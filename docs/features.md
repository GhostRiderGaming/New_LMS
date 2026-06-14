# Feature Specifications — AnimeEdu

Detailed breakdown of every user-facing and system feature, including UI behaviour, API contracts, and internal logic.

---

## Feature 1 — Scene Forge (Anime Image & Animation Generator)

### User-facing behaviour
1. User navigates to `/anime`.
2. Enters a topic (e.g., "photosynthesis") and selects a style from the dropdown (classroom/laboratory/outdoor/fantasy).
3. Optionally toggles "Include Animation" to request a GIF.
4. Clicks "Generate" — button disables, JobProgressBar appears.
5. Frontend polls `GET /api/v1/jobs/{job_id}` every 2s (or subscribes to WebSocket).
6. On completion, an `AnimeSceneCard` displays the PNG or GIF with caption, download link, and XP award notification.
7. On failure, a user-friendly error message is shown; user can retry.

### API contract
```
POST /api/v1/anime/generate
Body: { "topic": string, "style": "classroom"|"laboratory"|"outdoor"|"fantasy", "include_animation": boolean }
Response 202: { "job_id": string, "status": "queued" }
Response 422: { "error": "safety_violation", "detail": { "reason": string } }
Response 429: rate limit exceeded
```

### Pipeline steps
1. `safety.check_topic(topic)` — if unsafe → HTTP 422
2. Insert `Job` row (status=queued)
3. `generate_anime_task.delay(job_id, topic, style, include_animation, session_id)`
4. Worker: build prompt via `prompt_builder.build_anime_prompt(topic, style)`
5. Worker: call `_call_pollinations_image(prompt)` with retry (5 attempts, exponential backoff)
6. Worker: apply Pillow caption overlay via `_add_caption_overlay(bytes, caption)`
7. If animation: repeat steps 4–6 for N frames, assemble GIF via Pillow
8. Worker: `asset_manager.store_asset(data, key, content_type, ...)`
9. Worker: `safety.check_content(caption)` — if unsafe → delete asset, job failed
10. Worker: update job status=complete, asset_id=new asset UUID

### Output formats
- Single image: PNG 512×768 with caption bar
- Animation: GIF (default 4 frames, 300ms/frame, infinite loop)

### Storage key pattern
`anime/{job_id}/{uuid}.png` or `.gif`

---

## Feature 2 — Lab Engine (Interactive Simulation Generator)

### User-facing behaviour
1. User navigates to `/simulation`.
2. Enters a topic and selects a category.
3. Clicks "Generate Simulation" — JobProgressBar shown (up to 90s timeout).
4. On completion, simulation renders in a sandboxed `<iframe>` with `sandbox="allow-scripts"`.
5. Controls within the iframe (sliders, buttons) interact with the canvas animation in real time.
6. "Open Full Screen" button opens the simulation in a new tab via the presigned S3 URL.
7. "Download HTML" downloads the self-contained file.

### API contract
```
POST /api/v1/simulation/generate
Body: { "topic": string, "category": "physics"|"chemistry"|"biology"|"mathematics"|"history" }
Response 202: { "job_id": string, "status": "queued" }
```

### Pipeline steps
1. Safety check on topic
2. Insert Job row
3. `generate_simulation_task.delay(...)`
4. Worker: `prompt_builder.build_simulation_prompt(topic, category)` → structured prompt
5. Worker: Groq LLaMA 3.3 70B with `_SIMULATION_SYSTEM` prompt (max_tokens=8192, temp=0.4)
6. Worker: `_extract_html(raw)` strips markdown fencing
7. Worker: `_inline_external_scripts(html)` removes CDN links
8. Worker: `_validate_html(html)` via custom HTMLParser — if external URLs found → fallback
9. Worker: if invalid/empty → `_fallback_simulation(topic, category)` (particle animation)
10. Worker: store HTML to S3, persist Asset record

### Simulation HTML requirements (enforced at generation time)
- Zero external URLs in `src=` or `href=` attributes
- `<!DOCTYPE html>` present
- `<canvas>` element with `requestAnimationFrame` loop
- At least 2 interactive controls
- "LEARN" info box explaining the concept
- Dark theme: background `#0f172a`, purple `#8b5cf6`, cyan `#06b6d4`

### Fallback simulation
Always present — animated particle system that responds to speed and count sliders. Used when LLM generation fails or produces invalid HTML.

---

## Feature 3 — Holodeck (3D Model Generator)

### User-facing behaviour
1. User navigates to `/model3d`.
2. Enters an object name and selects a category.
3. Clicks "Generate 3D Model" — JobProgressBar shown (up to 120s timeout).
4. On completion, `ModelViewer3D` component renders the GLB in a Three.js canvas with:
   - Orbit controls (rotate, zoom, pan)
   - Auto-rotate enabled
   - Environment lighting (drei `Environment preset="studio"`)
5. "Download GLB" button triggers direct download from S3 presigned URL.
6. On failure, suggested alternative objects for the category are shown.

### API contract
```
POST /api/v1/model3d/generate
Body: { "object_name": string, "category": string }
Response 202: { "job_id": string, "status": "queued" }
```

### Pipeline steps
1. Safety check on object_name
2. Insert Job row
3. `generate_model3d_task.delay(...)`
4. Worker: call Tripo AI text-to-3D API with object_name
5. Worker: poll Tripo AI for completion; download GLB binary
6. Worker: upload GLB to S3 under `model3d/{job_id}/{uuid}.glb`
7. Worker: post-generation safety check on object_name
8. Worker: update job complete with asset_id

### Frontend 3D viewer stack
- `@react-three/fiber` + `@react-three/drei`
- `useGLTF` hook loads the presigned GLB URL
- `OrbitControls` + `autoRotate`
- `Suspense` with fallback spinner
- `Environment` for studio lighting

---

## Feature 4 — Chronicle (Story / Anime Series Generator)

### User-facing behaviour
1. User navigates to `/story`.
2. Enters a topic and selects episode count (1–6).
3. Clicks "Generate Story" — job submitted.
4. On plan completion, `StoryPlayer` renders:
   - Story title and synopsis
   - Episode list with episode titles
   - Per-episode scene viewer with scene image, caption, and description
   - Navigation between episodes and scenes
5. "Export Story ZIP" downloads all assets bundled.

### API contract
```
POST /api/v1/story/generate
Body: { "topic": string, "episode_count": integer (1-6) }
Response 202: { "job_id": string, "status": "queued" }

GET /api/v1/story/{story_id}
Response 200: { "story_id": string, "status": string, "episodes": [...] }

GET /api/v1/story/{story_id}/export
Response 200: ZIP binary (Content-Disposition: attachment)
```

### StoryPlan JSON schema
```json
{
  "story_id": "uuid",
  "title": "string",
  "synopsis": "string",
  "characters": [{ "name": "string", "role": "string", "description": "string" }],
  "episodes": [{
    "episode_number": 1,
    "title": "string",
    "scenes": [{
      "scene_number": 1,
      "description": "string",
      "caption": "string",
      "prompt": "string"
    }]
  }]
}
```

### Pipeline steps
1. Safety check on topic
2. Insert Job row
3. `generate_story_task.delay(...)`
4. Worker: `generate_story_plan(topic, episode_count, ...)` → Groq LLaMA 3.3 70B → StoryPlan
5. Worker: safety check on `title + synopsis`
6. Worker: for each scene → create child Job row → `generate_anime_task.delay(...)` 
7. Worker: on dispatch failure → placeholder scene, child job marked failed
8. Worker: parent job status → complete; child jobs process independently

---

## Feature 5 — Bella AI Assistant

### Visual components
- `BellaPresence` mounted in `app/layout.tsx` — persists across all routes
- Live2D avatar rendered via `pixi-live2d-display` + Cubism 4 SDK (loaded via `<Script strategy="beforeInteractive">`)
- VRM fallback via `@pixiv/three-vrm` + Three.js
- Floating panel: bottom-right corner, collapses to avatar icon, expands to chat + voice interface

### Chat behaviour
- Text input + send button
- Voice input: mic button → browser `getUserMedia` → WebM recording → `POST /bella/transcribe` → transcript pre-fills text input
- On send: `POST /api/v1/bella/chat` → reply text + audio_b64 + phonemes
- Audio played via Web Audio API; lip sync driven by amplitude envelope
- Reply rendered in chat bubble with typing animation

### API contracts
```
POST /api/v1/bella/chat
Body: { "message": string, "session_id": string }
Response: { "reply": string, "audio_b64": string|null, "phonemes": [], "tts_available": boolean }

POST /api/v1/bella/tts
Body: { "text": string }
Response: MP3 binary (audio/mpeg)

POST /api/v1/bella/transcribe
Body: multipart/form-data { "audio": blob }
Response: { "transcript": string }

GET /api/v1/bella/history?session_id={id}
Response: { "messages": [{ "role": string, "text": string, "timestamp": string }] }
```

### Session history
- In-memory dict keyed by session_id on the BellaService singleton
- Each entry: `{ role: "user"|"bella", text: string, timestamp: ISO8601 }`
- All prior turns sent as context in each Groq chat call

---

## Feature 6 — Asset Gallery

### UI
- Route: `/gallery`
- Grid of asset cards, filterable by type
- Each card shows: type badge, topic, created_at, file size, preview (image/iframe/3D icon), download button, delete button

### API contracts
```
GET /api/v1/assets
Response: AssetRecord[]

GET /api/v1/assets/{asset_id}
Response: AssetRecord (with presigned_url)

DELETE /api/v1/assets/{asset_id}
Response: 204

GET /api/v1/assets/{asset_id}/download
Response: redirect to presigned URL

GET /api/v1/assets/export/zip
Response: ZIP binary
```

### AssetRecord schema
```typescript
interface AssetRecord {
  asset_id: string
  job_id: string
  type: 'image' | 'animation' | 'simulation' | 'model3d' | 'story'
  topic: string
  file_path: string
  file_size_bytes: number
  mime_type: string
  metadata: Record<string, unknown>
  created_at: string
  expires_at: string
  session_id: string
  presigned_url: string
}
```

---

## Feature 7 — XP / Gamification

### Behaviour
- Every successful generation awards XP: image +10, animation +15, simulation +20, model3d +25, story episode +15
- XP displayed in `GameHUD` (top navigation bar)
- Level calculated from XP thresholds
- State managed by `useGameProgress` Zustand hook
- Persisted in `localStorage` under key `animeedu_progress`

---

## Feature 8 — Content Safety Filter

### Two-stage pipeline
**Stage 1 — Keyword blocklist** (synchronous, no API call)
- Checked on every `check_topic()` and `check_content()` call
- Word-boundary regex matching to avoid false positives (e.g., "racist" matches but not "bracist")
- Immediate rejection with `SafetyResult(safe=False, matched_keyword=...)`

**Stage 2 — Groq Safety Classifier**
- Model: `openai/gpt-oss-safeguard-20b`
- System prompt: classify as SAFE/UNSAFE for educational platform use
- Input wrapped with educational context to reduce false positives on academic topics
- Timeout: 5s, no retries (fail open on error)
- Response parsing: searches for "UNSAFE" substring; defaults to SAFE on empty/unrecognisable output

### Integration points
- `anime.router` → `safety.check_topic()` before enqueue
- `simulation.router` → `safety.check_topic()` before enqueue
- `model3d.router` → `safety.check_topic()` before enqueue
- `story.router` → `safety.check_topic()` before enqueue
- All Celery tasks → `safety.check_content()` after generation, before storing
