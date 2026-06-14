# AI Agents & Workflows — AnimeEdu

Complete specification of every AI agent, model, prompt, decision logic, and workflow in the system.

---

## 1. Agent Overview

| Agent | Model | Provider | Role |
|-------|-------|----------|------|
| Bella Chat | LLaMA 3.3 70B (`llama-3.3-70b-versatile`) | Groq | Conversational educational assistant |
| Prompt Builder | LLaMA 3.3 70B (`llama-3.3-70b-versatile`) | Groq | Converts topics into structured generation prompts |
| Simulation Code Gen | LLaMA 3.3 70B (`llama-3.3-70b-versatile`) | Groq | Generates self-contained HTML5 simulation code |
| Story Planner | LLaMA 3.3 70B (`llama-3.3-70b-versatile`) | Groq | Generates structured multi-episode story plans |
| Safety Classifier | `openai/gpt-oss-safeguard-20b` | Groq | Semantic content safety classification |
| Image Generator | Animagine XL 4.0 | HF Inference API (via Pollinations.ai fallback) | Anime-style image generation |
| 3D Model Generator | Tripo AI text-to-3D | Tripo AI API | Text → GLB 3D model |
| Speech-to-Text | Whisper Large v3 turbo | Groq | Transcribes Bella voice input |
| Text-to-Speech | edge-tts `en-US-AriaNeural` | Microsoft Edge (free) | Bella voice synthesis |

---

## 2. Bella Chat Agent

### Identity and Persona
```
System prompt:
"You are Bella, a friendly and knowledgeable educational assistant. 
You help students understand complex topics in a clear, engaging, and 
encouraging way. Keep your answers concise and age-appropriate. 
Use simple language and relatable examples where possible."
```

### Conversation Architecture
- **Model:** `llama-3.3-70b-versatile`
- **Max tokens:** 512 per reply
- **Temperature:** default (not set — uses model default)
- **History:** Full conversation history passed as messages array on every call
- **Session scope:** Per `session_id`; independent history per user session
- **History format:** `[{ role: "user"|"bella", text: string, timestamp: ISO8601 }]`

### LLM call structure
```python
messages = [
    {"role": "system", "content": SYSTEM_PROMPT},
    # Prior turns from session history:
    {"role": "user", "content": prior_user_message},
    {"role": "assistant", "content": prior_bella_message},
    # ... all prior turns ...
    # Current user message:
    {"role": "user", "content": current_message},
]
```

### Fallback behaviour (no API key)
Pattern-matched responses for common intents:
- Greetings → introduce Bella + offline mode notice
- Help/capabilities → list all 4 modules
- Educational questions (photosynthesis, Newton, math) → brief answer + CTA to relevant module
- Catch-all → explain offline mode + link to Groq console for API key

### TTS pipeline
1. Bella reply text → `edge_tts.Communicate(text, "en-US-AriaNeural")`
2. Stream audio chunks → collect to bytes buffer
3. Return MP3 bytes as base64 in JSON response
4. Frontend: Web Audio API decodes base64 → plays audio
5. Lip sync: amplitude envelope drives Live2D mouth parameter

### STT pipeline
1. Browser records audio via `getUserMedia` → WebM blob
2. `POST /api/v1/bella/transcribe` with multipart form
3. Groq Whisper: `whisper-large-v3-turbo` with fixed filename `"audio.webm"`
4. Returns `{ transcript: string }`

### Error handling
- Groq API error → `_local_fallback(message)` response; `tts_available: false`
- edge-tts error → `tts_available: false`; text reply still returned
- Safety classifier error → fail open (safe), no blocking

---

## 3. Prompt Builder Agent

### Purpose
Converts raw user topics into structured, model-specific prompts. Ensures all downstream generation prompts are high-quality and appropriate for the target model.

### Endpoints
```python
# Four methods, all use Groq LLaMA 3.3 70B:
await prompt_builder.build_anime_prompt(topic: str, style: str) -> str
await prompt_builder.build_simulation_prompt(topic: str, category: str) -> str
await prompt_builder.build_model3d_prompt(object_name: str, category: str) -> str
await prompt_builder.build_story_prompt(topic: str, episode_count: int) -> str
```

### Anime prompt builder
**Goal:** Convert "photosynthesis" + "laboratory" → anime-style image prompt
**Output example:**
```
"anime style educational scene, photosynthesis process in a bright laboratory, 
glowing green chloroplasts, colorful molecular diagrams, school students observing, 
masterpiece quality, vibrant colors, soft lighting, Makoto Shinkai style"
```

### Simulation prompt builder
**Goal:** Generate a detailed specification for the simulation code generator
**Output:** Structured prompt describing the scientific concept, key variables to control, visual elements to animate, and educational objectives.

### Failure handling
If the prompt builder Groq call fails, each generation service falls back to a direct prompt:
```python
except Exception:
    code_gen_prompt = (
        f"Create a complete, self-contained HTML5 interactive simulation about "
        f"'{topic}' in the '{category}' category..."
    )
```

---

## 4. Simulation Code Generation Agent

### System prompt
```
"You are a world-class educational simulation developer building interactive learning 
tools for 6th-grade students (ages 11-12). Generate a COMPLETE, self-contained HTML5 
simulation..."
```
Full prompt in `simulation_engine.py::_SIMULATION_SYSTEM`.

### Mandatory output requirements (enforced in system prompt)
1. Output ONLY raw HTML starting with `<!DOCTYPE html>` — no markdown fencing
2. ALL JavaScript inline in `<script>` tags; ALL CSS inline in `<style>` tags
3. ZERO external URLs
4. `<canvas>` with `requestAnimationFrame()` loop
5. Control panel with ≥ 2 interactive elements
6. "LEARN" info box
7. Dark theme: bg `#0f172a`, purple `#8b5cf6`, cyan `#06b6d4`
8. Animated movement — not static shapes
9. Canvas labels via `ctx.drawText`
10. Clear variable names with code comments

### Parameters
- **Model:** `llama-3.3-70b-versatile`
- **Max tokens:** 8192 (allows for complex, complete simulations)
- **Temperature:** 0.4 (some creativity, mostly deterministic)
- **Timeout:** 120s
- **Retries:** 3 (Groq client level)

### Output validation pipeline
```
LLM raw output
  → _extract_html() — strip markdown fences
  → _inline_external_scripts() — remove CDN links
  → _validate_html() — check for remaining external URLs
  → [invalid?] → _fallback_simulation() (particle animation)
  → store to S3
```

### Fallback simulation spec
Always valid; always used on any LLM failure. Contains:
- Topic title and category badge
- 560×320 canvas with animated glowing particles
- Speed slider + particle count slider
- "About this simulation" info box
- Full requestAnimationFrame loop with radial gradients

---

## 5. Story Planner Agent

### System prompt (inferred from story_engine.py)
Instructs the model to output a structured JSON StoryPlan for a given topic and episode count. The plan must include a coherent narrative arc with educational content.

### StoryPlan Pydantic schema
```python
class Scene(BaseModel):
    scene_number: int
    description: str      # Internal narrative description
    caption: str          # Display caption for the scene image
    prompt: str           # Anime image generation prompt for this scene

class Episode(BaseModel):
    episode_number: int
    title: str
    scenes: list[Scene]

class Character(BaseModel):
    name: str
    role: str
    description: str

class StoryPlan(BaseModel):
    story_id: str
    title: str
    synopsis: str
    characters: list[Character]
    episodes: list[Episode]
```

### Parameters
- **Model:** `llama-3.3-70b-versatile`
- **Max tokens:** varies (scales with episode_count)
- **Temperature:** 0.7 (more creative for narrative generation)

### Post-plan workflow
After StoryPlan generated:
1. Safety check on `title + synopsis`
2. For each scene: create child Job, dispatch `generate_anime_task`
3. Placeholder scene substituted on dispatch failure
4. Parent job marked complete; child jobs run independently

### Placeholder scene
```python
def _placeholder_scene(scene_number: int, topic: str) -> dict:
    return {
        "scene_number": scene_number,
        "description": f"Scene {scene_number} for {topic}",
        "caption": f"{topic} — scene {scene_number}",
        "image_url": None,  # Renders as grey placeholder in UI
    }
```

---

## 6. Safety Classifier Agent

### Architecture: Two-stage pipeline

**Stage 1 — Keyword Blocklist (synchronous, 0ms)**
```python
_BLOCKLIST = frozenset({
    "porn", "pornography", "nude", "nudity", "nsfw", "hentai", "erotic",
    "racist", "racism", "slur", "hate speech",
    "drug synthesis", "weapon synthesis", "gun making",
    "how to make a bomb", "how to make drugs",
    "suicide method", "self-harm method",
})
# Word-boundary matching: \bterm\b — prevents false positives
```

**Stage 2 — Groq Safety Classifier (async, ~500ms)**
```python
model = "openai/gpt-oss-safeguard-20b"
timeout = 5.0  # fail fast
max_retries = 0  # no retries — fail open

system_prompt = """
You are a content safety classifier for an educational platform...
Only classify content as UNSAFE if it contains explicit sexual content,
instructions for creating weapons or drugs, promotion of self-harm,
or targeted hate speech.
Respond with exactly one word: SAFE or UNSAFE.
"""
```

### Decision logic
```python
upper = raw_response.upper()
if "UNSAFE" in upper:
    return SafetyResult(safe=False, reason=...)
elif "SAFE" in upper:
    return SafetyResult(safe=True)
else:
    # Unrecognisable output — fail open
    return SafetyResult(safe=True, reason="unrecognisable output")
```

### Integration points
- `check_topic()` — called synchronously in every router before enqueueing
- `check_content()` — called inside every Celery task after generation, before storing
- Both methods wrap the educational context in the user prompt to reduce false positives

### Audit logging
Every violation logged:
```
SAFETY_VIOLATION topic='...' keyword='...' classifier='...' reason='...' at='2024-...'
```

---

## 7. Image Generation Agent (Pollinations.ai + HF)

### Primary: Pollinations.ai
- URL: `https://image.pollinations.ai/prompt/{encoded_prompt}?width=512&height=768&nologo=true&seed={seed}&model=flux`
- Tokenless — no API key required
- Retry policy: 5 attempts, exponential backoff, two URL variants
- Minimum response size check: < 1000 bytes = error page, retry

### Prompt structure
```
{anime_prompt from prompt_builder} + " anime style masterpiece"
```

### Animation (GIF)
- 4 frames (default) from sequential Pollinations.ai calls
- Each frame: same base prompt + "dynamic motion sequence, animation frame N"
- 1s delay between frames (rate limit)
- Assembly: Pillow `Image.save(format="GIF", save_all=True, duration=300, loop=0)`

### Caption overlay
- Pillow renders semi-transparent black bar (alpha 180) at bottom
- White text, font size 20, padding 12px
- Falls back to `ImageFont.load_default()` if `arial.ttf` unavailable

---

## 8. 3D Model Generation Agent

### API: Tripo AI text-to-3D
- Input: `object_name` string
- Output: GLB binary
- Polling: Tripo AI jobs require polling for completion
- Timeout: 120s total
- Retries: 3 (Celery task level)

### Failure suggestions
On persistent failure, `get_suggestions_for_category(category)` returns 5 alternative objects:
```python
SUGGESTIONS = {
    "science": ["DNA helix", "water molecule", "animal cell", "solar system", "atom"],
    "math": ["3D cube", "sphere", "pyramid", "cone", "cylinder"],
    "history": ["ancient vase", "sword", "castle tower", "compass", "globe"],
    # ... per category
}
```

---

## 9. Agent Interaction Map

```
User input
    │
    ├─ Prompt Builder Agent
    │   └─ Structured prompt
    │           │
    │           ├─ Image Generation Agent → PNG/GIF
    │           │
    │           ├─ Simulation Code Gen Agent → HTML
    │           │
    │           ├─ 3D Model Agent → GLB
    │           │
    │           └─ Story Planner Agent → StoryPlan
    │                       │
    │                       └─ Image Generation Agent (per scene)
    │
    ├─ Safety Classifier Agent (pre + post generation)
    │
    └─ Bella Chat Agent (independent, per-message)
            │
            ├─ TTS Agent (edge-tts)
            └─ STT Agent (Groq Whisper)
```

All agents are stateless except:
- **Bella Chat** — maintains in-memory session history per session_id
- **Safety Service** — singleton with Groq client instance (connection reuse)
