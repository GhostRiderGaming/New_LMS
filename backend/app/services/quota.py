"""
Storage quota enforcement service.

Checks the total file_size_bytes of all assets for a session against
STORAGE_QUOTA_BYTES (default 500 MB). Used by job submission endpoints.
"""
import os

from sqlalchemy.orm import Session

from app.models.anime_assets import Asset

# Default 500 MB
_DEFAULT_QUOTA = 500 * 1024 * 1024
STORAGE_QUOTA_BYTES: int = int(os.getenv("STORAGE_QUOTA_BYTES", str(_DEFAULT_QUOTA)))


def get_session_usage(session_id: str, db: Session) -> int:
    """Return total bytes stored for the given session."""
    result = (
        db.query(Asset)
        .filter(Asset.session_id == session_id)
        .with_entities(Asset.file_size_bytes)
        .all()
    )
    return sum(row[0] or 0 for row in result)


def check_quota(session_id: str, db: Session) -> None:
    """
    Raise HTTP 429 if the session has reached or exceeded the storage quota.
    Import FastAPI's HTTPException here to keep the service self-contained.
    """
    from fastapi import HTTPException
    import uuid

    usage = get_session_usage(session_id, db)
    if usage >= STORAGE_QUOTA_BYTES:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "quota_exceeded",
                "limit_bytes": STORAGE_QUOTA_BYTES,
                "used_bytes": usage,
                "request_id": str(uuid.uuid4()),
            },
        )
