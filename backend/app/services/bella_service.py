"""
BellaService — LLM chat (Groq LLaMA 3.3 70B), TTS (edge-tts, free),
STT (Groq Whisper Large v3), and in-memory session history.

Requirements: 10.3, 10.4, 10.5, 10.11, 10.12
"""
from __future__ import annotations

import asyncio
import base64
import io
import os
import tempfile
from datetime import datetime, timezone
from typing import Any

import edge_tts
from groq import AsyncGroq

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_GROQ_CHAT_MODEL = "llama-3.3-70b-versatile"
_GROQ_WHISPER_MODEL = "whisper-large-v3"
_EDGE_TTS_VOICE = "en-US-AriaNeural"  # friendly female voice, free via edge-tts

_SYSTEM_PROMPT = (
    "You are Bella, a friendly and knowledgeable educational assistant. "
    "You help students understand complex topics in a clear, engaging, and "
    "encouraging way. Keep your answers concise and age-appropriate. "
    "Use simple language and relatable examples where possible."
)


class ChatResult:
    """Result of a Bella chat call, including optional TTS audio."""

    def __init__(
        self,
        reply: str,
        audio_b64: str | None,
        phonemes: list[dict[str, Any]],
        tts_available: bool,
    ) -> None:
        self.reply = reply
        self.audio_b64 = audio_b64          # base64-encoded WAV/MP3, or None
        self.phonemes = phonemes             # phoneme timestamp list for lip sync
        self.tts_available = tts_available


class BellaService:
    """Stateful service for Bella's chat, TTS, STT, and history."""

    def __init__(self) -> None:
        self._history: dict[str, list[dict[str, str]]] = {}
        self._groq = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""))

    # ------------------------------------------------------------------
    # Chat — calls LLM then attempts TTS; falls back gracefully on TTS failure
    # Requirements: 10.3, 10.4, 10.5, 10.11, 10.12
    # ------------------------------------------------------------------

    async def chat(self, message: str, session_id: str) -> ChatResult:
        """Send *message* to Groq LLaMA 3.3 70B, attempt TTS, return ChatResult.

        TTS failure is non-fatal: returns tts_available=False with text reply intact.
        Appends both the user message and Bella's reply to session history.
        """
        # Build conversation context from history
        prior = self._history.get(session_id, [])
        groq_messages: list[dict[str, str]] = [
            {"role": "system", "content": _SYSTEM_PROMPT}
        ]
        for entry in prior:
            groq_role = "user" if entry["role"] == "user" else "assistant"
            groq_messages.append({"role": groq_role, "content": entry["text"]})
        groq_messages.append({"role": "user", "content": message})

        completion = await self._groq.chat.completions.create(
            model=_GROQ_CHAT_MODEL,
            messages=groq_messages,  # type: ignore[arg-type]
            max_tokens=512,
        )
        reply: str = completion.choices[0].message.content or ""

        # Persist to history (Requirement 10.11)
        now = datetime.now(timezone.utc).isoformat()
        bucket = self._history.setdefault(session_id, [])
        bucket.append({"role": "user", "text": message, "timestamp": now})
        bucket.append({"role": "bella", "text": reply, "timestamp": now})

        # Attempt TTS — graceful fallback on failure (Requirement 10.12)
        try:
            audio_bytes, phonemes = await self._synthesize_speech_with_phonemes(reply)
            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
            tts_available = True
        except Exception:
            audio_b64 = None
            phonemes = []
            tts_available = False

        return ChatResult(
            reply=reply,
            audio_b64=audio_b64,
            phonemes=phonemes,
            tts_available=tts_available,
        )

    # ------------------------------------------------------------------
    # TTS — edge-tts (free, no API key required)
    # Requirements: 10.4, 10.5
    # ------------------------------------------------------------------

    async def synthesize_speech(self, text: str) -> bytes:
        """Synthesize speech via edge-tts and return raw MP3 bytes."""
        audio_bytes, _ = await self._synthesize_speech_with_phonemes(text)
        return audio_bytes

    async def _synthesize_speech_with_phonemes(
        self, text: str
    ) -> tuple[bytes, list[dict[str, Any]]]:
        """
        Use edge-tts to synthesize speech. Returns (mp3_bytes, phonemes).
        edge-tts doesn't provide phoneme timestamps, so phonemes is always [].
        Lip sync will fall back to amplitude-based animation on the frontend.
        """
        communicate = edge_tts.Communicate(text, _EDGE_TTS_VOICE)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        audio_bytes = buf.getvalue()
        if not audio_bytes:
            raise RuntimeError("edge-tts returned empty audio")
        return audio_bytes, []

    # ------------------------------------------------------------------
    # STT — Groq Whisper Large v3
    # Requirement: 10.3
    # ------------------------------------------------------------------

    async def transcribe_audio(self, audio_bytes: bytes, filename: str) -> str:
        """Transcribe *audio_bytes* via Groq Whisper Large v3."""
        transcription = await self._groq.audio.transcriptions.create(
            model=_GROQ_WHISPER_MODEL,
            file=(filename, audio_bytes, "audio/webm"),
        )
        return transcription.text

    # ------------------------------------------------------------------
    # History
    # Requirement: 10.11
    # ------------------------------------------------------------------

    def get_history(self, session_id: str) -> list[dict[str, str]]:
        """Return the message history for *session_id*, or [] if unknown."""
        return list(self._history.get(session_id, []))


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

bella_service = BellaService()
