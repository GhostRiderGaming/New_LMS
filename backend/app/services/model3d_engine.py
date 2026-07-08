"""
3D model generation service.

Uses Hugging Face Inference API for text-to-3D generation via a two-step pipeline:
  1. FLUX.1-schnell: text → reference image
  2. stable-fast-3d: image → GLB 3D model

Public API:
  generate_model3d(object_name, category, job_id, session_id) -> Asset

Requirements: 3.1, 3.4, 3.7
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import datetime, timezone
from typing import Literal

import httpx

from app.models.anime_assets import Asset, SessionLocal
from app.services.asset_manager import asset_manager
from app.services.prompt_builder import prompt_builder

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

Model3DCategory = Literal["anatomy", "chemistry", "astronomy", "historical", "mechanical"]

SUPPORTED_CATEGORIES: set[str] = {
    "anatomy", "chemistry", "astronomy", "historical", "mechanical"
}

_FALLBACK_SUGGESTIONS: dict[str, list[str]] = {
    "anatomy": ["human heart", "neuron", "DNA double helix", "cell membrane"],
    "chemistry": ["water molecule", "benzene ring", "ATP molecule", "glucose"],
    "astronomy": ["solar system", "black hole", "neutron star", "galaxy spiral"],
    "historical": ["Roman helmet", "Egyptian pyramid", "Greek amphora", "medieval sword"],
    "mechanical": ["gear assembly", "piston engine", "turbine blade", "ball bearing"],
}


# ---------------------------------------------------------------------------
# Hugging Face two-step pipeline (FLUX.1 image → stable-fast-3d)
# ---------------------------------------------------------------------------

async def _call_hf_model3d(prompt: str) -> bytes:
    """
    Generate a 3D model via Hugging Face two-step pipeline:
      1. FLUX.1-schnell: text prompt → reference image
      2. stable-fast-3d: reference image → GLB 3D model
    """
    hf_token = os.environ.get("HF_API_TOKEN", "")
    headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}

    # Step 1: Generate reference image
    image_url = "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell"
    image_bytes: bytes | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(image_url, json={"inputs": prompt}, headers=headers)
                if r.status_code == 503:
                    await asyncio.sleep(10 * (attempt + 1))
                    continue
                r.raise_for_status()
                if len(r.content) > 1000:
                    image_bytes = r.content
                    break
        except Exception:
            await asyncio.sleep(10)

    if not image_bytes:
        raise RuntimeError(
            "3D model generation is temporarily unavailable. "
            "The Hugging Face image generation pipeline (FLUX.1-schnell) is not responding. "
            "Please try again in a few minutes."
        )

    # Step 2: Image → 3D
    model3d_url = "https://api-inference.huggingface.co/models/stabilityai/stable-fast-3d"
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                r = await client.post(
                    model3d_url,
                    content=image_bytes,
                    headers={**headers, "Content-Type": "image/png"},
                )
                if r.status_code == 503:
                    await asyncio.sleep(15 * (attempt + 1))
                    continue
                r.raise_for_status()
                if len(r.content) > 1000:
                    return r.content
        except Exception:
            await asyncio.sleep(15)

    raise RuntimeError(
        "3D model generation is temporarily unavailable. "
        "The Hugging Face 3D pipeline (stable-fast-3d) is not responding. "
        "Please try again in a few minutes."
    )


def _store_asset_record(
    job_id: str,
    object_name: str,
    topic: str,
    file_path: str,
    file_size: int,
    metadata: dict,
    session_id: str,
) -> Asset:
    """Persist an Asset row to the database and return it."""
    now = datetime.now(timezone.utc)
    asset = Asset(
        asset_id=str(uuid.uuid4()),
        job_id=job_id,
        type="model3d",
        topic=topic,
        file_path=file_path,
        file_size_bytes=file_size,
        mime_type="model/gltf-binary",
        asset_metadata=metadata,
        created_at=now,
        session_id=session_id,
    )
    db = SessionLocal()
    try:
        db.add(asset)
        db.commit()
        db.refresh(asset)
        return asset
    finally:
        db.close()


def get_suggestions_for_category(category: str) -> list[str]:
    """Return a list of suggested objects for the given category."""
    return _FALLBACK_SUGGESTIONS.get(category, list(_FALLBACK_SUGGESTIONS["mechanical"]))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_model3d(
    object_name: str,
    category: str,
    job_id: str,
    session_id: str,
) -> Asset:
    """
    Generate a 3D model via Hugging Face two-step pipeline.
    Requirements: 3.1, 3.4, 3.7
    """
    # Build a detailed prompt via Groq
    model_prompt = await prompt_builder.build_3d_prompt(object_name, category)

    # Generate via Hugging Face pipeline
    glb_bytes = await _call_hf_model3d(model_prompt)

    key = f"model3d/{job_id}/{uuid.uuid4()}.glb"
    metadata = {
        "object_name": object_name,
        "description": f"3D model of {object_name} ({category})",
        "scale_reference": _infer_scale_reference(category, object_name),
        "category": category,
    }
    asset_manager.store_asset(
        data=glb_bytes,
        key=key,
        content_type="model/gltf-binary",
        topic=object_name,
        asset_type="model3d",
        metadata=metadata,
    )

    return _store_asset_record(
        job_id=job_id,
        object_name=object_name,
        topic=object_name,
        file_path=key,
        file_size=len(glb_bytes),
        metadata=metadata,
        session_id=session_id,
    )


def _infer_scale_reference(category: str, object_name: str) -> str:
    """
    Return a human-readable scale reference for the object.
    Requirement 3.4: metadata SHALL include scale_reference.
    """
    scale_map = {
        "anatomy": "approximately life-size (human scale)",
        "chemistry": "molecular scale (nanometers to angstroms)",
        "astronomy": "astronomical scale (varies by object)",
        "historical": "artifact scale (varies by object)",
        "mechanical": "engineering scale (varies by object)",
    }
    return scale_map.get(category, "scale varies")
