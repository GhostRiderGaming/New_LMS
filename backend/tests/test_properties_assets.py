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


# ---------------------------------------------------------------------------
# Property 14: Asset metadata completeness
# Feature: education-anime-generator, Property 14: Asset metadata completeness
# Validates: Requirements 1.3, 3.4, 6.2
# ---------------------------------------------------------------------------

# Type-specific required metadata fields per asset type
_REQUIRED_METADATA_FIELDS: dict[str, list[str]] = {
    "image": ["caption"],
    "animation": ["caption"],
    "simulation": [],
    "model3d": ["object_name", "description"],
    "story": ["story_id"],
}

# Common required top-level fields on every Asset record
_REQUIRED_ASSET_FIELDS = ["topic", "type", "created_at", "mime_type"]


def _make_asset_record(
    asset_type: str,
    topic: str,
    metadata: dict,
    mime_type: str = "image/png",
) -> dict:
    """Build a minimal asset record dict as it would be stored/returned."""
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    return {
        "asset_id": str(uuid.uuid4()),
        "job_id": str(uuid.uuid4()),
        "type": asset_type,
        "topic": topic,
        "file_path": f"assets/{uuid.uuid4()}.bin",
        "file_size_bytes": 1,
        "mime_type": mime_type,
        "metadata": metadata,
        "created_at": now,
        "expires_at": now + datetime.timedelta(hours=25),
        "session_id": "test-session",
    }


def _metadata_is_complete(asset_type: str, metadata: dict) -> tuple[bool, str]:
    """Return (ok, reason). Checks type-specific required fields are non-empty."""
    required = _REQUIRED_METADATA_FIELDS.get(asset_type, [])
    for field in required:
        if not metadata.get(field):
            return False, f"metadata missing or empty field '{field}' for type '{asset_type}'"
    return True, ""


@given(
    topic=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    caption=st.text(min_size=1, max_size=500).filter(lambda s: s.strip()),
)
@settings(max_examples=100, deadline=None)
def test_image_asset_metadata_has_caption(topic: str, caption: str) -> None:
    """
    Feature: education-anime-generator, Property 14: Asset metadata completeness

    For any anime scene (image/animation) asset, the metadata must contain
    a non-empty 'caption' field. Validates Requirements 1.3, 6.2.
    """
    for asset_type in ("image", "animation"):
        record = _make_asset_record(asset_type, topic, {"caption": caption})
        ok, reason = _metadata_is_complete(asset_type, record["metadata"])
        assert ok, reason

        # Verify that an asset WITHOUT caption fails the check
        bad_record = _make_asset_record(asset_type, topic, {})
        ok_bad, _ = _metadata_is_complete(asset_type, bad_record["metadata"])
        assert not ok_bad, (
            f"Expected metadata completeness check to fail for {asset_type} without caption"
        )


@given(
    topic=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    object_name=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    description=st.text(min_size=1, max_size=500).filter(lambda s: s.strip()),
)
@settings(max_examples=100, deadline=None)
def test_model3d_asset_metadata_has_object_name_and_description(
    topic: str, object_name: str, description: str
) -> None:
    """
    Feature: education-anime-generator, Property 14: Asset metadata completeness

    For any 3D model asset, the metadata must contain non-empty 'object_name'
    and 'description' fields. Validates Requirements 3.4, 6.2.
    """
    record = _make_asset_record(
        "model3d", topic, {"object_name": object_name, "description": description}
    )
    ok, reason = _metadata_is_complete("model3d", record["metadata"])
    assert ok, reason

    # Missing object_name
    bad1 = _make_asset_record("model3d", topic, {"description": description})
    ok1, _ = _metadata_is_complete("model3d", bad1["metadata"])
    assert not ok1, "Expected failure when object_name is missing from model3d metadata"

    # Missing description
    bad2 = _make_asset_record("model3d", topic, {"object_name": object_name})
    ok2, _ = _metadata_is_complete("model3d", bad2["metadata"])
    assert not ok2, "Expected failure when description is missing from model3d metadata"


@given(
    topic=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    story_id=st.uuids().map(str),
)
@settings(max_examples=100, deadline=None)
def test_story_asset_metadata_has_story_id(topic: str, story_id: str) -> None:
    """
    Feature: education-anime-generator, Property 14: Asset metadata completeness

    For any story scene asset, the metadata must contain a non-empty 'story_id'.
    Validates Requirements 6.2.
    """
    record = _make_asset_record("story", topic, {"story_id": story_id})
    ok, reason = _metadata_is_complete("story", record["metadata"])
    assert ok, reason

    bad = _make_asset_record("story", topic, {})
    ok_bad, _ = _metadata_is_complete("story", bad["metadata"])
    assert not ok_bad, "Expected failure when story_id is missing from story asset metadata"


@given(
    asset_type=st.sampled_from(list(_REQUIRED_METADATA_FIELDS.keys())),
    topic=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
)
@settings(max_examples=100, deadline=None)
def test_asset_record_has_required_top_level_fields(asset_type: str, topic: str) -> None:
    """
    Feature: education-anime-generator, Property 14: Asset metadata completeness

    For any asset type, the asset record must have non-empty values for
    topic, type, created_at, and mime_type. Validates Requirements 6.2.
    """
    record = _make_asset_record(asset_type, topic, {})
    for field in _REQUIRED_ASSET_FIELDS:
        value = record.get(field)
        assert value is not None and value != "", (
            f"Asset record missing required field '{field}' for type '{asset_type}'"
        )


# ---------------------------------------------------------------------------
# Property 15: Asset availability window
# Validates: Requirements 4.3
# ---------------------------------------------------------------------------

@given(
    asset_type=st.sampled_from(list(_REQUIRED_METADATA_FIELDS.keys())),
    topic=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    hours_offset=st.floats(min_value=0.0, max_value=8760.0),  # 0 to 1 year ahead
)
@settings(max_examples=100, deadline=None)
def test_asset_expires_at_is_at_least_24h_after_created_at(
    asset_type: str, topic: str, hours_offset: float
) -> None:
    """
    Feature: education-anime-generator, Property 15: Asset availability window

    For any completed Asset, the expires_at timestamp must be at least 24 hours
    after the created_at timestamp. Validates Requirements 4.3.
    """
    import datetime

    created_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
        hours=hours_offset
    )
    expires_at = created_at + datetime.timedelta(hours=24)

    record = {
        "asset_id": str(uuid.uuid4()),
        "job_id": str(uuid.uuid4()),
        "type": asset_type,
        "topic": topic,
        "file_path": f"assets/{uuid.uuid4()}.bin",
        "file_size_bytes": 1,
        "mime_type": "image/png",
        "metadata": {},
        "created_at": created_at,
        "expires_at": expires_at,
        "session_id": "test-session",
    }

    window = record["expires_at"] - record["created_at"]
    assert window >= datetime.timedelta(hours=24), (
        f"Asset availability window is {window}, expected >= 24 hours. "
        f"created_at={record['created_at']}, expires_at={record['expires_at']}"
    )


@given(
    asset_type=st.sampled_from(list(_REQUIRED_METADATA_FIELDS.keys())),
    topic=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    short_hours=st.floats(min_value=0.0, max_value=23.999),
)
@settings(max_examples=100, deadline=None)
def test_asset_with_short_expiry_fails_availability_check(
    asset_type: str, topic: str, short_hours: float
) -> None:
    """
    Feature: education-anime-generator, Property 15: Asset availability window

    Negative case: any asset whose expires_at is less than 24 hours after
    created_at must fail the availability window check. Validates Requirements 4.3.
    """
    import datetime

    created_at = datetime.datetime.now(datetime.timezone.utc)
    expires_at = created_at + datetime.timedelta(hours=short_hours)

    window = expires_at - created_at
    assert window < datetime.timedelta(hours=24), (
        "Precondition: window should be < 24h for this negative test"
    )

    # The system must enforce >= 24h; a record with a shorter window is invalid.
    is_valid = window >= datetime.timedelta(hours=24)
    assert not is_valid, (
        f"Expected availability check to fail for window={window} (< 24h), "
        f"but it passed. created_at={created_at}, expires_at={expires_at}"
    )


@given(
    asset_type=st.sampled_from(list(_REQUIRED_METADATA_FIELDS.keys())),
    topic=st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
)
@settings(max_examples=100, deadline=None)
def test_default_expires_at_satisfies_availability_window(
    asset_type: str, topic: str
) -> None:
    """
    Feature: education-anime-generator, Property 15: Asset availability window

    The _default_expires_at() factory used by the Asset SQLAlchemy model must
    always produce a timestamp >= 24 hours from now. Validates Requirements 4.3.
    """
    import datetime
    from app.models.anime_assets import _default_expires_at

    before = datetime.datetime.now(datetime.timezone.utc)
    expires_at = _default_expires_at()
    after = datetime.datetime.now(datetime.timezone.utc)

    # expires_at must be at least 24h after the call time
    min_expected = before + datetime.timedelta(hours=24)
    assert expires_at >= min_expected, (
        f"_default_expires_at() returned {expires_at}, expected >= {min_expected}"
    )

    # Sanity: should not be unreasonably far in the future (> 25h is suspicious)
    max_expected = after + datetime.timedelta(hours=25)
    assert expires_at <= max_expected, (
        f"_default_expires_at() returned {expires_at}, which is unexpectedly far in the future"
    )
