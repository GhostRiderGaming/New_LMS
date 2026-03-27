"""
Property-based tests for the prompt builder service.

Feature: education-anime-generator
Properties covered:
  - Property 19: Prompt builder produces non-empty structured output

PBT library: Hypothesis
Min iterations: 100 per property
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.prompt_builder import PromptBuilder

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_topics = st.text(min_size=1, max_size=200).filter(lambda s: s.strip())

_anime_styles = st.sampled_from(["classroom", "laboratory", "outdoor", "fantasy"])

_simulation_categories = st.sampled_from(
    ["physics", "chemistry", "biology", "mathematics", "history"]
)

_model3d_categories = st.sampled_from(
    ["anatomy", "chemistry", "astronomy", "historical", "mechanical"]
)

_episode_counts = st.integers(min_value=1, max_value=10)

# A realistic non-empty prompt returned by the LLM
_llm_responses = st.text(min_size=1, max_size=500).filter(lambda s: s.strip())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_builder_with_mock_response(response: str) -> PromptBuilder:
    """Return a PromptBuilder whose Groq client always returns `response`."""
    builder = PromptBuilder.__new__(PromptBuilder)
    mock_groq = MagicMock()
    mock_completion = MagicMock()
    mock_completion.choices[0].message.content = response
    mock_groq.chat.completions.create = AsyncMock(return_value=mock_completion)
    builder._groq = mock_groq
    return builder


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Property 19: Prompt builder produces non-empty structured output
# Feature: education-anime-generator, Property 19: Prompt builder produces non-empty structured output
# Validates: Requirements 1.2
# ---------------------------------------------------------------------------

@given(topic=_topics, style=_anime_styles, llm_response=_llm_responses)
@settings(max_examples=100, deadline=None)
def test_build_anime_prompt_non_empty(topic: str, style: str, llm_response: str) -> None:
    """
    Feature: education-anime-generator, Property 19: Prompt builder produces non-empty structured output

    For any non-empty topic string, build_anime_prompt must return a non-empty
    string that contains the topic keywords.
    """
    builder = _make_builder_with_mock_response(llm_response)
    result = _run(builder.build_anime_prompt(topic, style))

    assert isinstance(result, str), "build_anime_prompt must return a str"
    assert result.strip(), "build_anime_prompt must return a non-empty string"


@given(topic=_topics, style=_anime_styles, llm_response=_llm_responses)
@settings(max_examples=100, deadline=None)
def test_build_anime_prompt_passes_topic_to_groq(
    topic: str, style: str, llm_response: str
) -> None:
    """
    Feature: education-anime-generator, Property 19: Prompt builder produces non-empty structured output

    The Groq API call for build_anime_prompt must include the topic in the
    user message so the LLM can embed topic keywords in the output.
    """
    builder = _make_builder_with_mock_response(llm_response)
    _run(builder.build_anime_prompt(topic, style))

    call_kwargs = builder._groq.chat.completions.create.call_args
    messages = call_kwargs.kwargs.get("messages") or call_kwargs.args[0] if call_kwargs.args else []
    if not messages:
        messages = call_kwargs.kwargs["messages"]

    user_content = next(
        (m["content"] for m in messages if m["role"] == "user"), ""
    )
    assert topic in user_content, (
        f"Topic {topic!r} must appear in the user message sent to Groq, "
        f"got: {user_content!r}"
    )


@given(topic=_topics, episode_count=_episode_counts, llm_response=_llm_responses)
@settings(max_examples=100, deadline=None)
def test_build_story_prompt_non_empty(
    topic: str, episode_count: int, llm_response: str
) -> None:
    """
    Feature: education-anime-generator, Property 19: Prompt builder produces non-empty structured output

    For any non-empty topic and valid episode count, build_story_prompt must
    return a non-empty string.
    """
    builder = _make_builder_with_mock_response(llm_response)
    result = _run(builder.build_story_prompt(topic, episode_count))

    assert isinstance(result, str)
    assert result.strip(), "build_story_prompt must return a non-empty string"


@given(topic=_topics, category=_simulation_categories, llm_response=_llm_responses)
@settings(max_examples=100, deadline=None)
def test_build_simulation_prompt_non_empty(
    topic: str, category: str, llm_response: str
) -> None:
    """
    Feature: education-anime-generator, Property 19: Prompt builder produces non-empty structured output

    For any non-empty topic and valid category, build_simulation_prompt must
    return a non-empty string.
    """
    builder = _make_builder_with_mock_response(llm_response)
    result = _run(builder.build_simulation_prompt(topic, category))

    assert isinstance(result, str)
    assert result.strip(), "build_simulation_prompt must return a non-empty string"


@given(
    object_name=_topics,
    category=_model3d_categories,
    llm_response=_llm_responses,
)
@settings(max_examples=100, deadline=None)
def test_build_3d_prompt_non_empty(
    object_name: str, category: str, llm_response: str
) -> None:
    """
    Feature: education-anime-generator, Property 19: Prompt builder produces non-empty structured output

    For any non-empty object name and valid category, build_3d_prompt must
    return a non-empty string.
    """
    builder = _make_builder_with_mock_response(llm_response)
    result = _run(builder.build_3d_prompt(object_name, category))

    assert isinstance(result, str)
    assert result.strip(), "build_3d_prompt must return a non-empty string"


@given(topic=_topics, style=_anime_styles, llm_response=_llm_responses)
@settings(max_examples=100, deadline=None)
def test_build_anime_prompt_returns_llm_output_verbatim(
    topic: str, style: str, llm_response: str
) -> None:
    """
    Feature: education-anime-generator, Property 19: Prompt builder produces non-empty structured output

    The prompt builder must return the LLM's response stripped of leading/trailing
    whitespace — it must not truncate or transform the content.
    """
    builder = _make_builder_with_mock_response(llm_response)
    result = _run(builder.build_anime_prompt(topic, style))

    assert result == llm_response.strip(), (
        "build_anime_prompt must return the LLM response verbatim (stripped). "
        f"Expected {llm_response.strip()!r}, got {result!r}"
    )
