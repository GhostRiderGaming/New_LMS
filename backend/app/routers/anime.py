"""
Anime generation router.

POST /api/v1/anime/generate — submit an anime image or animation generation job.

Returns 202 immediately with job_id (async Celery task does the actual work).
Runs safety pre-check before enqueuing (Requirement 8.4).

Requirements: 1.6, 1.8
"""
from __future__ import annotations

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_session
from app.models.anime_assets import Job, get_db
from app.services.safety import safety_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class AnimeGenerateRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=500)
    style: Literal["classroom", "laboratory", "outdoor", "fantasy"] = "classroom"
    include_animation: bool = False
    character_name: Optional[str] = Field(default=None, max_length=100)


class AnimeGenerateResponse(BaseModel):
    job_id: str
    status: str
    request_id: str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=AnimeGenerateResponse, status_code=202)
async def generate_anime(
    body: AnimeGenerateRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """
    Submit an anime generation job.

    Returns 202 with job_id immediately — generation runs asynchronously.
    Rejects unsafe topics with 422 before any job is created (Requirement 8.4).
    """
    request_id = str(uuid.uuid4())

    # Safety pre-check (Requirement 8.4)
    safety = await safety_service.check_topic(body.topic)
    if not safety.safe:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "safety_violation",
                "reason": safety.reason,
                "request_id": request_id,
            },
        )

    # Create job record
    job_id = str(uuid.uuid4())
    job = Job(
        job_id=job_id,
        type="anime",
        status="queued",
        topic=body.topic,
        parameters={
            "style": body.style,
            "include_animation": body.include_animation,
            "character_name": body.character_name,
        },
        session_id=session["session_id"],
    )
    db.add(job)
    db.commit()

    # Enqueue Celery task, fall back to in-process execution if broker is down
    try:
        from app.worker import generate_anime_task
        generate_anime_task.delay(
            job_id=job_id,
            topic=body.topic,
            style=body.style,
            include_animation=body.include_animation,
            session_id=session["session_id"],
        )
    except Exception:
        from app.services.task_executor import run_anime_job
        from app.services.task_runner import dispatch_async
        dispatch_async(run_anime_job(
            job_id=job_id,
            topic=body.topic,
            style=body.style,
            include_animation=body.include_animation,
            session_id=session["session_id"],
        ))

    return AnimeGenerateResponse(
        job_id=job_id,
        status="queued",
        request_id=request_id,
    )
