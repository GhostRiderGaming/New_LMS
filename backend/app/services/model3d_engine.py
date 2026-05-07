"""
3D model generation service.

Uses Hugging Face Inference API (free) with openai/shap-e for text-to-3D generation.
Falls back to a descriptive error (not a silent placeholder) if generation fails.

Public API:
  generate_model3d(object_name, category, job_id, session_id) -> Asset

Requirements: 3.1, 3.4, 3.7
"""
from __future__ import annotations

import base64
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

# Shap-E via HF Inference API — text-to-3D, free tier
_HF_MODEL = "openai/shap-e"
_HF_API_URL = f"https://api-inference.huggingface.co/models/{_HF_MODEL}"
_HF_TIMEOUT = 120  # seconds — 3D generation is slow
_MAX_RETRIES = 3
_RETRY_DELAY = 10  # seconds between retries

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

# Minimal valid GLB (single triangle) — used only as absolute last resort
_FALLBACK_GLB_B64 = (
    "Z2xURgIAAAANAAAALgAAAEpTT057ImFzc2V0Ijp7InZlcnNpb24iOiIyLjAifSwic2NlbmVzIjpb"
    "eyJub2RlcyI6WzBdfV0sIm5vZGVzIjpbeyJtZXNoIjowfV0sIm1lc2hlcyI6W3sicHJpbWl0aXZl"
    "cyI6W3siYXR0cmlidXRlcyI6eyJQT1NJVElPTiI6MX0sImluZGljZXMiOjB9XX1dLCJidWZmZXJz"
    "IjpbeyJieXRlTGVuZ3RoIjoxOH1dLCJidWZmZXJWaWV3cyI6W3siYnVmZmVyIjowLCJieXRlT2Zm"
    "c2V0IjowLCJieXRlTGVuZ3RoIjo2LCJ0YXJnZXQiOjM0OTYzfSx7ImJ1ZmZlciI6MCwiYnl0ZU9m"
    "ZnNldCI6NiwiYnl0ZUxlbmd0aCI6MTIsInRhcmdldCI6MzQ5NjJ9XSwiYWNjZXNzb3JzIjpbeyJi"
    "dWZmZXJWaWV3IjowLCJieXRlT2Zmc2V0IjowLCJjb21wb25lbnRUeXBlIjo1MTIzLCJjb3VudCI6"
    "MywidHlwZSI6IlNDQUxBUiJ9LHsiYnVmZmVyVmlldyI6MSwiYnl0ZU9mZnNldCI6MCwiY29tcG9u"
    "ZW50VHlwZSI6NTEyNiwiY291bnQiOjMsInR5cGUiOiJWRUMzIiwibWF4IjpbMS4xLDEuMSwxLjFd"
    "LCJtaW4iOlswLjAsMC4wLDAuMF19XX0NAAAAQklOAAABAAIAAAAAAAAAAAAAgD8AAAAAAACAPwAAAA"
    "AAAAAAAAAAAAAAAACAP"
    "w=="
)


async def _call_hf_model3d(prompt: str) -> bytes:
    """
    Call HF Inference API (Shap-E) with retries.
    Returns raw GLB bytes on success, raises RuntimeError on all failures.
    """
    hf_token = os.environ.get("HF_API_TOKEN", "")
    headers = {"Authorization": f"Bearer {hf_token}"} if hf_token else {}
    payload = {"inputs": prompt}

    last_error: Exception = RuntimeError("Unknown error")
    for attempt in range(_MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=_HF_TIMEOUT) as client:
                resp = await client.post(_HF_API_URL, json=payload, headers=headers)
                if resp.status_code == 503:
                    # Model loading — wait and retry
                    wait = _RETRY_DELAY * (attempt + 1)
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                content = resp.content
                # HF returns GLB bytes directly for 3D models
                if len(content) < 100:
                    raise RuntimeError(f"HF returned suspiciously small response ({len(content)} bytes)")
                return content
        except Exception as e:
            last_error = e
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_RETRY_DELAY)

    raise RuntimeError(f"3D model generation failed after {_MAX_RETRIES} attempts: {last_error}")


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
      1. Build a detailed text-to-3D prompt via Groq
      2. Call HF Shap-E API → returns GLB bytes
      3. Upload to AWS S3
      4. Persist Asset record with required metadata and return it

    Requirements: 3.1, 3.4, 3.7
    Raises RuntimeError if generation fails (caller handles retry/fallback).
    """
    model_prompt = await prompt_builder.build_3d_prompt(object_name, category)

    # Raises RuntimeError on failure — Celery task will retry
    glb_bytes = await _call_hf_model3d(model_prompt)

    key = f"model3d/{job_id}/{uuid.uuid4()}.glb"
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
