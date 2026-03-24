"""
Property-based tests for job processing invariants.

Feature: education-anime-generator
Properties covered:
  - Property 9:  Retry count bounded (never exceeds 3; status is "failed" after 3 retries)
  - Property 2:  Job status progression is monotonic (queued → processing → complete|failed)
  - Property 1:  Job ID uniqueness

PBT library: Hypothesis
Min iterations: 100 per property
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Minimal in-memory Job model for pure property testing
# (mirrors app/models/anime_assets.py fields without DB dependency)
# ---------------------------------------------------------------------------

_VALID_STATUSES = ("queued", "processing", "complete", "failed")
_STATUS_ORDER = {s: i for i, s in enumerate(_VALID_STATUSES)}


class InMemoryJob:
    """Lightweight stand-in for the SQLAlchemy Job model."""

    MAX_RETRIES = 3

    def __init__(self, topic: str, job_type: str = "anime", session_id: str = ""):
        self.job_id = str(uuid.uuid4())
        self.type = job_type
        self.status = "queued"
        self.topic = topic
        self.retry_count = 0
        self.error_message: str | None = None
        self.created_at = datetime.now(timezone.utc)

    def advance(self, to: str) -> None:
        """Attempt to advance status. Raises ValueError on regression."""
        if _STATUS_ORDER[to] < _STATUS_ORDER[self.status]:
            raise ValueError(
                f"Illegal status regression: {self.status!r} → {to!r}"
            )
        self.status = to

    def record_failure(self, error: str) -> None:
        """Increment retry_count; mark failed once limit is reached."""
        self.retry_count += 1
        self.error_message = error
        if self.retry_count >= self.MAX_RETRIES:
            self.status = "failed"

    def simulate_retry_sequence(self, failure_count: int) -> None:
        """Drive the job through `failure_count` failures then success."""
        self.advance("processing")
        for _ in range(failure_count):
            self.record_failure("transient error")
            if self.status == "failed":
                return
            # Reset to processing for next attempt
            self.status = "processing"
        self.advance("complete")


# ---------------------------------------------------------------------------
# Property 9: Retry count bounded
# Feature: education-anime-generator, Property 9: Retry count bounded
# Validates: Requirements 7.3
# ---------------------------------------------------------------------------

@given(failure_count=st.integers(min_value=0, max_value=10))
@settings(max_examples=100)
def test_retry_count_never_exceeds_max(failure_count: int) -> None:
    """
    Feature: education-anime-generator, Property 9: Retry count bounded

    For any number of failures, retry_count must never exceed 3, and after
    3 retries the job status must be "failed".
    """
    job = InMemoryJob(topic="photosynthesis")
    job.simulate_retry_sequence(failure_count)

    assert job.retry_count <= InMemoryJob.MAX_RETRIES, (
        f"retry_count={job.retry_count} exceeds MAX_RETRIES={InMemoryJob.MAX_RETRIES}"
    )

    if failure_count >= InMemoryJob.MAX_RETRIES:
        assert job.status == "failed", (
            f"Expected status='failed' after {failure_count} failures, got {job.status!r}"
        )


@given(failure_count=st.integers(min_value=3, max_value=20))
@settings(max_examples=100)
def test_job_marked_failed_after_max_retries(failure_count: int) -> None:
    """
    Feature: education-anime-generator, Property 9: Retry count bounded

    When failures >= MAX_RETRIES, the job must end in 'failed' status.
    """
    job = InMemoryJob(topic="newton's laws")
    job.simulate_retry_sequence(failure_count)

    assert job.status == "failed"
    assert job.retry_count == InMemoryJob.MAX_RETRIES


# ---------------------------------------------------------------------------
# Property 2: Job status progression is monotonic
# Feature: education-anime-generator, Property 2: Job status progression is monotonic
# Validates: Requirements 4.5, 7.2
# ---------------------------------------------------------------------------

@given(
    path=st.sampled_from([
        ["queued", "processing", "complete"],
        ["queued", "processing", "failed"],
        ["queued", "complete"],
        ["queued", "failed"],
    ])
)
@settings(max_examples=100)
def test_valid_status_paths_do_not_raise(path: list[str]) -> None:
    """
    Feature: education-anime-generator, Property 2: Job status progression is monotonic

    Any forward-only status path must be accepted without error.
    """
    job = InMemoryJob(topic="cell division")
    for status in path[1:]:  # skip initial "queued" (already set)
        job.advance(status)
    assert job.status == path[-1]


@given(
    regression=st.sampled_from([
        ("processing", "queued"),
        ("complete", "processing"),
        ("complete", "queued"),
        ("failed", "queued"),
        ("failed", "processing"),
    ])
)
@settings(max_examples=100)
def test_status_regression_raises(regression: tuple[str, str]) -> None:
    """
    Feature: education-anime-generator, Property 2: Job status progression is monotonic

    Attempting to move a job backward in the status sequence must raise ValueError.
    """
    from_status, to_status = regression
    job = InMemoryJob(topic="gravity")
    job.status = from_status  # force to intermediate state

    with pytest.raises(ValueError, match="Illegal status regression"):
        job.advance(to_status)


# ---------------------------------------------------------------------------
# Property 1: Job ID uniqueness
# Feature: education-anime-generator, Property 1: Job ID uniqueness
# Validates: Requirements 4.2, 7.2
# ---------------------------------------------------------------------------

@given(n=st.integers(min_value=2, max_value=50))
@settings(max_examples=100)
def test_job_ids_are_unique(n: int) -> None:
    """
    Feature: education-anime-generator, Property 1: Job ID uniqueness

    For any N job submissions, all returned job_ids must be distinct UUIDs.
    """
    jobs = [InMemoryJob(topic=f"topic-{i}") for i in range(n)]
    ids = [j.job_id for j in jobs]

    assert len(ids) == len(set(ids)), (
        f"Duplicate job IDs found among {n} jobs"
    )

    # Each ID must be a valid UUID
    for job_id in ids:
        parsed = uuid.UUID(job_id)  # raises ValueError if invalid
        assert str(parsed) == job_id, f"job_id {job_id!r} is not a canonical UUID string"
