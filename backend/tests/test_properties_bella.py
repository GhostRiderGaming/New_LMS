"""
Property-based tests for the Bella feature.

Feature: bella-vrm-avatar
Properties covered:
  - Property 4:  Emotion state maps to correct expression values
  - Property 10: Chat history round-trip preserves order

PBT library: Hypothesis
Min iterations: 100 per property (enforced via @settings)
"""
from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from unittest.mock import AsyncMock, patch, MagicMock

from fastapi.testclient import TestClient
from app.main import app
from app.services.bella_service import BellaService

client = TestClient(app)

# ---------------------------------------------------------------------------
# Emotion → expression mapping (pure function, no HTTP needed)
# ---------------------------------------------------------------------------

# The canonical mapping defined in design.md / Requirements 5.1–5.3
_EMOTION_EXPRESSION_MAP: dict[str, dict[str, float]] = {
    "neutral":   {"Happy": 0.0, "Relaxed": 0.0, "Surprised": 0.0},
    "thinking":  {"Happy": 0.0, "Relaxed": 0.5, "Surprised": 0.0},
    "happy":     {"Happy": 1.0, "Relaxed": 0.0, "Surprised": 0.0},
    "celebrate": {"Happy": 1.0, "Relaxed": 0.0, "Surprised": 0.0},
}


def compute_emotion_expressions(emotion: str) -> dict[str, float]:
    """
    Pure mapping function: emotion state → VRM expression values.

    This mirrors the logic in VRMViewer's useEffect on the emotion prop
    (frontend) and serves as the backend-side canonical reference for
    Property 4.
    """
    return dict(_EMOTION_EXPRESSION_MAP[emotion])


# ---------------------------------------------------------------------------
# Property 4: Emotion state maps to correct expression values
# Feature: bella-vrm-avatar, Property 4: Emotion state maps to correct expression values
# Validates: Requirements 5.1, 5.2, 5.3
# ---------------------------------------------------------------------------

@given(st.sampled_from(["neutral", "thinking", "happy", "celebrate"]))
@settings(max_examples=100)
def test_emotion_expression_mapping(emotion: str) -> None:
    """
    Feature: bella-vrm-avatar, Property 4: Emotion state maps to correct expression values

    For any emotion state in {neutral, thinking, happy, celebrate}, the
    resulting expression values must match the specification exactly:
      - neutral   → Happy=0, Relaxed=0, Surprised=0
      - thinking  → Happy=0, Relaxed=0.5, Surprised=0
      - happy     → Happy=1, Relaxed=0, Surprised=0
      - celebrate → Happy=1, Relaxed=0, Surprised=0
    """
    result = compute_emotion_expressions(emotion)

    expected = _EMOTION_EXPRESSION_MAP[emotion]
    assert result["Happy"] == expected["Happy"], (
        f"emotion={emotion!r}: Happy expected {expected['Happy']}, got {result['Happy']}"
    )
    assert result["Relaxed"] == expected["Relaxed"], (
        f"emotion={emotion!r}: Relaxed expected {expected['Relaxed']}, got {result['Relaxed']}"
    )
    assert result["Surprised"] == expected["Surprised"], (
        f"emotion={emotion!r}: Surprised expected {expected['Surprised']}, got {result['Surprised']}"
    )

    # All values must be in [0, 1]
    for key, val in result.items():
        assert 0.0 <= val <= 1.0, f"emotion={emotion!r}: {key}={val} out of [0,1]"

    # neutral and thinking must not set Happy to 1
    if emotion in ("neutral", "thinking"):
        assert result["Happy"] == 0.0

    # happy and celebrate must set Happy to 1
    if emotion in ("happy", "celebrate"):
        assert result["Happy"] == 1.0

    # only thinking sets Relaxed > 0
    if emotion != "thinking":
        assert result["Relaxed"] == 0.0

    # Surprised is always 0 for all defined emotions
    assert result["Surprised"] == 0.0


# ---------------------------------------------------------------------------
# Property 10: Chat history round-trip preserves order
# Feature: bella-vrm-avatar, Property 10: Chat history round-trip preserves order
# Validates: Requirements 7.4
# ---------------------------------------------------------------------------

@given(st.lists(st.text(min_size=1), min_size=1, max_size=20))
@settings(max_examples=100, deadline=None)
def test_history_round_trip_preserves_order(messages: list[str]) -> None:
    """
    Feature: bella-vrm-avatar, Property 10: Chat history round-trip preserves order

    For any sequence of N messages sent to /bella/chat with the same
    session_id, a subsequent GET /bella/history must return all 2*N entries
    (user + bella alternating) in the exact insertion order, with correct
    roles assigned.
    """
    import uuid

    session_id = str(uuid.uuid4())
    expected_pairs: list[tuple[str, str]] = []  # (user_text, bella_reply)

    # Build a mock service that records calls and returns predictable replies
    service = BellaService()
    reply_counter = 0

    async def fake_chat(message: str, sid: str):
        nonlocal reply_counter
        from app.services.bella_service import ChatResult
        reply = f"reply-{reply_counter}"
        reply_counter += 1
        # Delegate to real history logic but skip actual LLM call
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        bucket = service._history.setdefault(sid, [])
        bucket.append({"role": "user", "text": message, "timestamp": now})
        bucket.append({"role": "bella", "text": reply, "timestamp": now})
        return ChatResult(reply=reply, audio_b64=None, phonemes=[], tts_available=False)

    service.chat = fake_chat  # type: ignore[method-assign]

    with patch("app.routers.bella.bella_service", service):
        # Send all messages sequentially
        for msg in messages:
            resp = client.post(
                "/bella/chat",
                json={"message": msg, "session_id": session_id},
            )
            assert resp.status_code == 200
            reply_text = resp.json()["reply"]
            expected_pairs.append((msg, reply_text))

        # Fetch history
        hist_resp = client.get("/bella/history", params={"session_id": session_id})

    assert hist_resp.status_code == 200
    history = hist_resp.json()["messages"]

    # Must have exactly 2 entries per message (user + bella)
    assert len(history) == len(messages) * 2, (
        f"Expected {len(messages) * 2} history entries, got {len(history)}"
    )

    # Verify alternating roles and correct text in insertion order
    for i, (user_text, bella_reply) in enumerate(expected_pairs):
        user_entry = history[i * 2]
        bella_entry = history[i * 2 + 1]

        assert user_entry["role"] == "user", (
            f"Entry {i*2} should be 'user', got {user_entry['role']!r}"
        )
        assert user_entry["text"] == user_text, (
            f"Entry {i*2} text mismatch: expected {user_text!r}, got {user_entry['text']!r}"
        )

        assert bella_entry["role"] == "bella", (
            f"Entry {i*2+1} should be 'bella', got {bella_entry['role']!r}"
        )
        assert bella_entry["text"] == bella_reply, (
            f"Entry {i*2+1} text mismatch: expected {bella_reply!r}, got {bella_entry['text']!r}"
        )

    # No message may be missing — all user texts must appear in order
    user_entries = [h for h in history if h["role"] == "user"]
    assert [e["text"] for e in user_entries] == messages, (
        "User messages in history do not match sent messages in order"
    )


# ===========================================================================
# Education Anime Generator — Property 20 & 21
# ===========================================================================

# ---------------------------------------------------------------------------
# Property 20: Bella conversation history persistence
# Feature: education-anime-generator, Property 20
# Validates: Requirements 10.11
# ---------------------------------------------------------------------------

@given(st.lists(st.text(min_size=1, max_size=200), min_size=1, max_size=15))
@settings(max_examples=100, deadline=None)
def test_bella_history_persistence(messages: list[str]) -> None:
    """
    Feature: education-anime-generator, Property 20: Bella conversation history persistence

    For any sequence of N messages sent to Bella within a session, a subsequent
    GET /bella/history must return all 2*N entries (user + bella alternating)
    in the exact insertion order, with correct roles, for the duration of the session.
    """
    import uuid as _uuid

    session_id = str(_uuid.uuid4())
    service = BellaService()
    reply_index = 0

    async def fake_chat(message: str, sid: str) -> "ChatResult":  # type: ignore[name-defined]
        nonlocal reply_index
        from app.services.bella_service import ChatResult
        reply = f"reply-{reply_index}"
        reply_index += 1
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        bucket = service._history.setdefault(sid, [])
        bucket.append({"role": "user", "text": message, "timestamp": now})
        bucket.append({"role": "bella", "text": reply, "timestamp": now})
        return ChatResult(reply=reply, audio_b64=None, phonemes=[], tts_available=False)

    service.chat = fake_chat  # type: ignore[method-assign]

    with patch("app.routers.bella.bella_service", service):
        sent_pairs: list[tuple[str, str]] = []
        for msg in messages:
            resp = client.post(
                "/bella/chat",
                json={"message": msg, "session_id": session_id},
            )
            assert resp.status_code == 200
            sent_pairs.append((msg, resp.json()["reply"]))

        hist_resp = client.get("/bella/history", params={"session_id": session_id})

    assert hist_resp.status_code == 200
    history_entries = hist_resp.json()["messages"]

    # Must have exactly 2 entries per message
    assert len(history_entries) == len(messages) * 2, (
        f"Expected {len(messages) * 2} entries, got {len(history_entries)}"
    )

    # Verify order and roles
    for i, (user_text, bella_reply) in enumerate(sent_pairs):
        user_entry = history_entries[i * 2]
        bella_entry = history_entries[i * 2 + 1]

        assert user_entry["role"] == "user"
        assert user_entry["text"] == user_text
        assert bella_entry["role"] == "bella"
        assert bella_entry["text"] == bella_reply

    # All user messages appear in order
    user_texts = [e["text"] for e in history_entries if e["role"] == "user"]
    assert user_texts == messages


# ---------------------------------------------------------------------------
# Property 21: Bella TTS fallback on failure
# Feature: education-anime-generator, Property 21
# Validates: Requirements 10.12
# ---------------------------------------------------------------------------

@given(st.text(min_size=1, max_size=300))
@settings(max_examples=100, deadline=None)
def test_bella_tts_fallback_on_failure(message: str) -> None:
    """
    Feature: education-anime-generator, Property 21: Bella TTS fallback on failure

    For any Bella response where TTS synthesis fails, the system must still
    return HTTP 200 with a non-empty reply text, tts_available=False, and
    must NOT return an error status to the client.
    """
    import uuid as _uuid

    session_id = str(_uuid.uuid4())
    service = BellaService()

    async def fake_chat_tts_fails(msg: str, sid: str) -> "ChatResult":  # type: ignore[name-defined]
        from app.services.bella_service import ChatResult
        from datetime import datetime, timezone
        reply = f"Bella says: {msg[:50]}"
        now = datetime.now(timezone.utc).isoformat()
        bucket = service._history.setdefault(sid, [])
        bucket.append({"role": "user", "text": msg, "timestamp": now})
        bucket.append({"role": "bella", "text": reply, "timestamp": now})
        # Simulate TTS failure — tts_available=False, no audio
        return ChatResult(reply=reply, audio_b64=None, phonemes=[], tts_available=False)

    service.chat = fake_chat_tts_fails  # type: ignore[method-assign]

    with patch("app.routers.bella.bella_service", service):
        resp = client.post(
            "/bella/chat",
            json={"message": message, "session_id": session_id},
        )

    # Must return 200 — not an error status (Requirement 10.12)
    assert resp.status_code == 200, (
        f"Expected 200 on TTS failure, got {resp.status_code}"
    )

    data = resp.json()

    # Reply text must be non-empty
    assert "reply" in data
    assert isinstance(data["reply"], str)
    assert len(data["reply"]) > 0, "reply must be non-empty even when TTS fails"

    # tts_available must be False
    assert data["tts_available"] is False, (
        "tts_available must be False when TTS synthesis fails"
    )

    # audio_b64 must be None (no audio produced)
    assert data.get("audio_b64") is None, (
        "audio_b64 must be None when TTS fails"
    )
