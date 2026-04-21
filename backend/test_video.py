"""Quick proof-of-concept test for the video assembler."""
import asyncio
import sys
import os

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

async def test_video():
    from app.services.video_assembler import _create_title_card, _synthesize_narration, _create_scene_clip
    import tempfile
    from PIL import Image
    import io
    
    print("[TEST] Creating title card...")
    title_clip = _create_title_card("Test: Photosynthesis", "A Biology Adventure")
    print(f"  ✅ Title card: {title_clip.duration}s, size={title_clip.size}")
    title_clip.close()
    
    print("[TEST] Synthesizing narration...")
    audio_path = tempfile.mktemp(suffix=".mp3")
    duration = await _synthesize_narration("This is a test of the edge TTS narration system.", audio_path)
    print(f"  ✅ Narration: {duration:.1f}s, file size={os.path.getsize(audio_path)} bytes")
    os.unlink(audio_path)
    
    print("[TEST] Creating scene clip...")
    # Create a test image
    img = Image.new("RGB", (512, 768), (30, 60, 120))
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    draw.rectangle([(100, 200), (400, 500)], fill=(50, 150, 50))
    draw.ellipse([(200, 100), (350, 250)], fill=(200, 200, 50))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    
    scene_clip = _create_scene_clip(buf.getvalue(), "A plant absorbing sunlight for photosynthesis", 5.0)
    print(f"  ✅ Scene clip: {scene_clip.duration}s, size={scene_clip.size}")
    scene_clip.close()
    
    print("\n🎉 All video assembler components working! Pipeline is ready.")

if __name__ == "__main__":
    asyncio.run(test_video())
