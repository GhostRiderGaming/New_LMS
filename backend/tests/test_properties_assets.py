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
# Helpers — in-memory fake R2 store for pure property testing
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
