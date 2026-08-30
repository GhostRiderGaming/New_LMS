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

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.core.auth import get_current_session

from app.services.bella_service import bella_service
from app.services.bella_voice_engine import BELLA_DATASET, bella_voice_engine

# ---------------------------------------------------------------------------
# Pydantic v2 models
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    message: str
    session_id: str = ""
    language: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    audio_b64: Optional[str] = None       # base64-encoded WAV, None if TTS failed
    phonemes: list[dict[str, Any]] = []   # phoneme timestamps for lip sync
    tts_available: bool = False
    emotion: str = "warm"
    category: str = "General"


class TTSRequest(BaseModel):
    text: str
    language: Optional[str] = None
    category: Optional[str] = None
    emotion: Optional[str] = None
    speed: Optional[float] = None


class ExplainRequest(BaseModel):
    topic: str
    section: Optional[str] = None
    language: Optional[str] = None
    image_context: dict | None = None  # {source, category, caption, prompt}


class ExplainResponse(BaseModel):
    explanation: str
    audio_b64: Optional[str] = None
    tts_available: bool = False
    emotion: str = "warm"
    category: str = "General"


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


@router.get("/dataset")
async def get_dataset():
    """Retrieve the curated 100-dialogue Bella voice training and evaluation dataset."""
    return {
        "count": len(BELLA_DATASET),
        "dataset": BELLA_DATASET,
    }


@router.post("/preview/{dialogue_id}")
async def preview_dialogue(dialogue_id: str):
    """
    Synthesize speech for a specific dialogue item from the 100-item dataset
    using its exact emotional tone, speed rate, and voice blend.
    """
    try:
        audio_bytes, meta = bella_voice_engine.synthesize_dataset_dialogue(dialogue_id.upper())
        return Response(content=audio_bytes, media_type="audio/wav", headers={"X-Bella-Emotion": meta["emotion"], "X-Bella-Category": meta["category"]})
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Dialogue ID '{dialogue_id}' not found in dataset")
    except Exception as e:
        raise HTTPException(status_code=500, detail={"error": "preview_failed", "detail": str(e)})


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, session: dict = Depends(get_current_session)):
    """Send a message to Bella and receive a reply with optional TTS audio.

    TTS failure is non-fatal — tts_available=False is returned with the text
    reply intact (Requirement 10.12).
    """
    try:
        session_id = body.session_id or (session.get("session_id") if isinstance(session, dict) else "default-session")
        result = await bella_service.chat(body.message, session_id, language=body.language)
        return ChatResponse(
            reply=result.reply,
            audio_b64=result.audio_b64,
            phonemes=result.phonemes,
            tts_available=result.tts_available,
            emotion=result.emotion,
            category=result.category,
        )
    except Exception as e:
        import logging
        logging.getLogger("animeedu").error(f"[Bella] Chat endpoint error: {e}", exc_info=True)
        fallback = bella_service._local_fallback(body.message)
        return ChatResponse(
            reply=fallback,
            audio_b64=None,
            phonemes=[],
            tts_available=False,
            emotion="warm",
            category="General",
        )


@router.post("/explain", response_model=ExplainResponse)
async def explain(body: ExplainRequest, session: dict = Depends(get_current_session)):
    """Generate a spoken educational explanation of a topic.

    Called automatically after content generation/opening.
    Returns explanation text + optional TTS audio for Bella's voice narration.
    """
    try:
        result = await bella_service.explain_topic(body.topic, section=body.section, language=body.language, image_context=body.image_context)
        return ExplainResponse(
            explanation=result.reply,
            audio_b64=result.audio_b64,
            tts_available=result.tts_available,
            emotion=result.emotion,
            category=result.category,
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={"error": "explain_failed", "request_id": str(uuid.uuid4())},
        )


@router.post("/tts")
async def tts(body: TTSRequest, session: dict = Depends(get_current_session)):
    """Convert text to speech via Kokoro TTS and return raw audio bytes."""
    try:
        audio_bytes = await bella_service.synthesize_speech(
            body.text,
            language=body.language,
            category=body.category,
            emotion=body.emotion,
            speed=body.speed,
        )
        media_type = "audio/wav" if audio_bytes.startswith(b"RIFF") else "audio/mpeg"
        return Response(content=audio_bytes, media_type=media_type)
    except Exception as e:
        import logging
        logging.getLogger("animeedu").error(f"[Bella] TTS endpoint error: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"error": "tts_failed", "detail": str(e), "request_id": str(uuid.uuid4())},
        )


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio: UploadFile = File(...), session: dict = Depends(get_current_session)):
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
async def history(
    session_id: str = Query(default=""),
    session: dict = Depends(get_current_session),
):
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
