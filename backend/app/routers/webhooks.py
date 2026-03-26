"""
Webhook registration and delivery.

Endpoints:
  POST /api/v1/webhooks/register — register a URL to receive job completion callbacks

Delivery is handled by the Celery task `deliver_webhook` which fires when a job
transitions to "complete" or "failed".

Requirements: 4.8
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

from app.core.auth import get_current_session
from app.models.anime_assets import Webhook, get_db

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class WebhookRegisterRequest(BaseModel):
    url: HttpUrl


class WebhookRegisterResponse(BaseModel):
    webhook_id: str
    url: str
    request_id: str


# ---------------------------------------------------------------------------
# POST /api/v1/webhooks/register
# ---------------------------------------------------------------------------

@router.post("/register", status_code=201, response_model=WebhookRegisterResponse)
async def register_webhook(
    body: WebhookRegisterRequest,
    session: dict = Depends(get_current_session),
    db: Session = Depends(get_db),
) -> WebhookRegisterResponse:
    """Register a webhook URL for job completion notifications."""
    req_id = str(uuid.uuid4())
    webhook = Webhook(
        url=str(body.url),
        session_id=session["session_id"],
    )
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    return WebhookRegisterResponse(
        webhook_id=webhook.webhook_id,
        url=webhook.url,
        request_id=req_id,
    )
