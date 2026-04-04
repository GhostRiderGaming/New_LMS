# Tech Stack

## Backend (Python)

- **Framework:** FastAPI (Python 3.11) with Pydantic v2 models
- **ORM:** SQLAlchemy with SQLite (auto-creates tables on startup)
- **Job Queue:** Celery 5 + Redis (Upstash Redis free tier)
- **Auth:** API key via `X-API-Key` header or session_id cookie
- **Rate Limiting:** SlowAPI (mirrors CatchupXV1 pattern)

## Frontend (TypeScript)

- **Framework:** Next.js 14 (App Router)
- **Styling:** TailwindCSS — dark anime theme (`bg #0a0a0f`, accent purple `#7c3aed`, cyan `#06b6d4`, pink `#ec4899`)
- **3D:** Three.js + `@react-three/fiber` + `@react-three/drei` + `@pixiv/three-vrm`
- **Simulation rendering:** D3.js, Matter.js (browser-side only)
- **State:** Zustand
- **Animation:** Framer Motion

## AI Cloud APIs (no local GPU required)

| Service | Provider | Use |
|---|---|---|
| Animagine XL 4.0 | HF Inference API (free) | Anime image generation |
| TripoSR | HF Inference API (free) | 3D model generation |
| edge-tts | Microsoft Edge (free, no key) | Bella voice synthesis |
| LLaMA 3.3 70B | Groq API (free tier) | LLM for prompts, story, simulation code, Bella chat |
| Whisper Large v3 | Groq API (free tier) | Bella speech-to-text |
| LlamaGuard 3 8B | Groq API (free tier) | Content safety classification |

## Storage

- **Object store:** AWS S3 (boto3 client)
- **Database:** Supabase PostgreSQL (free tier) / SQLite for local dev

## Testing

- **Backend PBT:** Hypothesis (min 100 iterations per property)
- **Frontend PBT:** fast-check
- **Backend unit/integration:** pytest + pytest-benchmark
- **Frontend unit:** Jest / Vitest

## Common Commands

```bash
# Backend — local dev
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Backend — run tests (single pass, no watch)
cd backend
pytest --tb=short

# Backend — run Celery worker
cd backend
celery -A app.worker worker --loglevel=info

# Frontend — local dev (run manually)
cd frontend
npm install
npm run dev

# Frontend — run tests (single pass)
cd frontend
npx vitest --run

# Docker Compose (backend + Redis)
docker compose up
```

## Environment Variables

Backend `.env`:
```
HF_API_TOKEN=
GROQ_API_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=catchupx-anime-assets
DATABASE_URL=sqlite:///./app.db
UPSTASH_REDIS_URL=
STORAGE_QUOTA_BYTES=524288000
```

Frontend `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```
