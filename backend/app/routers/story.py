"""
Storyification router.

POST /api/v1/story/generate  — submit a story generation job
GET  /api/v1/story/{story_id} — retrieve story plan + scene statuses

Returns 202 immediately; actual work runs in the generate_story_task Celery task.
Runs safety pre-check before enqueuing (Requirement 8.4).

Requirements: 9.5, 9.6
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_session
from app.models.anime_assets import Asset, Job, get_db
from app.services.safety import safety_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class StoryRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=500)
    episode_count: int = Field(default=3, ge=1, le=10)
    reuse_character_id: Optional[str] = None


class StoryResponse(BaseModel):
    job_id: str
    status: str
    request_id: str


class StoryStatusResponse(BaseModel):
    story_id: str
    job_id: str
    status: str
    title: Optional[str] = None
    synopsis: Optional[str] = None
    total_scenes: Optional[int] = None
    asset_id: Optional[str] = None
    request_id: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=StoryResponse, status_code=202)
async def generate_story(
    body: StoryRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """
    Submit a storyification job.

    Returns 202 with job_id immediately — generation runs asynchronously.
    Rejects unsafe topics with 422 before any job is created (Requirement 8.4).
    Requirement 9.1: story plan generated within 30 seconds (async).
    Requirement 9.5: supports up to 10 episodes.
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

    job_id = str(uuid.uuid4())
    job = Job(
        job_id=job_id,
        type="story",
        status="queued",
        topic=body.topic,
        parameters={
            "episode_count": body.episode_count,
            "reuse_character_id": body.reuse_character_id,
        },
        session_id=session["session_id"],
    )
    db.add(job)
    db.commit()

    # Enqueue Celery task, fall back to in-process execution if broker is down
    try:
        from app.worker import generate_story_task
        generate_story_task.delay(
            job_id=job_id,
            topic=body.topic,
            episode_count=body.episode_count,
            session_id=session["session_id"],
        )
    except Exception:
        from app.services.task_executor import run_story_job
        from app.services.task_runner import dispatch_async
        dispatch_async(run_story_job(
            job_id=job_id,
            topic=body.topic,
            episode_count=body.episode_count,
            session_id=session["session_id"],
        ))

    return StoryResponse(job_id=job_id, status="queued", request_id=request_id)


@router.get("/{story_id}", response_model=StoryStatusResponse)
async def get_story(
    story_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """
    Retrieve story plan status and metadata by story_id.

    Returns the job status, story title, synopsis, and total scene count.
    Returns 404 if the story_id does not exist for this session.

    Requirement 9.6: assemble into viewable sequential player.
    """
    request_id = str(uuid.uuid4())

    # Find the story plan asset by story_id in metadata
    plan_asset = (
        db.query(Asset)
        .filter(
            Asset.type == "story",
            Asset.session_id == session["session_id"],
        )
        .all()
    )

    # Filter by story_id in metadata (SQLite JSON path support varies)
    matching = [
        a for a in plan_asset
        if (a.asset_metadata or {}).get("story_id") == story_id
        and not (a.asset_metadata or {}).get("is_zip_export")
    ]

    if not matching:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "story_id": story_id,
                "request_id": request_id,
            },
        )

    asset = matching[0]
    job = db.query(Job).filter(Job.job_id == asset.job_id).first()
    meta = asset.asset_metadata or {}

    return StoryStatusResponse(
        story_id=story_id,
        job_id=asset.job_id,
        status=job.status if job else "unknown",
        title=meta.get("title"),
        synopsis=meta.get("synopsis"),
        total_scenes=meta.get("total_scenes"),
        asset_id=asset.asset_id,
        request_id=request_id,
    )


@router.get("/{story_id}/export")
async def export_story_zip(
    story_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """
    Export the full story as a ZIP archive (scenes + manifest).

    Returns a presigned R2 URL for the ZIP download.
    Requirement 9.8: ZIP with all scenes, captions, and JSON manifest.
    """
    from fastapi.responses import JSONResponse
    from app.services.story_engine import assemble_story_zip
    from app.services.asset_manager import asset_manager

    request_id = str(uuid.uuid4())

    try:
        await assemble_story_zip(story_id, db)
    except ValueError as exc:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "reason": str(exc), "request_id": request_id},
        )

    # Find the newly created ZIP asset
    zip_assets = (
        db.query(Asset)
        .filter(
            Asset.type == "story",
            Asset.session_id == session["session_id"],
        )
        .all()
    )
    zip_asset = next(
        (
            a for a in zip_assets
            if (a.asset_metadata or {}).get("story_id") == story_id
            and (a.asset_metadata or {}).get("is_zip_export")
        ),
        None,
    )

    if not zip_asset:
        raise HTTPException(
            status_code=500,
            detail={"error": "export_failed", "request_id": request_id},
        )

    url = asset_manager.get_presigned_url(zip_asset.file_path)
    return JSONResponse(
        content={
            "story_id": story_id,
            "asset_id": zip_asset.asset_id,
            "download_url": url,
            "request_id": request_id,
        }
    )
