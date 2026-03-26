"""
Assets router — GET /assets/{id}, DELETE /assets/{id}, GET /assets/{id}/download

Requirements: 6.3, 6.4, 6.5
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_current_session
from app.models.anime_assets import Asset, get_db
from app.services.asset_manager import asset_manager

router = APIRouter()


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class AssetResponse(BaseModel):
    asset_id: str
    job_id: str
    type: str
    topic: str
    file_path: str
    file_size_bytes: int
    mime_type: str
    metadata: dict
    created_at: str
    expires_at: str
    session_id: str
    presigned_url: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_asset_or_404(asset_id: str, db: Session) -> Asset:
    asset = db.query(Asset).filter(Asset.asset_id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "asset_id": asset_id, "request_id": str(uuid.uuid4())},
        )
    return asset


def _asset_to_response(asset: Asset) -> AssetResponse:
    presigned_url = asset_manager.get_presigned_url(asset.file_path)
    return AssetResponse(
        asset_id=asset.asset_id,
        job_id=asset.job_id,
        type=asset.type,
        topic=asset.topic,
        file_path=asset.file_path,
        file_size_bytes=asset.file_size_bytes,
        mime_type=asset.mime_type,
        metadata=asset.asset_metadata or {},
        created_at=asset.created_at.isoformat(),
        expires_at=asset.expires_at.isoformat(),
        session_id=asset.session_id,
        presigned_url=presigned_url,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """Return asset metadata + presigned download URL. 404 if not found."""
    asset = _get_asset_or_404(asset_id, db)
    return _asset_to_response(asset)


@router.delete("/{asset_id}", status_code=204)
async def delete_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """Delete asset from R2 and DB. Returns 204. 404 if not found."""
    asset = _get_asset_or_404(asset_id, db)
    # Remove from R2 first, then DB
    asset_manager.delete_file(asset.file_path)
    db.delete(asset)
    db.commit()
    return Response(status_code=204)


@router.get("/{asset_id}/download")
async def download_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """Stream raw asset bytes. 404 if not found in DB or R2."""
    asset = _get_asset_or_404(asset_id, db)
    data = asset_manager.download_file(asset.file_path)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "asset_id": asset_id, "request_id": str(uuid.uuid4())},
        )
    return Response(content=data, media_type=asset.mime_type)
