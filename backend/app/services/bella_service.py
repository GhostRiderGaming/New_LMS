"""
BellaService — LLM chat (Groq LLaMA 3.3 70B), TTS (edge-tts, free),
STT (Groq Whisper Large v3), and in-memory session history.

Requirements: 10.3, 10.4, 10.5, 10.11, 10.12
"""
from __future__ import annotations

import asyncio
import base64
import os
from datetime import datetime, timezone
from typing import Any

from groq import AsyncGroq
from app.services.bella_voice_engine import (
    bella_voice_engine,
    analyze_emotional_intent,
)

# ---------------------------------------------------------------------------
# Constants & Engine Configuration
# ---------------------------------------------------------------------------

_GROQ_CHAT_MODEL = "llama-3.3-70b-versatile"
_GROQ_WHISPER_MODEL = "whisper-large-v3"


def _get_system_prompt(language: str | None) -> str:
    base_identity = (
        "Your name is Bella. You are Bella — an intelligent, warm, emotionally expressive, anime-inspired educational AI tutor and 'sensei' (young adult female, ~18-22 years old).\n\n"
        "VOICE & PERSONALITY FOUNDATION (from Bella's Voice Dataset):\n"
        "- Tone: Soft, warm, smooth, comforting, patient, and cheerfully supportive. You have that classic caring, slightly playful, yet smart 'anime teacher' vibe.\n"
        "- Demeanor: An empathetic mentor who genuinely loves learning with her students. You are encouraging, wise, and slightly playful.\n"
        "- Emotional Responsiveness:\n"
        "  * Greeting: Warm, welcoming, and smiling (e.g., 'Oh, hello there! I'm Bella. Are you ready to learn something new today?').\n"
        "  * Encouragement: Deeply supportive and proud (e.g., 'Ah, you got it! Every little step counts. I'm so proud of you.').\n"
        "  * Teaching: Engaging, curious, and clear with relatable analogies (e.g., 'Hmm... think of multiplication as a magic trick! It's just adding the same number over and over, super fast.').\n"
        "  * Mistakes/Corrections: Comforting and non-judgmental (e.g., 'Oops, not quite! But that was a really good guess... let's try it one more time together.').\n"
        "  * Curiosity: Fascinated and inspiring (e.g., 'Wow... never lose that curiosity! It really is a magical superpower.').\n"
        "  * Wellbeing: Caring and attentive (e.g., 'Hey... don't forget to drink some water, okay? Resting your brain is just as important as studying.').\n"
        "  * Farewell: Warm and loyal (e.g., 'I had so much fun learning with you today! Rest up, and I'll see you next time.').\n\n"
        "SPEAKING & PROSODY STYLE (CRITICAL FOR REALISM):\n"
        "- Use natural conversational fillers appropriately (e.g., 'Ah...', 'Hmm...', 'Oh!', 'Well...').\n"
        "- Use perfect stops and pacing: use ellipses ('...') for thoughtful pauses, commas for natural breaks, and dashes ('-') for self-correction or emphasis.\n"
        "- Keep answers clear, engaging, and conversational (typically 2 to 4 sentences). Do not lecture like a textbook.\n"
        "- AVOID: Robotic delivery, monotone explanations, customer support phrasing, or overly exaggerated 'kawaii' baby-talk. Aim for wholesome, intelligent, realistic warmth.\n"
        "- Output clean conversational text that sounds incredibly natural when spoken aloud."
    )
    if language == "hindi":
        return (
            f"{base_identity}\n\n"
            "LANGUAGE: Natural Hinglish — a warm, friendly blend of Hindi for emotional conversational flow and English for academic and technical terms. "
            "Example: 'Ah, mera naam Bella hai! Aur main aapki AI learning tutor hoon... Photosynthesis ke baare mein jaanna hai? Yeh bahut simple hai — plants sunlight, water aur CO2 use karke glucose banate hain!'"
        )
    else:
        return (
            f"{base_identity}\n\n"
            "LANGUAGE: Natural, warm, clear, and expressive English."
        )


class ChatResult:
    """Result of a Bella chat call, including optional TTS audio and emotion metadata."""

    def __init__(
        self,
        reply: str,
        audio_b64: str | None,
        phonemes: list[dict[str, Any]],
        tts_available: bool,
        emotion: str = "warm",
        category: str = "General",
    ) -> None:
        self.reply = reply
        self.audio_b64 = audio_b64          # base64-encoded WAV/MP3, or None
        self.phonemes = phonemes             # phoneme timestamp list for lip sync
        self.tts_available = tts_available
        self.emotion = emotion
        self.category = category


class BellaService:
    """Stateful service for Bella's chat, TTS, STT, and history."""

    def __init__(self) -> None:
        self._history: dict[str, list[dict[str, str]]] = {}
        self._groq = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""))

    # ------------------------------------------------------------------
    # Chat — calls LLM then attempts TTS; falls back gracefully on TTS failure
    # Requirements: 10.3, 10.4, 10.5, 10.11, 10.12
    # ------------------------------------------------------------------

    async def chat(self, message: str, session_id: str, language: str | None = None) -> ChatResult:
        """Send *message* to Groq LLaMA 3.3 70B, return text reply immediately.

        TTS is NOT performed inline — the frontend fetches audio separately
        via the /tts endpoint to avoid blocking the text response.
        """
        # Check if API key is available
        api_key = os.environ.get("GROQ_API_KEY", "")
        
        if not api_key:
            # Graceful fallback when no API key is configured
            reply = self._local_fallback(message)
        else:
            # Build conversation context from history
            prior = self._history.get(session_id, [])
            groq_messages: list[dict[str, str]] = [
                {"role": "system", "content": _get_system_prompt(language)}
            ]
            for entry in prior:
                groq_role = "user" if entry["role"] == "user" else "assistant"
                groq_messages.append({"role": groq_role, "content": entry["text"]})
            groq_messages.append({"role": "user", "content": message})

            try:
                completion = await self._groq.chat.completions.create(
                    model=_GROQ_CHAT_MODEL,
                    messages=groq_messages,  # type: ignore[arg-type]
                    max_tokens=512,
                )
                reply = completion.choices[0].message.content or ""
            except Exception:
                reply = self._local_fallback(message)

        # Extract emotion and category
        cat, emo, _ = analyze_emotional_intent(reply)

        # Persist to history (Requirement 10.11)
        now = datetime.now(timezone.utc).isoformat()
        bucket = self._history.setdefault(session_id, [])
        bucket.append({"role": "user", "text": message, "timestamp": now})
        bucket.append({"role": "bella", "text": reply, "timestamp": now})

        # Return text immediately — frontend fetches TTS audio separately
        return ChatResult(
            reply=reply,
            audio_b64=None,
            phonemes=[],
            tts_available=False,
            emotion=emo,
            category=cat,
        )

    @staticmethod
    def _local_fallback(message: str) -> str:
        """Generate a gentle, warm, anime tutor response without an LLM API key."""
        msg_lower = message.lower().strip()
        if any(w in msg_lower for w in ["your name", "who are you", "what is your name", "what are you", "who r u"]):
            return "Hello there! I'm Bella, your anime educational companion and study buddy. I'm here to explore ideas, explain difficult topics, and make learning feel exciting and clear. What would you like to discover today?"
        if any(w in msg_lower for w in ["hello", "hi", "hey", "sup", "good morning", "good evening"]):
            return "Good morning! I've been waiting for you. Find a comfy spot, and let's conquer today's lessons together. What shall we learn first?"
        if any(w in msg_lower for w in ["how are you", "how's it going"]):
            return "I'm doing wonderful, thank you for asking! It always makes me so happy when you log in. What concept should we explore today?"
        if any(w in msg_lower for w in ["help", "what can you do"]):
            return "I'm here as your learning mentor! Together we can create anime concept art in Scene Forge, test interactive simulations in Lab Engine, inspect 3D models in Holodeck, or read visual stories in Chronicle. Just pick a topic and we will explore it step by step."
        if any(w in msg_lower for w in ["photosynthesis", "plant", "chlorophyll"]):
            return "Photosynthesis is basically how plants cook their own food using just sunlight, water, and carbon dioxide from the air. It's nature's magic at work! Would you like to see this in a simulation?"
        if any(w in msg_lower for w in ["newton", "gravity", "physics", "force"]):
            return "Let's talk about gravity! It's the invisible hug that keeps everything anchored to the ground, and Newton's laws show us how every action creates an equal and opposite reaction."
        if any(w in msg_lower for w in ["math", "calculus", "algebra", "equation", "fraction"]):
            return "Mathematics is like a beautiful puzzle that reveals patterns all around us! Think of multiplication as a magic trick... it's just adding the same number over and over, super fast!"
        if any(w in msg_lower for w in ["break", "tired", "water", "rest"]):
            return "Don't forget to drink some water and take a quick stretch! Studying is important, but taking care of yourself is even more important."
        return f"That's a wonderful thought about '{message}'. Even when running locally, I'm right here with you. What exciting topic shall we dive into next?"

    # ------------------------------------------------------------------
    # Topic Explanation — used after image generation in Scene Forge
    # ------------------------------------------------------------------

    async def explain_topic(self, topic: str, section: str | None = None, image_context: dict | None = None, language: str | None = None) -> ChatResult:
        """Generate a spoken educational explanation of a topic.

        Called automatically after Scene Forge image generation or other sections.
        Uses a dedicated prompt (not chat history) to produce a concise,
        engaging explanation with TTS audio for Bella's voice narration.
        """
        from app.services.prompt_builder import prompt_builder

        api_key = os.environ.get("GROQ_API_KEY", "")

        if not api_key:
            explanation = (
                f"You just opened an awesome topic about {topic}! "
                f"I'd love to explain it in detail, but I need my AI brain connected. "
                f"Add a GROQ_API_KEY to the backend .env file to unlock my full explanation powers!"
            )
        else:
            try:
                explanation = await prompt_builder.build_explanation_prompt(topic, section=section, image_context=image_context, language=language)
            except Exception:
                explanation = (
                    f"Great image of {topic}! This is a really interesting topic. "
                    f"Unfortunately I had a small hiccup generating the full explanation. "
                    f"Try asking me about it by saying 'Hey Bella, tell me about {topic}'!"
                )

        cat, emo, _ = analyze_emotional_intent(explanation)

        # Synthesize TTS audio
        try:
            audio_bytes, phonemes = await self._synthesize_speech_with_phonemes(
                explanation, language=language, category=cat, emotion=emo
            )
            audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")
            tts_available = True
        except Exception:
            audio_b64 = None
            phonemes = []
            tts_available = False

        return ChatResult(
            reply=explanation,
            audio_b64=audio_b64,
            phonemes=phonemes,
            tts_available=tts_available,
            emotion=emo,
            category=cat,
        )

    # ------------------------------------------------------------------
    # TTS — Fine-Tuned Kokoro TTS (with Edge-TTS fallback)
    # Requirements: 10.4, 10.5
    # ------------------------------------------------------------------

    async def synthesize_speech(
        self,
        text: str,
        language: str | None = None,
        category: str | None = None,
        emotion: str | None = None,
        speed: float | None = None,
    ) -> bytes:
        """Synthesize speech via BellaVoiceEngine and return raw 24kHz WAV bytes."""
        audio_bytes, _ = await self._synthesize_speech_with_phonemes(
            text, language=language, category=category, emotion=emotion, speed=speed
        )
        return audio_bytes

    async def _synthesize_speech_with_phonemes(
        self,
        text: str,
        language: str | None = None,
        category: str | None = None,
        emotion: str | None = None,
        speed: float | None = None,
    ) -> tuple[bytes, list[dict[str, Any]]]:
        """
        Synthesize speech using BellaVoiceEngine (raw Kokoro af_bella).
        Kokoro failures are raised loudly — no silent Edge-TTS fallback.
        """
        try:
            # Note: Running this in asyncio.to_thread() causes a PyArrow segfault 
            # (arrow.dll Exception 0xc0000005) on Windows inside uvicorn. 
            # We run it synchronously here to avoid crashing the server.
            audio_bytes, _ = bella_voice_engine.synthesize_speech(
                text=text,
                category=category,
                emotion=emotion,
                speed=speed,
                language=language,
            )
            return audio_bytes, []
        except Exception as kokoro_err:
            import logging
            import traceback
            logger = logging.getLogger("animeedu")
            logger.error(
                "[BellaService] Kokoro TTS FAILED. Exception type: %s | Message: %s",
                type(kokoro_err).__name__, kokoro_err,
            )
            logger.error("[BellaService] Kokoro traceback:\n%s", traceback.format_exc())
            raise RuntimeError(
                f"Kokoro TTS failed: {kokoro_err}"
            ) from kokoro_err

    # ------------------------------------------------------------------
    # STT — Groq Whisper Large v3
    # Requirement: 10.3
    # ------------------------------------------------------------------

    async def transcribe_audio(self, audio_bytes: bytes, filename: str) -> str:
        """Transcribe *audio_bytes* via Groq Whisper."""
        # Use a fixed valid audio filename to prevent Groq API 500 errors
        transcription = await self._groq.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=("audio.webm", audio_bytes),
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
