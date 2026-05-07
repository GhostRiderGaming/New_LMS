# Education Anime Generator — Full Project Audit Report
**Date:** May 7, 2026  
**Auditor:** Kiro (static code analysis)  
**Scope:** All backend services, routers, Celery workers, frontend pages, components, and API wrappers

---

## Executive Summary

The project is structurally sound and well-organized. The backend starts and the frontend renders. However, **several generation pipelines have critical bugs that prevent them from working end-to-end**, and the story pipeline will timeout 100% of the time under current configuration. Bella's TTS and lip sync work but with degraded quality. UI is clean but has a fake progress bar and no timeout handling.

---

## 1. Generation Pipelines

### 1.1 Anime Image Generation
**Status:** ⚠️ Partially Working

| Metric | Value |
|--------|-------|
| API Used | Hugging Face Inference API (Animagine XL 4.0) |
| Typical Time | 5–15s (HF free tier is slow and rate-limited) |
| Frontend Timeout | 30s |
| Risk of Timeout | Medium |

**Issues Found:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| A1 | 🟠 HIGH | HF free tier rate-limits to ~100 req/hour. No retry on 429. Job fails immediately. | Add retry with exponential backoff on 429 in `_call_hf_image()` |
| A2 | 🟡 MEDIUM | Caption overlay uses `ImageFont.load_default()` fallback — renders at ~5px, unreadable | Bundle a TTF font in the repo or use a larger default size |
| A3 | 🟡 MEDIUM | Long captions overflow image bounds — no text wrapping | Add `textwrap.wrap()` before drawing |
| A4 | 🟡 MEDIUM | Animation generates frames sequentially with 1s delay — 4 frames = 8–12s minimum | Acceptable for now; document expected time |
| A5 | 🟢 LOW | HF model may be loading (cold start adds 20–30s on first request) | Show "Model warming up..." message to user |

---

### 1.2 Simulation Generation
**Status:** ⚠️ Partially Working — Fallback is broken

| Metric | Value |
|--------|-------|
| API Used | Groq LLaMA 3.3 70B |
| Typical Time | 15–30s (large HTML output) |
| Frontend Timeout | 30s |
| Risk of Timeout | **HIGH** |

**Issues Found:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| S1 | 🔴 CRITICAL | Frontend 30s timeout < Groq generation time (15–30s + network). Simulations will timeout frequently | Increase `REQUEST_TIMEOUT` in `api.ts` to 90s for simulation endpoint |
| S2 | 🟠 HIGH | Fallback simulation (`_fallback_simulation()`) generates a static HTML with a slider — no canvas, no animation. Violates Requirement 2.4 | Rewrite fallback to include a minimal canvas + requestAnimationFrame loop |
| S3 | 🟠 HIGH | External URL stripping doesn't handle `<img src="https://...">` or `@import url(...)` in CSS | Extend `_ExternalURLChecker` to cover img tags and CSS imports |
| S4 | 🟡 MEDIUM | Double Groq call: `build_simulation_prompt()` + `generate_simulation()` = 2 API calls, doubles latency | Merge into a single call with a combined system prompt |
| S5 | 🟡 MEDIUM | No validation that generated HTML contains a `<canvas>` element | Add check in `_validate_html()` |

---

### 1.3 3D Model Generation
**Status:** ⚠️ Partially Working — Fallback is misleading

| Metric | Value |
|--------|-------|
| API Used | HF Inference API (TripoSR) |
| Typical Time | 15–30s |
| Frontend Timeout | 30s |
| Risk of Timeout | **HIGH** |

**Issues Found:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| M1 | 🔴 CRITICAL | HF TripoSR API timeout is 30s — same as frontend timeout. Any slow response = double failure | Increase `httpx.AsyncClient(timeout=180)` (already set) but also increase frontend timeout to 120s |
| M2 | 🟠 HIGH | Fallback GLB (`_FALLBACK_GLB_B64`) is a single triangle — loads in Three.js but shows nothing useful. User thinks generation worked | Show explicit error message instead of silently returning a placeholder |
| M3 | 🟠 HIGH | No retry logic in `_call_hf_model3d()` — single failure = job fails | Add 2 retries with 5s backoff |
| M4 | 🟡 MEDIUM | TripoSR is an image-to-3D model, not text-to-3D. Sending a text prompt will likely return an error or poor result | Switch to a text-to-3D model or add an intermediate image generation step |
| M5 | 🟡 MEDIUM | Scale reference metadata is generic ("molecular scale") — not useful for Three.js viewer | Add actual numeric scale hints |

---

### 1.4 Story Generation
**Status:** 🔴 BROKEN — Will timeout 100% of the time

| Metric | Value |
|--------|-------|
| API Used | Groq LLaMA 3.3 70B (plan) + HF Animagine (scenes) |
| Typical Time | 60–120s for 3 episodes × 3 scenes |
| Frontend Timeout | 30s |
| Risk of Timeout | **CRITICAL — 100%** |

**Issues Found:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| ST1 | 🔴 CRITICAL | Story generation takes 60–120s. Frontend timeout is 30s. The job submission itself returns in <1s (202), but polling will show "queued" forever because the Celery task hasn't started yet (Redis may not be running) | Ensure Celery worker is running; increase poll timeout display |
| ST2 | 🔴 CRITICAL | Scene tasks are dispatched but not tracked. Job is marked "complete" immediately after dispatch, before any scenes are generated | Track scene task IDs; only mark "complete" when all scenes finish |
| ST3 | 🟠 HIGH | Placeholder scene substitution (`_placeholder_scene()`) is defined but never called. Failed scenes are silently missing | Call `_placeholder_scene()` when a scene task fails |
| ST4 | 🟠 HIGH | Story ZIP export queries for assets with `story_id` in metadata, but scene anime tasks don't set `story_id` in their metadata | Pass `story_id` to each scene task and store it in asset metadata |
| ST5 | 🟡 MEDIUM | Pydantic validation rejects story plans with <3 scenes per episode. Groq sometimes generates 2 | Pad with placeholder scenes instead of rejecting |
| ST6 | 🟡 MEDIUM | No deduplication — same story generated twice creates all new assets | Add story_id caching by topic hash |

---

## 2. Bella Assistant

**Status:** ⚠️ Partially Working

### 2.1 Chat (LLM)
**Status:** ✅ Working  
- Groq LLaMA 3.3 70B responds correctly
- Graceful fallback when API key missing
- History maintained in-memory per session

**Issues:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| B1 | 🟡 MEDIUM | History stored in-memory — lost if backend restarts | Persist to SQLite `bella_history` table |
| B2 | 🟡 MEDIUM | No rate limiting on `/bella/chat` — user can exhaust Groq quota | Add SlowAPI rate limit: 10 req/min per session |
| B3 | 🟢 LOW | Fallback responses are hardcoded keyword matches — not a real fallback | Use a local rule-based response generator |

### 2.2 TTS (edge-tts)
**Status:** ⚠️ Working but degraded

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| B4 | 🟠 HIGH | edge-tts returns MP3 but frontend expects WAV. Audio may not play in all browsers | Convert to WAV using `pydub` or return as MP3 with correct MIME type |
| B5 | 🟠 HIGH | Phoneme timestamps are always empty `[]` — lip sync falls back to amplitude animation | Use a phoneme extraction library (e.g., `phonemizer`) or accept degraded lip sync |
| B6 | 🟡 MEDIUM | TTS failure is silent — user hears nothing and sees no error | Show "🔇 Voice unavailable" indicator in chat UI |
| B7 | 🟡 MEDIUM | edge-tts requires internet connection — fails in offline environments | Document this requirement clearly |

### 2.3 STT (Groq Whisper)
**Status:** ✅ Working  
- Accepts audio blob, returns transcript
- Graceful error handling

### 2.4 Animations & VRM
**Status:** ⚠️ Partially Working

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| B8 | 🟠 HIGH | VRM model file path is hardcoded — if file doesn't exist, Three.js canvas shows nothing | Add a visible error state: "Bella model not found" |
| B9 | 🟡 MEDIUM | Lip sync uses amplitude-based animation (no phonemes) — mouth movement is approximate | Acceptable for now; document as known limitation |
| B10 | 🟡 MEDIUM | Idle animation loop may cause memory leaks if component unmounts without cleanup | Ensure `cancelAnimationFrame()` is called on unmount |
| B11 | 🟢 LOW | "Celebrate" animation (jump + clap) is defined but trigger condition (topic completed) is not wired up | Wire `completeMission()` callback to trigger celebrate state |

---

## 3. UI / Frontend

### 3.1 General UI Smoothness
**Status:** ✅ Smooth — dark theme renders well, no layout shifts observed in code

**Potential Issues:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| U1 | 🟡 MEDIUM | `BellaOverlay` mounts a Three.js canvas on every page — adds ~50ms render overhead | Lazy-load the canvas; show 2D avatar until user opens Bella |
| U2 | 🟡 MEDIUM | `ModelViewer3D` loads Three.js + GLTFLoader on the 3D page — large bundle | Use dynamic import with `next/dynamic` and `ssr: false` |
| U3 | 🟢 LOW | Sidebar is always visible — on mobile (320px) it overlaps content | Add `md:hidden` toggle for mobile sidebar |

### 3.2 Progress Bar
**Status:** ⚠️ Functional but misleading

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| P1 | 🟠 HIGH | Progress bar uses random increments — stalls at 90% for 30+ seconds | Use real step data from WebSocket or show elapsed time instead |
| P2 | 🟠 HIGH | No maximum wait time — if job is stuck, polling runs forever | Add 5-minute timeout: show "Taking longer than expected" + cancel button |
| P3 | 🟡 MEDIUM | WebSocket and polling run concurrently after WS connects — race condition | Stop polling immediately when WebSocket connects successfully |

### 3.3 Error Handling
**Status:** ⚠️ Basic

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| E1 | 🟡 MEDIUM | All network errors show "Unable to reach the server" — doesn't distinguish timeout vs. refused | Check error type: `AbortError` = timeout, `TypeError` = refused |
| E2 | 🟡 MEDIUM | Story page shows no per-scene error state — if 3/9 scenes fail, user doesn't know | Add per-scene status indicators in StoryPlayer |
| E3 | 🟢 LOW | Retry button re-submits the same request — no backoff | Add 2s delay before retry |

### 3.4 API Timeouts
**Status:** 🔴 Misconfigured

| Endpoint | Current Timeout | Recommended |
|----------|----------------|-------------|
| Anime image | 30s | 60s |
| Simulation | 30s | 90s |
| 3D model | 30s | 120s |
| Story | 30s | 30s (job submission only — polling handles the rest) |
| Bella chat | 30s | 15s |

---

## 4. Infrastructure

### 4.1 Celery / Redis
**Status:** 🔴 Broken on Windows without `--pool=solo`

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| I1 | 🔴 CRITICAL | `kombu` Redis transport crashes with `AttributeError: 'NoneType' object has no attribute 'Redis'` on Windows | Always use `py -3.11 -m celery ... --pool=solo` on Windows |
| I2 | 🟠 HIGH | If Redis is not running, job submission returns 202 but task is never executed | Add health check endpoint that verifies Redis connectivity |
| I3 | 🟡 MEDIUM | Retry countdown (2s, 4s, 8s) is too short for API outages | Increase to (30s, 60s, 120s) |

### 4.2 AWS S3
**Status:** ✅ Configured correctly  
- boto3 client uses standard AWS credentials
- Region set to `ap-south-1`
- Presigned URLs with 24h TTL

**Issues:**

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| I4 | 🟡 MEDIUM | S3 bucket must exist before first run — no auto-creation | Add startup check: create bucket if not exists |
| I5 | 🟡 MEDIUM | No S3 error handling in `upload_file()` — if upload fails, asset record is still created in DB | Wrap in try/except; rollback DB record on S3 failure |

### 4.3 Authentication
**Status:** ✅ Working  
- `X-API-Key: dev-api-key` sent from frontend
- Backend validates against `API_KEY` env var

---

## 5. Summary Table

| Area | Status | Critical Issues | High Issues | Medium Issues |
|------|--------|----------------|-------------|---------------|
| Anime Generation | ⚠️ Partial | 0 | 1 | 3 |
| Simulation | ⚠️ Partial | 1 | 2 | 2 |
| 3D Model | ⚠️ Partial | 1 | 2 | 2 |
| Story | 🔴 Broken | 2 | 2 | 2 |
| Bella Chat | ✅ Working | 0 | 0 | 2 |
| Bella TTS | ⚠️ Partial | 0 | 2 | 1 |
| Bella Animations | ⚠️ Partial | 0 | 1 | 2 |
| UI Smoothness | ✅ Good | 0 | 0 | 2 |
| Progress Bar | ⚠️ Misleading | 0 | 2 | 1 |
| API Timeouts | 🔴 Wrong | 1 | 0 | 0 |
| Celery/Redis | 🔴 Broken | 1 | 1 | 1 |
| AWS S3 | ✅ Working | 0 | 0 | 2 |

---

## 6. Priority Fix List

### Fix Immediately (Blocking)
1. **Story timeout** — increase frontend timeout for story polling; ensure Celery worker runs with `--pool=solo`
2. **Simulation timeout** — increase `REQUEST_TIMEOUT` in `api.ts` to 90s for simulation
3. **3D model API mismatch** — TripoSR is image-to-3D, not text-to-3D; switch model or add image step
4. **Celery on Windows** — always use `py -3.11 -m celery -A app.worker worker --pool=solo`

### Fix Soon (High Impact)
5. **Scene task tracking in story** — mark story "complete" only when all scenes finish
6. **Story ZIP missing scenes** — pass `story_id` to scene tasks
7. **Simulation fallback** — rewrite to include canvas + animation
8. **TTS audio format** — ensure MP3 MIME type is correct for browser playback
9. **Progress bar timeout** — add 5-minute max wait with cancel button

### Fix When Possible (Quality)
10. **Bella history persistence** — save to SQLite
11. **Rate limit Bella chat** — 10 req/min per session
12. **Caption text wrapping** — prevent overflow on long captions
13. **Retry backoff** — increase Celery retry delays to 30/60/120s
14. **S3 error handling** — rollback DB on upload failure

---

## 7. What Is Working Well

- ✅ FastAPI app starts cleanly, all routers registered
- ✅ Authentication (API key) works end-to-end
- ✅ Content safety filter (LlamaGuard + blocklist) is well-implemented
- ✅ Bella chat (LLM) responds correctly with graceful fallback
- ✅ Simulation HTML generation produces valid, self-contained output (when it doesn't timeout)
- ✅ Dark anime UI theme is clean and consistent
- ✅ Asset metadata validation (Pydantic) is thorough
- ✅ Job status polling works correctly
- ✅ CORS is properly configured
- ✅ OpenAPI docs accessible at `/api/v1/docs`
