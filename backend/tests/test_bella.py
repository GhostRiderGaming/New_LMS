"""
Unit tests for the /bella router.

Validates: Requirements 7.2, 7.4, 9.3
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.bella_service import ChatResult

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chat_result(reply: str = "Hello!", tts_available: bool = False) -> ChatResult:
    return ChatResult(reply=reply, audio_b64=None, phonemes=[], tts_available=tts_available)


def _make_service_mock(
    chat_reply: str = "Hello!",
    transcript: str = "test transcript",
    history: list[dict] | None = None,
) -> MagicMock:
    """Return a mock BellaService with sensible defaults."""
    mock = MagicMock()
    mock.chat = AsyncMock(return_value=_make_chat_result(chat_reply))
    mock.transcribe_audio = AsyncMock(return_value=transcript)
    mock.get_history = MagicMock(return_value=history or [])
    return mock


# ---------------------------------------------------------------------------
# POST /bella/chat — Requirement 7.2
# ---------------------------------------------------------------------------

class TestChat:
    def test_returns_reply_string(self):
        """POST /bella/chat returns { reply: str } with mocked BellaService."""
        mock_svc = _make_service_mock(chat_reply="Hi there!")

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.post("/bella/chat", json={"message": "Hello", "session_id": "s1"})

        assert resp.status_code == 200
        data = resp.json()
        assert "reply" in data
        assert isinstance(data["reply"], str)
        assert data["reply"] == "Hi there!"

    def test_reply_with_default_session_id(self):
        """session_id is optional; omitting it still returns a reply."""
        mock_svc = _make_service_mock(chat_reply="Sure!")

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.post("/bella/chat", json={"message": "What is gravity?"})

        assert resp.status_code == 200
        assert resp.json()["reply"] == "Sure!"

    def test_chat_failure_returns_error_with_request_id(self):
        """Chat failure returns { error: 'chat_failed', request_id: ... } — Requirement 7.2 / 9.3."""
        mock_svc = _make_service_mock()
        mock_svc.chat = AsyncMock(side_effect=RuntimeError("LLM unavailable"))

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.post("/bella/chat", json={"message": "Hi"})

        assert resp.status_code == 500
        detail = resp.json()["detail"]
        assert detail["error"] == "chat_failed"
        assert "request_id" in detail
        assert isinstance(detail["request_id"], str)
        assert len(detail["request_id"]) > 0


# ---------------------------------------------------------------------------
# GET /bella/history — Requirement 7.4
# ---------------------------------------------------------------------------

class TestHistory:
    def test_returns_messages_in_insertion_order(self):
        """GET /bella/history returns messages in the order they were inserted."""
        stored = [
            {"role": "user", "text": "First message", "timestamp": "2024-01-01T00:00:00+00:00"},
            {"role": "bella", "text": "First reply", "timestamp": "2024-01-01T00:00:01+00:00"},
            {"role": "user", "text": "Second message", "timestamp": "2024-01-01T00:00:02+00:00"},
            {"role": "bella", "text": "Second reply", "timestamp": "2024-01-01T00:00:03+00:00"},
        ]
        mock_svc = _make_service_mock(history=stored)

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.get("/bella/history", params={"session_id": "sess-abc"})

        assert resp.status_code == 200
        messages = resp.json()["messages"]
        assert len(messages) == 4
        # Verify insertion order is preserved
        for i, msg in enumerate(messages):
            assert msg["role"] == stored[i]["role"]
            assert msg["text"] == stored[i]["text"]

    def test_empty_history_returns_empty_list(self):
        """GET /bella/history returns empty messages list for unknown session."""
        mock_svc = _make_service_mock(history=[])

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.get("/bella/history", params={"session_id": "unknown"})

        assert resp.status_code == 200
        assert resp.json()["messages"] == []

    def test_history_passes_session_id_to_service(self):
        """GET /bella/history forwards session_id to the service layer."""
        mock_svc = _make_service_mock(history=[])

        with patch("app.routers.bella.bella_service", mock_svc):
            client.get("/bella/history", params={"session_id": "my-session"})

        mock_svc.get_history.assert_called_once_with("my-session")


# ---------------------------------------------------------------------------
# POST /bella/transcribe — Requirement 9.3
# ---------------------------------------------------------------------------

class TestTranscribe:
    def test_returns_transcript_string(self):
        """POST /bella/transcribe returns { transcript: str }."""
        mock_svc = _make_service_mock(transcript="What is photosynthesis?")

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.post(
                "/bella/transcribe",
                files={"audio": ("audio.webm", b"fake-audio-bytes", "audio/webm")},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "transcript" in data
        assert isinstance(data["transcript"], str)
        assert data["transcript"] == "What is photosynthesis?"

    def test_transcribe_failure_returns_error_with_request_id(self):
        """Transcribe failure returns error detail with request_id field."""
        mock_svc = _make_service_mock()
        mock_svc.transcribe_audio = AsyncMock(side_effect=RuntimeError("Whisper unavailable"))

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.post(
                "/bella/transcribe",
                files={"audio": ("audio.webm", b"fake-audio-bytes", "audio/webm")},
            )

        assert resp.status_code == 500
        detail = resp.json()["detail"]
        assert detail["error"] == "transcribe_failed"
        assert "request_id" in detail
        assert isinstance(detail["request_id"], str)


# ---------------------------------------------------------------------------
# Error response shape — Requirement 9.3
# ---------------------------------------------------------------------------

class TestErrorResponseShape:
    """All error responses must include a request_id field."""

    def test_chat_error_has_request_id(self):
        mock_svc = _make_service_mock()
        mock_svc.chat = AsyncMock(side_effect=Exception("boom"))

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.post("/bella/chat", json={"message": "hi"})

        assert "request_id" in resp.json()["detail"]

    def test_transcribe_error_has_request_id(self):
        mock_svc = _make_service_mock()
        mock_svc.transcribe_audio = AsyncMock(side_effect=Exception("boom"))

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.post(
                "/bella/transcribe",
                files={"audio": ("a.webm", b"x", "audio/webm")},
            )

        assert "request_id" in resp.json()["detail"]

    def test_history_error_has_request_id(self):
        mock_svc = _make_service_mock()
        mock_svc.get_history = MagicMock(side_effect=Exception("boom"))

        with patch("app.routers.bella.bella_service", mock_svc):
            resp = client.get("/bella/history", params={"session_id": "x"})

        assert "request_id" in resp.json()["detail"]
