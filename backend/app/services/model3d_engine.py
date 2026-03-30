"""
3D model generation service.

Uses Fal.ai Hunyuan3D-2.1 for text-to-3D generation, downloads the GLTF result,
uploads to Cloudflare R2, and attaches required metadata.

Public API:
  generate_model3d(object_name, category, job_id, session_id) -> Asset

Requirements: 3.1, 3.4, 3.7
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

import fal_client
import httpx

from app.models.anime_assets import Asset, SessionLocal
from app.services.asset_manager import asset_manager
from app.services.prompt_builder import prompt_builder

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_FAL_MODEL = "fal-ai/hunyuan3d-v2"

Model3DCategory = Literal["anatomy", "chemistry", "astronomy", "historical", "mechanical"]

# Supported categories for validation
SUPPORTED_CATEGORIES: set[str] = {
    "anatomy", "chemistry", "astronomy", "historical", "mechanical"
}

# Suggested alternatives when an object cannot be generated
_FALLBACK_SUGGESTIONS: dict[str, list[str]] = {
    "anatomy": ["human heart", "neuron", "DNA double helix", "cell membrane"],
    "chemistry": ["water molecule", "benzene ring", "ATP molecule", "glucose"],
    "astronomy": ["solar system", "black hole", "neutron star", "galaxy spiral"],
    "historical": ["Roman helmet", "Egyptian pyramid", "Greek amphora", "medieval sword"],
    "mechanical": ["gear assembly", "piston engine", "turbine blade", "ball bearing"],
}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _call_fal_model3d(prompt: str) -> bytes:
    """
    Call Fal.ai Hunyuan3D-2.1 with the given prompt.
    Returns raw GLTF bytes.
    Requirement 3.1: generate or retrieve a 3D model in GLTF format.
    """
    result = await fal_client.run_async(
        _FAL_MODEL,
        arguments={
            "prompt": prompt,
            "num_inference_steps": 50,
            "guidance_scale": 7.5,
            "output_format": "glb",  # GLB = binary GLTF with embedded textures
        },
    )
    # result["model_mesh"]["url"] — download the GLTF/GLB file
    model_url: str = result["model_mesh"]["url"]
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.get(model_url)
        resp.raise_for_status()
        return resp.content


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
    Generate a 3D model for the given object name and category.

    Flow:
      1. Build a detailed Hunyuan3D-2.1 prompt via Groq (Requirement 3.4)
      2. Call Fal.ai Hunyuan3D-2.1 → returns GLB (binary GLTF with embedded textures)
      3. Upload to Cloudflare R2
      4. Persist Asset record with required metadata and return it

    Requirements: 3.1, 3.4, 3.7
    Metadata attached: object_name, description, scale_reference, category (Requirement 3.4)
    """
    # 1. Build prompt via Groq
    model_prompt = await prompt_builder.build_3d_prompt(object_name, category)

    # 2. Generate 3D model via Fal.ai
    glb_bytes = await _call_fal_model3d(model_prompt)

    # 3. Upload to R2
    key = f"model3d/{job_id}/{uuid.uuid4()}.glb"
    # Requirement 3.4: attach metadata including object_name, description, scale_reference, category
    metadata = {
        "object_name": object_name,
        "description": model_prompt,
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

    # 4. Persist DB record
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
