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
from app.services.image_resolver import image_resolver

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_IMAGE_SIZE = {"width": 512, "height": 768}  # portrait
_CAPTION_FONT_SIZE = 20
_CAPTION_PADDING = 12
_CAPTION_BG_ALPHA = 180  # semi-transparent black bar

AnimeStyle = Literal["classroom", "laboratory", "outdoor", "fantasy", "character"]


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

# Negative prompt for scientific diagrams — blocks human characters at the model level
_SCIENTIFIC_NEGATIVE = (
    "humans, people, children, students, classroom, teacher, anime characters, "
    "text, watermark, blurry, low quality"
)


async def _call_pollinations_image(
    prompt: str,
    negative: str = "",
    reference_image_url: str | None = None,
) -> bytes:
    """
    Call pollinations.ai (free, tokenless) to generate an image.
    Uses the /prompt/ endpoint with robust retry and fallback seed logic.
    Accepts an optional negative prompt passed as a separate URL parameter
    that the Flux model actually respects.

    If reference_image_url is provided, passes it as the `image` query parameter
    so the model uses it as a visual reference for identity-preserving generation.
    """
    encoded_prompt = urllib.parse.quote(prompt)
    seed = uuid.uuid4().int % 100000
    neg_param = f"&negative={urllib.parse.quote(negative)}" if negative else ""
    ref_param = f"&image={urllib.parse.quote(reference_image_url)}" if reference_image_url else ""
    
    # Two URL variants with different seeds for fallback
    urls = [
        f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={_IMAGE_SIZE['width']}&height={_IMAGE_SIZE['height']}&nologo=true&enhance=false&seed={seed}{neg_param}{ref_param}",
        f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={_IMAGE_SIZE['width']}&height={_IMAGE_SIZE['height']}&nologo=true&enhance=false&seed={seed+1}{neg_param}{ref_param}",
    ]
    
    max_retries = 3
    base_delay = 4.0
    last_error = None
    
    for url_idx, url in enumerate(urls):
        async with httpx.AsyncClient(timeout=120) as client:
            for attempt in range(max_retries):
                try:
                    resp = await client.get(url)
                    if resp.status_code == 429:
                        await asyncio.sleep(base_delay * (2 ** attempt))
                        continue
                    if resp.status_code == 500 and attempt < max_retries - 1:
                        # Pollinations 500s are usually transient — retry with backoff
                        await asyncio.sleep(base_delay * (attempt + 1))
                        continue
                    resp.raise_for_status()
                    content = resp.content
                    if len(content) < 1000:
                        # Too small — likely an error page, retry
                        await asyncio.sleep(base_delay)
                        continue
                    return content
                except httpx.TimeoutException as exc:
                    last_error = exc
                    if attempt < max_retries - 1:
                        await asyncio.sleep(base_delay * (attempt + 1))
                    continue
                except httpx.HTTPStatusError as exc:
                    last_error = exc
                    if attempt == max_retries - 1 and url_idx == len(urls) - 1:
                        raise
                    await asyncio.sleep(base_delay * (attempt + 1))
                except Exception as exc:
                    last_error = exc
                    if attempt == max_retries - 1 and url_idx == len(urls) - 1:
                        raise
                    await asyncio.sleep(base_delay)
    
    raise RuntimeError(
        f"Failed to generate image after all retries. "
        f"Last error: {last_error}"
    )


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
    story_metadata: dict | None = None,
    reference_image_url: str | None = None,
) -> Asset:
    """
    Generate a single anime-style image using Pollinations.ai,
    or fetch a real textbook diagram from Wikimedia for scientific topics.

    If story_metadata is provided (keys: story_id, episode_number, scene_number),
    those fields are merged into the asset metadata so the frontend can look up
    scene images by their position in a story (Bug 6 Round 2).

    If reference_image_url is provided, it's passed to Pollinations as a visual
    reference for identity-preserving generation (character accuracy pipeline).
    """
    # 1. Resolve image source
    # Skip the expensive resolver for story scenes (has_scene_context pattern)
    # because we build the prompt directly from scene description + topic.
    has_scene_context = (
        style not in ("character",)
        and "(" in topic
        and topic.endswith(")")
    )

    if has_scene_context:
        # Build prompt directly without calling resolve_image
        paren_start = topic.rfind("(")
        scene_desc = topic[:paren_start].strip()
        story_context = topic[paren_start + 1:-1].strip()

        anime_prompt = (
            f"masterpiece, best quality, ultra-detailed cinematic anime scene, "
            f"{scene_desc}, "
            f"related to {story_context}, "
            f"vivid accurate period environment, dramatic cinematic lighting, "
            f"rich colors, sharp focus, expressive characters, "
            f"anime art style, 8k resolution"
        )
        neg = (
            "blurry, low quality, bad anatomy, watermark, text overlay, "
            "generic, boring, modern classroom, school desks, whiteboard"
        )
        raw_bytes = await _call_pollinations_image(
            anime_prompt,
            negative=neg,
            reference_image_url=reference_image_url,
        )
        final_bytes = _add_caption_overlay(raw_bytes, caption)
        key = f"anime/{job_id}/{uuid.uuid4()}.png"
        metadata = {
            "caption": caption, "style": style,
            "prompt": anime_prompt, "source": "ai_generated", "category": "HISTORICAL_EVENT",
        }
        if story_metadata:
            metadata.update(story_metadata)
        asset_manager.store_asset(
            data=final_bytes, key=key, content_type="image/png",
            topic=topic, asset_type="image", metadata=metadata,
        )
        return _store_asset_record(
            job_id=job_id, asset_type="image", topic=topic,
            file_path=key, file_size=len(final_bytes),
            mime_type="image/png", metadata=metadata, session_id=session_id,
        )

    result = await image_resolver.resolve_image(topic=topic, style=style)

    # Negative prompt for scientific diagrams
    neg = _SCIENTIFIC_NEGATIVE if result.category == "SCIENTIFIC_DIAGRAM" else ""

    if result.source == "wikimedia" and result.url:
        # ── External URL path ─────────────────────────────────────────────
        # Return the Wikipedia/Commons URL directly — do NOT fetch bytes.
        # The backend network cannot reach upload.wikimedia.org (egress
        # restriction). The frontend will load the URL via a normal <img>
        # tag — browsers have no such restriction.
        # Skip Pillow caption overlay and S3 upload for this path.
        key = result.url  # Store the external URL as the "file_path"
        metadata = {
            "caption": caption,
            "style": style,
            "source": "external",
            "category": result.category,
            "external_url": result.url,
            "prompt": f"[Wikimedia] {result.search_query}",
        }
        if story_metadata:
            metadata.update(story_metadata)
        return _store_asset_record(
            job_id=job_id,
            asset_type="image",
            topic=topic,
            file_path=key,
            file_size=0,
            mime_type="image/png",
            metadata=metadata,
            session_id=session_id,
        )
    else:
        # AI generation path
        if style == "character":
            import json
            import asyncio
            from app.services.prompt_builder import prompt_builder

            # System prompt tuned for maximum character accuracy.
            # Key insight: shorter positive prompts (< 80 words) outperform longer ones
            # on Pollinations/Flux. Visual appearance must come FIRST in the prompt.
            system_prompt = (
                "You are an expert character art director for image generation.\n"
                "Given a character name, output a JSON object with EXACTLY these keys:\n"
                "'wiki_query': Exact Wikipedia article title for this character/person "
                "(e.g. 'Napoleon Bonaparte', 'Naruto Uzumaki'). Use the most famous/canonical name.\n"
                "'visual_appearance': Precise comma-separated physical descriptors ONLY: "
                "hair color+style, eye color, skin tone, height/build, clothing colors+style, "
                "any distinctive marks or accessories. Maximum 40 words.\n"
                "'positive_prompt': Dense image generation prompt starting with visual_appearance, "
                "then character name, then quality tags. Format: "
                "'[appearance], [name], [setting], masterpiece, best quality, highly detailed, "
                "cinematic lighting, sharp focus, 8k'. Maximum 60 words total.\n"
                "'negative_prompt': 10-15 comma-separated negative tags specific to this character type. "
                "Real people: 'cartoon, anime style, illustration, painting, drawing'. "
                "Anime/game characters: 'photorealistic, 3d render, photograph, live action'."
            )
            
            # OPTIMISTIC CONCURRENCY: Fetch Wikipedia for raw topic while LLaMA generates the prompt
            if not reference_image_url:
                response_task = asyncio.create_task(
                    prompt_builder._call(
                        system_prompt, 
                        f"Character: {topic}", 
                        max_tokens=500, 
                        response_format={"type": "json_object"}
                    )
                )
                optimistic_wiki_task = asyncio.create_task(
                    image_resolver._fetch_wikimedia_image(topic)
                )
                response, optimistic_ref_url = await asyncio.gather(response_task, optimistic_wiki_task)
            else:
                optimistic_ref_url = reference_image_url
                response = await prompt_builder._call(
                    system_prompt, 
                    f"Character: {topic}", 
                    max_tokens=500, 
                    response_format={"type": "json_object"}
                )
            
            wiki_query = topic
            visual_appearance = ""
            anime_prompt = ""
            dynamic_negative = "inaccurate face, deformed, poor quality, bad anatomy, out of character, messy background, incoherent environment, poorly drawn, blurry, generic, boring, ugly, amateur photography"
            
            if response:
                try:
                    data = json.loads(response)
                    wiki_query = data.get("wiki_query", topic).strip()
                    visual_appearance = data.get("visual_appearance", "").strip()
                    anime_prompt = data.get("positive_prompt", "").strip()
                    neg = data.get("negative_prompt", "").strip()
                    if neg:
                        dynamic_negative = f"{neg}, {dynamic_negative}"
                except json.JSONDecodeError:
                    pass
            
            if not anime_prompt:
                anime_prompt = (
                    f"portrait of {topic}, accurate likeness, "
                    f"detailed face, period-accurate clothing, "
                    f"masterpiece, best quality, highly detailed, "
                    f"cinematic lighting, sharp focus, 8k resolution"
                )

            # Determine reference image (Optimistic hit or Secondary fetch)
            if not reference_image_url:
                if wiki_query.lower() == topic.lower():
                    reference_image_url = optimistic_ref_url
                else:
                    reference_image_url = await image_resolver._fetch_wikimedia_image(wiki_query)

            # ALWAYS-ON TEXTUAL REINFORCEMENT: Combine visual appearance with positive prompt
            if visual_appearance:
                anime_prompt = f"({visual_appearance}), {anime_prompt}"
                
            # URI SAFETY BOUNDS: Truncate to safe limits (approx 1500 chars total for prompts)
            if len(anime_prompt) > 1000:
                anime_prompt = anime_prompt[:1000]
            if len(dynamic_negative) > 500:
                dynamic_negative = dynamic_negative[:500]

            raw_bytes = await _call_pollinations_image(
                anime_prompt,
                negative=dynamic_negative,
                reference_image_url=reference_image_url,
            )
        else:
            anime_prompt = result.ai_prompt or f"{topic}, educational illustration, anime style, masterpiece, best quality"
            raw_bytes = await _call_pollinations_image(
                anime_prompt + " anime style masterpiece",
                negative=neg,
                reference_image_url=reference_image_url,
            )

    # 2. Caption overlay
    final_bytes = _add_caption_overlay(raw_bytes, caption)

    # 3. Upload to local/R2
    key = f"anime/{job_id}/{uuid.uuid4()}.png"
    metadata = {"caption": caption, "style": style, "prompt": anime_prompt, "source": result.source, "category": result.category}
    if story_metadata:
        metadata.update(story_metadata)
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
    Uses the image resolver to get a smarter prompt for non-scientific topics.
    For scientific diagrams (Google source), falls back to AI generation for animation.
    """
    result = await image_resolver.resolve_image(topic=topic, style=style)

    # For animations we always need AI generation (can't animate a Google image)
    if result.source == "google" or not result.ai_prompt:
        base_prompt = (
            f"{topic}, simple children's science illustration, bold saturated colors, "
            f"large clear shapes, friendly anime illustration style, masterpiece, best quality"
        )
    else:
        base_prompt = result.ai_prompt

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
