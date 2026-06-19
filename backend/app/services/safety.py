"""
Content safety filter service.

Two-stage safety pipeline (Requirements 8.1, 8.2, 8.4):
  Stage 1 — Keyword blocklist: instant rejection before any API call.
  Stage 2 — LlamaGuard 3 8B via Groq API: semantic classification.

Public API:
  check_topic(topic: str) -> SafetyResult   — pre-generation check
  check_content(text: str) -> SafetyResult  — post-generation check
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from groq import AsyncGroq

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Keyword blocklist — fast pre-generation rejection (Requirement 8.4)
# ---------------------------------------------------------------------------

_BLOCKLIST: frozenset[str] = frozenset(
    {
        # Sexual / adult — never educational
        "porn", "pornography", "nude", "nudity", "nsfw",
        "hentai", "erotic",
        # Hate speech — never educational
        "racist", "racism", "slur", "hate speech",
        # Specific harmful instructions — not general terms
        "drug synthesis", "weapon synthesis", "gun making",
        "how to make a bomb", "how to make drugs",
        # Self-harm instructions
        "suicide method", "self-harm method",
    }
)


def _contains_blocked_keyword(text: str) -> str | None:
    """Return the first matched blocked keyword, or None if clean."""
    lower = text.lower()
    for kw in _BLOCKLIST:
        # Use word-boundary matching to avoid false positives
        pattern = r"\b" + re.escape(kw) + r"\b"
        if re.search(pattern, lower):
            return kw
    return None


# ---------------------------------------------------------------------------
# LlamaGuard prompt template
# ---------------------------------------------------------------------------

_LLAMAGUARD_SYSTEM = (
    "You are a content safety classifier for an educational platform used by students. "
    "Classify the following text as SAFE or UNSAFE for educational use. "
    "Historical events (wars, revolutions, conflicts, political movements), "
    "scientific topics, literary analysis, and all standard academic subjects "
    "are SAFE — even if they involve historical violence, political upheaval, "
    "or sensitive historical periods. "
    "Only classify content as UNSAFE if it contains explicit sexual content, "
    "instructions for creating weapons or drugs, promotion of self-harm, "
    "or targeted hate speech. "
    "Respond with exactly one word: SAFE or UNSAFE."
)


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class SafetyResult:
    safe: bool
    reason: str = ""
    matched_keyword: str | None = None
    classifier_output: str | None = None
    checked_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# SafetyService
# ---------------------------------------------------------------------------

class SafetyService:
    """Stateless safety filter — one instance shared across the app."""

    def __init__(self) -> None:
        self._groq = AsyncGroq(
            api_key=os.environ.get("GROQ_API_KEY", ""),
            timeout=10.0,   # enough for a response, but won't block long
            max_retries=1,  # one retry for transient network blips
        )
        self._model = "openai/gpt-oss-safeguard-20b"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def check_topic(self, topic: str) -> SafetyResult:
        """
        Pre-generation safety check on a user-supplied topic string.

        Stage 1: keyword blocklist (synchronous, no API call).
        Stage 2: LlamaGuard 3 via Groq (async API call).

        Returns SafetyResult(safe=False) immediately on blocklist hit
        without making any API call.
        """
        # Stage 1 — blocklist
        matched = _contains_blocked_keyword(topic)
        if matched:
            result = SafetyResult(
                safe=False,
                reason=f"Topic contains blocked keyword: '{matched}'",
                matched_keyword=matched,
            )
            self._log_violation(topic, result)
            return result

        # Stage 2 — LlamaGuard
        return await self._classify(topic)

    async def check_content(self, text: str) -> SafetyResult:
        """
        Post-generation safety check on generated text/captions.

        Runs both blocklist and LlamaGuard stages.
        """
        matched = _contains_blocked_keyword(text)
        if matched:
            result = SafetyResult(
                safe=False,
                reason=f"Generated content contains blocked keyword: '{matched}'",
                matched_keyword=matched,
            )
            self._log_violation(text[:200], result)
            return result

        return await self._classify(text)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _classify(self, text: str) -> SafetyResult:
        """Call safety classifier via Groq and parse the response.

        The GPT-OSS-Safeguard model may return structured "Harmony" format
        output rather than a plain SAFE/UNSAFE token.  We search the full
        response for explicit "unsafe" signals and default to *safe* when the
        output is empty or unrecognisable — the keyword blocklist already
        catches obviously harmful content, so failing open here avoids
        blocking legitimate educational topics.
        """
        try:
            # Wrap input with educational context to reduce false positives
            # on legitimate academic topics (e.g. "the french revolution")
            contextualised_input = (
                f"The following is a topic submitted by a student on an educational "
                f"learning platform for educational content generation:\n\n{text}"
            )
            completion = await self._groq.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _LLAMAGUARD_SYSTEM},
                    {"role": "user", "content": contextualised_input},
                ],
                max_tokens=50,  # allow room for Harmony-format responses
                temperature=0,
            )
            raw: str = (completion.choices[0].message.content or "").strip()
        except Exception as exc:
            # Fail open with a warning — don't block generation on API errors
            logger.warning("Safety classifier API call failed: %s — defaulting to SAFE", exc)
            return SafetyResult(
                safe=True,
                reason="Safety classifier unavailable — defaulting to safe",
                classifier_output="ERROR",
            )

        upper = raw.upper()

        # Empty / whitespace-only response → fail open
        if not upper:
            logger.warning("Safety classifier returned empty response — defaulting to SAFE")
            return SafetyResult(
                safe=True,
                reason="Safety classifier returned empty response — defaulting to safe",
                classifier_output=raw,
            )

        # Determine safety: only flag as unsafe when the response explicitly
        # contains the word "unsafe" (handles both plain and Harmony formats).
        # A response containing "safe" (but NOT "unsafe") is considered safe.
        has_unsafe = "UNSAFE" in upper
        has_safe = "SAFE" in upper and not has_unsafe

        if has_unsafe:
            is_safe = False
        elif has_safe:
            is_safe = True
        else:
            # Unrecognisable output — fail open
            logger.warning(
                "Safety classifier returned unrecognisable output: %r — defaulting to SAFE",
                raw[:200],
            )
            is_safe = True

        result = SafetyResult(
            safe=is_safe,
            reason="" if is_safe else f"LlamaGuard classified content as unsafe: {raw}",
            classifier_output=raw,
        )

        if not is_safe:
            self._log_violation(text[:200], result)

        return result

    def _log_violation(self, topic_snippet: str, result: SafetyResult) -> None:
        """Log safety violations for audit (Requirement 8.3)."""
        logger.warning(
            "SAFETY_VIOLATION topic=%r keyword=%r classifier=%r reason=%r at=%s",
            topic_snippet,
            result.matched_keyword,
            result.classifier_output,
            result.reason,
            result.checked_at.isoformat(),
        )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

safety_service = SafetyService()
