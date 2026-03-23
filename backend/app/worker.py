# Celery worker — implemented in task 2.5
from celery import Celery
import os

celery_app = Celery(
    "education_anime",
    broker=os.getenv("UPSTASH_REDIS_URL", "redis://localhost:6379/0"),
    backend=os.getenv("UPSTASH_REDIS_URL", "redis://localhost:6379/0"),
)
