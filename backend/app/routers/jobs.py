# Jobs router — full implementation in task 4.1
# Minimal stub with auth dependency wired so Property 18 tests pass.
from fastapi import APIRouter, Depends

from app.core.auth import get_current_session

router = APIRouter()


@router.get("")
async def list_jobs(session: dict = Depends(get_current_session)):
    """List last 50 jobs for the current session. Full impl in task 4.1."""
    return {"jobs": [], "session_id": session["session_id"]}


@router.get("/{job_id}")
async def get_job(job_id: str, session: dict = Depends(get_current_session)):
    """Get job status by ID. Full impl in task 4.1."""
    return {"job_id": job_id, "status": "queued", "session_id": session["session_id"]}
