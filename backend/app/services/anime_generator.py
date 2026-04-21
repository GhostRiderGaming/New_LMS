"""
Anime image and animation generation service.

Uses Hugging Face Inference API (free) with Animagine XL 4.0 for image generation,
Pillow for caption overlay, FFmpeg for WebM animation assembly, and AWS S3 for storage.

Public API:
  generate_anime_image(topic, style, caption, job_id, session_id) -> Asset
  generate_anime_animation(topic, style, caption, job_id, session_id, n_frames) -> Asset

Requirements: 1.1, 1.3, 1.6, 1.7
"""
from __future__ import annotations

import io
import os
import uuid
import urllib.parse
from datetime import datetime, timezone
from typing import Literal

import httpx
from PIL import Image, ImageDraw, ImageFont

from app.models.anime_assets import Asset, SessionLocal
from app.services.asset_manager import asset_manager
from app.services.prompt_builder import prompt_builder

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_IMAGE_SIZE = {"width": 512, "height": 768}  # portrait
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
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    w, h = img.size

    try:
        font = ImageFont.truetype("arial.ttf", _CAPTION_FONT_SIZE) # Standard Windows font
    except (IOError, OSError):
        font = ImageFont.load_default()

    dummy = Image.new("RGBA", (1, 1))
    draw_dummy = ImageDraw.Draw(dummy)
    bbox = draw_dummy.textbbox((0, 0), caption, font=font)
    text_h = bbox[3] - bbox[1]
    bar_h = text_h + _CAPTION_PADDING * 2

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


import asyncio

async def _call_pollinations_image(prompt: str) -> bytes:
    """Call pollinations.ai (free, tokenless) to generate an image, with robust 429 handling."""
    encoded_prompt = urllib.parse.quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={_IMAGE_SIZE['width']}&height={_IMAGE_SIZE['height']}&nologo=true&seed={uuid.uuid4().int % 100000}"
    
    max_retries = 5
    base_delay = 2.0
    
    async with httpx.AsyncClient(timeout=60) as client:
        for attempt in range(max_retries):
            resp = await client.get(url)
            if resp.status_code == 429:
                if attempt == max_retries - 1:
                    resp.raise_for_status()
                # Exponential backoff
                await asyncio.sleep(base_delay * (2 ** attempt))
                continue
            resp.raise_for_status()
            return resp.content
    raise RuntimeError("Failed to fetch image after retries")


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
    Generate a single anime-style image using Pollinations.ai.
    """
    # 1. Build prompt
    anime_prompt = await prompt_builder.build_anime_prompt(topic, style)

    # 2. Generate image (tokenless)
    raw_bytes = await _call_pollinations_image(anime_prompt + " anime style masterpiece")

    # 3. Caption overlay
    final_bytes = _add_caption_overlay(raw_bytes, caption)

    # 4. Upload to local/R2
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
    n_frames: int = 4,
) -> Asset:
    """
    Generate a GIF animation without needing ffmpeg.
    """
    base_prompt = await prompt_builder.build_anime_prompt(topic, style)

    # Generate N frames
    pil_frames = []
    for i in range(n_frames):
        variation = f"{base_prompt}, dynamic motion sequence, animation frame {i + 1}"
        raw = await _call_pollinations_image(variation)
        captioned = _add_caption_overlay(raw, caption)
        img = Image.open(io.BytesIO(captioned)).convert("RGB")
        pil_frames.append(img)
        # Stagger requests to preserve rate limit
        await asyncio.sleep(1.0)

    # Assemble into GIF via Pillow (no ffmpeg needed!)
    out_buf = io.BytesIO()
    pil_frames[0].save(
        out_buf,
        format="GIF",
        save_all=True,
        append_images=pil_frames[1:],
        duration=300, # 300ms per frame
        loop=0 # infinite loop
    )
    gif_bytes = out_buf.getvalue()

    # Upload to R2
    key = f"anime/{job_id}/{uuid.uuid4()}.gif"
    metadata = {
        "caption": caption,
        "style": style,
        "n_frames": n_frames,
        "prompt": base_prompt,
    }
    asset_manager.store_asset(
        data=gif_bytes,
        key=key,
        content_type="image/gif",
        topic=topic,
        asset_type="animation",
        metadata=metadata,
    )

    return _store_asset_record(
        job_id=job_id,
        asset_type="animation",
        topic=topic,
        file_path=key,
        file_size=len(gif_bytes),
        mime_type="image/gif",
        metadata=metadata,
        session_id=session_id,
    )
