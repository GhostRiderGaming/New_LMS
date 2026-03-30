"""
Bella router.

POST /bella/chat        — send message, get reply + optional TTS audio
POST /bella/transcribe  — transcribe audio blob via Whisper
GET  /bella/history     — retrieve session conversation history

Requirements: 10.3, 10.4, 10.5, 10.11, 10.12
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.services.bella_service import bella_service

# ---------------------------------------------------------------------------
# Pydantic v2 models
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    message: str
    session_id: str = ""


class ChatResponse(BaseModel):
    reply: str
    audio_b64: Optional[str] = None       # base64-encoded WAV, None if TTS failed
    phonemes: list[dict[str, Any]] = []   # phoneme timestamps for lip sync
    tts_available: bool = False


class TTSRequest(BaseModel):
    text: str


class TranscribeResponse(BaseModel):
    transcript: str


class HistoryMessage(BaseModel):
    role: str
    text: str
    timestamp: str


class HistoryResponse(BaseModel):
    messages: list[HistoryMessage]


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest):
    """Send a message to Bella and receive a reply with optional TTS audio.

    TTS failure is non-fatal — tts_available=False is returned with the text
    reply intact (Requirement 10.12).
    """
    try:
        result = await bella_service.chat(body.message, body.session_id)
        return ChatResponse(
            reply=result.reply,
            audio_b64=result.audio_b64,
            phonemes=result.phonemes,
            tts_available=result.tts_available,
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={"error": "chat_failed", "request_id": str(uuid.uuid4())},
        )


@router.post("/tts")
async def tts(body: TTSRequest):
    """Convert text to speech and return raw audio bytes."""
    try:
        audio_bytes = await bella_service.synthesize_speech(body.text)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={"error": "tts_failed", "request_id": str(uuid.uuid4())},
        )


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...)):
    """Transcribe an audio blob to text via Groq Whisper Large v3.

    Requirement 10.3: accepts audio blob, returns transcript string.
    """
    try:
        audio_bytes = await audio.read()
        filename = audio.filename or "audio.webm"
        transcript = await bella_service.transcribe_audio(audio_bytes, filename)
        return TranscribeResponse(transcript=transcript)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={"error": "transcribe_failed", "request_id": str(uuid.uuid4())},
        )


@router.get("/history", response_model=HistoryResponse)
async def history(session_id: str = Query(default="")):
    """Retrieve chat history for a session in insertion order.

    Requirement 10.11: history persists for the duration of the session.
    """
    try:
        messages = bella_service.get_history(session_id)
        return HistoryResponse(
            messages=[HistoryMessage(**m) for m in messages]
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={"error": "history_failed", "request_id": str(uuid.uuid4())},
        )
