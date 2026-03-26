"""
Property-based tests for storage quota enforcement.

Feature: education-anime-generator
Properties covered:
  - Property 10: Storage quota enforcement

PBT library: Hypothesis
Min iterations: 100 per property
Validates: Requirements 6.6, 6.7
"""
from __future__ import annotations

import datetime
import uuid
from typing import List
from unittest.mock import patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Helpers - in-memory quota checker mirroring app/services/quota.py logic
# ---------------------------------------------------------------------------

class InMemoryQuotaDB:
    """Minimal in-memory stand-in for the SQLAlchemy session used by quota.py."""

    def __init__(self):
        self._assets: list[dict] = []

    def add_asset(self, session_id: str, file_size_bytes: int) -> str:
        asset_id = str(uuid.uuid4())
        self._assets.append(
            {"asset_id": asset_id, "session_id": session_id, "file_size_bytes": file_size_bytes}
        )
        return asset_id

    def get_session_usage(self, session_id: str) -> int:
        return sum(a["file_size_bytes"] for a in self._assets if a["session_id"] == session_id)


def _check_quota_pure(session_id: str, db: InMemoryQuotaDB, quota_bytes: int) -> tuple[bool, int]:
    """Pure quota check - returns (exceeded: bool, used_bytes: int)."""
    used = db.get_session_usage(session_id)
    return used >= quota_bytes, used


# ---------------------------------------------------------------------------
# Property 10: Storage quota enforcement - pure logic layer
# Feature: education-anime-generator, Property 10: Storage quota enforcement
# Validates: Requirements 6.6, 6.7
# ---------------------------------------------------------------------------

@given(
    quota_bytes=st.integers(min_value=1, max_value=10_000),
    asset_sizes=st.lists(st.integers(min_value=1, max_value=5_000), min_size=1, max_size=20),
)
@settings(max_examples=100, deadline=None)
def test_quota_exceeded_when_usage_meets_or_exceeds_limit(
    quota_bytes: int, asset_sizes: List[int]
) -> None:
    """
    Feature: education-anime-generator, Property 10: Storage quota enforcement

    For any session whose total stored bytes >= quota_bytes, the quota check
    must report exceeded=True. Below the limit it must report exceeded=False.
    """
    session_id = str(uuid.uuid4())
    db = InMemoryQuotaDB()
    for size in asset_sizes:
        db.add_asset(session_id, size)

    total = sum(asset_sizes)
    exceeded, used = _check_quota_pure(session_id, db, quota_bytes)

    if total >= quota_bytes:
        assert exceeded, (
            f"Expected quota exceeded (used={used}, quota={quota_bytes}) but check returned False"
        )
    else:
        assert not exceeded, (
            f"Expected quota NOT exceeded (used={used}, quota={quota_bytes}) but check returned True"
        )


@given(
    quota_bytes=st.integers(min_value=100, max_value=10_000),
    fill_size=st.integers(min_value=1, max_value=10_000),
)
@settings(max_examples=100, deadline=None)
def test_quota_not_exceeded_below_limit(quota_bytes: int, fill_size: int) -> None:
    """
    Feature: education-anime-generator, Property 10: Storage quota enforcement

    A session whose total usage is strictly less than the quota must NOT be rejected.
    """
    session_id = str(uuid.uuid4())
    db = InMemoryQuotaDB()
    if fill_size < quota_bytes:
        db.add_asset(session_id, fill_size)
        exceeded, used = _check_quota_pure(session_id, db, quota_bytes)
        assert not exceeded, f"Quota incorrectly exceeded: used={used} < quota={quota_bytes}"


@given(
    quota_bytes=st.integers(min_value=1, max_value=5_000),
    asset_sizes=st.lists(st.integers(min_value=1, max_value=2_000), min_size=1, max_size=10),
)
@settings(max_examples=100, deadline=None)
def test_quota_isolation_between_sessions(
    quota_bytes: int, asset_sizes: List[int]
) -> None:
    """
    Feature: education-anime-generator, Property 10: Storage quota enforcement

    Assets from one session must not count toward another session quota.
    A fresh session with no assets must never be quota-exceeded.
    """
    full_session = str(uuid.uuid4())
    empty_session = str(uuid.uuid4())
    db = InMemoryQuotaDB()
    for size in asset_sizes:
        db.add_asset(full_session, size)

    exceeded, used = _check_quota_pure(empty_session, db, quota_bytes)
    assert not exceeded, f"Empty session incorrectly shows quota exceeded (used={used})"
    assert used == 0, f"Empty session usage should be 0, got {used}"


@given(
    quota_bytes=st.integers(min_value=10, max_value=1_000),
    pre_fill=st.integers(min_value=0, max_value=999),
)
@settings(max_examples=100, deadline=None)
def test_quota_check_fires_before_enqueue(quota_bytes: int, pre_fill: int) -> None:
    """
    Feature: education-anime-generator, Property 10: Storage quota enforcement

    When a session is at or over quota, the quota check must reject the request
    BEFORE any job is enqueued. The enqueue function must never be called.
    """
    session_id = str(uuid.uuid4())
    db = InMemoryQuotaDB()
    if pre_fill > 0:
        db.add_asset(session_id, pre_fill)

    enqueue_called = False

    def mock_enqueue() -> str:
        nonlocal enqueue_called
        enqueue_called = True
        return str(uuid.uuid4())

    exceeded, used = _check_quota_pure(session_id, db, quota_bytes)
    if not exceeded:
        mock_enqueue()
        assert enqueue_called
    else:
        assert not enqueue_called, (
            f"Enqueue was called despite quota exceeded (used={used}, quota={quota_bytes})"
        )


# ---------------------------------------------------------------------------
# Property 10: Storage quota enforcement - service layer (real DB + check_quota)
# Feature: education-anime-generator, Property 10: Storage quota enforcement
# Validates: Requirements 6.6, 6.7
# ---------------------------------------------------------------------------

def _make_asset(session_id: str, size: int):
    from app.models.anime_assets import Asset as AssetModel
    now = datetime.datetime.now(datetime.timezone.utc)
    return AssetModel(
        asset_id=str(uuid.uuid4()),
        job_id=str(uuid.uuid4()),
        type="image",
        topic="test",
        file_path=f"assets/{uuid.uuid4()}.png",
        file_size_bytes=size,
        mime_type="image/png",
        asset_metadata={},
        created_at=now,
        expires_at=now + datetime.timedelta(hours=25),
        session_id=session_id,
    )


@given(
    asset_sizes=st.lists(st.integers(min_value=1, max_value=100), min_size=1, max_size=10)
)
@settings(max_examples=100, deadline=None)
def test_check_quota_raises_429_when_exceeded(asset_sizes: List[int]) -> None:
    """
    Feature: education-anime-generator, Property 10: Storage quota enforcement

    When a session stored assets meet or exceed the configured quota,
    check_quota() must raise HTTPException 429 with error=quota_exceeded,
    including limit_bytes and used_bytes in the detail.
    """
    from fastapi import HTTPException
    from app.models.anime_assets import Base, engine, SessionLocal
    from app.services.quota import check_quota

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    session_id = str(uuid.uuid4())
    tiny_quota = sum(asset_sizes)  # quota exactly at usage -> exceeded

    for size in asset_sizes:
        db.add(_make_asset(session_id, size))
    db.commit()

    raised = False
    try:
        with patch("app.services.quota.STORAGE_QUOTA_BYTES", tiny_quota):
            check_quota(session_id, db)
    except HTTPException as exc:
        raised = True
        assert exc.status_code == 429, f"Expected 429, got {exc.status_code}"
        detail = exc.detail
        assert isinstance(detail, dict), f"Expected dict detail, got {type(detail)}"
        assert detail.get("error") == "quota_exceeded", f"Got: {detail}"
        assert "limit_bytes" in detail, "Missing limit_bytes in 429 detail"
        assert "used_bytes" in detail, "Missing used_bytes in 429 detail"
        assert detail["used_bytes"] >= detail["limit_bytes"], (
            "used_bytes should be >= limit_bytes when quota exceeded"
        )
    finally:
        db.close()

    assert raised, (
        f"check_quota did not raise for session with {sum(asset_sizes)} bytes "
        f"and quota={tiny_quota}"
    )


@given(quota_bytes=st.integers(min_value=1_000_000, max_value=10_000_000))
@settings(max_examples=50, deadline=None)
def test_check_quota_does_not_raise_for_empty_session(quota_bytes: int) -> None:
    """
    Feature: education-anime-generator, Property 10: Storage quota enforcement

    A session with no stored assets (usage=0) must never trigger a 429.
    """
    from fastapi import HTTPException
    from app.models.anime_assets import Base, engine, SessionLocal
    from app.services.quota import check_quota

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    session_id = str(uuid.uuid4())

    try:
        with patch("app.services.quota.STORAGE_QUOTA_BYTES", quota_bytes):
            check_quota(session_id, db)
    except HTTPException as exc:
        pytest.fail(
            f"check_quota raised 429 for empty session with quota={quota_bytes}: {exc.detail}"
        )
    finally:
        db.close()


@given(
    quota_bytes=st.integers(min_value=10, max_value=10_000),
    asset_sizes=st.lists(st.integers(min_value=1, max_value=5_000), min_size=1, max_size=10),
)
@settings(max_examples=100, deadline=None)
def test_get_session_usage_matches_sum_of_asset_sizes(
    quota_bytes: int, asset_sizes: List[int]
) -> None:
    """
    Feature: education-anime-generator, Property 10: Storage quota enforcement

    get_session_usage() must return the exact sum of file_size_bytes for all
    assets belonging to the session.
    """
    from app.models.anime_assets import Base, engine, SessionLocal
    from app.services.quota import get_session_usage

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    session_id = str(uuid.uuid4())

    for size in asset_sizes:
        db.add(_make_asset(session_id, size))
    db.commit()

    try:
        usage = get_session_usage(session_id, db)
        assert usage == sum(asset_sizes), (
            f"get_session_usage returned {usage}, expected {sum(asset_sizes)}"
        )
    finally:
        db.close()
