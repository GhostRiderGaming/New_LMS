"""
Cloudflare R2 asset storage service (S3-compatible via boto3).

Provides: upload_file, get_presigned_url, delete_file, download_file.
"""
import os
from typing import Optional

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


class AssetManager:
    def __init__(self):
        account_id = os.getenv("CLOUDFLARE_R2_ACCOUNT_ID", "")
        self._bucket = os.getenv("CLOUDFLARE_R2_BUCKET", "catchupx-anime-assets")
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com" if account_id else None,
            aws_access_key_id=os.getenv("CLOUDFLARE_R2_ACCESS_KEY", ""),
            aws_secret_access_key=os.getenv("CLOUDFLARE_R2_SECRET_KEY", ""),
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )

    def upload_file(self, data: bytes, key: str, content_type: str) -> str:
        """Upload bytes to R2 under `key`. Returns the object key."""
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return key

    def get_presigned_url(self, key: str, expires: int = 86400) -> str:
        """Return a presigned GET URL valid for `expires` seconds (default 24h)."""
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires,
        )

    def delete_file(self, key: str) -> None:
        """Delete an object from R2. Silently succeeds if the key doesn't exist."""
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
        except ClientError:
            pass

    def download_file(self, key: str) -> Optional[bytes]:
        """Download and return raw bytes for `key`, or None if not found."""
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)
            return response["Body"].read()
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise


asset_manager = AssetManager()
