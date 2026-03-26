"""
Authentication dependency for the Education Anime Generator API.

Supports two credential mechanisms (checked in order):
  1. X-API-Key request header
  2. session_id cookie

Returns a session context dict on success.
Raises HTTP 401 for missing or invalid credentials.
"""
import os
import uuid

from fastapi import Cookie, Header, HTTPException

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# In production, load valid API keys from env / database.
# For local dev, a single key from the environment is accepted.
_DEV_API_KEY = os.getenv("API_KEY", "dev-api-key")

# Set of valid API keys (extend for multi-tenant use)
_VALID_API_KEYS: set[str] = {_DEV_API_KEY} if _DEV_API_KEY else set()


def _is_valid_api_key(key: str | None) -> bool:
    """Return True if the key is non-empty and in the allowed set."""
    return bool(key and key in _VALID_API_KEYS)


def _is_valid_session(session_id: str | None) -> bool:
    """
    Validate a session_id cookie.

    For now, any non-empty string that looks like a UUID is accepted.
    In production, validate against a sessions table.
    """
    if not session_id:
        return False
    try:
        uuid.UUID(session_id)
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

async def get_current_session(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    session_id: str | None = Cookie(default=None),
) -> dict:
    """
    FastAPI dependency that authenticates a request.

    Checks X-API-Key header first, then session_id cookie.
    Returns a session context dict: {"session_id": str, "api_key": str | None}
    Raises HTTP 401 if neither credential is valid.
    """
    if _is_valid_api_key(x_api_key):
        # API key auth — derive a stable session_id from the key
        derived_session = str(uuid.uuid5(uuid.NAMESPACE_DNS, x_api_key))
        return {"session_id": derived_session, "api_key": x_api_key}

    if _is_valid_session(session_id):
        return {"session_id": session_id, "api_key": None}

    raise HTTPException(
        status_code=401,
        detail={"error": "unauthorized", "message": "Valid X-API-Key header or session_id cookie required."},
    )
