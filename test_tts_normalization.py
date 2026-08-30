import os
import sys

# Ensure backend path is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "backend")))

from app.services.bella_voice_engine import (
    normalize_text_for_tts,
    prepare_prosody_for_bella,
    analyze_emotional_intent
)

tests = [
    {
        "name": "1. Normal text",
        "input": "That was really good! Let's continue."
    },
    {
        "name": "2. Text with *smiles*",
        "input": "That was really good! *smiles*"
    },
    {
        "name": "3. Text with multiple actions",
        "input": "*blushes* I didn't expect that... *laughs softly* Let's try again!"
    },
    {
        "name": "4. Text with emojis",
        "input": "Wow! ✨ That's amazing! 😊❤️"
    },
    {
        "name": "5. Text with both actions + emojis",
        "input": "*smiles warmly* Here you go! ✨"
    },
    {
        "name": "6. Excited response",
        "input": "Wait—really?! That's actually amazing!"
    },
    {
        "name": "7. Soft response",
        "input": "Hey... it's okay. Take your time."
    },
    {
        "name": "8. Surprised response",
        "input": "Oh... I didn't expect that."
    },
    {
        "name": "9. Curious response",
        "input": "Hmm... wait. How did you figure that out?"
    },
    {
        "name": "10. Image explanation",
        "input": "Looking at this diagram, we can see the core components of a cell."
    },
    {
        "name": "11. Simulation explanation",
        "input": "Welcome to the physics lab! Watch what happens when we drop the ball."
    }
]

def run_tests():
    print("=== BELLA TTS NORMALIZATION AND PROSODY TESTS ===\n")
    for t in tests:
        print(f"--- {t['name']} ---")
        print(f"UI TEXT      : {t['input']}")
        
        normalized = normalize_text_for_tts(t['input'])
        print(f"NORMALIZED   : {normalized}")
        
        cat, emo, recommended_speed = analyze_emotional_intent(normalized)
        print(f"EMOTION      : {emo} (Category: {cat}, Rec. Speed: {recommended_speed})")
        
        final_prosody = prepare_prosody_for_bella(normalized, emotion=emo)
        print(f"TTS PROSODY  : {final_prosody}")
        print("-" * 50 + "\n")

if __name__ == "__main__":
    run_tests()
