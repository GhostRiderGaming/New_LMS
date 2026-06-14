# Feature Logs — AnimeEdu

Chronological record of all features, fixes, and technical decisions. Most recent entries first.

---

## v1.0.0 — Active Development

### [CURRENT] Safety classifier updated to gpt-oss-safeguard-20b
- **Change:** Replaced previous LlamaGuard model with `openai/gpt-oss-safeguard-20b`
- **Why:** Previous model was returning inconsistent "Harmony" format responses that broke the SAFE/UNSAFE binary parse. New model gives cleaner output.
- **Fix:** Updated response parsing to search for "UNSAFE" substring anywhere in response (handles both plain and structured formats); fail-open on unrecognisable output.
- **File:** `backend/app/services/safety.py`
- **Status:** ✅ Fixed

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
