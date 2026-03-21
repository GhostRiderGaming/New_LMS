# Project Structure

Monorepo with `backend/` (FastAPI) and `frontend/` (Next.js 14).

```
/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app, router registration, CORS, startup
│   │   ├── worker.py                # Celery app + task imports
│   │   ├── core/
│   │   │   └── auth.py              # get_current_session dependency (API key + session)
│   │   ├── models/
│   │   │   └── anime_assets.py      # SQLAlchemy: Job, Asset models
│   │   ├── routers/
│   │   │   ├── anime.py             # POST /api/v1/anime/generate
│   │   │   ├── simulation.py        # POST /api/v1/simulation/generate
│   │   │   ├── model3d.py           # POST /api/v1/model3d/generate
│   │   │   ├── story.py             # POST /api/v1/story/generate, GET /story/{id}
│   │   │   ├── jobs.py              # GET /api/v1/jobs/{id}, GET /api/v1/jobs
│   │   │   ├── assets.py            # GET/DELETE /api/v1/assets/{id}
│   │   │   └── bella.py             # POST /bella/chat, /bella/transcribe, GET /bella/history
│   │   └── services/
│   │       ├── anime_generator.py   # Fal.ai Animagine XL calls + Pillow caption overlay
│   │       ├── simulation_engine.py # Groq LLM → HTML simulation bundle
│   │       ├── model3d_engine.py    # Fal.ai Hunyuan3D-2.1 calls
│   │       ├── story_engine.py      # Groq LLM → StoryPlan JSON + scene orchestration
│   │       ├── prompt_builder.py    # Groq LLM → structured prompts for each pipeline
│   │       ├── asset_manager.py     # boto3 R2: upload, presigned URL, delete
│   │       ├── safety.py            # LlamaGuard via Groq + keyword blocklist
│   │       └── bella_service.py     # Groq LLM chat + Fal.ai Kokoro TTS + history
│   ├── tests/
│   │   └── test_properties_*.py     # Hypothesis PBT files per domain
│   ├── requirements.txt
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── layout.tsx               # Root layout — includes BellaOverlay globally
│   │   ├── page.tsx                 # Home / TopicInput
│   │   ├── anime/page.tsx
│   │   ├── simulation/page.tsx
│   │   ├── model3d/page.tsx
│   │   ├── story/page.tsx
│   │   └── gallery/page.tsx
│   ├── components/
│   │   ├── anime/                   # AnimeSceneCard
│   │   ├── simulation/              # SimulationFrame (sandboxed iframe)
│   │   ├── model3d/                 # ModelViewer3D (@react-three/fiber + GLTFLoader)
│   │   ├── story/                   # StoryPlayer, EpisodeList
│   │   ├── bella/                   # BellaOverlay (VRM + chat + lip sync)
│   │   └── shared/                  # TopicInput, JobProgressBar, AssetGallery
│   ├── lib/
│   │   └── api.ts                   # Typed fetch wrappers for all backend endpoints
│   ├── .env.local.example
│   └── package.json
├── docker-compose.yml               # backend + Redis for local dev
└── .kiro/
    ├── specs/education-anime-generator/
    └── steering/
```

## Conventions

- **Router pattern:** Each router file registers one domain. Add to `main.py` via `app.include_router(x.router, prefix="/api/v1/...", tags=[...])`.
- **Async jobs:** All generation endpoints return `202 { job_id, status: "queued" }` immediately. Actual work runs in Celery tasks.
- **Error responses:** Always return `{ "error": "<code>", ... }` with a `request_id` field for tracing.
- **Asset URLs:** All assets stored in Cloudflare R2; served via presigned URLs (24h minimum TTL).
- **Safety:** Every generation endpoint runs `safety.check_topic()` before enqueuing. Post-generation runs `safety.check_content()` before storing.
- **Frontend pages:** Follow Next.js App Router conventions. All pages are wrapped with existing `AuthContext`.
- **API calls (frontend):** All backend calls go through `lib/api.ts` typed wrappers — never raw fetch in components.
- **Bella overlay:** Mounted once in `app/layout.tsx` so it persists across all page navigations.
- **Tests:** Co-locate unit tests as `*.test.ts` (frontend) or `tests/test_*.py` (backend). PBT files named `test_properties_<domain>.py`.
