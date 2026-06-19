"""
3D model generation service.

Uses Tripo AI API (https://platform.tripo3d.ai) for text-to-3D generation.
Get a free API key at: https://platform.tripo3d.ai/api-keys

Flow:
  1. POST /v2/openapi/task  → task_id
  2. Poll GET /v2/openapi/task/{task_id} until status == "success"
  3. Download GLB from result.model.url

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

_TRIPO_BASE = "https://api.tripo3d.ai/v2/openapi"
_TRIPO_TIMEOUT = 30       # seconds per HTTP call
_TRIPO_POLL_INTERVAL = 5  # seconds between status polls
_TRIPO_MAX_POLLS = 60     # 60 × 5s = 5 minutes max

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
# Tripo AI API
# ---------------------------------------------------------------------------

async def _call_tripo_model3d(prompt: str) -> bytes:
    """
    Generate a 3D model via Tripo AI text-to-3D API.
    Falls back to HF two-step pipeline (FLUX image → stable-fast-3d) if Tripo key is missing.
    """
    api_key = os.environ.get("TRIPO_API_KEY", "").strip()
    if not api_key:
        # No Tripo key — use free HF pipeline instead
        return await _call_hf_two_step(prompt)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=_TRIPO_TIMEOUT) as client:
            create_resp = await client.post(
                f"{_TRIPO_BASE}/task",
                headers=headers,
                json={
                    "type": "text_to_model",
                    "prompt": prompt[:1024],
                    "model_version": "v2.0-20240919",
                    "face_limit": 10000,
                    "texture": True,
                    "pbr": False,
                },
            )
            if create_resp.status_code in (401, 403):
                # Key invalid — fall back to HF pipeline silently
                return await _call_hf_two_step(prompt)
            create_resp.raise_for_status()
            resp_data = create_resp.json()

            if resp_data.get("code", -1) != 0:
                raise RuntimeError(f"Tripo task creation failed: {resp_data}")

            task_id: str = resp_data["data"]["task_id"]

            for _ in range(_TRIPO_MAX_POLLS):
                await asyncio.sleep(_TRIPO_POLL_INTERVAL)
                poll_resp = await client.get(f"{_TRIPO_BASE}/task/{task_id}", headers=headers)
                poll_resp.raise_for_status()
                poll_data = poll_resp.json()
                if poll_data.get("code", -1) != 0:
                    raise RuntimeError(f"Tripo poll error: {poll_data}")
                task = poll_data["data"]
                status = task.get("status", "")
                if status == "success":
                    glb_url: str = task["result"]["model"]["url"]
                    glb_resp = await client.get(glb_url, headers={})
                    glb_resp.raise_for_status()
                    if len(glb_resp.content) < 1000:
                        raise RuntimeError(f"GLB too small ({len(glb_resp.content)} bytes)")
                    return glb_resp.content
                if status in ("failed", "cancelled", "unknown"):
                    raise RuntimeError(f"Tripo task {task_id} ended with status: {status}")

            raise RuntimeError(f"Tripo task timed out")
    except Exception:
        # Any Tripo failure — fall back to HF
        return await _call_hf_two_step(prompt)


async def _call_hf_two_step(prompt: str) -> bytes:
    """
    Free fallback: FLUX.1-schnell image → stabilityai/stable-fast-3d GLB.
    Used when Tripo API key is missing or returns an error.
    """
    hf_token = os.environ.get("HF_API_TOKEN", "")
    headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}

    # Step 1: Generate reference image
    image_url = f"https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell"
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
        raise RuntimeError("HF image generation failed — unable to generate reference image for 3D model")

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

    raise RuntimeError("HF 3D model generation failed — stable-fast-3d unavailable")


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
    Generate a 3D model via Tripo AI text-to-3D API.
    Requirements: 3.1, 3.4, 3.7
    """
    # Build a detailed prompt via Groq
    model_prompt = await prompt_builder.build_3d_prompt(object_name, category)

    # Generate via Tripo AI
    glb_bytes = await _call_tripo_model3d(model_prompt)

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
