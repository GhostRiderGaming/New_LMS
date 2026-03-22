"""
BellaService — LLM chat (Groq LLaMA 3.3 70B), TTS (Fal.ai Kokoro v1.0),
STT (Groq Whisper Large v3), and in-memory session history.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import httpx
from groq import AsyncGroq

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_GROQ_CHAT_MODEL = "llama-3.3-70b-versatile"
_GROQ_WHISPER_MODEL = "whisper-large-v3"
_FAL_TTS_URL = "https://fal.run/fal-ai/kokoro/v1.0/american-english"

_SYSTEM_PROMPT = (
    "You are Bella, a friendly and knowledgeable educational assistant. "
    "You help students understand complex topics in a clear, engaging, and "
    "encouraging way. Keep your answers concise and age-appropriate. "
    "Use simple language and relatable examples where possible."
)


class BellaService:
    """Stateful service for Bella's chat, TTS, STT, and history."""

    def __init__(self) -> None:
        self._history: dict[str, list[dict[str, str]]] = {}
        self._groq = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""))

    # ------------------------------------------------------------------
    # 2.1  Chat
    # ------------------------------------------------------------------

    async def chat(self, message: str, session_id: str) -> str:
        """Send *message* to Groq LLaMA 3.3 70B and return Bella's reply.

        Appends both the user message and Bella's reply to the session
        history with ISO-8601 timestamps.
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

        # Persist to history
        now = datetime.now(timezone.utc).isoformat()
        bucket = self._history.setdefault(session_id, [])
        bucket.append({"role": "user", "text": message, "timestamp": now})
        bucket.append({"role": "bella", "text": reply, "timestamp": now})

        return reply


    # ------------------------------------------------------------------
    # 2.2  TTS — Fal.ai Kokoro v1.0
    # ------------------------------------------------------------------

    async def synthesize_speech(self, text: str) -> bytes:
        """POST *text* to Fal.ai Kokoro TTS and return raw audio bytes."""
        fal_key = os.environ.get("FAL_API_KEY", "")
        headers = {
            "Authorization": f"Key {fal_key}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {"input": text}

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                _FAL_TTS_URL,
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
            data = response.json()

        # Kokoro returns { "audio": { "url": "...", ... } }
        audio_url: str = data["audio"]["url"]
        async with httpx.AsyncClient(timeout=30) as client:
            audio_response = await client.get(audio_url)
            audio_response.raise_for_status()
            return audio_response.content


    # ------------------------------------------------------------------
    # 2.3  STT — Groq Whisper Large v3
    # ------------------------------------------------------------------

    async def transcribe_audio(self, audio_bytes: bytes, filename: str) -> str:
        """Transcribe *audio_bytes* via Groq Whisper Large v3."""
        # groq client expects a file-like tuple: (filename, bytes, content_type)
        transcription = await self._groq.audio.transcriptions.create(
            model=_GROQ_WHISPER_MODEL,
            file=(filename, audio_bytes, "audio/webm"),
        )
        return transcription.text

    # ------------------------------------------------------------------
    # 2.4  History
    # ------------------------------------------------------------------

    def get_history(self, session_id: str) -> list[dict[str, str]]:
        """Return the message history for *session_id*, or [] if unknown."""
        return list(self._history.get(session_id, []))


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

bella_service = BellaService()
