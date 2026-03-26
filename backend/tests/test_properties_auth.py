"""
Property-based tests for authentication.

Feature: education-anime-generator
Properties covered:
  - Property 18: Unauthenticated requests are rejected

PBT library: Hypothesis
Min iterations: 100 per property
"""
from __future__ import annotations

import uuid

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from fastapi import HTTPException
from fastapi.testclient import TestClient

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Strings that are definitely NOT valid API keys or session UUIDs
_garbage_strings = st.one_of(
    st.just(""),
    st.just("   "),
    st.text(min_size=1, max_size=64).filter(lambda s: s.strip() != ""),
)

_valid_uuid = st.uuids().map(str)


# ---------------------------------------------------------------------------
# Unit-level tests against the dependency directly
# ---------------------------------------------------------------------------

@given(bad_key=_garbage_strings, bad_session=_garbage_strings)
@settings(max_examples=100)
def test_invalid_credentials_raise_401(bad_key: str, bad_session: str) -> None:
    """
    Feature: education-anime-generator, Property 18: Unauthenticated requests are rejected

    For any combination of invalid/missing API key and invalid session_id,
    get_current_session must raise HTTP 401 before any processing begins.
    """
    import asyncio
    from app.core.auth import get_current_session, _VALID_API_KEYS

    # Ensure the bad_key is not accidentally in the valid set
    if bad_key in _VALID_API_KEYS:
        return  # skip — this is a valid key, not a test case for rejection

    with pytest.raises(HTTPException) as exc_info:
        asyncio.get_event_loop().run_until_complete(
            get_current_session(x_api_key=bad_key or None, session_id=bad_session or None)
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["error"] == "unauthorized"


@given(bad_key=_garbage_strings)
@settings(max_examples=100)
def test_missing_session_with_bad_key_raises_401(bad_key: str) -> None:
    """
    Feature: education-anime-generator, Property 18: Unauthenticated requests are rejected

    No session_id + invalid API key must always yield 401.
    """
    import asyncio
    from app.core.auth import get_current_session, _VALID_API_KEYS

    if bad_key in _VALID_API_KEYS:
        return

    with pytest.raises(HTTPException) as exc_info:
        asyncio.get_event_loop().run_until_complete(
            get_current_session(x_api_key=bad_key or None, session_id=None)
        )

    assert exc_info.value.status_code == 401


@given(session_id=_valid_uuid)
@settings(max_examples=100)
def test_valid_session_uuid_is_accepted(session_id: str) -> None:
    """
    Feature: education-anime-generator, Property 18: Unauthenticated requests are rejected (inverse)

    A valid UUID session_id must be accepted and must not raise 401.
    """
    import asyncio
    from app.core.auth import get_current_session

    result = asyncio.get_event_loop().run_until_complete(
        get_current_session(x_api_key=None, session_id=session_id)
    )

    assert result["session_id"] == session_id
    assert result["api_key"] is None


def test_valid_api_key_is_accepted() -> None:
    """
    Feature: education-anime-generator, Property 18: Unauthenticated requests are rejected (inverse)

    The configured API key must be accepted and must not raise 401.
    """
    import asyncio
    from app.core.auth import get_current_session, _DEV_API_KEY

    if not _DEV_API_KEY:
        pytest.skip("No API key configured")

    result = asyncio.get_event_loop().run_until_complete(
        get_current_session(x_api_key=_DEV_API_KEY, session_id=None)
    )

    assert result["api_key"] == _DEV_API_KEY
    assert result["session_id"]  # derived session_id must be non-empty


# ---------------------------------------------------------------------------
# HTTP-level tests via a minimal TestClient app (no DB lifespan dependency)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    """Minimal FastAPI app with just the jobs router — no DB lifespan."""
    from fastapi import FastAPI
    from app.routers.jobs import router as jobs_router

    mini_app = FastAPI()
    mini_app.include_router(jobs_router, prefix="/api/v1/jobs")

    with TestClient(mini_app) as c:
        yield c


def test_protected_endpoint_without_credentials_returns_401(client) -> None:
    """
    Feature: education-anime-generator, Property 18: Unauthenticated requests are rejected

    A request to a protected endpoint with no credentials must return 401.
    """
    response = client.get("/api/v1/jobs", headers={})
    assert response.status_code == 401


def test_protected_endpoint_with_valid_api_key_returns_not_401(client) -> None:
    """
    Feature: education-anime-generator, Property 18: Unauthenticated requests are rejected (inverse)

    A request with a valid API key must not be rejected with 401.
    """
    from app.core.auth import _DEV_API_KEY

    if not _DEV_API_KEY:
        pytest.skip("No API key configured")

    response = client.get("/api/v1/jobs", headers={"X-API-Key": _DEV_API_KEY})
    assert response.status_code != 401
