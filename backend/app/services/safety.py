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
        # Violence / harm
        "kill", "murder", "suicide", "self-harm", "torture", "gore",
        "massacre", "genocide", "terrorism", "bomb", "explosive",
        # Sexual / adult
        "porn", "pornography", "nude", "nudity", "explicit", "nsfw",
        "hentai", "erotic", "sexual",
        # Hate speech
        "racist", "racism", "nazi", "slur", "hate speech",
        # Drugs
        "cocaine", "heroin", "meth", "methamphetamine", "drug synthesis",
        # Weapons
        "weapon synthesis", "gun making", "how to make a bomb",
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
        self._groq = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""))
        self._model = "llama-guard-3-8b"

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
        """Call LlamaGuard 3 8B via Groq and parse the response."""
        try:
            completion = await self._groq.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": _LLAMAGUARD_SYSTEM},
                    {"role": "user", "content": text},
                ],
                max_tokens=10,
                temperature=0,
            )
            raw: str = (completion.choices[0].message.content or "").strip().upper()
        except Exception as exc:
            # Fail open with a warning — don't block generation on API errors
            logger.warning("LlamaGuard API call failed: %s — defaulting to SAFE", exc)
            return SafetyResult(
                safe=True,
                reason="Safety classifier unavailable — defaulting to safe",
                classifier_output="ERROR",
            )

        is_safe = raw.startswith("SAFE")
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
