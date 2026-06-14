# Architecture — AnimeEdu

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Next.js 14)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ /anime   │ │/simulation│ │ /model3d │ │  /story  │ /gallery  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│       ↕              ↕            ↕            ↕                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                     lib/api.ts                          │    │
│  │  (typed fetch wrappers, timeouts, AbortController)      │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           BellaPresence (layout.tsx — persistent)        │   │
│  │  Live2D/VRM avatar + chat + TTS audio + lip sync         │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP/WS (X-API-Key header)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend (Python 3.11)                 │
│                                                                 │
│  CORS → Rate Limit (SlowAPI) → Auth (X-API-Key)                 │
│                                                                 │
│  ┌────────┐ ┌──────────┐ ┌─────────┐ ┌────────┐ ┌──────────┐  │
│  │ /anime │ │/simulation│ │/model3d │ │ /story │ │  /bella  │  │
│  └───┬────┘ └─────┬─────┘ └────┬────┘ └───┬────┘ └─────┬────┘  │
│      │            │             │          │             │       │
│  ┌───▼────────────▼─────────────▼──────────▼─────────┐  │       │
│  │              safety.check_topic()                 │  │       │
│  └────────────────────────┬──────────────────────────┘  │       │
│                           │                             │       │
│  ┌────────────────────────▼──────────────────────────┐  │       │
│  │            Job row inserted (SQLite/PG)           │  │       │
│  └────────────────────────┬──────────────────────────┘  │       │
│                           │ .delay()                    │       │
│                           ▼                             │       │
│  ┌──────────────────────────────────────────────────┐   │       │
│  │              Celery Task (async)                 │   │       │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐ │   │       │
│  │  │anime_task  │  │sim_task    │  │model3d_task│ │   │       │
│  │  │story_task  │  │webhook_task│  │            │ │   │       │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘ │   │       │
│  │        │               │                │        │   │       │
│  │  ┌─────▼───────────────▼────────────────▼──────┐ │   │       │
│  │  │       safety.check_content() (post-gen)     │ │   │       │
│  │  └────────────────────────┬────────────────────┘ │   │       │
│  └───────────────────────────┼──────────────────────┘   │       │
│                              │                          │       │
│                   ┌──────────▼──────────┐               │       │
│                   │   asset_manager     │               │       │
│                   │   (boto3 → S3)      │               │       │
│                   └─────────────────────┘               │       │
│                                                         │       │
│  ┌────────────────────────────────────────────────────┐ │       │
│  │              bella_service                         │◄┘       │
│  │  Groq LLaMA chat + edge-tts + Groq Whisper         │         │
│  └────────────────────────────────────────────────────┘         │
└───────────────────────────────────────────────────────┬─────────┘
                                                        │
               ┌────────────────────────────────────────┤
               │                                        │
     ┌─────────▼──────────┐              ┌──────────────▼────────┐
     │   Redis (Upstash)  │              │   AWS S3 / Local FS    │
     │  Celery broker +   │              │   Asset storage        │
     │  result backend    │              │   Presigned URLs       │
     └────────────────────┘              └───────────────────────┘
               │
     ┌─────────▼──────────┐
     │  SQLite (dev)       │
     │  PostgreSQL (prod)  │
     │  Job + Asset rows   │
     └────────────────────┘
```

---

## 2. Component Map

### Backend (`backend/`)

| File | Responsibility |
|------|----------------|
| `app/main.py` | FastAPI app creation, CORS, SlowAPI, router registration, lifespan (DB init), static files mount |
| `app/worker.py` | Celery app config (broker=Redis, backend=Redis), all task definitions |
| `app/core/auth.py` | `get_current_session` FastAPI dependency — validates X-API-Key and extracts session_id |
| `app/models/anime_assets.py` | SQLAlchemy models: `Job` (job_id, type, status, parameters, error_message, retry_count, session_id), `Asset` (asset_id, job_id, type, topic, file_path, file_size_bytes, mime_type, asset_metadata, created_at, session_id) |
| `app/routers/anime.py` | `POST /anime/generate` — safety check → job insert → Celery dispatch |
| `app/routers/simulation.py` | `POST /simulation/generate` |
| `app/routers/model3d.py` | `POST /model3d/generate` |
| `app/routers/story.py` | `POST /story/generate`, `GET /story/{id}`, `GET /story/{id}/export` |
| `app/routers/jobs.py` | `GET /jobs/{id}`, `GET /jobs`, `WS /jobs/{id}/ws` |
| `app/routers/assets.py` | `GET /assets`, `GET /assets/{id}`, `DELETE /assets/{id}`, `GET /assets/{id}/download`, `GET /assets/export/zip` |
| `app/routers/bella.py` | `POST /bella/chat`, `POST /bella/tts`, `POST /bella/transcribe`, `GET /bella/history` |
| `app/routers/webhooks.py` | `POST /webhooks/register`, webhook delivery |
| `app/services/anime_generator.py` | Pollinations.ai calls, Pillow caption, GIF assembly, S3 upload |
| `app/services/simulation_engine.py` | Groq LLM code gen, HTML validation, inline/fallback logic, S3 upload |
| `app/services/model3d_engine.py` | Tripo AI text-to-3D API, GLB download, S3 upload, category suggestions |
| `app/services/story_engine.py` | Groq story plan generation, StoryPlan Pydantic model, placeholder scenes |
| `app/services/prompt_builder.py` | Groq LLM → structured prompts for anime, simulation, model3d, story |
| `app/services/safety.py` | Keyword blocklist + Groq safety classifier, SafetyResult dataclass |
| `app/services/asset_manager.py` | boto3 S3 client, `store_asset()`, `generate_presigned_url()`, `delete_file()` |
| `app/services/bella_service.py` | Groq chat, edge-tts TTS, Groq Whisper STT, in-memory session history |
| `app/services/quota.py` | Storage quota tracking and enforcement |

### Frontend (`frontend/`)

| File | Responsibility |
|------|----------------|
| `app/layout.tsx` | Root layout: GameHUD + BellaPresence + universe background |
| `app/page.tsx` | Home page / topic input landing |
| `app/anime/page.tsx` | Scene Forge page |
| `app/simulation/page.tsx` | Lab Engine page |
| `app/model3d/page.tsx` | Holodeck page |
| `app/story/page.tsx` | Chronicle page |
| `app/gallery/page.tsx` | Asset Gallery page |
| `components/bella/BellaPresence.tsx` | Floating avatar container, state management |
| `components/model3d/ModelViewer3D.tsx` | Three.js GLB viewer (@react-three/fiber) |
| `components/story/StoryPlayer.tsx` | Episode/scene navigation, progressive image loading |
| `components/shared/JobProgressBar.tsx` | Polling + WebSocket job status display |
| `lib/api.ts` | All typed fetch wrappers; timeout management; error extraction |
| `lib/bellaStore.ts` | Zustand store: session_id, conversation history, avatar state |
| `lib/useGameProgress.ts` | Zustand hook: XP, level, award functions |

---

## 3. Data Flow — Generation Request

```
1. User submits form
2. Frontend: api.generateAnime(topic, style, include_animation)
   → POST /api/v1/anime/generate + X-API-Key
3. Router: auth dependency validates key
4. Router: safety_service.check_topic(topic) — if unsafe → 422
5. Router: db.add(Job(status="queued")), db.commit()
6. Router: generate_anime_task.delay(...) OR in-process fallback
7. Router: return 202 { job_id }
8. Frontend: starts polling loop (2s interval) or opens WebSocket
9. Celery worker picks up task:
   a. db.query(Job).filter(id=job_id) → job.status = "processing"
   b. notify(job_id, { status: "processing" })
   c. generate_anime_image(...) → image bytes
   d. safety_service.check_content(caption)
   e. asset_manager.store_asset(bytes, key, ...)
   f. db.add(Asset(...)), db.commit()
   g. job.status = "complete", job.asset_id = asset.asset_id
   h. notify(job_id, { status: "complete", asset_id })
10. Frontend receives WebSocket push or polls complete status
11. Frontend: api.getAsset(asset_id) → presigned_url
12. AnimeSceneCard renders image from presigned_url
```

---

## 4. Database Schema

### Job table
```sql
CREATE TABLE jobs (
    job_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,           -- anime|simulation|model3d|story
    status TEXT NOT NULL,         -- queued|processing|complete|failed
    topic TEXT,
    parameters JSON,              -- style, category, episode_count, etc.
    asset_id TEXT,                -- FK to assets on completion
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    session_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### Asset table
```sql
CREATE TABLE assets (
    asset_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    type TEXT NOT NULL,           -- image|animation|simulation|model3d|story
    topic TEXT NOT NULL,
    file_path TEXT NOT NULL,      -- S3 key e.g. "anime/uuid/uuid.png"
    file_size_bytes INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    asset_metadata JSON,
    created_at TIMESTAMP NOT NULL,
    session_id TEXT NOT NULL
);
```

---

## 5. External Service Dependencies

| Service | Protocol | Auth | Timeout | Retry |
|---------|----------|------|---------|-------|
| Groq API (LLM) | HTTPS | Bearer API key | 120s | 3 |
| Groq API (Whisper) | HTTPS | Bearer API key | 30s | 1 |
| Groq API (Safety) | HTTPS | Bearer API key | 5s | 0 (fail open) |
| Pollinations.ai | HTTPS | None (tokenless) | 90s | 5 |
| Tripo AI | HTTPS | Bearer API key | 120s | 3 (Celery) |
| edge-tts | HTTPS | None (free) | 30s | 0 |
| AWS S3 | HTTPS | IAM credentials | 30s | boto3 default |
| Redis/Upstash | Redis/rediss:// | TLS URL | 1s connect | Celery |

---

## 6. Security Boundaries

- API key required for all `/api/v1/` endpoints (X-API-Key header)
- All generated content passes two-stage safety filter
- CORS restricted to known origins
- S3 assets served only via time-limited presigned URLs (never public bucket)
- Simulation HTML runs in `sandbox="allow-scripts"` iframe — no DOM access to parent
- Generated HTML externals removed before storage (no CDN injection)
- No user PII stored; session_id is an opaque UUID

---

## 7. Scalability Considerations

| Bottleneck | Current | Mitigation |
|-----------|---------|------------|
| Groq rate limits | Free tier | Queue tasks; retry with backoff |
| Pollinations.ai rate limits | Tokenless, throttled | 5 retries, exponential backoff |
| Redis Upstash | Free tier (10K req/day) | Batch notifications; short TTLs |
| SQLite | Single-writer, dev only | Migrate to PostgreSQL for production |
| S3 costs | Pay-per-use | Quota enforcement; asset expiry |
| Celery workers | Single process local | Scale horizontally on Railway |
