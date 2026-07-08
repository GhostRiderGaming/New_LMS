"""
In-process async task executor — runs generation jobs directly without Celery/Redis.

When the Celery broker is unavailable (local dev), routers dispatch jobs here
instead of silently dropping them. Each ``run_*_job`` coroutine mirrors the
logic of the corresponding Celery task in ``app.worker`` but executes natively
in the FastAPI event loop.

Progress notifications are sent via ``job_notifier.notify()`` so the
WebSocket-connected frontend receives real-time status updates.
"""
from __future__ import annotations

import logging
import traceback
from datetime import datetime, timezone

from app.models.anime_assets import Job, SessionLocal
from app.services.job_notifier import notify

logger = logging.getLogger(__name__)


def _friendly_error(exc: Exception) -> str:
    """Convert raw exceptions into user-friendly error messages."""
    msg = str(exc)
    if "Connection error" in msg or "APIConnectionError" in msg or "ConnectError" in msg:
        return (
            "The AI service is temporarily unreachable. "
            "This is usually a brief network issue — please try again in a moment."
        )
    if "timeout" in msg.lower() or "timed out" in msg.lower():
        return (
            "The generation timed out. The AI service may be busy — "
            "please try again in a moment."
        )
    if ("rate" in msg.lower() and "limit" in msg.lower()) or "429" in msg:
        return (
            "Rate limit reached. Too many requests — "
            "please wait a minute and try again."
        )
    if "401" in msg or "unauthorized" in msg.lower() or "invalid api key" in msg.lower():
        return "API authentication error. Please check the API key configuration."
    # Truncate very long error messages
    if len(msg) > 200:
        return msg[:200] + "..."
    return msg


def _update_job(job_id: str, **fields) -> None:
    """Helper: update a Job row with the given fields in a fresh session.
    
    Automatically increments retry_count when status transitions to 'failed',
    maintaining parity with the Celery worker's retry tracking.
    """
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            return
        for k, v in fields.items():
            setattr(job, k, v)
        # Track retry attempts on failure (I3)
        if fields.get("status") == "failed":
            job.retry_count = (job.retry_count or 0) + 1
        job.updated_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Anime generation
# ---------------------------------------------------------------------------

async def run_anime_job(
    job_id: str,
    topic: str,
    style: str,
    include_animation: bool,
    session_id: str,
) -> None:
    """Execute anime generation directly (no Celery)."""
    logger.info("task_executor: starting anime job %s", job_id)
    try:
        _update_job(job_id, status="processing")
        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 10, "step": "Starting generation..."})

        from app.services.anime_generator import generate_anime_image, generate_anime_animation
        from app.services.safety import safety_service

        caption = f"{topic} — educational anime scene"

        # Step 1: Build prompt + generate
        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 20, "step": "Building prompt..."})

        if include_animation:
            asset = await generate_anime_animation(
                topic=topic, style=style, caption=caption,
                job_id=job_id, session_id=session_id,
            )
        else:
            asset = await generate_anime_image(
                topic=topic, style=style, caption=caption,
                job_id=job_id, session_id=session_id,
            )

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 80, "step": "Safety check..."})

        # Step 2: Post-generation safety check
        safety_result = await safety_service.check_content(caption)

        if not safety_result.safe:
            from app.services.asset_manager import asset_manager
            asset_manager.delete_file(asset.file_path)
            _update_job(job_id, status="failed", error_message=f"safety_violation: {safety_result.reason}")
            notify(job_id, {"job_id": job_id, "status": "failed", "error_message": f"safety_violation: {safety_result.reason}"})
            return

        # Step 3: Mark complete
        _update_job(job_id, status="complete", asset_id=asset.asset_id)
        notify(job_id, {"job_id": job_id, "status": "complete", "asset_id": asset.asset_id, "progress": 100})
        logger.info("task_executor: anime job %s completed", job_id)

    except Exception as exc:
        logger.exception("task_executor: anime job %s failed", job_id)
        friendly = _friendly_error(exc)
        _update_job(job_id, status="failed", error_message=friendly)
        notify(job_id, {"job_id": job_id, "status": "failed", "error_message": friendly})


# ---------------------------------------------------------------------------
# Simulation generation
# ---------------------------------------------------------------------------

async def run_simulation_job(
    job_id: str,
    topic: str,
    category: str,
    session_id: str,
) -> None:
    """Execute simulation generation directly (no Celery)."""
    logger.info("task_executor: starting simulation job %s", job_id)
    try:
        _update_job(job_id, status="processing")
        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 10, "step": "Starting generation..."})

        from app.services.simulation_engine import generate_simulation
        from app.services.safety import safety_service

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 20, "step": "Generating simulation code..."})

        db = SessionLocal()
        try:
            asset = await generate_simulation(
                topic=topic, category=category,
                db=db, session_id=session_id, job_id=job_id,
            )
        finally:
            db.close()

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 80, "step": "Safety check..."})

        safety_result = await safety_service.check_content(topic)
        if not safety_result.safe:
            from app.services.asset_manager import asset_manager
            asset_manager.delete_file(asset.file_path)
            _update_job(job_id, status="failed", error_message=f"safety_violation: {safety_result.reason}")
            notify(job_id, {"job_id": job_id, "status": "failed", "error_message": f"safety_violation: {safety_result.reason}"})
            return

        _update_job(job_id, status="complete", asset_id=asset.asset_id)
        notify(job_id, {"job_id": job_id, "status": "complete", "asset_id": asset.asset_id, "progress": 100})
        logger.info("task_executor: simulation job %s completed", job_id)

    except Exception as exc:
        logger.exception("task_executor: simulation job %s failed", job_id)
        friendly = _friendly_error(exc)
        _update_job(job_id, status="failed", error_message=friendly)
        notify(job_id, {"job_id": job_id, "status": "failed", "error_message": friendly})


# ---------------------------------------------------------------------------
# 3D model generation
# ---------------------------------------------------------------------------

async def run_model3d_job(
    job_id: str,
    object_name: str,
    category: str,
    session_id: str,
) -> None:
    """Execute 3D model generation directly (no Celery)."""
    logger.info("task_executor: starting model3d job %s", job_id)
    try:
        _update_job(job_id, status="processing")
        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 10, "step": "Starting generation..."})

        from app.services.model3d_engine import generate_model3d
        from app.services.safety import safety_service

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 20, "step": "Generating 3D model..."})

        asset = await generate_model3d(
            object_name=object_name, category=category,
            job_id=job_id, session_id=session_id,
        )

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 80, "step": "Safety check..."})

        safety_result = await safety_service.check_content(object_name)
        if not safety_result.safe:
            from app.services.asset_manager import asset_manager
            asset_manager.delete_file(asset.file_path)
            _update_job(job_id, status="failed", error_message=f"safety_violation: {safety_result.reason}")
            notify(job_id, {"job_id": job_id, "status": "failed", "error_message": f"safety_violation: {safety_result.reason}"})
            return

        _update_job(job_id, status="complete", asset_id=asset.asset_id)
        notify(job_id, {"job_id": job_id, "status": "complete", "asset_id": asset.asset_id, "progress": 100})
        logger.info("task_executor: model3d job %s completed", job_id)

    except Exception as exc:
        logger.exception("task_executor: model3d job %s failed", job_id)
        friendly = _friendly_error(exc)
        _update_job(job_id, status="failed", error_message=friendly)
        notify(job_id, {"job_id": job_id, "status": "failed", "error_message": friendly})


# ---------------------------------------------------------------------------
# Story generation
# ---------------------------------------------------------------------------

async def run_story_job(
    job_id: str,
    topic: str,
    episode_count: int,
    session_id: str,
) -> None:
    """Execute story generation with video assembly (no Celery)."""
    logger.info("task_executor: starting story job %s", job_id)
    try:
        _update_job(job_id, status="processing")
        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 5, "step": "Planning story structure..."})

        from app.services.story_engine import generate_story_plan
        from app.services.safety import safety_service

        # Phase 1: Generate story plan
        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 10, "step": "AI is writing your story plan..."})

        db = SessionLocal()
        try:
            plan = await generate_story_plan(
                topic=topic, episode_count=episode_count,
                session_id=session_id, job_id=job_id, db=db,
            )
            # Get the plan asset_id
            from app.models.anime_assets import Asset
            plan_asset = (
                db.query(Asset)
                .filter(Asset.job_id == job_id, Asset.type == "story")
                .first()
            )
            plan_asset_id = plan_asset.asset_id if plan_asset else None
        finally:
            db.close()

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 20, "step": f"Story plan ready: {plan.title}"})

        # Safety check
        safety_result = await safety_service.check_content(f"{plan.title} {plan.synopsis}")
        if not safety_result.safe:
            _update_job(job_id, status="failed", error_message=f"safety_violation: {safety_result.reason}")
            notify(job_id, {"job_id": job_id, "status": "failed", "error_message": f"safety_violation: {safety_result.reason}"})
            return

        # Phase 2: Generate scene images sequentially
        import asyncio
        from app.services.anime_generator import generate_anime_image

        # Pre-resolve reference images for cast characters (for scene accuracy)
        character_refs: dict[str, str] = {}  # name_lower -> reference_url
        try:
            from app.services.image_resolver import image_resolver
            for char in plan.characters:
                char_name = char.name.strip()
                if char_name.lower() in image_resolver._DEPICTION_RESTRICTED:
                    continue
                ref_url = await image_resolver._fetch_wikimedia_image(char_name)
                if ref_url and await image_resolver._validate_image_url(ref_url):
                    character_refs[char_name.lower()] = ref_url
                    logger.info("task_executor: resolved reference for '%s': %s", char_name, ref_url[:80])
                elif topic:
                    ref_url = await image_resolver._fetch_wikimedia_image(f"{char_name} {topic}")
                    if ref_url and await image_resolver._validate_image_url(ref_url):
                        character_refs[char_name.lower()] = ref_url
                        logger.info("task_executor: resolved reference for '%s' with topic: %s", char_name, ref_url[:80])
        except Exception as e:
            logger.warning("task_executor: character reference pre-resolution failed: %s", e)

        total_scenes = sum(len(ep.scenes) for ep in plan.episodes)
        scene_images: dict[str, bytes] = {}
        scene_count = 0

        for episode in plan.episodes:
            for scene in episode.scenes:
                scene_count += 1
                scene_key = f"ep{episode.episode_number}_s{scene.scene_number}"
                progress = 20 + int(50 * scene_count / max(total_scenes, 1))
                
                notify(job_id, {
                    "job_id": job_id, "status": "processing", "progress": progress,
                    "step": f"Generating scene {scene_count}/{total_scenes}: {scene.description[:40]}..."
                })

                # Find the first character reference that appears in this scene description
                scene_ref_url = None
                scene_desc_lower = scene.description.lower()
                for char_name_lower, ref_url in character_refs.items():
                    if char_name_lower in scene_desc_lower:
                        scene_ref_url = ref_url
                        break

                try:
                    # Bug 6 Round 2: pass story_metadata so scene images are queryable
                    asset = await generate_anime_image(
                        topic=f"{topic} — Episode {episode.episode_number}: {episode.title} — {scene.description}",
                        style=plan.setting_style,
                        caption=scene.caption,
                        job_id=job_id,
                        session_id=session_id,
                        story_metadata={
                            "story_id": plan.story_id,
                            "episode_number": episode.episode_number,
                            "scene_number": scene.scene_number,
                        },
                        reference_image_url=scene_ref_url,
                    )
                    # Bug 6 Round 2: write asset_id back onto the scene
                    scene.asset_id = asset.asset_id
                    # Read the generated image bytes from storage
                    from app.services.asset_manager import asset_manager
                    img_bytes = asset_manager.download_file(asset.file_path)
                    if img_bytes:
                        scene_images[scene_key] = img_bytes
                except Exception as e:
                    logger.warning("Scene %s generation failed: %s", scene_key, e)
                
                # Throttle to avoid 429
                await asyncio.sleep(1.5)

        # Bug 6 Round 2: Re-save the StoryPlan asset metadata with populated asset_ids
        db2 = SessionLocal()
        try:
            from app.models.anime_assets import Asset as AssetModel
            plan_asset_obj = (
                db2.query(AssetModel)
                .filter(AssetModel.asset_id == plan_asset_id)
                .first()
            )
            if plan_asset_obj and plan_asset_obj.asset_metadata:
                updated_meta = dict(plan_asset_obj.asset_metadata)
                updated_meta["episodes"] = [ep.model_dump() for ep in plan.episodes]
                plan_asset_obj.asset_metadata = updated_meta
                db2.commit()
                logger.info("task_executor: updated plan asset %s with scene asset_ids", plan_asset_id)

                # Fix: The frontend downloads plan.json from Cloud Storage. We MUST update the Cloud Storage file too!
                from app.services.asset_manager import asset_manager
                plan_bytes = plan.model_dump_json(indent=2).encode("utf-8")
                asset_manager.store_asset(
                    data=plan_bytes,
                    key=plan_asset_obj.file_path,
                    content_type="application/json",
                    topic=plan_asset_obj.topic,
                    asset_type="story",
                    metadata=updated_meta,
                    created_at=plan_asset_obj.created_at,
                )
        except Exception as e:
            logger.warning("task_executor: failed to update plan asset metadata: %s", e)
            db2.rollback()
        finally:
            db2.close()

        # Phase 3: Assemble video
        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 75, "step": "Assembling anime video with narration..."})

        try:
            from app.services.video_assembler import assemble_story_video
            video_asset = await assemble_story_video(
                story_plan=plan.model_dump(),
                scene_images=scene_images,
                job_id=job_id,
                session_id=session_id,
            )
            notify(job_id, {"job_id": job_id, "status": "processing", "progress": 95, "step": "Video ready! Finalizing..."})
            logger.info("task_executor: video assembled for story job %s", job_id)
        except Exception as e:
            logger.warning("Video assembly failed for story job %s: %s", job_id, e)
            # Video assembly is optional — story plan is still complete

        # Phase 4: Complete
        _update_job(job_id, status="complete", asset_id=plan_asset_id)
        notify(job_id, {"job_id": job_id, "status": "complete", "asset_id": plan_asset_id, "progress": 100})
        logger.info("task_executor: story job %s completed", job_id)

    except Exception as exc:
        logger.exception("task_executor: story job %s failed", job_id)
        friendly = _friendly_error(exc)
        _update_job(job_id, status="failed", error_message=friendly)
        notify(job_id, {"job_id": job_id, "status": "failed", "error_message": friendly})

