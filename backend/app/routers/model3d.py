"""
3D model generation router.

POST /api/v1/model3d/generate — submit a 3D model generation job.

Returns 202 immediately with job_id (async Celery task does the actual work).
Runs safety pre-check before enqueuing (Requirement 8.4).
Handles unsupported objects by returning error with suggestions (Requirement 3.5).

Requirements: 3.5
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_session
from app.models.anime_assets import Job, get_db
from app.services.model3d_engine import SUPPORTED_CATEGORIES, get_suggestions_for_category
from app.services.safety import safety_service

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class Model3DRequest(BaseModel):
    object_name: str = Field(..., min_length=1, max_length=200)
    category: Literal["anatomy", "chemistry", "astronomy", "historical", "mechanical"] = "mechanical"


class Model3DResponse(BaseModel):
    job_id: str
    status: str
    request_id: str


class UnsupportedObjectError(BaseModel):
    error: str
    reason: str
    suggestions: list[str]
    request_id: str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=Model3DResponse, status_code=202)
async def generate_model3d(
    body: Model3DRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """
    Submit a 3D model generation job.

    Returns 202 with job_id immediately — generation runs asynchronously.
    Rejects unsafe topics with 422 before any job is created (Requirement 8.4).
    Returns 422 with suggestions list for unsupported objects (Requirement 3.5).
    """
    request_id = str(uuid.uuid4())

    # Validate category is supported (Requirement 3.5)
    if body.category not in SUPPORTED_CATEGORIES:
        suggestions = get_suggestions_for_category(body.category)
        raise HTTPException(
            status_code=422,
            detail={
                "error": "unsupported_category",
                "reason": f"Category '{body.category}' is not supported.",
                "suggestions": suggestions,
                "request_id": request_id,
            },
        )

    # Safety pre-check (Requirement 8.4)
    safety = await safety_service.check_topic(body.object_name)
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
        type="model3d",
        status="queued",
        topic=body.object_name,
        parameters={"category": body.category, "object_name": body.object_name},
        session_id=session["session_id"],
    )
    db.add(job)
    db.commit()

    # Enqueue Celery task
    from app.worker import generate_model3d_task
    generate_model3d_task.delay(
        job_id=job_id,
        object_name=body.object_name,
        category=body.category,
        session_id=session["session_id"],
    )

    return Model3DResponse(
        job_id=job_id,
        status="queued",
        request_id=request_id,
    )
