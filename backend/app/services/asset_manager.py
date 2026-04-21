"""
AWS S3 asset storage service (boto3).

Provides: upload_file, get_presigned_url, delete_file, download_file, store_asset.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from pydantic import BaseModel, field_validator, model_validator

# ---------------------------------------------------------------------------
# Asset metadata completeness validator (Requirement 6.2)
# ---------------------------------------------------------------------------

VALID_ASSET_TYPES = {"image", "animation", "simulation", "model3d", "story"}


class AssetMetadata(BaseModel):
    """
    Pydantic model that validates all required metadata fields are present
    and non-empty before an Asset is persisted to the database or R2.

    Requirement 6.2: record metadata including Topic, generation type,
    timestamp, and file size.
    """

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
            raise ValueError(
                f"type must be one of {sorted(VALID_ASSET_TYPES)}, got {v!r}"
            )
        return v

    @field_validator("file_size_bytes")
    @classmethod
    def file_size_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError(f"file_size_bytes must be positive, got {v}")
        return v

    @model_validator(mode="after")
    def type_specific_metadata(self) -> "AssetMetadata":
        """Validate type-specific metadata fields are present and non-empty."""
        meta = self.metadata or {}
        asset_type = self.type

        if asset_type == "image":
            caption = meta.get("caption", "")
            if not caption or not str(caption).strip():
                raise ValueError(
                    "metadata.caption must be non-empty for image assets"
                )

        elif asset_type == "model3d":
            object_name = meta.get("object_name", "")
            description = meta.get("description", "")
            if not object_name or not str(object_name).strip():
                raise ValueError(
                    "metadata.object_name must be non-empty for model3d assets"
                )
            if not description or not str(description).strip():
                raise ValueError(
                    "metadata.description must be non-empty for model3d assets"
                )

        elif asset_type == "story":
            if "story_id" not in meta:
                raise ValueError(
                    "metadata.story_id must be present for story assets"
                )

        # "simulation" and "animation" require no extra metadata fields
        return self


def validate_asset_metadata(
    topic: str,
    asset_type: str,
    created_at: datetime,
    file_size_bytes: int,
    metadata: dict[str, Any],
) -> None:
    """
    Validate asset metadata completeness before storage.
    Raises ValueError with a descriptive message if validation fails.
    """
    AssetMetadata(
        topic=topic,
        type=asset_type,
        created_at=created_at,
        file_size_bytes=file_size_bytes,
        metadata=metadata,
    )


def enforce_expires_at(created_at: datetime, expires_at: Optional[datetime] = None) -> datetime:
    """
    Enforce the 24-hour minimum availability window (Requirement 4.3).

    Returns an expires_at that is at least created_at + 24h.
    If expires_at is None or less than created_at + 24h, returns created_at + 24h.
    """
    minimum = created_at + timedelta(hours=24)
    if expires_at is None or expires_at < minimum:
        return minimum
    return expires_at


class AssetManager:
    def __init__(self):
        self._bucket = os.getenv("AWS_S3_BUCKET", "catchupx-anime-assets")
        self._aws_ak = os.getenv("AWS_ACCESS_KEY_ID", "")
        self._use_s3 = bool(self._aws_ak)
        
        if self._use_s3:
            self._client = boto3.client(
                "s3",
                aws_access_key_id=self._aws_ak,
                aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", ""),
                region_name=os.getenv("AWS_REGION", "us-east-1"),
                config=Config(signature_version="s3v4"),
            )
        else:
            # Fallback to Local Storage
            self._local_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "storage")
            os.makedirs(self._local_dir, exist_ok=True)
            print("[AssetManager] AWS credentials naturally missing. Defaulting to local disk storage fallback.")

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
            topic=topic,
            asset_type=asset_type,
            created_at=created_at,
            file_size_bytes=len(data),
            metadata=metadata,
        )
        return self.upload_file(data, key, content_type), expires_at

    def upload_file(self, data: bytes, key: str, content_type: str) -> str:
        if self._use_s3:
            self._client.put_object(
                Bucket=self._bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            )
        else:
            local_path = os.path.join(self._local_dir, key.replace("/", os.sep))
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "wb") as f:
                f.write(data)
        return key

    def get_presigned_url(self, key: str, expires: int = 86400) -> str:
        if self._use_s3:
            return self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": key},
                ExpiresIn=expires,
            )
        else:
            # Local fallback: Serve via the mounted Starlette StaticFiles endpoint
            # We don't strictly need localhost:8000 if frontend prepends BASE organically,
            # but providing absolute URL ensures next/image loads it safely.
            return f"http://localhost:8000/api/v1/storage/{key}"

    def delete_file(self, key: str) -> None:
        if self._use_s3:
            try:
                self._client.delete_object(Bucket=self._bucket, Key=key)
            except ClientError:
                pass
        else:
            local_path = os.path.join(self._local_dir, key.replace("/", os.sep))
            if os.path.exists(local_path):
                os.remove(local_path)

    def download_file(self, key: str) -> Optional[bytes]:
        if self._use_s3:
            try:
                response = self._client.get_object(Bucket=self._bucket, Key=key)
                return response["Body"].read()
            except ClientError as e:
                if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
                    return None
                raise
        else:
            local_path = os.path.join(self._local_dir, key.replace("/", os.sep))
            if not os.path.exists(local_path):
                return None
            try:
                with open(local_path, "rb") as f:
                    return f.read()
            except IOError:
                return None


asset_manager = AssetManager()
