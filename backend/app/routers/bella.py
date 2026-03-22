import uuid
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
    """Send a message to Bella and receive a reply."""
    try:
        reply = await bella_service.chat(body.message, body.session_id)
        return ChatResponse(reply=reply)
    except Exception:
        raise HTTPException(
            status_code=500,
            detail={"error": "chat_failed", "request_id": str(uuid.uuid4())},
        )


@router.post("/tts")
async def tts(body: TTSRequest):
    """Convert text to speech and return audio bytes."""
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
    """Transcribe an audio file to text."""
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
    """Retrieve chat history for a session."""
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
