"""
Production Voice Verification — Confirm Bella uses raw Kokoro af_bella.

Usage:
    cd backend
    python -m app.services.run_raw_voice_test

Output:
    backend/storage/ab_test_output/raw_af_bella_baseline.wav
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

# Ensure the backend directory is importable
_backend_dir = Path(__file__).resolve().parent.parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

# Configure logging so all TTS messages are visible in the console
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s -- %(message)s",
    stream=sys.stdout,
)


def main() -> None:
    from app.services.bella_voice_engine import bella_voice_engine

    # -----------------------------------------------------------------------
    # Standard test sentence
    # -----------------------------------------------------------------------
    test_sentence = (
        "I'm so glad you're here today... "
        "Let's explore something beautiful together, okay? "
        "Don't worry if it feels tricky at first, "
        "I'll be right by your side the whole time."
    )

    output_dir = _backend_dir / "storage" / "ab_test_output"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "raw_af_bella_baseline.wav"

    print("=" * 70)
    print("  Bella Production Voice Verification")
    print("=" * 70)
    print()
    print(f"  Test sentence : \"{test_sentence}\"")
    print(f"  Output path   : {output_path}")
    print()

    # -----------------------------------------------------------------------
    # Synthesize
    # -----------------------------------------------------------------------
    print("  Synthesizing with Kokoro TTS...")
    print()

    try:
        audio_bytes, metadata = bella_voice_engine.synthesize_speech(
            text=test_sentence,
        )
    except Exception as e:
        print(f"  *** SYNTHESIS FAILED ***")
        print(f"  Exception: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

    # -----------------------------------------------------------------------
    # Save WAV
    # -----------------------------------------------------------------------
    output_path.write_bytes(audio_bytes)

    # -----------------------------------------------------------------------
    # Report
    # -----------------------------------------------------------------------
    print("-" * 70)
    print("  Synthesis Results:")
    print(f"    TTS engine        : {metadata.get('tts_engine', 'unknown')}")
    print(f"    Voice ID          : {metadata.get('voice_id', 'unknown')}")
    print(f"    Speed             : {metadata.get('speed', 'unknown')}")
    print(f"    Blending enabled  : {metadata.get('blending_enabled', 'unknown')}")
    print(f"    Fallback triggered: {metadata.get('fallback_triggered', 'unknown')}")
    print(f"    Duration          : {metadata.get('duration_sec', 'unknown')}s")
    print(f"    Category          : {metadata.get('category', 'unknown')}")
    print(f"    Emotion           : {metadata.get('emotion', 'unknown')}")
    print(f"    Audio size        : {len(audio_bytes):,} bytes")
    print(f"    Saved to          : {output_path}")
    print()

    # -----------------------------------------------------------------------
    # Verify
    # -----------------------------------------------------------------------
    errors = []
    if metadata.get("tts_engine") != "kokoro":
        errors.append(f"Expected tts_engine=kokoro, got {metadata.get('tts_engine')}")
    if metadata.get("voice_id") != "af_bella":
        errors.append(f"Expected voice_id=af_bella, got {metadata.get('voice_id')}")
    if metadata.get("blending_enabled") is not False:
        errors.append(f"Expected blending_enabled=False, got {metadata.get('blending_enabled')}")
    if metadata.get("speed") != 1.0:
        errors.append(f"Expected speed=1.0, got {metadata.get('speed')}")
    if metadata.get("fallback_triggered") is not False:
        errors.append(f"Expected fallback_triggered=False, got {metadata.get('fallback_triggered')}")
    if not audio_bytes[:4] == b"RIFF":
        errors.append(f"Output is not valid WAV (header: {audio_bytes[:4]})")
    if len(audio_bytes) < 10_000:
        errors.append(f"Audio too small ({len(audio_bytes)} bytes)")

    if errors:
        print("  *** VERIFICATION FAILED ***")
        for err in errors:
            print(f"    FAIL: {err}")
        sys.exit(1)

    print("  [OK] TTS engine = kokoro")
    print("  [OK] Voice ID = af_bella")
    print("  [OK] Blending enabled = False")
    print("  [OK] Speed = 1.0")
    print("  [OK] Fallback triggered = False")
    print("  [OK] WAV file is valid RIFF format")
    print("  [OK] Audio size is reasonable")
    print()
    print("-" * 70)
    print("  All production voice checks passed.")
    print(f"  File: {output_path}")
    print("=" * 70)


if __name__ == "__main__":
    main()
