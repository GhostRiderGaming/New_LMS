"""
3D model generation service.

Uses a two-step pipeline — both steps are completely free:
  Step 1: Generate a reference image via HF Inference API (Animagine XL / FLUX)
  Step 2: Convert image to 3D GLB via HF Inference API (stabilityai/stable-fast-3d)

No API key required beyond the existing HF_API_TOKEN.

Public API:
  generate_model3d(object_name, category, job_id, session_id) -> Asset

Requirements: 3.1, 3.4, 3.7
"""
from __future__ import annotations

import asyncio
import os
import time
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

# Step 1: Generate a reference image (reuse the anime image pipeline)
_HF_IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell"
_HF_IMAGE_URL = f"https://api-inference.huggingface.co/models/{_HF_IMAGE_MODEL}"

# Step 2: Image → 3D GLB via Stable Fast 3D
_HF_3D_MODEL = "stabilityai/stable-fast-3d"
_HF_3D_URL = f"https://api-inference.huggingface.co/models/{_HF_3D_MODEL}"

_HF_TIMEOUT = 120
_MAX_RETRIES = 3
_RETRY_DELAY = 15  # seconds — HF models need time to warm up

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
# Two-step pipeline helpers
# ---------------------------------------------------------------------------

async def _generate_reference_image(object_name: str, category: str) -> bytes:
    """
    Step 1: Generate a clean reference image of the object using FLUX.1-schnell.
    Returns raw PNG bytes.
    """
    hf_token = os.environ.get("HF_API_TOKEN", "")
    headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}

    # Clean, white-background product-style prompt works best for image-to-3D
    prompt = (
        f"A single {object_name}, {category} subject, "
        "clean white background, studio lighting, high detail, "
        "no shadows, centered, product photography style"
    )

    last_error: Exception = RuntimeError("Unknown error")
    for attempt in range(_MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=_HF_TIMEOUT) as client:
                resp = await client.post(
                    _HF_IMAGE_URL,
                    json={"inputs": prompt, "parameters": {"width": 512, "height": 512}},
                    headers=headers,
                )
                if resp.status_code == 503:
                    await asyncio.sleep(_RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                if len(resp.content) < 1000:
                    raise RuntimeError(f"Image too small ({len(resp.content)} bytes)")
                return resp.content
        except Exception as e:
            last_error = e
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_RETRY_DELAY)

    raise RuntimeError(f"Reference image generation failed: {last_error}")


async def _image_to_3d(image_bytes: bytes) -> bytes:
    """
    Step 2: Convert a PNG image to a GLB 3D model via stabilityai/stable-fast-3d.
    Returns raw GLB bytes.
    """
    hf_token = os.environ.get("HF_API_TOKEN", "")
    headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}

    last_error: Exception = RuntimeError("Unknown error")
    for attempt in range(_MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=_HF_TIMEOUT) as client:
                resp = await client.post(
                    _HF_3D_URL,
                    content=image_bytes,
                    headers={**headers, "Content-Type": "image/png"},
                )
                if resp.status_code == 503:
                    await asyncio.sleep(_RETRY_DELAY * (attempt + 1))
                    continue
                resp.raise_for_status()
                if len(resp.content) < 1000:
                    raise RuntimeError(f"GLB too small ({len(resp.content)} bytes)")
                return resp.content
        except Exception as e:
            last_error = e
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_RETRY_DELAY)

    raise RuntimeError(f"Image-to-3D conversion failed: {last_error}")


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
    Generate a 3D model using a two-step free pipeline:
      1. Generate reference image via FLUX.1-schnell (HF free)
      2. Convert image to GLB via stable-fast-3d (HF free)

    Requirements: 3.1, 3.4, 3.7
    """
    # Step 1: reference image
    image_bytes = await _generate_reference_image(object_name, category)

    # Step 2: image → GLB
    glb_bytes = await _image_to_3d(image_bytes)

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
