"""
Storyification pipeline service.

Converts an educational topic into a structured multi-episode anime StoryPlan
using Groq API (LLaMA 3.3 70B), then orchestrates per-scene anime generation
via Celery tasks.

Public API:
  generate_story_plan(topic, episode_count, session_id, job_id, db) -> StoryPlan
  assemble_story_zip(story_id, db) -> bytes

Requirements: 9.1, 9.2, 9.3, 9.5, 9.8, 9.10, 9.11
"""
from __future__ import annotations

import io
import json
import os
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Any, Optional

from groq import AsyncGroq
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.models.anime_assets import Asset, Job, SessionLocal
from app.services.asset_manager import asset_manager
from app.services.prompt_builder import prompt_builder

_GROQ_MODEL = "llama-3.3-70b-versatile"

# ---------------------------------------------------------------------------
# Pydantic models for StoryPlan (used for validation + serialisation)
# ---------------------------------------------------------------------------

class ScenePlan(BaseModel):
    scene_number: int
    description: str
    caption: str
    asset_id: Optional[str] = None
    status: str = "pending"  # pending | complete | failed


class EpisodePlan(BaseModel):
    episode_number: int
    title: str
    educational_concept: str
    scenes: list[ScenePlan]

    @field_validator("scenes")
    @classmethod
    def min_three_scenes(cls, v: list[ScenePlan]) -> list[ScenePlan]:
        if len(v) < 3:
            raise ValueError(
                f"Each episode must have at least 3 scenes, got {len(v)}"
            )
        return v


class CharacterPlan(BaseModel):
    name: str
    role: str
    description: str
    asset_id: Optional[str] = None


class StoryPlan(BaseModel):
    story_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    synopsis: str
    topic: str
    characters: list[CharacterPlan]
    episodes: list[EpisodePlan]
    total_scenes: int = 0
    status: str = "planning"  # planning | generating | complete | failed

    @field_validator("episodes")
    @classmethod
    def min_three_episodes(cls, v: list[EpisodePlan]) -> list[EpisodePlan]:
        if len(v) < 3:
            raise ValueError(
                f"StoryPlan must have at least 3 episodes, got {len(v)}"
            )
        return v

    @model_validator(mode="after")
    def compute_total_scenes(self) -> "StoryPlan":
        self.total_scenes = sum(len(ep.scenes) for ep in self.episodes)
        return self


# ---------------------------------------------------------------------------
# System prompt for story planning
# ---------------------------------------------------------------------------

_STORY_PLAN_SYSTEM = """You are an educational anime story writer.
Given a topic and episode count, output a JSON StoryPlan with this exact schema:
{
  "title": "string",
  "synopsis": "string (2-3 sentences)",
  "characters": [
    {"name": "string", "role": "string", "description": "string"}
  ],
  "episodes": [
    {
      "episode_number": 1,
      "title": "string",
      "educational_concept": "string",
      "scenes": [
        {"scene_number": 1, "description": "string", "caption": "string"},
        {"scene_number": 2, "description": "string", "caption": "string"},
        {"scene_number": 3, "description": "string", "caption": "string"}
      ]
    }
  ]
}
RULES:
- Output ONLY valid JSON — no markdown, no explanation.
- Each episode MUST have exactly 3 scenes minimum.
- Map educational concepts to narrative events (character "discovers" a law, etc.).
- Each scene caption must explain the educational concept depicted.
- Characters should be domain-appropriate (scientist for physics, etc.).
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_json(raw: str) -> str:
    """Strip markdown fences and extract the first JSON object."""
    import re
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", raw.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"\n?```\s*$", "", stripped.strip())
    return stripped.strip()


def _placeholder_scene(scene_number: int, topic: str) -> ScenePlan:
    """
    Return a placeholder scene when generation fails for a specific scene.
    Requirement 9.10: substitute placeholder, continue remaining scenes.
    """
    return ScenePlan(
        scene_number=scene_number,
        description=f"[Placeholder] Scene {scene_number} for topic: {topic}",
        caption=f"This scene covers an aspect of {topic}. (Generation failed — placeholder shown.)",
        status="failed",
    )


def _store_story_asset(
    story_plan: StoryPlan,
    job_id: str,
    session_id: str,
    db: Session,
) -> Asset:
    """Persist the StoryPlan JSON as an Asset record."""
    plan_bytes = story_plan.model_dump_json(indent=2).encode("utf-8")
    key = f"story/{story_plan.story_id}/plan.json"
    now = datetime.now(timezone.utc)

    asset_manager.store_asset(
        data=plan_bytes,
        key=key,
        content_type="application/json",
        topic=story_plan.topic,
        asset_type="story",
        metadata={
            "story_id": story_plan.story_id,
            "title": story_plan.title,
            "total_scenes": story_plan.total_scenes,
        },
        created_at=now,
    )

    asset = Asset(
        asset_id=str(uuid.uuid4()),
        job_id=job_id,
        type="story",
        topic=story_plan.topic,
        file_path=key,
        file_size_bytes=len(plan_bytes),
        mime_type="application/json",
        asset_metadata={
            "story_id": story_plan.story_id,
            "title": story_plan.title,
            "total_scenes": story_plan.total_scenes,
        },
        created_at=now,
        session_id=session_id,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_story_plan(
    topic: str,
    episode_count: int,
    session_id: str,
    job_id: str,
    db: Session,
) -> StoryPlan:
    """
    Call Groq API to generate a structured StoryPlan JSON, validate it,
    and persist the plan as an Asset.

    Requirements: 9.1, 9.3, 9.11
    """
    groq = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""))
    story_prompt = await prompt_builder.build_story_prompt(topic, episode_count)

    completion = await groq.chat.completions.create(
        model=_GROQ_MODEL,
        messages=[
            {"role": "system", "content": _STORY_PLAN_SYSTEM},
            {"role": "user", "content": story_prompt},
        ],
        max_tokens=4096,
        temperature=0.6,
    )
    raw = (completion.choices[0].message.content or "").strip()
    json_str = _extract_json(raw)
    data: dict[str, Any] = json.loads(json_str)
    data["topic"] = topic

    # Validate via Pydantic — raises ValidationError if schema is wrong
    plan = StoryPlan(**data)

    # Persist plan as Asset
    _store_story_asset(plan, job_id, session_id, db)
    return plan


async def assemble_story_zip(story_id: str, db: Session) -> bytes:
    """
    Assemble all scene assets for a story into a ZIP archive with a JSON manifest.

    Manifest includes: title, synopsis, episode list, scene asset references.
    ZIP is uploaded to Cloudflare R2.

    Requirement 9.8
    """
    # Find the story plan asset
    plan_asset = (
        db.query(Asset)
        .filter(
            Asset.type == "story",
            Asset.asset_metadata["story_id"].as_string() == story_id,
        )
        .first()
    )
    if not plan_asset:
        raise ValueError(f"Story plan not found for story_id={story_id}")

    plan_bytes = asset_manager.download_file(plan_asset.file_path)
    if not plan_bytes:
        raise ValueError(f"Story plan file not found in R2: {plan_asset.file_path}")

    plan_data = json.loads(plan_bytes.decode("utf-8"))

    # Collect all scene assets for this story
    scene_assets = (
        db.query(Asset)
        .filter(
            Asset.type == "image",
            Asset.asset_metadata["story_id"].as_string() == story_id,
        )
        .all()
    )

    # Build manifest
    scene_refs: list[dict[str, Any]] = []
    for sa in scene_assets:
        meta = sa.asset_metadata or {}
        scene_refs.append({
            "asset_id": sa.asset_id,
            "file": f"scenes/{sa.asset_id}.png",
            "episode_number": meta.get("episode_number"),
            "scene_number": meta.get("scene_number"),
            "caption": meta.get("caption", ""),
        })

    manifest: dict[str, Any] = {
        "story_id": story_id,
        "title": plan_data.get("title", ""),
        "synopsis": plan_data.get("synopsis", ""),
        "episodes": plan_data.get("episodes", []),
        "scene_assets": scene_refs,
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }

    # Build ZIP in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        zf.writestr("story_plan.json", json.dumps(plan_data, indent=2))

        for sa in scene_assets:
            file_bytes = asset_manager.download_file(sa.file_path)
            if file_bytes:
                zf.writestr(f"scenes/{sa.asset_id}.png", file_bytes)

    zip_bytes = buf.getvalue()

    # Upload ZIP to R2
    zip_key = f"story/{story_id}/export.zip"
    now = datetime.now(timezone.utc)
    asset_manager.store_asset(
        data=zip_bytes,
        key=zip_key,
        content_type="application/zip",
        topic=plan_data.get("topic", story_id),
        asset_type="story",
        metadata={
            "story_id": story_id,
            "title": plan_data.get("title", ""),
            "total_scenes": len(scene_refs),
        },
        created_at=now,
    )

    # Persist ZIP asset record
    zip_asset = Asset(
        asset_id=str(uuid.uuid4()),
        job_id=plan_asset.job_id,
        type="story",
        topic=plan_data.get("topic", story_id),
        file_path=zip_key,
        file_size_bytes=len(zip_bytes),
        mime_type="application/zip",
        asset_metadata={
            "story_id": story_id,
            "title": plan_data.get("title", ""),
            "total_scenes": len(scene_refs),
            "is_zip_export": True,
        },
        created_at=now,
        session_id=plan_asset.session_id,
    )
    db.add(zip_asset)
    db.commit()

    return zip_bytes
