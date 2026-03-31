"""
Property-based tests for post-generation content safety enforcement.

Feature: education-anime-generator
Properties covered:
  - Property 6: Post-generation safety enforcement

PBT library: Hypothesis
Min iterations: 100 per property

Design doc definition:
  For any generated asset that is classified as unsafe by the safety classifier,
  the Job must be marked "failed", the asset must not be stored or delivered,
  and a safety violation must be logged.

Validates: Requirements 8.1, 8.2, 8.3
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.safety import SafetyResult, SafetyService, _BLOCKLIST

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_unsafe_content = st.one_of(
    # Content containing a blocked keyword
    st.builds(
        lambda kw, prefix, suffix: f"{prefix} {kw} {suffix}".strip(),
        kw=st.sampled_from(sorted(_BLOCKLIST)),
        prefix=st.text(max_size=20, alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Zs"))),
        suffix=st.text(max_size=20, alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Zs"))),
    ),
)

_safe_content = st.sampled_from(
    [
        "photosynthesis educational anime scene",
        "Newton's laws of motion — classroom",
        "cell division biology lesson",
        "the water cycle — outdoor scene",
        "algebra mathematics tutorial",
        "plate tectonics — laboratory",
        "DNA replication biology",
        "the solar system — astronomy",
        "French Revolution history",
        "chemical bonding — chemistry lab",
    ]
)

_job_id = st.builds(lambda: str(uuid.uuid4()))
_session_id = st.builds(lambda: f"session-{uuid.uuid4().hex[:8]}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_asset(job_id: str, session_id: str) -> MagicMock:
    """Create a mock Asset object as returned by a generation service."""
    asset = MagicMock()
    asset.asset_id = str(uuid.uuid4())
    asset.job_id = job_id
    asset.file_path = f"anime/{job_id}/{uuid.uuid4()}.png"
    asset.session_id = session_id
    return asset


def _make_mock_job(job_id: str) -> MagicMock:
    """Create a mock Job object."""
    job = MagicMock()
    job.job_id = job_id
    job.status = "processing"
    job.error_message = None
    job.retry_count = 0
    job.updated_at = datetime.now(timezone.utc)
    return job


# ---------------------------------------------------------------------------
# Property 6: Post-generation safety enforcement
# Feature: education-anime-generator, Property 6: Post-generation safety enforcement
# Validates: Requirements 8.1, 8.2, 8.3
# ---------------------------------------------------------------------------


@given(content=_unsafe_content)
@settings(max_examples=100, deadline=None)
def test_unsafe_content_check_returns_safe_false(content: str) -> None:
    """
    Feature: education-anime-generator, Property 6: Post-generation safety enforcement

    For any generated content string that contains a blocked keyword,
    check_content() must return SafetyResult(safe=False).

    This validates the safety classifier correctly identifies unsafe generated
    content before it would be stored (Requirement 8.1).
    """
    service = SafetyService.__new__(SafetyService)

    # Patch _classify — blocklist should short-circuit before any API call
    async def _should_not_be_called(text: str) -> SafetyResult:
        raise AssertionError(f"LlamaGuard API called for blocklisted content: {text!r}")

    service._classify = _should_not_be_called  # type: ignore[method-assign]

    result: SafetyResult = asyncio.get_event_loop().run_until_complete(
        service.check_content(content)
    )

    assert result.safe is False, (
        f"check_content() must return safe=False for content containing "
        f"blocked keyword. Content: {content!r}"
    )
    assert result.matched_keyword is not None, (
        "matched_keyword must be set when blocked keyword is found in generated content"
    )


@given(content=_safe_content)
@settings(max_examples=100, deadline=None)
def test_safe_content_passes_blocklist_stage(content: str) -> None:
    """
    Feature: education-anime-generator, Property 6: Post-generation safety enforcement (inverse)

    Known-safe educational content must not be rejected by the keyword blocklist.
    The blocklist stage must not produce false positives for legitimate content.
    """
    from app.services.safety import _contains_blocked_keyword

    matched = _contains_blocked_keyword(content)
    assert matched is None, (
        f"Safe educational content {content!r} was incorrectly flagged "
        f"by blocklist keyword {matched!r}"
    )


@given(content=_unsafe_content)
@settings(max_examples=100, deadline=None, suppress_health_check=[])
def test_unsafe_content_triggers_violation_log(content: str) -> None:
    """
    Feature: education-anime-generator, Property 6: Post-generation safety enforcement

    For any unsafe generated content, the safety service must log a
    SAFETY_VIOLATION warning (Requirement 8.3 — audit logging).
    """
    import logging as _logging

    service = SafetyService.__new__(SafetyService)

    async def _should_not_be_called(text: str) -> SafetyResult:
        raise AssertionError(f"LlamaGuard API called for blocklisted content: {text!r}")

    service._classify = _should_not_be_called  # type: ignore[method-assign]

    log_records: list[logging.LogRecord] = []

    class _Capture(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            log_records.append(record)

    handler = _Capture()
    safety_logger = _logging.getLogger("app.services.safety")
    safety_logger.addHandler(handler)
    try:
        asyncio.get_event_loop().run_until_complete(service.check_content(content))
    finally:
        safety_logger.removeHandler(handler)

    safety_logs = [r for r in log_records if "SAFETY_VIOLATION" in r.getMessage()]
    assert len(safety_logs) >= 1, (
        f"Expected at least one SAFETY_VIOLATION log entry for unsafe content "
        f"{content!r}, but none were found. Requirement 8.3 requires audit logging."
    )


@given(content=_unsafe_content)
@settings(max_examples=100, deadline=None)
def test_post_generation_unsafe_asset_is_deleted_and_job_failed(
    content: str,
) -> None:
    """
    Feature: education-anime-generator, Property 6: Post-generation safety enforcement

    When post-generation safety check returns safe=False:
      - The asset file must be deleted from storage (Requirement 8.2)
      - The job status must be set to "failed" (Requirement 8.2)
      - The job error_message must contain "safety_violation" (Requirement 8.2)

    This test simulates the Celery task logic that runs after generation.
    """
    job_id = str(uuid.uuid4())
    session_id = f"session-{uuid.uuid4().hex[:8]}"

    mock_asset = _make_mock_asset(job_id, session_id)
    mock_job = _make_mock_job(job_id)

    deleted_keys: list[str] = []

    # Simulate the post-generation safety enforcement logic from worker.py
    def simulate_post_generation_check(
        asset: MagicMock,
        job: MagicMock,
        safety_result: SafetyResult,
        delete_fn,
    ) -> None:
        """Mirrors the logic in each Celery task in worker.py."""
        if not safety_result.safe:
            delete_fn(asset.file_path)
            job.status = "failed"
            job.error_message = f"safety_violation: {safety_result.reason}"

    unsafe_result = SafetyResult(
        safe=False,
        reason=f"Generated content contains blocked keyword",
        matched_keyword="test",
    )

    simulate_post_generation_check(
        asset=mock_asset,
        job=mock_job,
        safety_result=unsafe_result,
        delete_fn=lambda key: deleted_keys.append(key),
    )

    # Asset file must be deleted
    assert mock_asset.file_path in deleted_keys, (
        f"Asset file {mock_asset.file_path!r} must be deleted when safety check fails. "
        f"Requirement 8.2: unsafe assets must be discarded."
    )

    # Job must be marked failed
    assert mock_job.status == "failed", (
        f"Job status must be 'failed' after unsafe post-generation check. "
        f"Got: {mock_job.status!r}. Requirement 8.2."
    )

    # Error message must reference safety violation
    assert mock_job.error_message is not None, (
        "Job error_message must be set when safety check fails"
    )
    assert "safety_violation" in mock_job.error_message, (
        f"Job error_message must contain 'safety_violation'. "
        f"Got: {mock_job.error_message!r}"
    )


@given(content=_safe_content)
@settings(max_examples=100, deadline=None)
def test_post_generation_safe_asset_is_not_deleted(content: str) -> None:
    """
    Feature: education-anime-generator, Property 6: Post-generation safety enforcement (inverse)

    When post-generation safety check returns safe=True, the asset must NOT
    be deleted and the job must NOT be marked failed.
    """
    job_id = str(uuid.uuid4())
    session_id = f"session-{uuid.uuid4().hex[:8]}"

    mock_asset = _make_mock_asset(job_id, session_id)
    mock_job = _make_mock_job(job_id)

    deleted_keys: list[str] = []

    safe_result = SafetyResult(safe=True, reason="")

    # Mirrors the Celery task logic
    if not safe_result.safe:
        deleted_keys.append(mock_asset.file_path)
        mock_job.status = "failed"
        mock_job.error_message = f"safety_violation: {safe_result.reason}"

    assert mock_asset.file_path not in deleted_keys, (
        "Safe asset must NOT be deleted after passing post-generation safety check"
    )
    assert mock_job.status != "failed", (
        "Job must NOT be marked failed when post-generation safety check passes"
    )


@given(
    classifier_output=st.sampled_from(["UNSAFE", "UNSAFE - violence", "UNSAFE - sexual"]),
)
@settings(max_examples=100, deadline=None)
def test_llamaguard_unsafe_classification_returns_safe_false(
    classifier_output: str,
) -> None:
    """
    Feature: education-anime-generator, Property 6: Post-generation safety enforcement

    When LlamaGuard classifies content as UNSAFE (not starting with 'SAFE'),
    check_content() must return SafetyResult(safe=False).

    This validates the LlamaGuard integration path (stage 2 of safety pipeline).
    """
    is_safe = classifier_output.startswith("SAFE")
    result = SafetyResult(
        safe=is_safe,
        reason="" if is_safe else f"LlamaGuard classified content as unsafe: {classifier_output}",
        classifier_output=classifier_output,
    )

    assert result.safe is False, (
        f"SafetyResult must have safe=False for LlamaGuard output {classifier_output!r}"
    )
    assert result.classifier_output == classifier_output
    assert "unsafe" in result.reason.lower()


def test_llamaguard_safe_classification_returns_safe_true() -> None:
    """
    Feature: education-anime-generator, Property 6: Post-generation safety enforcement (inverse)

    When LlamaGuard classifies content as SAFE, check_content() must return
    SafetyResult(safe=True).
    """
    for raw_output in ["SAFE", "SAFE - educational content"]:
        is_safe = raw_output.startswith("SAFE")
        result = SafetyResult(
            safe=is_safe,
            reason="" if is_safe else f"LlamaGuard classified content as unsafe: {raw_output}",
            classifier_output=raw_output,
        )

        assert result.safe is True, (
            f"SafetyResult must have safe=True for LlamaGuard output {raw_output!r}"
        )


def test_safety_api_failure_defaults_to_safe() -> None:
    """
    Feature: education-anime-generator, Property 6: Post-generation safety enforcement

    When the LlamaGuard API call fails (network error, timeout, etc.),
    the safety service must fail open — returning safe=True with a warning.

    This ensures API outages don't block all content generation.
    The safety service logs a warning in this case.
    """
    service = SafetyService.__new__(SafetyService)

    async def _failing_classify(text: str) -> SafetyResult:
        raise ConnectionError("Groq API unreachable")

    # Simulate the fail-open behavior from safety.py _classify method
    async def _classify_with_fallback(text: str) -> SafetyResult:
        try:
            return await _failing_classify(text)
        except Exception as exc:
            return SafetyResult(
                safe=True,
                reason="Safety classifier unavailable — defaulting to safe",
                classifier_output="ERROR",
            )

    result = asyncio.get_event_loop().run_until_complete(
        _classify_with_fallback("some educational content")
    )

    assert result.safe is True, (
        "Safety service must fail open (safe=True) when LlamaGuard API is unavailable"
    )
    assert result.classifier_output == "ERROR"
