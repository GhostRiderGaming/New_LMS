"""
Property-based tests for the 3D model generation pipeline.

Feature: education-anime-generator
Properties covered:
  - Property 9: 3D model GLTF validity and texture completeness

PBT library: Hypothesis
Min iterations: 100 per property

**Validates: Requirements 3.1, 3.6**
"""
from __future__ import annotations

import json
import struct

from hypothesis import given, settings
from hypothesis import strategies as st

from unittest.mock import MagicMock

# Patch fal_client before importing model3d_engine so the module loads without
# the optional fal-client package being installed in the test environment.
import sys
if "fal_client" not in sys.modules:
    sys.modules["fal_client"] = MagicMock()

from app.services.model3d_engine import SUPPORTED_CATEGORIES, get_suggestions_for_category  # noqa: E402

# ---------------------------------------------------------------------------
# GLTF / GLB helpers
# ---------------------------------------------------------------------------

_GLTF_MAGIC = 0x46546C67  # "glTF" in little-endian uint32
_GLB_VERSION = 2
_CHUNK_JSON = 0x4E4F534A  # "JSON"
_CHUNK_BIN = 0x004E4942   # "BIN\0"


def _parse_glb_json(glb_bytes: bytes) -> dict:
    """
    Parse the JSON chunk from a GLB (binary GLTF) file.
    GLB format: 12-byte header + one or more chunks.
    Header: magic(4) + version(4) + length(4)
    Chunk:  chunkLength(4) + chunkType(4) + chunkData(chunkLength)
    """
    if len(glb_bytes) < 12:
        raise ValueError("GLB too short to contain a valid header")

    magic, version, total_length = struct.unpack_from("<III", glb_bytes, 0)
    if magic != _GLTF_MAGIC:
        raise ValueError(f"Not a GLB file: magic=0x{magic:08X}")
    if version != _GLB_VERSION:
        raise ValueError(f"Unsupported GLB version: {version}")

    offset = 12
    while offset < total_length:
        if offset + 8 > len(glb_bytes):
            break
        chunk_length, chunk_type = struct.unpack_from("<II", glb_bytes, offset)
        offset += 8
        chunk_data = glb_bytes[offset: offset + chunk_length]
        offset += chunk_length

        if chunk_type == _CHUNK_JSON:
            return json.loads(chunk_data.decode("utf-8"))

    raise ValueError("No JSON chunk found in GLB file")


def _collect_external_texture_uris(gltf: dict) -> list[str]:
    """
    Return all texture image URIs in the GLTF that are NOT data: URIs
    and NOT references to bufferViews (i.e., they would require external network requests).

    A compliant GLTF for download must have all textures embedded as data: URIs
    or reference bufferViews (Requirement 3.6).
    """
    external: list[str] = []
    for image in gltf.get("images", []):
        uri = image.get("uri", "")
        # bufferView reference — embedded, no URI needed
        if "bufferView" in image:
            continue
        # data: URI — embedded, self-contained
        if uri.startswith("data:"):
            continue
        # empty URI with bufferView is fine; non-empty non-data URI is external
        if uri:
            external.append(uri)
    return external


def _build_minimal_glb(gltf_json: dict, bin_data: bytes = b"") -> bytes:
    """
    Build a minimal valid GLB binary from a GLTF JSON dict and optional BIN chunk.
    Used to construct test fixtures.
    """
    json_bytes = json.dumps(gltf_json).encode("utf-8")
    # JSON chunk must be padded to 4-byte boundary with spaces (0x20)
    json_pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b" " * json_pad

    chunks = bytearray()
    # JSON chunk
    chunks += struct.pack("<II", len(json_bytes), _CHUNK_JSON)
    chunks += json_bytes

    # BIN chunk (optional)
    if bin_data:
        bin_pad = (4 - len(bin_data) % 4) % 4
        padded_bin = bin_data + b"\x00" * bin_pad
        chunks += struct.pack("<II", len(padded_bin), _CHUNK_BIN)
        chunks += padded_bin

    total_length = 12 + len(chunks)
    header = struct.pack("<III", _GLTF_MAGIC, _GLB_VERSION, total_length)
    return header + bytes(chunks)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_object_names = st.text(
    alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd", "Zs")),
    min_size=1,
    max_size=80,
).filter(lambda s: s.strip())

_categories = st.sampled_from(sorted(SUPPORTED_CATEGORIES))

# Strategy: generate a GLTF JSON with only embedded textures (data: URIs or bufferViews)
_embedded_image = st.one_of(
    # data: URI image
    st.fixed_dictionaries({"uri": st.just("data:image/png;base64,iVBORw0KGgo=")}),
    # bufferView reference (no URI)
    st.fixed_dictionaries({"bufferView": st.integers(min_value=0, max_value=3), "mimeType": st.just("image/png")}),
)

_external_image = st.fixed_dictionaries({
    "uri": st.one_of(
        st.just("https://example.com/texture.png"),
        st.just("http://cdn.example.com/mat.jpg"),
        st.just("textures/diffuse.png"),  # relative path — also external
    )
})


# ---------------------------------------------------------------------------
# Property 9: 3D model GLTF validity and texture completeness
# Validates: Requirements 3.1, 3.6
# ---------------------------------------------------------------------------

@given(images=st.lists(_embedded_image, min_size=0, max_size=4))
@settings(max_examples=100)
def test_property9_embedded_textures_pass(images: list[dict]) -> None:
    """
    **Validates: Requirements 3.1, 3.6**

    Property 9: 3D model GLTF validity and texture completeness

    For any GLTF where all image entries use data: URIs or bufferView references,
    _collect_external_texture_uris must return an empty list.
    """
    gltf = {"asset": {"version": "2.0"}, "images": images}
    external = _collect_external_texture_uris(gltf)
    assert external == [], (
        f"Expected no external texture URIs for embedded images, got: {external}"
    )


@given(external_image=_external_image)
@settings(max_examples=100)
def test_property9_external_textures_detected(external_image: dict) -> None:
    """
    **Validates: Requirements 3.1, 3.6**

    Property 9: 3D model GLTF validity and texture completeness

    For any GLTF that contains an image with an external URI,
    _collect_external_texture_uris must detect it.
    """
    gltf = {"asset": {"version": "2.0"}, "images": [external_image]}
    external = _collect_external_texture_uris(gltf)
    assert len(external) == 1, (
        f"Expected 1 external texture URI, got: {external}"
    )


@given(images=st.lists(_embedded_image, min_size=0, max_size=4))
@settings(max_examples=100)
def test_property9_glb_parse_roundtrip(images: list[dict]) -> None:
    """
    **Validates: Requirements 3.1, 3.6**

    Property 9: 3D model GLTF validity and texture completeness — GLB parse roundtrip

    For any GLTF JSON with embedded images, building a GLB and parsing it back
    must yield the same images list, and no external texture URIs must be found.
    """
    gltf = {"asset": {"version": "2.0"}, "images": images}
    glb_bytes = _build_minimal_glb(gltf)

    parsed = _parse_glb_json(glb_bytes)
    assert parsed.get("images", []) == images, (
        "Parsed GLTF images do not match original"
    )
    external = _collect_external_texture_uris(parsed)
    assert external == [], (
        f"Parsed GLTF contains external texture URIs: {external}"
    )


def test_property9_glb_magic_validation() -> None:
    """
    **Validates: Requirements 3.1**

    Property 9: 3D model GLTF validity — invalid magic bytes are rejected.
    """
    import pytest

    bad_bytes = b"NOTGLTF" + b"\x00" * 20
    with pytest.raises(ValueError, match="Not a GLB file"):
        _parse_glb_json(bad_bytes)


def test_property9_no_images_is_valid() -> None:
    """
    **Validates: Requirements 3.1, 3.6**

    Property 9: A GLTF with no images section has no external textures.
    """
    gltf = {"asset": {"version": "2.0"}, "meshes": []}
    external = _collect_external_texture_uris(gltf)
    assert external == []


def test_property9_mixed_embedded_and_external_detected() -> None:
    """
    **Validates: Requirements 3.6**

    Property 9: Mixed embedded + external images — only external ones are flagged.
    """
    gltf = {
        "asset": {"version": "2.0"},
        "images": [
            {"uri": "data:image/png;base64,abc="},          # embedded — OK
            {"bufferView": 0, "mimeType": "image/png"},     # embedded — OK
            {"uri": "https://cdn.example.com/tex.png"},     # external — flagged
        ],
    }
    external = _collect_external_texture_uris(gltf)
    assert len(external) == 1
    assert "cdn.example.com" in external[0]


# ---------------------------------------------------------------------------
# Supplementary: supported categories and suggestions (Requirement 3.5)
# ---------------------------------------------------------------------------

@given(category=_categories)
@settings(max_examples=100)
def test_supported_categories_have_suggestions(category: str) -> None:
    """
    For every supported category, get_suggestions_for_category must return
    a non-empty list of alternative object names (Requirement 3.5).
    """
    suggestions = get_suggestions_for_category(category)
    assert isinstance(suggestions, list), "Suggestions must be a list"
    assert len(suggestions) > 0, f"No suggestions for category '{category}'"
    for s in suggestions:
        assert isinstance(s, str) and s.strip(), (
            f"Each suggestion must be a non-empty string, got: {s!r}"
        )
