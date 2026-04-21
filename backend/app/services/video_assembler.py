"""
Video Assembler — Converts a story plan + scene images into a narrated MP4 video.

Pipeline:
  1. For each scene: generate narration audio via edge-tts
  2. Load scene images, apply Ken Burns (pan/zoom) effects
  3. Add caption overlays and episode title cards
  4. Stitch everything into a single MP4 with audio

Dependencies: moviepy, edge-tts, Pillow, imageio-ffmpeg
"""
from __future__ import annotations

import asyncio
import io
import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any

import edge_tts
from PIL import Image, ImageDraw, ImageFont
from moviepy import (
    ImageClip,
    AudioFileClip,
    CompositeVideoClip,
    concatenate_videoclips,
    TextClip,
    ColorClip,
)

from app.models.anime_assets import Asset, SessionLocal
from app.services.asset_manager import asset_manager

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_TTS_VOICE = "en-US-AriaNeural"
_VIDEO_SIZE = (1280, 720)
_FPS = 24
_TITLE_CARD_DURATION = 4  # seconds
_MIN_SCENE_DURATION = 5   # minimum seconds per scene


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _synthesize_narration(text: str, output_path: str) -> float:
    """Generate narration audio via edge-tts. Returns duration in seconds."""
    try:
        communicate = edge_tts.Communicate(text, _TTS_VOICE)
        await communicate.save(output_path)
        
        # Get duration
        try:
            audio_clip = AudioFileClip(output_path)
            duration = audio_clip.duration
            audio_clip.close()
            return max(duration, _MIN_SCENE_DURATION)
        except Exception:
            return _MIN_SCENE_DURATION
    except Exception as e:
        print(f"[VideoAssembler] TTS narration failed: {e} — using silent clip")
        # Create an empty file so the caller knows narration failed
        with open(output_path, "wb") as f:
            f.write(b"")
        return _MIN_SCENE_DURATION


def _create_title_card(title: str, subtitle: str = "", duration: float = _TITLE_CARD_DURATION) -> ImageClip:
    """Create a cinematic title card with gradient background."""
    img = Image.new("RGB", _VIDEO_SIZE, (15, 10, 35))
    draw = ImageDraw.Draw(img)
    
    try:
        title_font = ImageFont.truetype("arial.ttf", 56)
        sub_font = ImageFont.truetype("arial.ttf", 24)
    except (IOError, OSError):
        title_font = ImageFont.load_default()
        sub_font = ImageFont.load_default()
    
    # Draw purple accent line
    draw.rectangle([(540, 300), (740, 304)], fill=(139, 92, 246))
    
    # Draw title centered
    bbox = draw.textbbox((0, 0), title, font=title_font)
    tw = bbox[2] - bbox[0]
    draw.text(((1280 - tw) // 2, 320), title, font=title_font, fill=(255, 255, 255))
    
    # Draw subtitle
    if subtitle:
        bbox2 = draw.textbbox((0, 0), subtitle, font=sub_font)
        sw = bbox2[2] - bbox2[0]
        draw.text(((1280 - sw) // 2, 400), subtitle, font=sub_font, fill=(139, 92, 246))
    
    # Save to temp and create clip
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    img.save(tmp.name)
    tmp.close()
    
    clip = ImageClip(tmp.name, duration=duration)
    return clip


def _create_scene_clip(image_bytes: bytes, caption: str, duration: float) -> ImageClip:
    """Create a scene clip from image bytes with caption overlay and Ken Burns effect."""
    # Load and resize image
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    
    # Scale to fit video while maintaining aspect ratio, then pad
    img_ratio = img.width / img.height
    vid_ratio = _VIDEO_SIZE[0] / _VIDEO_SIZE[1]
    
    if img_ratio > vid_ratio:
        new_w = int(_VIDEO_SIZE[1] * img_ratio)
        new_h = _VIDEO_SIZE[1]
    else:
        new_w = _VIDEO_SIZE[0]
        new_h = int(_VIDEO_SIZE[0] / img_ratio)
    
    # Scale up slightly for Ken Burns room
    new_w = int(new_w * 1.15)
    new_h = int(new_h * 1.15)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    
    # Add caption bar at bottom
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 20)
    except (IOError, OSError):
        font = ImageFont.load_default()
    
    bar_h = 60
    # Semi-transparent bar
    overlay = Image.new("RGBA", (new_w, bar_h), (0, 0, 0, 180))
    img_rgba = img.convert("RGBA")
    img_rgba.paste(overlay, (0, new_h - bar_h), overlay)
    
    draw = ImageDraw.Draw(img_rgba)
    # Wrap caption text
    max_chars = 80
    wrapped = caption[:max_chars] + ("..." if len(caption) > max_chars else "")
    draw.text((20, new_h - bar_h + 15), wrapped, font=font, fill=(255, 255, 255, 255))
    
    img_final = img_rgba.convert("RGB")
    
    # Save temp
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    img_final.save(tmp.name)
    tmp.close()
    
    # Create clip with simple Ken Burns (slow zoom in)
    base_clip = ImageClip(tmp.name, duration=duration)
    
    # Ken Burns: slow zoom from 1.0 to 1.1 over duration
    def zoom_effect(get_frame, t):
        import numpy as np
        frame = get_frame(t)
        h, w = frame.shape[:2]
        
        # Calculate zoom factor (1.0 -> 1.1 over duration)
        zoom = 1.0 + (0.1 * t / max(duration, 1))
        
        # Calculate crop
        new_h = int(h / zoom)
        new_w = int(w / zoom)
        y_start = (h - new_h) // 2
        x_start = (w - new_w) // 2
        
        cropped = frame[y_start:y_start+new_h, x_start:x_start+new_w]
        
        # Resize back to original
        from PIL import Image as PILImage
        pil_img = PILImage.fromarray(cropped)
        pil_img = pil_img.resize((_VIDEO_SIZE[0], _VIDEO_SIZE[1]), PILImage.LANCZOS)
        return np.array(pil_img)
    
    zoomed = base_clip.transform(zoom_effect)
    return zoomed


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def assemble_story_video(
    story_plan: dict,
    scene_images: dict[str, bytes],  # scene_key -> image bytes
    job_id: str,
    session_id: str,
) -> Asset:
    """
    Assemble a narrated anime video from a story plan and scene images.
    
    Returns an Asset record pointing to the generated MP4.
    """
    clips = []
    temp_files = []
    
    try:
        title = story_plan.get("title", "Educational Story")
        topic = story_plan.get("topic", "Unknown")
        
        # 1. Opening title card
        opening = _create_title_card(title, f"A {topic} Adventure")
        clips.append(opening)
        
        # 2. Process each episode
        for ep in story_plan.get("episodes", []):
            ep_num = ep.get("episode_number", 1)
            ep_title = ep.get("title", f"Episode {ep_num}")
            concept = ep.get("educational_concept", "")
            
            # Episode title card
            ep_card = _create_title_card(
                f"Episode {ep_num}: {ep_title}",
                concept,
                duration=3
            )
            clips.append(ep_card)
            
            # Process each scene
            for scene in ep.get("scenes", []):
                scene_num = scene.get("scene_number", 1)
                description = scene.get("description", "")
                caption = scene.get("caption", description)
                scene_key = f"ep{ep_num}_s{scene_num}"
                
                # Narration text
                narration_text = f"{description}. {caption}"
                
                # Generate narration audio
                audio_path = tempfile.mktemp(suffix=".mp3")
                temp_files.append(audio_path)
                duration = await _synthesize_narration(narration_text, audio_path)
                
                # Get scene image (or create placeholder)
                if scene_key in scene_images:
                    img_bytes = scene_images[scene_key]
                else:
                    # Create a placeholder scene image
                    placeholder = Image.new("RGB", _VIDEO_SIZE, (20, 15, 40))
                    d = ImageDraw.Draw(placeholder)
                    try:
                        f = ImageFont.truetype("arial.ttf", 32)
                    except:
                        f = ImageFont.load_default()
                    d.text((200, 300), f"Scene {scene_num}: {description[:50]}...", font=f, fill=(180, 180, 220))
                    buf = io.BytesIO()
                    placeholder.save(buf, format="PNG")
                    img_bytes = buf.getvalue()
                
                # Create scene video clip
                scene_clip = _create_scene_clip(img_bytes, caption, duration)
                
                # Add narration audio (skip if TTS failed — empty file)
                try:
                    if os.path.getsize(audio_path) > 100:  # Non-trivial file
                        audio = AudioFileClip(audio_path)
                        scene_clip = scene_clip.with_audio(audio)
                except Exception as e:
                    print(f"[VideoAssembler] Audio attach failed for scene {scene_key}: {e}")
                
                clips.append(scene_clip)
        
        # 3. Closing card
        closing = _create_title_card("The End", f"Generated by AnimeEdu • {topic}", duration=3)
        clips.append(closing)
        
        # 4. Concatenate all clips
        final = concatenate_videoclips(clips, method="compose")
        
        # 5. Write to temp file
        output_path = tempfile.mktemp(suffix=".mp4")
        temp_files.append(output_path)
        
        final.write_videofile(
            output_path,
            fps=_FPS,
            codec="libx264",
            audio_codec="aac",
            threads=2,
            logger=None,  # Suppress moviepy's verbose output
        )
        
        # 6. Read and store
        with open(output_path, "rb") as f:
            video_bytes = f.read()
        
        key = f"story/{job_id}/{uuid.uuid4()}.mp4"
        now = datetime.now(timezone.utc)
        
        asset_manager.store_asset(
            data=video_bytes,
            key=key,
            content_type="video/mp4",
            topic=topic,
            asset_type="animation",
            metadata={
                "title": title,
                "topic": topic,
                "story_id": story_plan.get("story_id", ""),
                "type": "anime_video",
                "total_episodes": len(story_plan.get("episodes", [])),
            },
            created_at=now,
        )
        
        # 7. Create asset record
        asset = Asset(
            asset_id=str(uuid.uuid4()),
            job_id=job_id,
            type="animation",
            topic=topic,
            file_path=key,
            file_size_bytes=len(video_bytes),
            mime_type="video/mp4",
            asset_metadata={
                "title": title,
                "topic": topic,
                "story_id": story_plan.get("story_id", ""),
                "type": "anime_video",
            },
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
    
    finally:
        # Cleanup temp files
        for f in temp_files:
            try:
                os.unlink(f)
            except:
                pass
        
        # Close clips
        for c in clips:
            try:
                c.close()
            except:
                pass
