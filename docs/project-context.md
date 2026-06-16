# Project Context — AnimeEdu

Everything an AI coding agent or new engineer needs to understand the project immediately: mental model, decisions made, gotchas, and what's canonical.

---

## 1. What This Project Is

AnimeEdu is a **full-stack AI educational content generation platform** built as a standalone module that will eventually be merged into the CatchupXV1 LMS. It takes a topic typed by a student and transforms it into:
1. Anime-style educational images or animations
2. Interactive HTML5 browser simulations
3. 3D GLB models viewable in-browser
4. Multi-episode anime story series
5. Conversational learning via "Bella", a persistent AI avatar

The platform is designed to require **no local GPU** — all AI workloads are offloaded to cloud APIs (Groq, Pollinations.ai, Tripo AI).

---

## 2. Mental Model

Think of AnimeEdu as a **pipeline of AI agents**:

```
Student types topic
  → Prompt Builder (Groq LLM) converts it to model-specific prompt
  → Generation pipeline (image/simulation/3D/story)
  → Safety classifier checks output
  → Asset stored in S3
  → Frontend displays result
```

Bella sits outside this pipeline — she's a **stateful conversation agent** that knows about the platform and can answer questions about any topic. She runs independently of the generation pipelines.

---

## 3. Key Design Decisions (and why)

### Why Celery for async jobs?
Generation tasks (especially simulation and 3D) can take 30–120 seconds. A synchronous HTTP request would time out. Celery allows the endpoint to return a job ID immediately while the work happens in a background worker. Frontend polls or subscribes to WebSocket for updates.

### Why SQLite for dev?
SQLAlchemy auto-creates tables on startup with no migration needed. Developers can clone and run the project without setting up a database server. SQLite is swapped for PostgreSQL in production via the `DATABASE_URL` env var.

### Why Pollinations.ai instead of HF Animagine?
Pollinations.ai is **tokenless** — no API key needed. This lets developers run the full image generation pipeline immediately after cloning. HF requires an API token and has more complex rate limiting. Pollinations is used as primary; HF is available as fallback.

### Why GIF instead of WebM/MP4 for animations?
ffmpeg is difficult to install reliably on Windows and in CI. Pillow is already a dependency and can assemble GIFs natively. GIF supports infinite loop which is ideal for short educational animations. WebM/MP4 requires encoding which adds significant complexity.

### Why edge-tts instead of a paid TTS API?
edge-tts is completely free, no API key required, and produces high-quality speech via Microsoft's Edge TTS servers. It gives Bella a natural voice without any cost. The only dependency is outbound internet, which is always available in any deployment target.

### Why fail-open on safety classifier?
The keyword blocklist is the hard safety gate — it instantly blocks clearly harmful content without any API call. The classifier is a second layer for semantic detection. If the classifier API is down, the keyword blocklist still catches the obvious cases. Failing closed (blocking all generation on classifier outage) would make the platform unusable during API issues.

### Why the two-stage safety approach?
Stage 1 (keyword) is synchronous, zero-latency, and zero-cost. Stage 2 (LLM classifier) catches subtler content that keywords miss. Running both means: fast rejection for obvious violations, semantic understanding for edge cases.

### Why is Bella mounted in layout.tsx?
If Bella were mounted on individual pages, she would re-mount (and re-initialise her Live2D avatar) on every page navigation. By mounting in the root layout, she persists: conversation history is maintained, the avatar doesn't flash/reload, and the chat panel stays open during navigation.

---

## 4. What's Canonical (source of truth)

| Topic | Canonical source |
|-------|-----------------|
| API endpoints and schemas | `backend/app/routers/*.py` |
| Database schema | `backend/app/models/anime_assets.py` |
| AI model names and parameters | `backend/app/services/*.py` source code |
| Environment variables | `backend/.env.example` |
| Frontend API contract | `frontend/lib/api.ts` |
| Celery task definitions | `backend/app/worker.py` |
| Safety blocklist | `backend/app/services/safety.py::_BLOCKLIST` |
| Design tokens | `frontend/app/globals.css` + `design.md` |
| Test coverage requirements | `requirements.md` §8 + `testing.md` |

---

## 5. What's Currently Functional vs. Known Issues

### Functional and tested
- Anime image generation (Pollinations.ai pipeline, caption overlay)
- Anime animation generation (GIF via Pillow)
- Interactive simulation generation (Groq LLM + fallback)
- Safety filter (keyword blocklist + gpt-oss-safeguard-20b)
- Job queue (Celery + Redis; in-process fallback when Redis down)
- WebSocket job status push
- Bella chat (Groq LLaMA 3.3 70B)
- Bella TTS (edge-tts)
- Bella STT (Groq Whisper)
- Bella offline fallback
- Asset gallery (list, filter, download, delete, zip export)
- Story plan generation and scene dispatch
- Three.js 3D model viewer

### Known issues (see featurelogs.md for details)
- WebSocket reliability on some deployment platforms → 2s polling fallback in place
- LLM occasionally truncates simulation HTML → fallback simulation used transparently
- Pollinations.ai rate limits during peak hours → 5-retry backoff mitigates
- Bella Live2D Cubism SDK loaded from CDN → will fail if CDN unavailable
- SQLite write contention with multiple Celery workers → PostgreSQL required for production

---

## 6. Gotchas for Developers

### 1. Groq rate limits are per-model
LLaMA 3.3 70B, Whisper, and the safety model have **separate** rate limit buckets on Groq's free tier. Hitting the LLM limit doesn't affect STT. Hitting the safety model limit causes fail-open (safe), not a block.

### 2. Simulation HTML validation is strict
The `_validate_html()` checker will reject HTML with any `src="https://..."` or `href="https://..."` attributes. When testing custom simulations, ensure zero external URLs.

### 3. Celery `asyncio.new_event_loop()` is intentional
Celery workers are synchronous by default. To call async services (Groq, Pollinations.ai), each task creates a new event loop with `asyncio.new_event_loop()`, runs the async code, then closes it. This is the correct pattern — do not try to make Celery tasks async natively without configuring `celery-pool-asyncio`.

### 4. SQLAlchemy sessions must be explicitly closed
Every database operation in Celery tasks opens a `SessionLocal()` and MUST close it in a `finally` block. SQLite in particular doesn't release file locks without explicit close.

### 5. The safety classifier wraps input in educational context
Topics are sent to the classifier as: "The following is a topic submitted by a student on an educational learning platform: {topic}". This context is essential — without it, topics like "French Revolution" get flagged as violent.

### 6. presigned_url vs file_path
- `file_path` in the Asset record is the S3 key (e.g., `anime/uuid/uuid.png`) — not a URL
- `presigned_url` is generated on-demand by `asset_manager.generate_presigned_url(file_path)` and included in API responses
- Never use `file_path` directly in the frontend — always use `presigned_url`

### 7. BellaService is a singleton
`bella_service = BellaService()` at module level. In-memory history is tied to this singleton. If the backend restarts (e.g., uvicorn `--reload`), all session histories are lost. This is expected behaviour in dev.

### 8. Frontend api.ts uses X-API-Key header
The frontend automatically adds `X-API-Key: {NEXT_PUBLIC_API_KEY}` to every request via `lib/api.ts`. The default value is `"dev-api-key"` for local development. Match this with `API_KEY` in backend `.env`.

### 9. story_id vs job_id
Story generation returns a `job_id` for the overall story job. The story itself has its own `story_id` (UUID assigned during plan creation). Use `job_id` for tracking generation status; use `story_id` for accessing the story content (`GET /story/{story_id}`).

### 10. Three.js + SSR
`ModelViewer3D` uses `@react-three/fiber` which requires a browser environment. Always import it with `dynamic(() => import(...), { ssr: false })` or ensure the component is only rendered client-side.

### 11. `onComplete` must fire directly from polling, not via useEffect
The `JobProgressBar` calls `onComplete` directly from the polling loop when `job.status === 'complete'` is detected. It does NOT use a `useEffect` to watch `status`. Reason: the parent unmounts the bar when `jobStatus === 'complete'`, so a `useEffect` on `status` would fire on an already-unmounted component. The callback is stored in a `useRef` to stay fresh across renders.

### 12. Asset fetch after job completion needs retries
The Celery worker marks the job complete in the DB, but the asset may not yet be fully written to S3 when the frontend polls. Always wrap `api.getAsset()` in a retry loop (5 attempts, 2s delay) when called immediately after job completion.

### 13. Progress bar stays visible during result loading
All generation pages use a `resultLoading` boolean. The bar hides only when `jobStatus === 'complete' && !resultLoading`. This prevents the white-screen flash between 100% progress and the result appearing.

### 14. Groq safety model rotates frequently
Groq decommissions LlamaGuard variants regularly. The current model is `openai/gpt-oss-safeguard-20b`. If job submissions suddenly take 110+ seconds, check that this model name is still valid at `https://console.groq.com/docs/models`. The safety service fails open on any classifier error, so a decommissioned model won't block generation — it will just be slow until the timeout (5s) kicks in.

### 15. Windows requires `--pool=solo` for Celery
On Windows, Celery's default multiprocessing pool doesn't work. Always run:
```powershell
py -3.11 -m celery -A app.worker worker --loglevel=info --pool=solo
```

---

## 7. File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Backend router | `{domain}.py` | `anime.py`, `simulation.py` |
| Backend service | `{domain}_service.py` or `{domain}_engine.py` | `bella_service.py`, `simulation_engine.py` |
| Backend PBT test | `test_properties_{domain}.py` | `test_properties_safety.py` |
| Backend unit test | `test_{module}.py` | `test_bella.py` |
| Frontend page | `app/{route}/page.tsx` | `app/anime/page.tsx` |
| Frontend component | `components/{domain}/{Name}.tsx` | `components/bella/BellaPresence.tsx` |
| Frontend hook | `lib/use{Name}.ts` | `lib/useGameProgress.ts` |
| Frontend store | `lib/{name}Store.ts` | `lib/bellaStore.ts` |
| S3 asset key | `{type}/{job_id}/{uuid}.{ext}` | `anime/abc123/def456.png` |

---

## 8. Environment Quick Reference

### Minimal dev setup (just Groq)
```bash
# backend/.env — minimum for core functionality:
GROQ_API_KEY=gsk_...
DATABASE_URL=sqlite:///./app.db
# Everything else optional for local dev
```

### Full production setup
```bash
GROQ_API_KEY=gsk_...
HF_API_TOKEN=hf_...
TRIPO_API_KEY=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=catchupx-anime-assets
DATABASE_URL=postgresql://...
UPSTASH_REDIS_URL=rediss://...
STORAGE_QUOTA_BYTES=524288000
API_KEY=<secure-random-string>
```

---

## 9. Development Workflow

### Windows — one command
```powershell
# Start everything (Redis + backend + Celery + frontend) and open browser:
cd C:\CatchupX\New_LMS
./start

# Stop everything:
./stop
```

### Manual (all platforms)
```bash
# 1. Start Redis
"C:\Program Files\Redis\redis-server.exe"   # Windows
redis-server                                  # macOS/Linux

# 2. Start backend (terminal 1)
cd backend && py -3.11 -m uvicorn app.main:app --reload --port 8000

# 3. Start Celery worker (terminal 2)
cd backend && py -3.11 -m celery -A app.worker worker --loglevel=info --pool=solo

# 4. Start frontend (terminal 3)
cd frontend && npm run dev

# 5. Run tests
cd backend && pytest --tb=short
cd frontend && npx vitest --run
```

---

## 10. Adding a New Generation Feature

To add a new generation pipeline (e.g., "Quiz Generator"):

1. **Backend service:** Create `app/services/quiz_engine.py` with `generate_quiz(topic, ...) -> Asset`
2. **Backend router:** Create `app/routers/quiz.py` with `POST /generate` → safety check → job → Celery dispatch
3. **Backend task:** Add `generate_quiz_task` in `app/worker.py` following the standard task pattern
4. **Register router:** `app.include_router(quiz.router, prefix="/api/v1/quiz", tags=["quiz"])` in `main.py`
5. **Frontend API wrapper:** Add `generateQuiz(...)` to `lib/api.ts`
6. **Frontend page:** Create `app/quiz/page.tsx`
7. **Frontend component:** Create `components/quiz/QuizPlayer.tsx`
8. **Tests:** Create `tests/test_properties_quiz.py` with Hypothesis tests
9. **Docs:** Update `features.md`, `requirements.md`, `tasks.md`, `featurelogs.md`
