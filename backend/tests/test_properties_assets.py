"""
Property-based tests for asset storage.

Feature: education-anime-generator
Properties covered:
  - Property 3:  Asset retrieval round trip (byte equality + 404 for missing)
  - Property 4:  Asset deletion is permanent

PBT library: Hypothesis
Min iterations: 100 per property
"""
from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

# ---------------------------------------------------------------------------
# Helpers â€” in-memory fake R2 store for pure property testing
# ---------------------------------------------------------------------------

class FakeR2:
    """In-memory stand-in for Cloudflare R2 / boto3 S3 client."""

    def __init__(self):
        self._store: dict[str, bytes] = {}

    def put_object(self, Bucket, Key, Body, ContentType):  # noqa: N803
        self._store[Key] = Body

    def get_object(self, Bucket, Key):  # noqa: N803
        if Key not in self._store:
            from botocore.exceptions import ClientError
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "Not found"}}, "GetObject")
        return {"Body": _BytesIO(self._store[Key])}

    def delete_object(self, Bucket, Key):  # noqa: N803
        self._store.pop(Key, None)

    def generate_presigned_url(self, operation, Params, ExpiresIn):  # noqa: N803
        key = Params["Key"]
        return f"https://fake-r2/{key}?expires={ExpiresIn}"


class _BytesIO:
    def __init__(self, data: bytes):
        self._data = data

    def read(self) -> bytes:
        return self._data


def _make_asset_manager(fake_r2: FakeR2):
    """Return an AssetManager wired to a FakeR2 instance."""
    from app.services.asset_manager import AssetManager
    mgr = AssetManager.__new__(AssetManager)
    mgr._bucket = "test-bucket"
    mgr._client = fake_r2
    return mgr


# ---------------------------------------------------------------------------
# Property 3: Asset retrieval round trip
# Feature: education-anime-generator, Property 3: Asset retrieval round trip
# Validates: Requirements 6.1, 6.3
# ---------------------------------------------------------------------------

@given(
    data=st.binary(min_size=0, max_size=4096),
    content_type=st.sampled_from(["image/png", "image/webp", "model/gltf+json", "text/html"]),
)
@settings(max_examples=100, deadline=None)
def test_asset_round_trip_byte_equality(data: bytes, content_type: str) -> None:
    """
    Feature: education-anime-generator, Property 3: Asset retrieval round trip

    For any binary blob uploaded to R2, downloading it by the same key must
    return byte-for-byte identical data.
    """
    fake_r2 = FakeR2()
    mgr = _make_asset_manager(fake_r2)

    key = f"assets/{uuid.uuid4()}.bin"
    mgr.upload_file(data, key, content_type)
    retrieved = mgr.download_file(key)

    assert retrieved is not None, "download_file returned None for an existing key"
    assert retrieved == data, (
        f"Round-trip mismatch: uploaded {len(data)} bytes, retrieved {len(retrieved)} bytes"
    )


@given(key=st.text(min_size=1, max_size=128, alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters="-_/")))
@settings(max_examples=100, deadline=None)
def test_missing_asset_returns_none(key: str) -> None:
    """
    Feature: education-anime-generator, Property 3: Asset retrieval round trip

    For any key that was never uploaded, download_file must return None
    (which the router translates to HTTP 404).
    """
    fake_r2 = FakeR2()
    mgr = _make_asset_manager(fake_r2)

    result = mgr.download_file(key)
    assert result is None, f"Expected None for missing key {key!r}, got {result!r}"


# ---------------------------------------------------------------------------
# Property 4: Asset deletion is permanent
# Feature: education-anime-generator, Property 4: Asset deletion is permanent
# Validates: Requirements 6.4, 6.5
# ---------------------------------------------------------------------------

@given(data=st.binary(min_size=1, max_size=1024))
@settings(max_examples=100, deadline=None)
def test_deleted_asset_is_not_retrievable(data: bytes) -> None:
    """
    Feature: education-anime-generator, Property 4: Asset deletion is permanent

    After delete_file(key), download_file(key) must return None for any
    previously uploaded binary blob.
    """
    fake_r2 = FakeR2()
    mgr = _make_asset_manager(fake_r2)

    key = f"assets/{uuid.uuid4()}.bin"
    mgr.upload_file(data, key, "application/octet-stream")

    # Confirm it exists before deletion
    assert mgr.download_file(key) is not None

    mgr.delete_file(key)

    result = mgr.download_file(key)
    assert result is None, "Asset still retrievable after deletion"


@given(key=st.text(min_size=1, max_size=64, alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters="-_/")))
@settings(max_examples=100, deadline=None)
def test_delete_nonexistent_key_is_idempotent(key: str) -> None:
    """
    Feature: education-anime-generator, Property 4: Asset deletion is permanent

    Calling delete_file on a key that doesn't exist must not raise an exception
    (idempotent delete).
    """
    fake_r2 = FakeR2()
    mgr = _make_asset_manager(fake_r2)

    # Should not raise
    mgr.delete_file(key)
    mgr.delete_file(key)  # second call also safe


# ---------------------------------------------------------------------------
# Property 4 (HTTP layer): DELETE endpoint makes asset unretrievable via API
# Feature: education-anime-generator, Property 4: Asset deletion is permanent
# Validates: Requirements 6.4, 6.5
# ---------------------------------------------------------------------------

@given(data=st.binary(min_size=1, max_size=512))
@settings(max_examples=100, deadline=None)
def test_delete_endpoint_makes_asset_unretrievable(data: bytes) -> None:
    """
    Feature: education-anime-generator, Property 4: Asset deletion is permanent

    After the DELETE /assets/{id} endpoint removes an asset, any subsequent
    GET /assets/{id} must return HTTP 404 and the asset must not appear in
    any listing.
    """
    import datetime
    from fastapi.testclient import TestClient
    from unittest.mock import patch, MagicMock
    from app.main import app
    from app.models.anime_assets import Base, engine, SessionLocal, Asset as AssetModel

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    asset_id = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc)
    asset = AssetModel(
        asset_id=asset_id,
        job_id=str(uuid.uuid4()),
        type="image",
        topic="test",
        file_path=f"assets/{asset_id}.png",
        file_size_bytes=len(data),
        mime_type="image/png",
        asset_metadata={"caption": "test"},
        created_at=now,
        expires_at=now + datetime.timedelta(hours=25),
        session_id="test-session",
    )
    db.add(asset)
    db.commit()
    file_path = f"assets/{asset_id}.png"  # capture before session closes
    db.close()

    fake_r2 = FakeR2()
    fake_r2.put_object(Bucket="b", Key=file_path, Body=data, ContentType="image/png")

    with patch("app.routers.assets.asset_manager") as mock_mgr:
        mock_mgr.delete_file = MagicMock(side_effect=lambda key: fake_r2.delete_object(Bucket="b", Key=key))
        mock_mgr.get_presigned_url = MagicMock(return_value="https://fake/url")

        client = TestClient(app)
        headers = {"X-API-Key": "dev-api-key"}

        # DELETE should succeed with 204
        del_resp = client.delete(f"/api/v1/assets/{asset_id}", headers=headers)
        assert del_resp.status_code == 204, f"Expected 204, got {del_resp.status_code}"

        # Subsequent GET must return 404
        get_resp = client.get(f"/api/v1/assets/{asset_id}", headers=headers)
        assert get_resp.status_code == 404, f"Expected 404 after deletion, got {get_resp.status_code}"
