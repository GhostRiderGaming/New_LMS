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
