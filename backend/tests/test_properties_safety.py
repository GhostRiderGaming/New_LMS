"""
Property-based tests for content safety filtering.

Feature: education-anime-generator
Properties covered:
  - Property 5: Safety filter blocks unsafe topics pre-generation

PBT library: Hypothesis
Min iterations: 100 per property
"""
from __future__ import annotations

import asyncio

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Import the module under test
# ---------------------------------------------------------------------------

from app.services.safety import (
    SafetyResult,
    SafetyService,
    _BLOCKLIST,
    _contains_blocked_keyword,
)

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# A topic that embeds a known blocked keyword
_blocked_keyword = st.sampled_from(sorted(_BLOCKLIST))

_safe_educational_topics = st.sampled_from(
    [
        "photosynthesis",
        "Newton's laws of motion",
        "the water cycle",
        "World War II history",
        "cell division",
        "the solar system",
        "algebra",
        "the French Revolution",
        "DNA replication",
        "plate tectonics",
    ]
)

# Arbitrary text that wraps a blocked keyword with surrounding words
_surrounding_text = st.text(
    min_size=0,
    max_size=30,
    alphabet=st.characters(whitelist_categories=("Ll", "Lu", "Zs")),
)


# ---------------------------------------------------------------------------
# Property 5: Safety filter blocks unsafe topics pre-generation
# Feature: education-anime-generator, Property 5: Safety filter blocks unsafe topics pre-generation
# Validates: Requirements 8.4
# ---------------------------------------------------------------------------

@given(keyword=_blocked_keyword, prefix=_surrounding_text, suffix=_surrounding_text)
@settings(max_examples=100, deadline=None)
def test_blocklist_keyword_is_always_rejected(
    keyword: str, prefix: str, suffix: str
) -> None:
    """
    Feature: education-anime-generator, Property 5: Safety filter blocks unsafe topics pre-generation

    For any topic string that contains a keyword from the blocklist,
    _contains_blocked_keyword must return that keyword (non-None),
    indicating the request should be rejected before any generation pipeline
    is invoked.
    """
    topic = f"{prefix} {keyword} {suffix}".strip()
    matched = _contains_blocked_keyword(topic)

    assert matched is not None, (
        f"Expected blocklist to catch keyword {keyword!r} in topic {topic!r}, "
        f"but _contains_blocked_keyword returned None"
    )


@given(keyword=_blocked_keyword, prefix=_surrounding_text, suffix=_surrounding_text)
@settings(max_examples=100, deadline=None)
def test_check_topic_returns_unsafe_for_blocked_keyword(
    keyword: str, prefix: str, suffix: str
) -> None:
    """
    Feature: education-anime-generator, Property 5: Safety filter blocks unsafe topics pre-generation

    check_topic() must return SafetyResult(safe=False) for any topic
    containing a blocked keyword, without making any LlamaGuard API call
    (matched_keyword is set, classifier_output is None).
    """
    topic = f"{prefix} {keyword} {suffix}".strip()

    service = SafetyService.__new__(SafetyService)
    # Patch _classify to fail loudly if called — blocklist should short-circuit
    async def _should_not_be_called(text: str) -> SafetyResult:
        raise AssertionError(
            f"LlamaGuard API was called for a blocklisted topic: {text!r}"
        )
    service._classify = _should_not_be_called  # type: ignore[method-assign]

    result: SafetyResult = asyncio.get_event_loop().run_until_complete(
        service.check_topic(topic)
    )

    assert result.safe is False, (
        f"Expected safe=False for topic {topic!r} containing keyword {keyword!r}"
    )
    assert result.matched_keyword is not None, (
        "matched_keyword must be set when a blocklist keyword is found"
    )
    assert result.classifier_output is None, (
        "classifier_output must be None — LlamaGuard must NOT be called for blocklisted topics"
    )


@given(topic=_safe_educational_topics)
@settings(max_examples=100, deadline=None)
def test_safe_topics_pass_blocklist_stage(topic: str) -> None:
    """
    Feature: education-anime-generator, Property 5: Safety filter blocks unsafe topics pre-generation (inverse)

    Known-safe educational topics must not be caught by the keyword blocklist.
    """
    matched = _contains_blocked_keyword(topic)

    assert matched is None, (
        f"Safe topic {topic!r} was incorrectly flagged by blocklist keyword {matched!r}"
    )


@given(keyword=_blocked_keyword)
@settings(max_examples=100, deadline=None)
def test_blocked_keyword_exact_match(keyword: str) -> None:
    """
    Feature: education-anime-generator, Property 5: Safety filter blocks unsafe topics pre-generation

    A topic consisting solely of a blocked keyword must be caught.
    """
    matched = _contains_blocked_keyword(keyword)
    assert matched is not None, f"Exact keyword {keyword!r} not caught by blocklist"


@given(
    keyword=_blocked_keyword,
    case_transform=st.sampled_from(["upper", "title", "mixed"]),
)
@settings(max_examples=100, deadline=None)
def test_blocklist_is_case_insensitive(keyword: str, case_transform: str) -> None:
    """
    Feature: education-anime-generator, Property 5: Safety filter blocks unsafe topics pre-generation

    The blocklist check must be case-insensitive.
    """
    if case_transform == "upper":
        topic = keyword.upper()
    elif case_transform == "title":
        topic = keyword.title()
    else:
        # Alternate upper/lower per character
        topic = "".join(
            c.upper() if i % 2 == 0 else c.lower() for i, c in enumerate(keyword)
        )

    matched = _contains_blocked_keyword(topic)
    assert matched is not None, (
        f"Case-transformed keyword {topic!r} (original: {keyword!r}) not caught by blocklist"
    )
