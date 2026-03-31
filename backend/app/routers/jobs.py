"""
Jobs router - GET /api/v1/jobs, GET /api/v1/jobs/{job_id}

Requirements: 4.2, 4.5, 7.2, 7.6
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_session
from app.models.anime_assets import Job, get_db

router = APIRouter()


class JobResponse(BaseModel):
    job_id: str
    type: str
    status: str
    topic: str
    asset_id: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    created_at: str
    session_id: str


def _job_to_response(job: Job) -> JobResponse:
    return JobResponse(
        job_id=job.job_id,
        type=job.type,
        status=job.status,
        topic=job.topic,
        asset_id=job.asset_id,
        error_message=job.error_message,
        retry_count=job.retry_count or 0,
        created_at=job.created_at.isoformat() if job.created_at else "",
        session_id=job.session_id,
    )


@router.get("", response_model=list[JobResponse])
async def list_jobs(
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """List last 50 jobs for the current session. Requirements: 7.6"""
    jobs = (
        db.query(Job)
        .filter(Job.session_id == session["session_id"])
        .order_by(Job.created_at.desc())
        .limit(50)
        .all()
    )
    return [_job_to_response(j) for j in jobs]


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """Get job status by ID. Requirements: 4.5"""
    job = db.query(Job).filter(Job.job_id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "job_id": job_id,
                "request_id": str(uuid.uuid4()),
            },
        )
    return _job_to_response(job)