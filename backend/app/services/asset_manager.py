"""
Asset storage service.

Storage backend is selected by the STORAGE_BACKEND env var:
  - "local"  (default) — saves files to ./storage/ on disk; serves via /api/v1/storage/
  - "gcs"               — Google Cloud Storage (production)

To switch to GCS when ready:
  1. Set STORAGE_BACKEND=gcs in .env
  2. Set GCS_BUCKET_NAME=your-bucket
  3. Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
     OR set GCS_SERVICE_ACCOUNT_JSON=<inline JSON string>

Public API (same interface regardless of backend):
  store_asset(data, key, content_type, topic, asset_type, metadata) -> (key, expires_at)
  upload_file(data, key, content_type) -> key
  get_presigned_url(key, expires) -> str
  delete_file(key) -> None
  download_file(key) -> bytes | None
"""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, field_validator, model_validator

# ---------------------------------------------------------------------------
# Asset metadata validation (Requirement 6.2)
# ---------------------------------------------------------------------------

VALID_ASSET_TYPES = {"image", "animation", "simulation", "model3d", "story"}


class AssetMetadata(BaseModel):
    topic: str
    type: str
    created_at: datetime
    file_size_bytes: int
    metadata: dict[str, Any] = {}

    @field_validator("topic")
    @classmethod
    def topic_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("topic must be a non-empty string")
        return v

    @field_validator("type")
    @classmethod
    def type_valid(cls, v: str) -> str:
        if v not in VALID_ASSET_TYPES:
            raise ValueError(f"type must be one of {sorted(VALID_ASSET_TYPES)}, got {v!r}")
        return v

    @field_validator("file_size_bytes")
    @classmethod
    def file_size_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError(f"file_size_bytes must be positive, got {v}")
        return v

    @model_validator(mode="after")
    def type_specific_metadata(self) -> "AssetMetadata":
        meta = self.metadata or {}
        if self.type == "image":
            if not str(meta.get("caption", "")).strip():
                raise ValueError("metadata.caption must be non-empty for image assets")
        elif self.type == "model3d":
            if not str(meta.get("object_name", "")).strip():
                raise ValueError("metadata.object_name must be non-empty for model3d assets")
            if not str(meta.get("description", "")).strip():
                raise ValueError("metadata.description must be non-empty for model3d assets")
        elif self.type == "story":
            if "story_id" not in meta:
                raise ValueError("metadata.story_id must be present for story assets")
        return self


def validate_asset_metadata(
    topic: str,
    asset_type: str,
    created_at: datetime,
    file_size_bytes: int,
    metadata: dict[str, Any],
) -> None:
    AssetMetadata(
        topic=topic, type=asset_type, created_at=created_at,
        file_size_bytes=file_size_bytes, metadata=metadata,
    )


def enforce_expires_at(created_at: datetime, expires_at: Optional[datetime] = None) -> datetime:
    minimum = created_at + timedelta(hours=24)
    return minimum if (expires_at is None or expires_at < minimum) else expires_at


# ---------------------------------------------------------------------------
# Local filesystem backend
# ---------------------------------------------------------------------------

class _LocalBackend:
    """
    Stores files under backend/storage/ and serves them via
    GET /api/v1/storage/{key} (mounted StaticFiles in main.py).
    """

    def __init__(self) -> None:
        # storage/ lives next to the backend/ package root
        self._root = Path(__file__).resolve().parent.parent.parent / "storage"
        self._root.mkdir(parents=True, exist_ok=True)
        print(f"[AssetManager] LOCAL storage active → {self._root}")

    def upload(self, data: bytes, key: str, content_type: str) -> str:
        dest = self._root / Path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return key

    def presigned_url(self, key: str, expires: int = 86400) -> str:
        # Served by FastAPI's StaticFiles mount at /api/v1/storage/
        base = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")
        return f"{base}/api/v1/storage/{key}"

    def delete(self, key: str) -> None:
        path = self._root / Path(key)
        if path.exists():
            path.unlink()

    def download(self, key: str) -> Optional[bytes]:
        path = self._root / Path(key)
        return path.read_bytes() if path.exists() else None


# ---------------------------------------------------------------------------
# Google Cloud Storage backend (used in production)
# ---------------------------------------------------------------------------

class _GCSBackend:
    """
    Google Cloud Storage backend.

    Auth priority:
      1. GCS_SERVICE_ACCOUNT_JSON env var (inline JSON string)
      2. GOOGLE_APPLICATION_CREDENTIALS env var (path to JSON file)
      3. Application Default Credentials (gcloud auth, GCE metadata server)
    """

    def __init__(self) -> None:
        try:
            from google.cloud import storage as gcs  # type: ignore
            from google.oauth2 import service_account  # type: ignore
        except ImportError:
            raise RuntimeError(
                "google-cloud-storage is not installed. "
                "Run: pip install google-cloud-storage"
            )

        self._bucket_name = os.environ.get("GCS_BUCKET_NAME", "")
        if not self._bucket_name:
            raise RuntimeError("GCS_BUCKET_NAME env var is required for GCS backend")

        # Inline JSON takes priority (useful for platforms like Railway)
        inline_json = os.environ.get("GCS_SERVICE_ACCOUNT_JSON", "")
        if inline_json:
            info = json.loads(inline_json)
            creds = service_account.Credentials.from_service_account_info(info)
            self._client = gcs.Client(credentials=creds)
        else:
            # Falls back to GOOGLE_APPLICATION_CREDENTIALS or ADC
            self._client = gcs.Client()

        self._bucket = self._client.bucket(self._bucket_name)
        print(f"[AssetManager] GCS storage active → bucket: {self._bucket_name}")

    def upload(self, data: bytes, key: str, content_type: str) -> str:
        blob = self._bucket.blob(key)
        blob.upload_from_string(data, content_type=content_type)
        return key

    def presigned_url(self, key: str, expires: int = 86400) -> str:
        from datetime import timedelta
        blob = self._bucket.blob(key)
        return blob.generate_signed_url(
            expiration=timedelta(seconds=expires),
            method="GET",
            version="v4",
        )

    def delete(self, key: str) -> None:
        try:
            self._bucket.blob(key).delete()
        except Exception:
            pass

    def download(self, key: str) -> Optional[bytes]:
        try:
            return self._bucket.blob(key).download_as_bytes()
        except Exception:
            return None


# ---------------------------------------------------------------------------
# AssetManager — public interface
# ---------------------------------------------------------------------------

class AssetManager:
    """
    Single interface for all asset operations.
    Backend is selected at startup via STORAGE_BACKEND env var.
    """

    def __init__(self) -> None:
        backend = os.getenv("STORAGE_BACKEND", "local").lower().strip()
        if backend == "gcs":
            self._backend = _GCSBackend()
        else:
            # Default: local filesystem (development / construction phase)
            self._backend = _LocalBackend()

    # ── Public API ──────────────────────────────────────────────────────────

    def store_asset(
        self,
        data: bytes,
        key: str,
        content_type: str,
        topic: str,
        asset_type: str,
        metadata: dict[str, Any],
        created_at: Optional[datetime] = None,
        expires_at: Optional[datetime] = None,
    ) -> tuple[str, datetime]:
        if created_at is None:
            created_at = datetime.now(timezone.utc)
        expires_at = enforce_expires_at(created_at, expires_at)
        validate_asset_metadata(
            topic=topic, asset_type=asset_type,
            created_at=created_at, file_size_bytes=len(data), metadata=metadata,
        )
        return self.upload_file(data, key, content_type), expires_at

    def upload_file(self, data: bytes, key: str, content_type: str) -> str:
        return self._backend.upload(data, key, content_type)

    def get_presigned_url(self, key: str, expires: int = 86400) -> str:
        return self._backend.presigned_url(key, expires)

    def delete_file(self, key: str) -> None:
        self._backend.delete(key)

    def download_file(self, key: str) -> Optional[bytes]:
        return self._backend.download(key)


# Module-level singleton
asset_manager = AssetManager()
