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


def _update_job(job_id: str, **fields) -> None:
    """Helper: update a Job row with the given fields in a fresh session."""
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            return
        for k, v in fields.items():
            setattr(job, k, v)
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
        _update_job(job_id, status="failed", error_message=str(exc))
        notify(job_id, {"job_id": job_id, "status": "failed", "error_message": str(exc)})


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
        _update_job(job_id, status="failed", error_message=str(exc))
        notify(job_id, {"job_id": job_id, "status": "failed", "error_message": str(exc)})


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
        _update_job(job_id, status="failed", error_message=str(exc))
        notify(job_id, {"job_id": job_id, "status": "failed", "error_message": str(exc)})


# ---------------------------------------------------------------------------
# Story generation
# ---------------------------------------------------------------------------

async def run_story_job(
    job_id: str,
    topic: str,
    episode_count: int,
    session_id: str,
) -> None:
    """Execute story generation directly (no Celery)."""
    logger.info("task_executor: starting story job %s", job_id)
    try:
        _update_job(job_id, status="processing")
        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 10, "step": "Starting story planning..."})

        from app.services.story_engine import generate_story_plan
        from app.services.safety import safety_service

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 20, "step": "Generating story plan..."})

        db = SessionLocal()
        try:
            plan = await generate_story_plan(
                topic=topic, episode_count=episode_count,
                session_id=session_id, job_id=job_id, db=db,
            )
        finally:
            db.close()

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 70, "step": "Safety check..."})

        safety_result = await safety_service.check_content(f"{plan.title} {plan.synopsis}")
        if not safety_result.safe:
            _update_job(job_id, status="failed", error_message=f"safety_violation: {safety_result.reason}")
            notify(job_id, {"job_id": job_id, "status": "failed", "error_message": f"safety_violation: {safety_result.reason}"})
            return

        # Dispatch per-scene anime generation tasks
        import uuid as _uuid
        from app.models.anime_assets import Job as JobModel

        notify(job_id, {"job_id": job_id, "status": "processing", "progress": 80, "step": "Dispatching scene generation..."})

        db = SessionLocal()
        try:
            for episode in plan.episodes:
                for scene in episode.scenes:
                    scene_job_id = str(_uuid.uuid4())
                    scene_job = JobModel(
                        job_id=scene_job_id,
                        type="anime",
                        status="queued",
                        topic=topic,
                        parameters={
                            "style": "classroom",
                            "caption": scene.caption,
                            "story_id": plan.story_id,
                            "episode_number": episode.episode_number,
                            "scene_number": scene.scene_number,
                        },
                        session_id=session_id,
                    )
                    db.add(scene_job)
                    db.commit()

                    # Dispatch scene generation as another background task
                    import asyncio
                    asyncio.create_task(run_anime_job(
                        job_id=scene_job_id,
                        topic=f"{topic} — {scene.description}",
                        style="classroom",
                        include_animation=False,
                        session_id=session_id,
                    ))
        finally:
            db.close()

        _update_job(job_id, status="complete")
        notify(job_id, {"job_id": job_id, "status": "complete", "progress": 100})
        logger.info("task_executor: story job %s completed", job_id)

    except Exception as exc:
        logger.exception("task_executor: story job %s failed", job_id)
        _update_job(job_id, status="failed", error_message=str(exc))
        notify(job_id, {"job_id": job_id, "status": "failed", "error_message": str(exc)})
