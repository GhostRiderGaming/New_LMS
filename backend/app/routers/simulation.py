"""
Simulation generation router.

POST /api/v1/simulation/generate — submit a simulation generation job.

Returns 202 immediately with job_id (async Celery task does the actual work).
Runs safety pre-check before enqueuing (Requirement 8.4).

Requirements: 2.6
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth import get_current_session
from app.models.anime_assets import Job, get_db
from app.services.safety import safety_service
from app.services.simulation_engine import SimulationCategory

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SimulationRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=500)
    category: SimulationCategory = SimulationCategory.physics


class SimulationResponse(BaseModel):
    job_id: str
    status: str
    request_id: str


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=SimulationResponse, status_code=202)
async def generate_simulation(
    body: SimulationRequest,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """
    Submit a simulation generation job.

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
        type="simulation",
        status="queued",
        topic=body.topic,
        parameters={"category": body.category.value},
        session_id=session["session_id"],
    )
    db.add(job)
    db.commit()

    # Enqueue Celery task, fall back to in-process execution if broker is down
    try:
        from app.worker import generate_simulation_task
        generate_simulation_task.delay(
            job_id=job_id,
            topic=body.topic,
            category=body.category.value,
            session_id=session["session_id"],
        )
    except Exception:
        from app.services.task_executor import run_simulation_job
        from app.services.task_runner import dispatch_async
        dispatch_async(run_simulation_job(
            job_id=job_id,
            topic=body.topic,
            category=body.category.value,
            session_id=session["session_id"],
        ))

    return SimulationResponse(
        job_id=job_id,
        status="queued",
        request_id=request_id,
    )
