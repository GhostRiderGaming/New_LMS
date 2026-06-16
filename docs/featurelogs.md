# Feature Logs — AnimeEdu

Chronological record of all features, fixes, and technical decisions. Most recent entries first.

---

## v1.1.0 — UX & Reliability Fixes (Current)

### [FIXED] Progress bar now fills smoothly from the start
- **Change:** Tick interval reduced from 2000ms → 800ms; fast start added (4–12% per tick for first 15%); progress now animates from `queued` state too
- **Why:** Bar was stuck at 5% during queued state and incremented too slowly during processing
- **File:** `frontend/components/shared/JobProgressBar.tsx`
- **Status:** ✅ Fixed

### [FIXED] Result not showing after 100% progress
- **Root cause:** `onComplete` was fired via a `useEffect` that tracked `status`. The parent hid the progress bar when `jobStatus === 'complete'`, causing the bar to unmount before the effect fired. The callback ran in a stale closure.
- **Fix:** `onComplete` now fires directly from the polling loop when `job.status === 'complete'` is detected. A `useRef` keeps the callback reference fresh.
- **File:** `frontend/components/shared/JobProgressBar.tsx`
- **Status:** ✅ Fixed

### [FIXED] "Connection error" shown after generation completes
- **Root cause:** `api.getAsset()` was called immediately after job completion, while the backend was still briefly busy (writing to DB/S3). One failure → immediately showed ErrorCard.
- **Fix:** All 4 generation pages (anime, simulation, model3d, story) now retry `api.getAsset()` up to 5 times with 2-second delays. Progress bar stays visible until asset is fully loaded.
- **Files:** `frontend/app/anime/page.tsx`, `frontend/app/simulation/page.tsx`, `frontend/app/model3d/page.tsx`, `frontend/app/story/page.tsx`
- **Status:** ✅ Fixed

### [FIXED] Model3D page used its own polling instead of JobProgressBar
- **Change:** Rewrote `model3d/page.tsx` to use `JobProgressBar`'s `onComplete` callback pattern (same as anime/simulation/story pages)
- **Why:** The page had a manual `startPolling` interval that lacked retry logic, connection resilience, and the WebSocket upgrade path
- **File:** `frontend/app/model3d/page.tsx`
- **Status:** ✅ Fixed

### [ADDED] Progress bar stays visible while loading result
- **Change:** Added `resultLoading` state to all 4 generation pages. Progress bar condition changed from `jobStatus !== 'complete'` to `jobStatus !== 'complete' || resultLoading`
- **Why:** Bar disappeared at 100% while asset was being fetched, leaving users with a blank screen
- **Files:** `frontend/app/anime/page.tsx`, `frontend/app/simulation/page.tsx`, `frontend/app/model3d/page.tsx`, `frontend/app/story/page.tsx`
- **Status:** ✅ Active

### [ADDED] One-command launcher (`start.ps1`)
- **Feature:** Single PowerShell script at project root that starts Redis, backend, Celery worker, and frontend in sequence; opens browser automatically
- **Usage:** `cd C:\CatchupX\New_LMS; ./start`
- **Files:** `start.ps1`, `stop.ps1`
- **Status:** ✅ Active

### [FIXED] LlamaGuard safety model decommissioned (second time)
- **Change:** `meta-llama/llama-guard-4-12b` → `openai/gpt-oss-safeguard-20b`
- **Why:** Groq decommissioned `llama-guard-4-12b`. This caused every job submission to block for ~110 seconds.
- **File:** `backend/app/services/safety.py`
- **Status:** ✅ Fixed

### [FIXED] Safety blocklist false positives on educational topics
- **Change:** Removed overly broad keywords: `bomb`, `kill`, `murder`, `suicide`, `torture`, `gore`, `massacre`, `genocide`, `terrorism`, `explosive`, `cocaine`, `heroin`, `meth`, `nazi`
- **Why:** Legitimate educational topics like "World War II", "nuclear physics", "chemical reactions" were being blocked
- **Kept:** Only specific harmful instruction phrases remain blocked
- **File:** `backend/app/services/safety.py`
- **Status:** ✅ Fixed

### [FIXED] Bella TTS uses streaming (reliable cross-platform)
- **Change:** Reverted from `communicate.save(tmp_path)` back to `async for chunk in communicate.stream()`
- **Why:** The `.save()` approach was silently returning empty bytes on Windows
- **File:** `backend/app/services/bella_service.py`
- **Status:** ✅ Fixed

### [FIXED] Anime image 500 errors from Pollinations.ai
- **Change:** Added 500-specific retry logic; two URL format fallbacks; increased timeout 60s → 90s
- **Why:** Pollinations.ai returns intermittent 500s that should be retried, not immediately raised
- **File:** `backend/app/services/anime_generator.py`
- **Status:** ✅ Fixed

### [FIXED] Job submission taking ~110 seconds
- **Root cause:** Safety classifier was calling a decommissioned Groq model that took 110s to timeout before failing open
- **Fix:** Updated to `openai/gpt-oss-safeguard-20b` + timeout reduced to 5s + no retries
- **File:** `backend/app/services/safety.py`
- **Status:** ✅ Fixed

### [FIXED] S3 CORS blocking simulation HTML fetch
- **Change:** Simulation HTML is now fetched via `GET /api/v1/assets/{id}/download` (backend proxy) instead of directly from S3 presigned URL
- **Why:** Browsers block cross-origin fetch from S3 presigned URLs by default
- **File:** `frontend/app/simulation/page.tsx`
- **Status:** ✅ Fixed

### [FIXED] Asset 404 due to session mismatch
- **Change:** `GET /assets/{id}` and `GET /assets/{id}/download` endpoints no longer filter by session_id
- **Why:** Assets created by Celery worker had a different session_id than the one derived from the frontend's API key
- **File:** `backend/app/routers/assets.py`
- **Status:** ✅ Fixed

### [FIXED] Polling falsely marking jobs as failed
- **Change:** Removed `setStatus('failed')` from catch block in polling loop. Connection errors now only increment `retryCount`; only the backend can mark a job failed.
- **Why:** Backend was busy processing (Groq/Pollinations calls) during polling, causing connection timeouts that incorrectly showed as failures
- **File:** `frontend/components/shared/JobProgressBar.tsx`
- **Status:** ✅ Fixed

---

## v1.0.0 — Initial Development

### [FIXED] Safety classifier updated to gpt-oss-safeguard-20b (first time)
- **Change:** `llama-guard-3-8b` → `meta-llama/llama-guard-4-12b` (then later to `openai/gpt-oss-safeguard-20b`)
- **File:** `backend/app/services/safety.py`

### [ACTIVE] 3D model generation switched to Tripo AI
- **Change:** Replaced HF Inference API (TripoSR, Shap-E) with Tripo AI text-to-3D API
- **File:** `backend/app/services/model3d_engine.py`

### [ACTIVE] Animation generation switched from ffmpeg to Pillow GIF
- **Change:** Replaced ffmpeg WebM with Pillow GIF (4 frames, 300ms, infinite loop)
- **File:** `backend/app/services/anime_generator.py`

### [ACTIVE] Pollinations.ai as primary image source
- **Change:** Tokenless Pollinations.ai as primary; HF Animagine XL as fallback
- **File:** `backend/app/services/anime_generator.py`

### [ACTIVE] Simulation fallback with proper canvas
- **Change:** Fallback simulation uses real canvas + requestAnimationFrame + two sliders
- **File:** `backend/app/services/simulation_engine.py`

### [ACTIVE] Celery fast-fail broker timeout
- **Change:** `socket_connect_timeout=3, socket_timeout=3` — fast fail when Redis down
- **File:** `backend/app/worker.py`

### [ACTIVE] Global CORS exception handler for 500 errors
- **File:** `backend/app/main.py`

### [ACTIVE] BellaPresence in root layout
- **File:** `frontend/app/layout.tsx`

### [ACTIVE] Per-endpoint client-side timeouts
- simulation: 90s, model3d: 120s, bella: 15s, default: 30s
- **File:** `frontend/lib/api.ts`

### [ACTIVE] Bella offline pattern-matched fallback
- **File:** `backend/app/services/bella_service.py`

### [ACTIVE] Live2D vendor chunk stabilisation
- **File:** `frontend/next.config.js`

### [ACTIVE] Educational context wrapping in safety prompts
- **File:** `backend/app/services/safety.py`

### [ACTIVE] XP gamification system
- **Files:** `frontend/lib/useGameProgress.ts`, `frontend/components/layout/GameHUD.tsx`

---

## Known Issues / Backlog

### ISSUE: WebSocket support on some deployment platforms
- **Workaround:** Frontend falls back to 3s polling on WebSocket error
- **Status:** 🔄 Workaround in place

### ISSUE: Simulation LLM sometimes truncates HTML
- **Workaround:** `_validate_html` detects invalid HTML → fallback simulation used
- **Status:** 🔄 Workaround in place

### ISSUE: Pollinations.ai rate limit spikes during peak hours
- **Workaround:** 5-retry exponential backoff; two URL variants
- **Status:** 🔄 Monitoring

### ISSUE: Bella Live2D requires CDN-loaded Cubism SDK
- **Workaround:** None — CDN must be reachable
- **Status:** 📋 Backlog — bundle SDK locally

### ISSUE: SQLite not suitable for concurrent Celery workers
- **Fix plan:** Migrate to PostgreSQL before scaling
- **Status:** 📋 Planned for production

### ISSUE: 3D viewer GLB CORS on some S3 configs
- **Fix:** Add S3 CORS policy allowing GET from frontend origin
- **Status:** 📋 Deployment checklist item


### [CURRENT] 3D model generation switched to Tripo AI
- **Change:** Replaced HF Inference API (Hunyuan3D/TripoSR) with Tripo AI text-to-3D API
- **Why:** HF Inference API free tier is too slow and unreliable for 3D generation; Tripo AI provides higher-quality GLB output with a reliable polling API
- **File:** `backend/app/services/model3d_engine.py`
- **Status:** ✅ Active

### [CURRENT] Animation generation switched from ffmpeg to Pillow GIF
- **Change:** Replaced ffmpeg WebM assembly with Pillow GIF creation
- **Why:** ffmpeg dependency is complex to install on all platforms and CI; Pillow is already a dependency and produces adequate GIF output for educational use
- **Implementation:** `PIL.Image.save(format="GIF", save_all=True, append_images=frames, duration=300, loop=0)`
- **File:** `backend/app/services/anime_generator.py`
- **Status:** ✅ Active

### [CURRENT] Pollinations.ai as primary image source (tokenless)
- **Change:** Made Pollinations.ai the primary image generation path instead of HF Animagine XL
- **Why:** Pollinations.ai is free with no API key required, reducing barrier to entry. HF Animagine XL available as fallback.
- **Implementation:** Two URL variants as failover; seed randomisation; 5-retry exponential backoff; minimum response size check (< 1000 bytes = error page)
- **File:** `backend/app/services/anime_generator.py`
- **Status:** ✅ Active

### [CURRENT] Simulation fallback always returns valid HTML
- **Change:** `_fallback_simulation()` now generates a full particle animation with canvas + requestAnimationFrame + two sliders
- **Why:** Previously the fallback was a bare HTML page with no animation. Requirement 2.4 mandates canvas + requestAnimationFrame in all simulations, including fallbacks.
- **File:** `backend/app/services/simulation_engine.py`
- **Status:** ✅ Active

### [CURRENT] edge-tts streaming implementation
- **Change:** Replaced direct byte assembly with `communicate.stream()` async iteration
- **Why:** Previous approach caused silent failures on some platforms. Streaming is more reliable cross-platform.
- **File:** `backend/app/services/bella_service.py`
- **Status:** ✅ Active

### [CURRENT] Whisper model pinned to whisper-large-v3-turbo
- **Change:** Changed from `whisper-large-v3` to `whisper-large-v3-turbo` for STT
- **Why:** `whisper-large-v3-turbo` is faster (lower latency for Bella voice input) with comparable accuracy for conversational speech
- **Note:** Fixed filename `"audio.webm"` passed to Groq to prevent 500 errors from filename detection issues
- **File:** `backend/app/services/bella_service.py`
- **Status:** ✅ Active

### [CURRENT] Safety classifier fail-open on API error
- **Change:** Safety classifier API errors now result in `SafetyResult(safe=True)` with a warning log
- **Why:** Failing closed (blocking) on classifier API outage would prevent all generation. The keyword blocklist is the hard safety gate; the classifier is supplemental.
- **File:** `backend/app/services/safety.py`
- **Status:** ✅ Active

### [CURRENT] Celery fast-fail broker timeout
- **Change:** `socket_connect_timeout=1`, `socket_timeout=1` on broker transport
- **Why:** Default Celery timeouts cause the generation endpoint to block for 30+ seconds when Redis is down. With 1s timeout, the in-process fallback kicks in quickly.
- **File:** `backend/app/worker.py`
- **Status:** ✅ Active

### [CURRENT] Global CORS exception handler
- **Change:** Added global `@app.exception_handler(Exception)` that returns JSON with CORS headers
- **Why:** Unhandled 500 errors in FastAPI bypass the CORS middleware, causing browser fetch to fail with a CORS error instead of showing the actual error message
- **File:** `backend/app/main.py`
- **Status:** ✅ Active

### [CURRENT] BellaPresence mounted in root layout
- **Change:** `BellaPresence` component mounted in `app/layout.tsx` rather than individual pages
- **Why:** Allows Bella to persist across page navigations without re-initialisation. Conversation history and avatar state are preserved.
- **File:** `frontend/app/layout.tsx`
- **Status:** ✅ Active

### [CURRENT] Live2D vendor chunk stabilisation
- **Change:** Added `splitChunks.cacheGroups.live2d` to webpack config to give pixi-live2d-display a stable chunk name
- **Why:** Live2D module was causing hot reload failures due to inconsistent chunk naming
- **File:** `frontend/next.config.js`
- **Status:** ✅ Active

### [CURRENT] Per-endpoint client-side timeouts
- **Change:** Added `AbortController`-based timeouts per endpoint in `lib/api.ts`
- **Why:** Default browser fetch has no timeout. Generation calls (especially simulation: 90s, model3d: 120s) need endpoint-specific timeouts to give users a clear timeout message.
- **File:** `frontend/lib/api.ts`
- **Status:** ✅ Active

### [CURRENT] Bella offline fallback responses
- **Change:** `_local_fallback()` method returns pattern-matched educational responses when GROQ_API_KEY is absent
- **Why:** Without a Groq API key, all Bella calls would silently fail. Offline fallback makes the platform usable immediately after cloning, before API keys are configured.
- **File:** `backend/app/services/bella_service.py`
- **Status:** ✅ Active

### [CURRENT] Story scene image dispatch with placeholder fallback
- **Change:** If `generate_anime_task.delay()` fails for a scene, scene job is marked failed and a placeholder is substituted
- **Why:** Requirement 4.5 — a failed scene image should not fail the entire story. StoryPlayer should render with partial images.
- **File:** `backend/app/worker.py::generate_story_task`
- **Status:** ✅ Active

### [CURRENT] Post-generation safety check on all Celery tasks
- **Change:** Every generation task calls `safety.check_content()` after generating, before storing
- **Why:** The prompt builder may produce content that passes topic-level safety but generates unsafe visual content. Post-generation check catches this.
- **Files:** `backend/app/worker.py` (all task functions)
- **Status:** ✅ Active

### [CURRENT] XP gamification system
- **Feature:** `useGameProgress` Zustand hook tracks XP earned per generation
- **Implementation:** XP stored in localStorage via Zustand persist middleware; `GameHUD` displays current XP and level
- **File:** `frontend/lib/useGameProgress.ts`, `frontend/components/layout/GameHUD.tsx`
- **Status:** ✅ Active

### [CURRENT] Educational context wrapping in safety prompts
- **Change:** User-submitted topics wrapped with "This is a topic submitted by a student on an educational learning platform" before sending to safety classifier
- **Why:** Topics like "The French Revolution" were being incorrectly flagged as unsafe due to mentions of violence. Educational context significantly reduces false positives.
- **File:** `backend/app/services/safety.py::_classify`
- **Status:** ✅ Active

---

## Known Issues / Backlog

### ISSUE: WebSocket support on some deployment platforms
- **Problem:** Railway and Render may have WebSocket timeouts or proxy issues
- **Workaround:** Frontend falls back to 2s polling on WebSocket error
- **Status:** 🔄 Workaround in place; proper fix pending deployment testing

### ISSUE: Simulation LLM sometimes truncates HTML
- **Problem:** Complex simulations sometimes exceed LLaMA 3.3 70B's context window mid-generation, producing truncated HTML
- **Workaround:** `_validate_html` detects invalid HTML; fallback simulation used
- **Status:** 🔄 Workaround in place; investigating prompt optimisation to produce shorter initial HTML

### ISSUE: Pollinations.ai rate limit spikes during peak hours
- **Problem:** During peak usage, Pollinations.ai returns 429 or 500 responses more frequently, requiring more retries
- **Workaround:** 5-retry exponential backoff; HF Animagine XL available as secondary path
- **Status:** 🔄 Monitoring

### ISSUE: Bella Live2D requires internet-loaded Cubism SDK
- **Problem:** `https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js` is loaded from Live2D's CDN. If unavailable, Live2D rendering fails.
- **Workaround:** Bundle Cubism SDK locally as a fallback
- **Status:** 📋 Backlog

### ISSUE: Hypothesis tests are slow in CI (~40s)
- **Problem:** 100 examples × multiple async tests = slow CI run
- **Fix plan:** Use `@settings(max_examples=20)` in dev profile, keep 100 for CI
- **Status:** 📋 Backlog

### ISSUE: SQLite not suitable for concurrent Celery workers
- **Problem:** Multiple Celery workers + SQLite = write contention and potential corruption
- **Fix plan:** Migrate to PostgreSQL before scaling to multiple workers
- **Status:** 📋 Planned for production deployment

### ISSUE: 3D viewer GLB from URL causes CORS issues in some S3 configs
- **Problem:** `useGLTF(presigned_url)` fails if S3 bucket doesn't have correct CORS policy
- **Fix:** Add S3 CORS policy allowing GET from frontend origin
- **Status:** 📋 Backlog — add to deployment checklist
