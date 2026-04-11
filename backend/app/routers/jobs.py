"""
Jobs router - GET /api/v1/jobs, GET /api/v1/jobs/{job_id},
              WS  /api/v1/jobs/{job_id}/ws

Requirements: 4.2, 4.5, 7.2, 7.6
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_session
from app.models.anime_assets import Job, SessionLocal, get_db
from app.services.job_notifier import subscribe

router = APIRouter()
logger = logging.getLogger(__name__)


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


def _job_to_ws_dict(job: Job) -> dict:
    """Convert a Job row into the dict the frontend expects on the WebSocket."""
    return {
        "job_id": job.job_id,
        "status": job.status,
        "asset_id": job.asset_id,
        "error_message": job.error_message,
    }


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


# ---------------------------------------------------------------------------
# WebSocket endpoint — real-time job status streaming
# ---------------------------------------------------------------------------

@router.websocket("/{job_id}/ws")
async def job_status_ws(
    websocket: WebSocket,
    job_id: str,
    api_key: str = Query(default="dev-api-key", alias="api_key"),
):
    """
    Stream real-time status updates for a specific job.

    The WebSocket immediately sends the current job state, then pushes
    updates as the job transitions (queued → processing → complete/failed).
    A background DB poll every 5 s acts as a safety net in case the
    in-process notification is missed (e.g. worker runs in a separate process).

    The connection closes automatically once the job reaches a terminal state.
    """
    await websocket.accept()

    # Send the current state immediately
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            await websocket.send_json({"error": "not_found", "job_id": job_id})
            await websocket.close(code=4004)
            return
        last_status = job.status
        await websocket.send_json(_job_to_ws_dict(job))
        if last_status in ("complete", "failed"):
            await websocket.close()
            return
    finally:
        db.close()

    # Subscribe to in-process notifications AND poll DB as a fallback
    try:
        async with subscribe(job_id) as queue:
            while True:
                # Wait for either a pub/sub notification or a 5 s timeout (then poll DB)
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=5.0)
                    await websocket.send_json(msg)
                    if msg.get("status") in ("complete", "failed"):
                        await websocket.close()
                        return
                except asyncio.TimeoutError:
                    # Fallback: poll the database directly
                    db = SessionLocal()
                    try:
                        job = db.query(Job).filter(Job.job_id == job_id).first()
                        if not job:
                            await websocket.close(code=4004)
                            return
                        current = _job_to_ws_dict(job)
                        if job.status != last_status:
                            last_status = job.status
                            await websocket.send_json(current)
                        if job.status in ("complete", "failed"):
                            await websocket.close()
                            return
                    finally:
                        db.close()
    except WebSocketDisconnect:
        logger.debug("Client disconnected from job %s WS", job_id)
    except Exception:
        logger.exception("Unexpected error in job %s WS", job_id)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass