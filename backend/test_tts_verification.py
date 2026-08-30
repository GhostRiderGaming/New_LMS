import asyncio
import os
import tempfile

async def run_verification():
    print("=" * 60)
    print("KOKORO TTS FULL VERIFICATION SUITE")
    print("=" * 60)

    from app.services.bella_service import bella_service
    from app.services.video_assembler import _synthesize_narration

    # 1. Test direct speech synthesis
    print("\n1. Testing bella_service.synthesize_speech (English)...")
    audio = await bella_service.synthesize_speech("Welcome to the next generation LMS platform powered by Kokoro TTS!")
    assert isinstance(audio, bytes), "Audio must be bytes"
    assert len(audio) > 10000, f"Audio bytes too small: {len(audio)}"
    assert audio.startswith(b"RIFF"), f"Audio must be WAV RIFF format, got header: {audio[:4]}"
    print(f"   [PASS] Generated {len(audio)} bytes of 24kHz WAV audio successfully!")

    # 2. Test Hindi speech synthesis
    print("\n2. Testing bella_service.synthesize_speech (Hindi / Hinglish)...")
    audio_hi = await bella_service.synthesize_speech("Namaste, main Bella hoon! Aapka educational companion.", language="hindi")
    assert isinstance(audio_hi, bytes) and len(audio_hi) > 5000
    print(f"   [PASS] Generated {len(audio_hi)} bytes of Hindi/Hinglish WAV audio successfully!")

    # 3. Test chat with TTS
    print("\n3. Testing bella_service.chat with TTS...")
    chat_res = await bella_service.chat("Hello Bella! Who are you?", session_id="test-session-123")
    print(f"   Reply: '{chat_res.reply[:80]}...'")
    print(f"   TTS available: {chat_res.tts_available}")
    assert chat_res.tts_available is True, "TTS should be available"
    assert chat_res.audio_b64 is not None and len(chat_res.audio_b64) > 1000
    print(f"   [PASS] Chat audio_b64 length: {len(chat_res.audio_b64)} chars")

    # 4. Test explain_topic
    print("\n4. Testing bella_service.explain_topic...")
    explain_res = await bella_service.explain_topic("Black Holes and General Relativity")
    print(f"   Explanation: '{explain_res.reply[:80]}...'")
    print(f"   TTS available: {explain_res.tts_available}")
    assert explain_res.tts_available is True
    print(f"   [PASS] Explain audio_b64 length: {len(explain_res.audio_b64)} chars")

    # 5. Test video narration synthesis
    print("\n5. Testing video_assembler._synthesize_narration...")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        duration = await _synthesize_narration("In the depths of space, gravity warps the fabric of spacetime.", tmp_path)
        assert os.path.exists(tmp_path), "Narration file must exist"
        assert os.path.getsize(tmp_path) > 10000, "Narration file must contain audio"
        print(f"   [PASS] Narration duration: {duration:.2f}s, file size: {os.path.getsize(tmp_path)} bytes")
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    print("\n" + "=" * 60)
    print("ALL TTS VERIFICATION TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(run_verification())
