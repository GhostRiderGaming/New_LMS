"""
Assets router — GET /assets, GET /assets/{id}, DELETE /assets/{id},
                GET /assets/{id}/download, GET /assets/export/zip

Requirements: 6.3, 6.4, 6.5, 5.4, 5.9
"""
import io
import json
import uuid
import zipfile
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
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

@router.get("", response_model=List[AssetResponse])
async def list_assets(
    type: Optional[str] = Query(None, description="Filter by asset type: image, animation, simulation, model3d, story"),
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """List all assets for the current session, optionally filtered by type."""
    q = db.query(Asset).filter(Asset.session_id == session["session_id"])
    if type:
        q = q.filter(Asset.type == type)
    assets = q.order_by(Asset.created_at.desc()).limit(200).all()
    return [_asset_to_response(a) for a in assets]


@router.get("/export/zip")
async def export_all_zip(
    type: Optional[str] = Query(None, description="Filter by asset type"),
    db: Session = Depends(get_db),
    session: dict = Depends(get_current_session),
):
    """Download all session assets as a ZIP archive. Requirements: 5.9"""
    q = db.query(Asset).filter(Asset.session_id == session["session_id"])
    if type:
        q = q.filter(Asset.type == type)
    assets = q.order_by(Asset.created_at.desc()).all()

    buf = io.BytesIO()
    manifest = []

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for asset in assets:
            data = asset_manager.download_file(asset.file_path)
            if data is None:
                continue
            # Derive a safe filename from topic + asset_id
            safe_topic = "".join(c if c.isalnum() or c in "-_ " else "_" for c in asset.topic)[:40]
            ext = asset.mime_type.split("/")[-1] if "/" in asset.mime_type else "bin"
            filename = f"{asset.type}/{safe_topic}_{asset.asset_id[:8]}.{ext}"
            zf.writestr(filename, data)
            manifest.append({
                "asset_id": asset.asset_id,
                "type": asset.type,
                "topic": asset.topic,
                "filename": filename,
                "file_size_bytes": asset.file_size_bytes,
                "created_at": asset.created_at.isoformat(),
                "metadata": asset.asset_metadata or {},
            })

        zf.writestr("manifest.json", json.dumps({"assets": manifest, "total": len(manifest)}, indent=2))

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=anime-assets.zip"},
    )


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
