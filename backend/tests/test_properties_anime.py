"""
Property-based tests for the anime generation pipeline.

Feature: education-anime-generator
Properties covered:
  - Property 16: Malformed request returns structured 400

PBT library: Hypothesis
Min iterations: 100 per property
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Minimal test app — anime router only, no DB lifespan
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def client():
    """Minimal FastAPI app with just the anime router — no DB lifespan."""
    from app.routers.anime import router as anime_router

    mini_app = FastAPI()
    mini_app.include_router(anime_router, prefix="/api/v1/anime")

    with TestClient(mini_app, raise_server_exceptions=False) as c:
        yield c


# ---------------------------------------------------------------------------
# Strategies — bodies that fail schema validation
# ---------------------------------------------------------------------------

# Missing required 'topic' field
_missing_topic = st.just({})

# topic is wrong type (not a string)
_wrong_type_topic = st.one_of(
    st.just({"topic": 123}),
    st.just({"topic": None}),
    st.just({"topic": []}),
    st.just({"topic": True}),
)

# topic is empty string (min_length=1 violated)
_empty_topic = st.just({"topic": ""})

# topic exceeds max_length=500
_too_long_topic = st.just({"topic": "x" * 501})

# invalid style value
_invalid_style = st.just({"topic": "photosynthesis", "style": "underwater"})

# completely non-JSON body — sent as raw bytes
_non_json_bodies = st.sampled_from([
    b"not json at all",
    b"<xml>bad</xml>",
    b"",
    b"null",
    b"[]",
])

# Combine all malformed JSON-body strategies
_malformed_json_body = st.one_of(
    _missing_topic,
    _wrong_type_topic,
    _empty_topic,
    _too_long_topic,
    _invalid_style,
)


# ---------------------------------------------------------------------------
# Property 16: Malformed request returns structured 400
# Feature: education-anime-generator, Property 16: Malformed request returns structured 400
# Validates: Requirements 4.9
# ---------------------------------------------------------------------------

@given(body=_malformed_json_body)
@settings(max_examples=100)
def test_malformed_json_body_returns_422_or_400(client, body: dict) -> None:
    """
    Feature: education-anime-generator, Property 16: Malformed request returns structured 400

    For any request body that fails schema validation, the API must return
    HTTP 400 or 422 with a structured response body.

    FastAPI returns 422 Unprocessable Entity for Pydantic validation failures,
    which satisfies the requirement for a structured error response describing
    each validation failure.
    """
    response = client.post(
        "/api/v1/anime/generate",
        json=body,
        headers={"X-API-Key": "dev-api-key"},
    )

    # FastAPI uses 422 for Pydantic validation errors (which is the standard
    # HTTP status for semantic validation failures per RFC 9110).
    # Both 400 and 422 satisfy Requirement 4.9.
    assert response.status_code in (400, 422), (
        f"Expected 400 or 422 for malformed body {body!r}, got {response.status_code}"
    )

    data = response.json()

    # Response must be structured (not a plain string)
    assert isinstance(data, dict), (
        f"Response body must be a JSON object, got {type(data).__name__}"
    )

    # FastAPI 422 responses include a 'detail' array describing each failure
    # Custom 400 responses must include a non-empty 'details' or 'detail' key
    has_detail = "detail" in data or "details" in data or "error" in data
    assert has_detail, (
        f"Structured error response must contain 'detail', 'details', or 'error' key. Got: {data}"
    )


@given(body=_malformed_json_body)
@settings(max_examples=100)
def test_malformed_request_detail_is_non_empty(client, body: dict) -> None:
    """
    Feature: education-anime-generator, Property 16: Malformed request returns structured 400

    The 'detail' array (or equivalent) in the error response must be non-empty,
    describing at least one validation failure.
    """
    response = client.post(
        "/api/v1/anime/generate",
        json=body,
        headers={"X-API-Key": "dev-api-key"},
    )

    assert response.status_code in (400, 422)
    data = response.json()

    # FastAPI 422: detail is a list of validation error objects
    if "detail" in data and isinstance(data["detail"], list):
        assert len(data["detail"]) > 0, (
            f"'detail' list must be non-empty for malformed body {body!r}"
        )


def test_non_json_body_returns_4xx(client) -> None:
    """
    Feature: education-anime-generator, Property 16: Malformed request returns structured 400

    Sending a non-JSON body must return a 4xx status code.
    """
    response = client.post(
        "/api/v1/anime/generate",
        content=b"not json at all",
        headers={
            "Content-Type": "application/json",
            "X-API-Key": "dev-api-key",
        },
    )
    assert 400 <= response.status_code < 500, (
        f"Expected 4xx for non-JSON body, got {response.status_code}"
    )


def test_valid_request_does_not_return_400(client) -> None:
    """
    Feature: education-anime-generator, Property 16: Malformed request returns structured 400 (inverse)

    A well-formed request must NOT return 400 or 422 due to schema validation.
    We verify this by checking FastAPI's validation layer directly — a valid
    AnimeGenerateRequest must parse without error.
    """
    from app.routers.anime import AnimeGenerateRequest

    # These must all parse without raising ValidationError
    valid_bodies = [
        {"topic": "photosynthesis"},
        {"topic": "Newton's laws", "style": "laboratory"},
        {"topic": "cell division", "style": "fantasy", "include_animation": True},
        {"topic": "x" * 500},  # max length boundary
    ]

    for body in valid_bodies:
        req = AnimeGenerateRequest(**body)
        assert req.topic == body["topic"]
