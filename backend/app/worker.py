"""
Celery app configured for Upstash Redis broker.

Task retry policy: max_retries=3, exponential backoff (countdown doubles each retry).
All generation tasks are imported here so Celery discovers them.
"""
import os

from celery import Celery

REDIS_URL = os.getenv("UPSTASH_REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "education_anime",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.update(
    # Serialisation
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Timezone
    timezone="UTC",
    enable_utc=True,
    # Retry policy defaults (tasks can override per-call)
    task_max_retries=3,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Upstash Redis requires SSL for remote connections; local dev uses plain redis://
    broker_use_ssl=REDIS_URL.startswith("rediss://"),
    redis_backend_use_ssl=REDIS_URL.startswith("rediss://"),
)


def _retry_countdown(retries: int) -> int:
    """Exponential backoff: 2^retries seconds (2, 4, 8)."""
    return 2 ** retries


# ---------------------------------------------------------------------------
# Placeholder task — real tasks registered in their respective service modules
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    max_retries=3,
    name="education_anime.noop",
)
def noop_task(self):
    """No-op task used for worker health checks."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Anime generation task (Requirements 1.1, 1.6, 1.7, 1.8)
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    max_retries=3,
    name="education_anime.generate_anime",
)
def generate_anime_task(
    self,
    job_id: str,
    topic: str,
    style: str,
    include_animation: bool,
    session_id: str,
):
    """
    Celery task: generate anime image (and optionally animation) for a job.

    On success: updates job status to 'complete' and sets asset_id.
    On failure: retries up to 3 times with exponential backoff, then marks 'failed'.
    Post-generation safety check runs before storing the asset (Requirement 8.1).
    """
    import asyncio
    from datetime import datetime, timezone

    from app.models.anime_assets import Job, SessionLocal
    from app.services.anime_generator import generate_anime_image, generate_anime_animation
    from app.services.safety import safety_service

    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            return

        job.status = "processing"
        job.updated_at = datetime.now(timezone.utc)
        db.commit()

        # Build a caption from the topic
        caption = f"{topic} — educational anime scene"

        # Run async generation in a new event loop
        loop = asyncio.new_event_loop()
        try:
            if include_animation:
                asset = loop.run_until_complete(
                    generate_anime_animation(
                        topic=topic,
                        style=style,
                        caption=caption,
                        job_id=job_id,
                        session_id=session_id,
                    )
                )
            else:
                asset = loop.run_until_complete(
                    generate_anime_image(
                        topic=topic,
                        style=style,
                        caption=caption,
                        job_id=job_id,
                        session_id=session_id,
                    )
                )

            # Post-generation safety check (Requirement 8.1)
            safety_result = loop.run_until_complete(
                safety_service.check_content(caption)
            )
        finally:
            loop.close()

        if not safety_result.safe:
            # Discard asset, mark job failed (Requirement 8.2)
            from app.services.asset_manager import asset_manager
            asset_manager.delete_file(asset.file_path)
            db.delete(asset)
            job.status = "failed"
            job.error_message = f"safety_violation: {safety_result.reason}"
            job.updated_at = datetime.now(timezone.utc)
            db.commit()
            return

        job.status = "complete"
        job.asset_id = asset.asset_id
        job.updated_at = datetime.now(timezone.utc)
        db.commit()

    except Exception as exc:
        db.rollback()
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if job:
            job.retry_count = min((job.retry_count or 0) + 1, 3)
            if job.retry_count >= 3:
                job.status = "failed"
                job.error_message = str(exc)
            job.updated_at = datetime.now(timezone.utc)
            db.commit()
        countdown = _retry_countdown(self.request.retries)
        raise self.retry(exc=exc, countdown=countdown)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Webhook delivery task (Property 13 / Requirement 4.8)
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    max_retries=3,
    name="education_anime.deliver_webhook",
)
def deliver_webhook(self, webhook_url: str, job_id: str, status: str):
    """
    POST a job completion notification to the registered webhook URL.
    Retries up to 3 times with exponential backoff on network errors.
    """
    import httpx

    payload = {"job_id": job_id, "status": status}
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.post(webhook_url, json=payload)
            resp.raise_for_status()
    except Exception as exc:
        countdown = _retry_countdown(self.request.retries)
        raise self.retry(exc=exc, countdown=countdown)
