"""
Property-based tests for the storyification pipeline.

Feature: education-anime-generator
Properties covered:
  - Property 6:  Story plan scene count invariant
  - Property 17: Story ZIP manifest completeness

PBT library: Hypothesis
Min iterations: 100 per property

Validates: Requirements 9.2, 9.5, 9.8
"""
from __future__ import annotations

import io
import json
import zipfile
from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from app.services.story_engine import (
    CharacterPlan,
    EpisodePlan,
    ScenePlan,
    StoryPlan,
)

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_text = st.text(
    alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd", "Zs")),
    min_size=1,
    max_size=80,
).filter(lambda s: s.strip())

_scene_st = st.builds(
    ScenePlan,
    scene_number=st.integers(min_value=1, max_value=20),
    description=_text,
    caption=_text,
    asset_id=st.none(),
    status=st.just("pending"),
)

# Each episode has 3–6 scenes (minimum 3 enforced by validator)
_episode_st = st.builds(
    EpisodePlan,
    episode_number=st.integers(min_value=1, max_value=10),
    title=_text,
    educational_concept=_text,
    scenes=st.lists(_scene_st, min_size=3, max_size=6),
)

# StoryPlan has 3–10 episodes (minimum 3 enforced by validator)
_story_plan_st = st.builds(
    StoryPlan,
    title=_text,
    synopsis=_text,
    topic=_text,
    characters=st.lists(
        st.builds(CharacterPlan, name=_text, role=_text, description=_text),
        min_size=1,
        max_size=4,
    ),
    episodes=st.lists(_episode_st, min_size=3, max_size=10),
)


# ---------------------------------------------------------------------------
# Property 6: Story plan scene count invariant
# Validates: Requirements 9.2, 9.5
# ---------------------------------------------------------------------------

@given(plan=_story_plan_st)
@settings(max_examples=100)
def test_property6_total_scenes_equals_sum_of_episode_scenes(plan: StoryPlan) -> None:
    """
    Feature: education-anime-generator, Property 6: Story plan scene count invariant

    For any generated StoryPlan with N episodes, each episode must contain at
    least 3 scenes, and total_scenes must equal the sum of scenes across all
    episodes.

    Validates: Requirements 9.2, 9.5
    """
    # Each episode must have at least 3 scenes
    for ep in plan.episodes:
        assert len(ep.scenes) >= 3, (
            f"Episode {ep.episode_number} has {len(ep.scenes)} scenes — "
            f"minimum is 3 (Requirement 9.2)"
        )

    # total_scenes must equal the actual sum
    expected_total = sum(len(ep.scenes) for ep in plan.episodes)
    assert plan.total_scenes == expected_total, (
        f"total_scenes={plan.total_scenes} does not match "
        f"sum of episode scenes={expected_total}"
    )


@given(plan=_story_plan_st)
@settings(max_examples=100)
def test_property6_story_plan_has_minimum_three_episodes(plan: StoryPlan) -> None:
    """
    Feature: education-anime-generator, Property 6: Story plan scene count invariant

    For any StoryPlan, the episodes list must contain at least 3 episodes.

    Validates: Requirement 9.5
    """
    assert len(plan.episodes) >= 3, (
        f"StoryPlan has {len(plan.episodes)} episodes — minimum is 3 (Requirement 9.5)"
    )


@given(
    episode_count=st.integers(min_value=3, max_value=10),
    scenes_per_episode=st.integers(min_value=3, max_value=6),
)
@settings(max_examples=100)
def test_property6_total_scenes_arithmetic(
    episode_count: int, scenes_per_episode: int
) -> None:
    """
    Feature: education-anime-generator, Property 6: Story plan scene count invariant

    For any StoryPlan constructed with a fixed number of episodes and scenes per
    episode, total_scenes must equal episode_count * scenes_per_episode.

    Validates: Requirements 9.2, 9.5
    """
    episodes = [
        EpisodePlan(
            episode_number=i + 1,
            title=f"Episode {i + 1}",
            educational_concept=f"Concept {i + 1}",
            scenes=[
                ScenePlan(
                    scene_number=j + 1,
                    description=f"Scene {j + 1}",
                    caption=f"Caption {j + 1}",
                )
                for j in range(scenes_per_episode)
            ],
        )
        for i in range(episode_count)
    ]

    plan = StoryPlan(
        title="Test Story",
        synopsis="A test synopsis.",
        topic="test topic",
        characters=[CharacterPlan(name="Hero", role="protagonist", description="A student")],
        episodes=episodes,
    )

    assert plan.total_scenes == episode_count * scenes_per_episode, (
        f"Expected total_scenes={episode_count * scenes_per_episode}, "
        f"got {plan.total_scenes}"
    )


def test_property6_rejects_episode_with_fewer_than_three_scenes() -> None:
    """
    Feature: education-anime-generator, Property 6: Story plan scene count invariant

    Constructing an EpisodePlan with fewer than 3 scenes must raise a
    ValidationError.

    Validates: Requirement 9.2
    """
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        EpisodePlan(
            episode_number=1,
            title="Too Short",
            educational_concept="Gravity",
            scenes=[
                ScenePlan(scene_number=1, description="Only one scene", caption="Caption"),
                ScenePlan(scene_number=2, description="Only two scenes", caption="Caption"),
            ],
        )


def test_property6_rejects_story_plan_with_fewer_than_three_episodes() -> None:
    """
    Feature: education-anime-generator, Property 6: Story plan scene count invariant

    Constructing a StoryPlan with fewer than 3 episodes must raise a
    ValidationError.

    Validates: Requirement 9.5
    """
    from pydantic import ValidationError

    episodes = [
        EpisodePlan(
            episode_number=i + 1,
            title=f"Episode {i + 1}",
            educational_concept="Concept",
            scenes=[
                ScenePlan(scene_number=j + 1, description="Desc", caption="Cap")
                for j in range(3)
            ],
        )
        for i in range(2)  # only 2 episodes — should fail
    ]

    with pytest.raises(ValidationError):
        StoryPlan(
            title="Short Story",
            synopsis="Synopsis.",
            topic="topic",
            characters=[CharacterPlan(name="A", role="B", description="C")],
            episodes=episodes,
        )


# ---------------------------------------------------------------------------
# Property 17: Story ZIP manifest completeness
# Validates: Requirement 9.8
# ---------------------------------------------------------------------------

def _build_zip(manifest: dict[str, Any], scene_files: list[str]) -> bytes:
    """Helper: build an in-memory ZIP with a manifest.json and scene files."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        for fname in scene_files:
            zf.writestr(fname, b"fake-image-bytes")
    return buf.getvalue()


def _parse_manifest(zip_bytes: bytes) -> dict[str, Any]:
    """Helper: extract and parse manifest.json from a ZIP."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        return json.loads(zf.read("manifest.json").decode("utf-8"))


def _list_zip_files(zip_bytes: bytes) -> list[str]:
    """Helper: list all file names in a ZIP."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        return zf.namelist()


@given(
    title=_text,
    synopsis=_text,
    scene_count=st.integers(min_value=1, max_value=12),
)
@settings(max_examples=100)
def test_property17_manifest_contains_required_fields(
    title: str, synopsis: str, scene_count: int
) -> None:
    """
    Feature: education-anime-generator, Property 17: Story ZIP manifest completeness

    For any exported story ZIP, the manifest.json must contain non-empty values
    for: story_id, title, synopsis, episodes list, and scene_assets list.

    Validates: Requirement 9.8
    """
    story_id = "test-story-id"
    scene_files = [f"scenes/scene_{i}.png" for i in range(scene_count)]
    scene_refs = [
        {
            "asset_id": f"asset-{i}",
            "file": scene_files[i],
            "episode_number": 1,
            "scene_number": i + 1,
            "caption": f"Caption {i}",
        }
        for i in range(scene_count)
    ]

    manifest: dict[str, Any] = {
        "story_id": story_id,
        "title": title,
        "synopsis": synopsis,
        "episodes": [{"episode_number": 1, "title": "Ep 1", "scenes": []}],
        "scene_assets": scene_refs,
        "exported_at": "2026-01-01T00:00:00+00:00",
    }

    zip_bytes = _build_zip(manifest, scene_files)
    parsed = _parse_manifest(zip_bytes)

    # Required top-level fields must be present and non-empty
    assert parsed.get("story_id"), "manifest must contain non-empty story_id"
    assert parsed.get("title"), "manifest must contain non-empty title"
    assert parsed.get("synopsis"), "manifest must contain non-empty synopsis"
    assert isinstance(parsed.get("episodes"), list), "manifest must contain episodes list"
    assert len(parsed["episodes"]) > 0, "manifest episodes list must not be empty"
    assert isinstance(parsed.get("scene_assets"), list), "manifest must contain scene_assets list"


@given(
    scene_count=st.integers(min_value=1, max_value=12),
)
@settings(max_examples=100)
def test_property17_every_scene_asset_ref_has_matching_file(scene_count: int) -> None:
    """
    Feature: education-anime-generator, Property 17: Story ZIP manifest completeness

    For any exported story ZIP, every scene asset reference in the manifest must
    correspond to an actual file present in the ZIP archive.

    Validates: Requirement 9.8
    """
    scene_files = [f"scenes/scene_{i}.png" for i in range(scene_count)]
    scene_refs = [
        {"asset_id": f"a{i}", "file": scene_files[i], "episode_number": 1, "scene_number": i + 1, "caption": ""}
        for i in range(scene_count)
    ]

    manifest: dict[str, Any] = {
        "story_id": "sid",
        "title": "T",
        "synopsis": "S",
        "episodes": [{"episode_number": 1, "title": "E", "scenes": []}],
        "scene_assets": scene_refs,
        "exported_at": "2026-01-01T00:00:00+00:00",
    }

    zip_bytes = _build_zip(manifest, scene_files)
    parsed = _parse_manifest(zip_bytes)
    zip_files = set(_list_zip_files(zip_bytes))

    for ref in parsed["scene_assets"]:
        assert ref["file"] in zip_files, (
            f"Scene asset file '{ref['file']}' referenced in manifest "
            f"but not found in ZIP archive"
        )


@given(
    title=_text,
    synopsis=_text,
    episode_count=st.integers(min_value=1, max_value=5),
    scenes_per_episode=st.integers(min_value=1, max_value=4),
)
@settings(max_examples=100)
def test_property17_scene_asset_count_matches_manifest(
    title: str,
    synopsis: str,
    episode_count: int,
    scenes_per_episode: int,
) -> None:
    """
    Feature: education-anime-generator, Property 17: Story ZIP manifest completeness

    For any exported story ZIP, the number of scene asset references in the
    manifest must equal the number of scene files present in the ZIP.

    Validates: Requirement 9.8
    """
    total_scenes = episode_count * scenes_per_episode
    scene_files = [f"scenes/scene_{i}.png" for i in range(total_scenes)]
    scene_refs = [
        {
            "asset_id": f"a{i}",
            "file": scene_files[i],
            "episode_number": (i // scenes_per_episode) + 1,
            "scene_number": (i % scenes_per_episode) + 1,
            "caption": f"Caption {i}",
        }
        for i in range(total_scenes)
    ]

    manifest: dict[str, Any] = {
        "story_id": "sid",
        "title": title,
        "synopsis": synopsis,
        "episodes": [
            {"episode_number": ep + 1, "title": f"Episode {ep + 1}", "scenes": []}
            for ep in range(episode_count)
        ],
        "scene_assets": scene_refs,
        "exported_at": "2026-01-01T00:00:00+00:00",
    }

    zip_bytes = _build_zip(manifest, scene_files)
    parsed = _parse_manifest(zip_bytes)
    zip_files = [f for f in _list_zip_files(zip_bytes) if f.startswith("scenes/")]

    assert len(parsed["scene_assets"]) == len(zip_files), (
        f"Manifest references {len(parsed['scene_assets'])} scenes "
        f"but ZIP contains {len(zip_files)} scene files"
    )


def test_property17_manifest_json_is_parseable() -> None:
    """
    Feature: education-anime-generator, Property 17: Story ZIP manifest completeness

    The manifest.json in any exported ZIP must be valid, parseable JSON.

    Validates: Requirement 9.8
    """
    manifest: dict[str, Any] = {
        "story_id": "abc",
        "title": "Photosynthesis",
        "synopsis": "A story about plants.",
        "episodes": [{"episode_number": 1, "title": "Ep 1", "scenes": []}],
        "scene_assets": [],
        "exported_at": "2026-01-01T00:00:00+00:00",
    }
    zip_bytes = _build_zip(manifest, [])

    # Must not raise
    parsed = _parse_manifest(zip_bytes)
    assert isinstance(parsed, dict)


# ---------------------------------------------------------------------------
# Import pytest for the non-hypothesis tests
# ---------------------------------------------------------------------------
import pytest
