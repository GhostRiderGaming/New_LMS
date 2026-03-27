"""
Anime image and animation generation service.

Uses Fal.ai Animagine XL 4.0 for image generation, Pillow for caption overlay,
FFmpeg for WebM animation assembly, and Cloudflare R2 for storage.

Public API:
  generate_anime_image(topic, style, caption, job_id, session_id) -> Asset
  generate_anime_animation(topic, style, caption, job_id, session_id, n_frames) -> Asset

Requirements: 1.1, 1.3, 1.6, 1.7
"""
from __future__ import annotations

import io
import os
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Literal

import fal_client
import httpx
from PIL import Image, ImageDraw, ImageFont

from app.models.anime_assets import Asset, SessionLocal
from app.services.asset_manager import asset_manager
from app.services.prompt_builder import prompt_builder

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_FAL_MODEL = "fal-ai/animagine-xl"
_IMAGE_SIZE = {"width": 832, "height": 1216}  # portrait — standard anime aspect ratio
_CAPTION_FONT_SIZE = 20
_CAPTION_PADDING = 12
_CAPTION_BG_ALPHA = 180  # semi-transparent black bar

AnimeStyle = Literal["classroom", "laboratory", "outdoor", "fantasy"]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _add_caption_overlay(image_bytes: bytes, caption: str) -> bytes:
    """
    Render a semi-transparent caption bar at the bottom of the image.
    Returns PNG bytes with the overlay applied.
    Requirement 1.3: System SHALL attach a text caption explaining the concept.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    w, h = img.size

    # Try to load a bundled font; fall back to PIL default
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", _CAPTION_FONT_SIZE)
    except (IOError, OSError):
        font = ImageFont.load_default()

    # Measure text to size the caption bar
    dummy = Image.new("RGBA", (1, 1))
    draw_dummy = ImageDraw.Draw(dummy)
    bbox = draw_dummy.textbbox((0, 0), caption, font=font)
    text_h = bbox[3] - bbox[1]
    bar_h = text_h + _CAPTION_PADDING * 2

    # Draw semi-transparent bar
    overlay = Image.new("RGBA", (w, bar_h), (0, 0, 0, _CAPTION_BG_ALPHA))
    img.paste(overlay, (0, h - bar_h), overlay)

    draw = ImageDraw.Draw(img)
    draw.text(
        (_CAPTION_PADDING, h - bar_h + _CAPTION_PADDING),
        caption,
        font=font,
        fill=(255, 255, 255, 255),
    )

    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG")
    return out.getvalue()


async def _call_fal_image(prompt: str) -> bytes:
    """Call Fal.ai Animagine XL 4.0 and return raw image bytes."""
    result = await fal_client.run_async(
        _FAL_MODEL,
        arguments={
            "prompt": prompt,
            "negative_prompt": "nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers",
            **_IMAGE_SIZE,
            "num_inference_steps": 28,
            "guidance_scale": 7.0,
        },
    )
    # result["images"][0]["url"] — download the image
    image_url: str = result["images"][0]["url"]
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.get(image_url)
        resp.raise_for_status()
        return resp.content


def _store_asset_record(
    job_id: str,
    asset_type: str,
    topic: str,
    file_path: str,
    file_size: int,
    mime_type: str,
    metadata: dict,
    session_id: str,
) -> Asset:
    """Persist an Asset row to the database and return it."""
    now = datetime.now(timezone.utc)
    asset = Asset(
        asset_id=str(uuid.uuid4()),
        job_id=job_id,
        type=asset_type,
        topic=topic,
        file_path=file_path,
        file_size_bytes=file_size,
        mime_type=mime_type,
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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_anime_image(
    topic: str,
    style: AnimeStyle,
    caption: str,
    job_id: str,
    session_id: str,
) -> Asset:
    """
    Generate a single anime-style image for the given topic and style.

    Flow:
      1. Build structured Animagine XL prompt via Groq (Requirement 1.2)
      2. Call Fal.ai Animagine XL 4.0
      3. Add caption overlay (Requirement 1.3)
      4. Upload to Cloudflare R2
      5. Persist Asset record and return it

    Requirements: 1.1, 1.3, 1.6
    """
    # 1. Build prompt
    anime_prompt = await prompt_builder.build_anime_prompt(topic, style)

    # 2. Generate image
    raw_bytes = await _call_fal_image(anime_prompt)

    # 3. Caption overlay
    final_bytes = _add_caption_overlay(raw_bytes, caption)

    # 4. Upload to R2
    key = f"anime/{job_id}/{uuid.uuid4()}.png"
    metadata = {"caption": caption, "style": style, "prompt": anime_prompt}
    asset_manager.store_asset(
        data=final_bytes,
        key=key,
        content_type="image/png",
        topic=topic,
        asset_type="image",
        metadata=metadata,
    )

    # 5. Persist DB record
    return _store_asset_record(
        job_id=job_id,
        asset_type="image",
        topic=topic,
        file_path=key,
        file_size=len(final_bytes),
        mime_type="image/png",
        metadata=metadata,
        session_id=session_id,
    )


async def generate_anime_animation(
    topic: str,
    style: AnimeStyle,
    caption: str,
    job_id: str,
    session_id: str,
    n_frames: int = 8,
) -> Asset:
    """
    Generate a short looping WebM animation for the given topic.

    Flow:
      1. Build base prompt via Groq
      2. Generate N frames with slight prompt variation via Fal.ai
      3. Assemble frames into WebM using FFmpeg subprocess
      4. Upload to Cloudflare R2
      5. Persist Asset record and return it

    Requirement 1.7: Generator SHALL produce a short looping animation (WebM, min 2s).
    """
    base_prompt = await prompt_builder.build_anime_prompt(topic, style)

    # Generate N frames with slight variation
    frame_bytes_list: list[bytes] = []
    for i in range(n_frames):
        variation = f"{base_prompt}, frame {i + 1} of {n_frames}, slight motion"
        raw = await _call_fal_image(variation)
        captioned = _add_caption_overlay(raw, caption)
        frame_bytes_list.append(captioned)

    # Assemble into WebM via FFmpeg
    webm_bytes = _assemble_webm(frame_bytes_list, fps=4)

    # Upload to R2
    key = f"anime/{job_id}/{uuid.uuid4()}.webm"
    metadata = {
        "caption": caption,
        "style": style,
        "n_frames": n_frames,
        "prompt": base_prompt,
    }
    asset_manager.store_asset(
        data=webm_bytes,
        key=key,
        content_type="video/webm",
        topic=topic,
        asset_type="animation",
        metadata=metadata,
    )

    return _store_asset_record(
        job_id=job_id,
        asset_type="animation",
        topic=topic,
        file_path=key,
        file_size=len(webm_bytes),
        mime_type="video/webm",
        metadata=metadata,
        session_id=session_id,
    )


def _assemble_webm(frames: list[bytes], fps: int = 4) -> bytes:
    """
    Write PNG frames to a temp directory and use FFmpeg to produce a WebM.
    Returns raw WebM bytes.
    Requirement 1.7: minimum 2 seconds → at fps=4, need ≥8 frames.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        for i, frame in enumerate(frames):
            path = os.path.join(tmpdir, f"frame_{i:04d}.png")
            with open(path, "wb") as f:
                f.write(frame)

        output_path = os.path.join(tmpdir, "output.webm")
        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", os.path.join(tmpdir, "frame_%04d.png"),
            "-c:v", "libvpx-vp9",
            "-b:v", "0", "-crf", "33",
            "-loop", "0",  # loop forever
            output_path,
        ]
        subprocess.run(cmd, check=True, capture_output=True)

        with open(output_path, "rb") as f:
            return f.read()
