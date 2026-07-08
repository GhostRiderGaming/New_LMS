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

import logging

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
    episode_number: int = 1
    title: str = "Untitled Episode"
    educational_concept: str = "Educational concept."
    scenes: list[ScenePlan] = Field(default_factory=list)

    @field_validator("scenes")
    @classmethod
    def min_three_scenes(cls, v: list[ScenePlan]) -> list[ScenePlan]:
        # Pad with placeholders instead of rejecting — Groq sometimes generates fewer
        while len(v) < 3:
            v.append(ScenePlan(
                scene_number=len(v) + 1,
                description="[Auto-generated placeholder scene]",
                caption="This scene continues the educational narrative.",
                status="pending",
            ))
        return v


class CharacterPlan(BaseModel):
    name: str = "Unnamed Character"
    role: str = "Participant"
    description: str = "A character in the story."
    justification: str = ""  # one-line reason why this figure is tied to this specific event
    asset_id: Optional[str] = None


# Map topic category to a visual style for scene image generation
_CATEGORY_TO_STYLE: dict[str, str] = {
    "HISTORICAL_EVENT": "historical",
    "FICTIONAL_LORE":   "fantasy",
    "GEOGRAPHY_NATURE": "outdoor",
    "SCIENTIFIC_DIAGRAM": "laboratory",
    "SOCIAL_CONCEPT":   "outdoor",
}


class StoryPlan(BaseModel):
    story_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "Untitled Story"
    synopsis: str = "An educational narrative."
    topic: str = "Unknown Topic"
    topic_category: str = "FICTIONAL_LORE"  # classified topic type
    setting_style: str = "fantasy"  # derived visual style for scene images
    characters: list[CharacterPlan] = Field(default_factory=list)
    episodes: list[EpisodePlan] = Field(default_factory=list)
    total_scenes: int = 0
    status: str = "planning"  # planning | generating | complete | failed

    @field_validator("episodes")
    @classmethod
    def min_three_episodes(cls, v: list[EpisodePlan]) -> list[EpisodePlan]:
        # Pad with placeholder episodes instead of rejecting
        while len(v) < 3:
            ep_num = len(v) + 1
            v.append(EpisodePlan(
                episode_number=ep_num,
                title=f"Episode {ep_num}",
                educational_concept="Continuation of the topic",
                scenes=[
                    ScenePlan(scene_number=i, description=f"Scene {i}", caption="Educational scene.", status="pending")
                    for i in range(1, 4)
                ],
            ))
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
  "synopsis": "string (2-3 sentences summarising the specific event/concept)",
  "characters": [
    {
      "name": "string",
      "role": "string (their specific role IN THIS EVENT — not a general title)",
      "description": "string (120-200 words — see rules below)",
      "justification": "string (one sentence explaining exactly how this figure is directly involved in this specific event)"
    }
  ],
  "episodes": [
    {
      "episode_number": 1,
      "title": "string",
      "educational_concept": "string",
      "scenes": [
        {"scene_number": 1, "description": "string (vivid visual description of what is happening — setting, characters present, action, mood)", "caption": "string (brief, easy-to-understand explanation)"},
        {"scene_number": 2, "description": "string", "caption": "string"},
        {"scene_number": 3, "description": "string", "caption": "string"}
      ]
    }
  ]
}
RULES:
- Output ONLY valid JSON — no markdown, no explanation.
- Each episode MUST have exactly 3 scenes minimum.
- Map educational concepts to narrative events.
- Each scene description must be a vivid visual description (setting, characters, action, mood) tied to the specific narrative of this topic.
- Each scene caption must explain the educational concept depicted using brief, simple, and easy-to-understand language.

CHARACTER RULES (CRITICAL):
- Include ONLY figures who are DIRECTLY AND SPECIFICALLY involved in THIS EXACT event/concept.
- Do NOT include figures who merely share the same broader universe, franchise, era, or subject but have no direct role in this specific event.
- For each character, provide a "justification" field: one sentence explaining their SPECIFIC role in THIS event. If you cannot write a clear justification tying them to this exact event, DO NOT include them.
- Aim for 4-8 characters maximum. Quality over quantity.
- Each character "description" MUST be 120-200 words and include:
  (a) Their specific role and actions in this event
  (b) Their personality, motivation, or historical significance
  (c) Key relationships or conflicts relevant to this event
  (d) Why they matter to understanding this concept
  (e) Physical appearance details if known (for visual reference)

EXAMPLES OF WHAT NOT TO DO:
- Topic is "French Revolution" → do NOT include Napoleon (he rose to power AFTER the Revolution).
- Topic is "Archon War" from Genshin Impact → do NOT include Traveler, Furina, or Nahida (they are from centuries later).
- Topic is "Trojan War" → do NOT include Odysseus's journey home (that's The Odyssey, a different story).
"""


# ---------------------------------------------------------------------------
# Helpers



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
            "synopsis": story_plan.synopsis,
            "topic": story_plan.topic,
            "total_scenes": story_plan.total_scenes,
            # Include full episode/scene data so frontend StoryPlayer can render without a separate fetch
            "episodes": [ep.model_dump() for ep in story_plan.episodes],
            "characters": [c.model_dump() for c in story_plan.characters],
        },
        created_at=now,
        session_id=session_id,
    )
    db.add(asset)
    
    try:
        db.commit()
        db.refresh(asset)
    except Exception as exc:
        db.rollback()
        log.error("[ORPHAN_ASSET_DETECTED] Database commit failed after uploading story plan to storage. Leaked key: %s. Error: %s", key, exc)
        raise

    return asset


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Cast refinement prompt — second pass to ground cast in generated content
# ---------------------------------------------------------------------------

_CAST_REFINE_SYSTEM = """You are a strict cast editor for an educational story.
You will be given:
1. A topic/event name
2. A synopsis that was already generated for this topic
3. Episode descriptions that were already generated
4. A list of characters that were proposed

Your job: REMOVE any character who is NOT directly mentioned or implied in the synopsis or episode descriptions. Keep only figures who actually participate in the events described.

For each kept character, ensure:
- The "justification" clearly ties them to the described events
- The "description" is 120-200 words with role, personality, relationships, and appearance
- The "role" describes their function in THIS specific event

Output a JSON object containing a "characters" array of the filtered characters in the same schema:
{
  "characters": [
    {
      "name": "string",
      "role": "string",
      "description": "string (120-200 words)",
      "justification": "string"
    }
  ]
}

Output ONLY the JSON object — no markdown, no explanation.
Keep 4-8 characters maximum.
"""

log = logging.getLogger(__name__)


async def _classify_topic_category(groq: AsyncGroq, topic: str) -> tuple[str, str]:
    """Classify a topic into a category and derive a visual style.
    
    Returns (topic_category, setting_style).
    """
    classifier_system = (
        "Classify this topic into exactly one category. "
        "Respond with ONLY the category name, nothing else.\n\n"
        "HISTORICAL_EVENT — real historical events, wars, civilizations, periods\n"
        "FICTIONAL_LORE — fictional universes, games, anime, literature, mythology\n"
        "GEOGRAPHY_NATURE — places, ecosystems, natural phenomena\n"
        "SCIENTIFIC_DIAGRAM — science/math concepts\n"
        "SOCIAL_CONCEPT — abstract social, economic, psychological concepts"
    )
    try:
        r = await groq.chat.completions.create(
            model=_GROQ_MODEL,
            messages=[
                {"role": "system", "content": classifier_system},
                {"role": "user", "content": f"Topic: {topic}"},
            ],
            max_tokens=20,
            temperature=0.0,
        )
        raw = (r.choices[0].message.content or "").strip().upper()
        # Extract the category name
        for cat in _CATEGORY_TO_STYLE:
            if cat in raw:
                return cat, _CATEGORY_TO_STYLE[cat]
    except Exception as exc:
        log.warning("Topic classification failed: %s — defaulting to FICTIONAL_LORE", exc)
    return "FICTIONAL_LORE", "fantasy"


async def _refine_cast(
    groq: AsyncGroq,
    topic: str,
    synopsis: str,
    episodes: list[EpisodePlan],
    characters: list[CharacterPlan],
) -> list[dict]:
    """Second pass: remove characters not grounded in the generated content."""
    episode_summaries = []
    for ep in episodes:
        scenes_text = "; ".join(
            s.description for s in ep.scenes
        )
        episode_summaries.append(
            f"Episode {ep.episode_number}: {ep.title} — {scenes_text}"
        )

    user_msg = (
        f"TOPIC: {topic}\n\n"
        f"SYNOPSIS: {synopsis}\n\n"
        f"EPISODES:\n" + "\n".join(episode_summaries) + "\n\n"
        f"PROPOSED CHARACTERS:\n{json.dumps([c.model_dump() for c in characters], indent=2)}"
    )

    try:
        r = await groq.chat.completions.create(
            model=_GROQ_MODEL,
            messages=[
                {"role": "system", "content": _CAST_REFINE_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            max_tokens=4096,
            temperature=0.3,
            response_format={"type": "json_object"}
        )
        raw = (r.choices[0].message.content or "").strip()
        data = json.loads(raw)
        refined = data.get("characters", [])
        if isinstance(refined, list) and len(refined) > 0:
            log.info(
                "Cast refined: %d → %d characters",
                len(characters), len(refined),
            )
            return refined[:8]  # hard cap at 8
    except Exception as exc:
        log.warning("Cast refinement failed: %s — keeping original cast", exc)

    # Fallback: just cap the original list
    return [c.model_dump() for c in characters][:8]


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

    Two-pass pipeline:
      1. Generate full story plan (synopsis + episodes + initial cast)
      2. Refine cast by grounding it in the actual generated synopsis/episodes

    Requirements: 9.1, 9.3, 9.11
    """
    groq = AsyncGroq(
        api_key=os.environ.get("GROQ_API_KEY", ""),
        timeout=300.0,  # 5 minutes — large stories (10 episodes) can be slow
        max_retries=3
    )

    import asyncio

    # Launch independent tasks concurrently
    classify_task = asyncio.create_task(_classify_topic_category(groq, topic))
    prompt_task = asyncio.create_task(prompt_builder.build_story_prompt(topic, episode_count))
    
    (topic_category, setting_style), story_prompt = await asyncio.gather(classify_task, prompt_task)
    log.info("Topic '%s' classified as %s (style: %s)", topic, topic_category, setting_style)

    # Pass 1: Generate the full story plan
    completion = await groq.chat.completions.create(
        model=_GROQ_MODEL,
        messages=[
            {"role": "system", "content": _STORY_PLAN_SYSTEM},
            {"role": "user", "content": story_prompt},
        ],
        max_tokens=8192,  # increased from 4096 — 10 episodes × 3 scenes needs more tokens
        temperature=0.6,
        response_format={"type": "json_object"}
    )
    try:
        raw = (completion.choices[0].message.content or "").strip()
        data: dict[str, Any] = json.loads(raw)
        data["topic"] = topic
        data["topic_category"] = topic_category
        data["setting_style"] = setting_style

        # Validate via Pydantic IMMEDIATELY — raises ValidationError if schema is fundamentally broken
        plan = StoryPlan(**data)

        # Pass 2: Refine the cast — ground it in the generated content using typed Pydantic objects
        if plan.characters and plan.synopsis:
            refined_characters = await _refine_cast(
                groq, topic, plan.synopsis, plan.episodes, plan.characters
            )
            plan.characters = [CharacterPlan(**c) for c in refined_characters]
    except Exception as exc:
        log.error("Story generation failed or produced invalid JSON/schema: %s", exc)
        # Fallback to minimal valid story plan
        plan = StoryPlan(
            title=f"The Story of {topic}",
            synopsis=f"An educational narrative exploring {topic}.",
            topic=topic,
            topic_category=topic_category,
            setting_style=setting_style,
            characters=[],
            episodes=[EpisodePlan(episode_number=1, title="Introduction", educational_concept=topic, scenes=[])]
        )

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

        import asyncio
        
        # Parallelize synchronous I/O using ThreadPool via asyncio.to_thread
        async def fetch_scene(sa):
            data = await asyncio.to_thread(asset_manager.download_file, sa.file_path)
            return sa.asset_id, data
            
        tasks = [fetch_scene(sa) for sa in scene_assets]
        # Principal Eng Fix: Stream the results via as_completed so large byte arrays are garbage collected immediately
        for coro in asyncio.as_completed(tasks):
            asset_id, file_bytes = await coro
            if file_bytes:
                zf.writestr(f"scenes/{asset_id}.png", file_bytes)

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
    
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        log.error("[ORPHAN_ASSET_DETECTED] Database commit failed after uploading story export ZIP to storage. Leaked key: %s. Error: %s", zip_key, exc)
        raise

    return zip_bytes
