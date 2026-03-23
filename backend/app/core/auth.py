# Auth dependency — implemented in task 3.1
from fastapi import Header, HTTPException


async def get_current_session(x_api_key: str = Header(default=None)):
    """Placeholder auth dependency. Full implementation in task 3.1."""
    return {"session_id": "dev", "api_key": x_api_key}
