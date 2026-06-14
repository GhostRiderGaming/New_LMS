# User Flow — AnimeEdu

Complete user journeys for every feature, including happy paths, error paths, and edge cases.

---

## Global Layout (all pages)

```
[App starts]
    │
    ├─ GameHUD renders (top nav bar) — XP, level, nav links
    │
    ├─ BellaPresence mounts (floating bottom-right)
    │   ├─ Live2D Cubism SDK loaded via beforeInteractive script
    │   └─ BellaService session_id generated (UUID, stored in Zustand)
    │
    └─ Main content area renders current page
```

Every page shares:
- Navigation: Scene Forge | Lab Engine | Holodeck | Chronicle | Gallery
- Bella avatar always accessible; click to open/close chat panel
- Universe background animation (CSS animated stars/particles)

---

## Flow 1 — Anime Scene Generation (Scene Forge)

```
User visits /anime
    │
    ├─ TopicInput renders (topic text field + style dropdown + animation toggle)
    │
    ├─ User types topic, selects style, optionally toggles animation
    │
    ├─ User clicks "Generate"
    │   ├─ Frontend validates: topic not empty, topic length ≤ 500 chars
    │   ├─ POST /api/v1/anime/generate
    │   │   ├─ [Safety check FAIL] → HTTP 422 → toast "Content not allowed"
    │   │   └─ [SUCCESS] → HTTP 202 { job_id }
    │   │
    │   ├─ Button disables, JobProgressBar shows (status: "Queued...")
    │   │
    │   ├─ Polling loop: GET /api/v1/jobs/{job_id} every 2s
    │   │   OR WebSocket ws://.../jobs/{job_id}/ws
    │   │
    │   ├─ Status transitions: queued → processing → complete|failed
    │   │
    │   ├─ [complete]
    │   │   ├─ GET /api/v1/assets/{asset_id} → presigned_url
    │   │   ├─ AnimeSceneCard renders: image/GIF preview, topic, caption, style badge
    │   │   ├─ Download button links to presigned URL
    │   │   ├─ XP awarded (+10 image / +15 animation) → GameHUD updates
    │   │   └─ Asset appears in Gallery
    │   │
    │   └─ [failed]
    │       ├─ Error message shown (humanised from error_message)
    │       └─ "Try again" button re-enables form
    │
    └─ [Rate limit 429] → toast "Rate limit exceeded — wait 60s"
```

---

## Flow 2 — Simulation Generation (Lab Engine)

```
User visits /simulation
    │
    ├─ TopicInput + category dropdown (Physics/Chemistry/Biology/Math/History)
    │
    ├─ User clicks "Generate Simulation"
    │   ├─ POST /api/v1/simulation/generate
    │   ├─ JobProgressBar shown (90s client timeout)
    │   │
    │   ├─ [complete]
    │   │   ├─ GET asset → presigned URL for HTML file
    │   │   ├─ SimulationFrame renders <iframe sandbox="allow-scripts" src={url}>
    │   │   │   ├─ Canvas animation plays automatically
    │   │   │   ├─ Control panel sliders/buttons interact in real time
    │   │   │   └─ LEARN box explains the concept
    │   │   ├─ "Open Fullscreen" → window.open(presigned_url, '_blank')
    │   │   ├─ "Download HTML" → direct download
    │   │   └─ XP +20
    │   │
    │   └─ [failed / LLM timeout]
    │       ├─ Fallback simulation is always substituted by worker
    │       ├─ User sees working simulation (particle fallback) even on LLM failure
    │       └─ job.metadata.fallback = true (visible to devs, not users)
    │
    └─ LLM generation takes up to 60s — progress bar keeps animating
```

---

## Flow 3 — 3D Model Generation (Holodeck)

```
User visits /model3d
    │
    ├─ ObjectInput (text) + category dropdown
    │
    ├─ User clicks "Generate 3D Model"
    │   ├─ POST /api/v1/model3d/generate
    │   ├─ JobProgressBar shown (120s client timeout)
    │   │
    │   ├─ [complete]
    │   │   ├─ ModelViewer3D renders Three.js canvas
    │   │   │   ├─ GLB loaded via useGLTF(presigned_url)
    │   │   │   ├─ OrbitControls: drag to rotate, scroll to zoom
    │   │   │   ├─ Auto-rotate enabled by default
    │   │   │   └─ Studio environment lighting
    │   │   ├─ "Download GLB" button
    │   │   └─ XP +25
    │   │
    │   └─ [failed after 3 retries]
    │       ├─ Suggestions list shown: "Try: DNA helix, water molecule, ..."
    │       └─ User can retry with different object
    │
    └─ Tripo AI may take 60–120s for complex objects
```

---

## Flow 4 — Anime Story Generation (Chronicle)

```
User visits /story
    │
    ├─ TopicInput + episode count selector (1–6)
    │
    ├─ User clicks "Generate Story"
    │   ├─ POST /api/v1/story/generate
    │   ├─ JobProgressBar shown
    │   │
    │   ├─ [story plan complete]
    │   │   ├─ StoryPlayer renders immediately with plan
    │   │   │   ├─ Title + Synopsis displayed
    │   │   │   ├─ Characters panel (name, role, description)
    │   │   │   ├─ Episode list in sidebar
    │   │   │   └─ Scene viewer: description, caption, image (loading initially)
    │   │   │
    │   │   ├─ Per-scene anime jobs dispatch concurrently
    │   │   │   ├─ Each scene polls for its own job completion
    │   │   │   ├─ Images appear progressively as scenes complete
    │   │   │   └─ Failed scenes show placeholder image (non-blocking)
    │   │   │
    │   │   ├─ Navigation: prev/next scene, prev/next episode
    │   │   ├─ "Export ZIP" → GET /api/v1/story/{story_id}/export
    │   │   └─ XP +15 per episode
    │   │
    │   └─ [failed] → error toast; topic may be too complex or rate-limited
    │
    └─ Full story with 3 episodes × 3 scenes = 9 parallel anime generation jobs
```

---

## Flow 5 — Bella Chat Assistant

```
[User on any page]
    │
    ├─ Bella avatar visible (bottom-right floating button)
    │
    ├─ User clicks avatar → chat panel expands
    │   ├─ Previous conversation messages shown
    │   └─ Text input + mic button
    │
    ├─ TEXT CHAT
    │   ├─ User types message → clicks Send (or Enter)
    │   ├─ POST /api/v1/bella/chat { message, session_id }
    │   ├─ Bella avatar enters "thinking" animation state
    │   ├─ Reply received → renders in chat bubble
    │   ├─ TTS audio plays (if available) → lip sync animation
    │   └─ History appended; context grows per session
    │
    ├─ VOICE INPUT
    │   ├─ User clicks mic → browser requests mic permission
    │   ├─ Recording starts (max 30s) → visual waveform indicator
    │   ├─ User clicks stop → WebM blob sent to POST /bella/transcribe
    │   ├─ Transcript appears in text input field
    │   └─ User can edit then send, or send immediately
    │
    ├─ [No GROQ_API_KEY]
    │   ├─ Offline pattern-matched responses used
    │   └─ Response includes prompt to add API key
    │
    ├─ [TTS unavailable]
    │   ├─ Text reply shown normally
    │   └─ No audio — silent lip sync animation or idle pose
    │
    └─ User closes panel → avatar returns to idle animation
```

---

## Flow 6 — Asset Gallery

```
User visits /gallery
    │
    ├─ GET /api/v1/assets → full list rendered as cards
    │
    ├─ Filter bar: All | Images | Animations | Simulations | 3D Models | Stories
    │   └─ Filtering is client-side on fetched data
    │
    ├─ Each card:
    │   ├─ Image/GIF: thumbnail preview
    │   ├─ Simulation: iframe mini-preview or HTML icon
    │   ├─ 3D Model: Three.js mini-viewer or GLB icon
    │   └─ Story: book icon + episode count
    │
    ├─ "Download" → window.open(presigned_url)
    │
    ├─ "Delete" → DELETE /api/v1/assets/{asset_id}
    │   ├─ Confirmation modal shown
    │   └─ Card removed from list on success
    │
    └─ "Export All as ZIP" → window.open(exportAllZip URL)
```

---

## Error Handling Summary

| Error | User sees |
|-------|-----------|
| Safety violation (422) | "Your request was rejected due to content safety policy." |
| Rate limit (429) | "Rate limit exceeded. Please wait a moment and try again." |
| Server error (500) | "The server encountered an error. Please try again in a moment." |
| Network timeout | "Request timed out. The server may be busy — please try again." |
| Job failed | Error message from job.error_message, humanised |
| Storage quota exceeded | "Storage quota exceeded. Please delete some assets before generating more." |
| LLM unavailable | Fallback simulation used; user sees working content |
| Tripo AI failure | "3D generation failed. Suggestions: ..." |

---

## Session Lifecycle

```
Browser first visit
    │
    ├─ Zustand initialises: generates session_id (UUID), stores in localStorage
    │
    ├─ All API calls include session_id in request body
    │
    ├─ Assets tagged with session_id — Gallery filters to current session
    │
    ├─ Bella history keyed by session_id in memory on backend
    │
    └─ Session persists across page refreshes (localStorage) but not browser clear
```
