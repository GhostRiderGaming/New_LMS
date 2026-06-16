# Deployment Guide — AnimeEdu

Complete instructions for local development, staging, and production deployment.

---

## 1. Local Development Setup

### Quick Start (Windows — one command)
```powershell
cd C:\CatchupX\New_LMS
./start
```
This single script starts Redis, backend API, Celery worker, and frontend in sequence, then opens http://localhost:3000 automatically.

To stop everything:
```powershell
./stop
```

### Manual Setup (all platforms)

#### Prerequisites
- Python 3.11+
- Node.js 18+
- Redis (local at `C:\Program Files\Redis\redis-server.exe` on Windows, or Docker)
- Git

### Step 1 — Clone and set up backend
```bash
cd backend
pip install -r requirements.txt

# Create .env from template:
cp .env.example .env
# Edit .env — add GROQ_API_KEY at minimum for full functionality

# Start API server:
uvicorn app.main:app --reload --port 8000
```

### Step 2 — Set up frontend
```bash
cd frontend
npm install

# Create .env.local:
cp .env.local.example .env.local
# Default: NEXT_PUBLIC_API_URL=http://localhost:8000

# Start dev server:
npm run dev
# Accessible at http://localhost:3000
```

### Step 3 — Start Celery worker (required for async generation)
```bash
# Requires Redis. Start local Redis first:
# Windows: use Redis via WSL or Docker
# macOS: brew install redis && redis-server

cd backend
celery -A app.worker worker --loglevel=info
```

### Step 4 — Without Redis (development fallback)
If Redis is unavailable, the backend falls back to in-process task execution:
- Generation tasks run synchronously in the API process
- No separate worker process needed
- Slower (blocks the API while generating)
- Suitable for development and testing without full Redis setup

### Local development URLs
| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| API Docs (Swagger) | http://localhost:8000/api/v1/docs |
| API Docs (Redoc) | http://localhost:8000/api/v1/redoc |
| Health check | http://localhost:8000/health |

---

## 2. Docker Compose (Backend + Redis)

```bash
# Root directory (where docker-compose.yml lives):
docker compose up

# Or rebuild after code changes:
docker compose up --build

# Detached:
docker compose up -d

# Stop:
docker compose down
```

### docker-compose.yml (reference)
```yaml
version: "3.9"
services:
  api:
    build: ./backend
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    depends_on:
      - redis
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000

  worker:
    build: ./backend
    env_file:
      - ./backend/.env
    depends_on:
      - redis
    command: celery -A app.worker worker --loglevel=info

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
```

---

## 3. Production Deployment

### Architecture
```
[Vercel]          [Railway / Render]          [Upstash]
Frontend          Backend API                  Redis
Next.js           FastAPI + Celery            (Celery broker)
Static build      uvicorn + worker
                       ↕
                  [AWS S3]         [PostgreSQL]
                  Asset storage    Database
```

---

### 3.1 Backend — Railway

**Step 1 — Create Railway project**
```bash
# Install Railway CLI:
npm install -g @railway/cli

# Login:
railway login

# Create project from backend directory:
cd backend
railway init
railway up
```

**Step 2 — Configure environment variables on Railway dashboard**
```
GROQ_API_KEY=gsk_...
HF_API_TOKEN=hf_...
TRIPO_API_KEY=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=catchupx-anime-assets
DATABASE_URL=postgresql://...  (Railway PostgreSQL add-on)
UPSTASH_REDIS_URL=rediss://...  (Upstash)
STORAGE_QUOTA_BYTES=524288000
API_KEY=<generate-secure-key>
```

**Step 3 — Add Procfile**
```
# backend/Procfile:
web: uvicorn app.main:app --host 0.0.0.0 --port $PORT
worker: celery -A app.worker worker --loglevel=info
```

**Step 4 — Configure CORS for production domain**
Update `backend/app/main.py`:
```python
allow_origins=[
    "http://localhost:3000",
    "https://your-app.vercel.app",
    "https://your-custom-domain.com",
]
```

**Alternative: Render**
- Create Web Service → connect GitHub repo → set build command `pip install -r requirements.txt` → start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Create Background Worker for Celery: start command `celery -A app.worker worker --loglevel=info`

---

### 3.2 Frontend — Vercel

**Step 1 — Connect repository to Vercel**
```bash
# Install Vercel CLI:
npm install -g vercel

# From frontend directory:
cd frontend
vercel
```

Or connect via Vercel dashboard → Import Git Repository.

**Step 2 — Configure environment variables in Vercel dashboard**
```
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
NEXT_PUBLIC_API_KEY=<same-key-as-backend-API_KEY>
```

**Step 3 — Build settings**
- Framework: Next.js (auto-detected)
- Build Command: `npm run build`
- Output Directory: `.next`
- Install Command: `npm install`

**Step 4 — Verify next.config.js image domains**
Ensure S3 bucket domain is in `remotePatterns`:
```js
{ protocol: 'https', hostname: '*.amazonaws.com' }
```

---

### 3.3 Database — PostgreSQL (Production)

**Option A: Railway PostgreSQL add-on**
- Add PostgreSQL plugin in Railway → copy connection string → set `DATABASE_URL`

**Option B: Supabase PostgreSQL (free tier)**
1. Create project on supabase.com
2. Copy connection string: `postgresql://postgres:{password}@{host}:5432/postgres`
3. Set as `DATABASE_URL` in backend env

**Migration:**
SQLAlchemy auto-creates all tables on startup via `Base.metadata.create_all()`. No migration script needed for initial deployment. For schema changes, use Alembic:
```bash
pip install alembic
alembic init migrations
# Configure alembic.ini with DATABASE_URL
alembic revision --autogenerate -m "description"
alembic upgrade head
```

---

### 3.4 Redis — Upstash

1. Create account at upstash.com
2. Create Redis database → select closest region
3. Copy `rediss://` connection URL
4. Set as `UPSTASH_REDIS_URL` in backend env
5. Free tier: 10,000 req/day, 256MB

**Configuration in worker.py:**
```python
# SSL auto-detected from URL prefix:
broker_use_ssl=REDIS_URL.startswith("rediss://")
redis_backend_use_ssl=REDIS_URL.startswith("rediss://")
```

---

### 3.5 AWS S3 Setup

**Step 1 — Create S3 bucket**
```bash
aws s3 mb s3://catchupx-anime-assets --region us-east-1
```

**Step 2 — Bucket policy (private, presigned URL access only)**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Deny",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::catchupx-anime-assets/*",
    "Condition": {
      "StringNotEquals": { "s3:authType": "REST-QUERY-STRING" }
    }
  }]
}
```

**Step 3 — IAM user with minimal permissions**
```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
  "Resource": [
    "arn:aws:s3:::catchupx-anime-assets",
    "arn:aws:s3:::catchupx-anime-assets/*"
  ]
}
```

---

## 4. Environment Variable Checklist

### Before deploying backend, confirm these are set:
- [ ] `GROQ_API_KEY` — required for LLM, safety, STT
- [ ] `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` + `AWS_S3_BUCKET` — required for asset storage
- [ ] `DATABASE_URL` — PostgreSQL URL for production
- [ ] `UPSTASH_REDIS_URL` — Redis URL for Celery
- [ ] `API_KEY` — secure key that matches frontend `NEXT_PUBLIC_API_KEY`
- [ ] CORS `allow_origins` includes frontend URL

### Before deploying frontend, confirm:
- [ ] `NEXT_PUBLIC_API_URL` — full URL to backend (no trailing slash)
- [ ] `NEXT_PUBLIC_API_KEY` — matches backend `API_KEY`

---

## 5. Health Checks and Monitoring

### Health endpoint
```
GET /health
Response: { "status": "ok" }
```
Configure Railway/Render to use `/health` as the health check path.

### Smoke test after deployment
```bash
# Check API is up:
curl https://your-backend.railway.app/health

# Check anime endpoint works:
curl -X POST https://your-backend.railway.app/api/v1/anime/generate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"topic": "photosynthesis", "style": "classroom", "include_animation": false}'
# Expected: 202 {"job_id": "...", "status": "queued"}
```

---

## 6. Common Deployment Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 500 on any route | Database tables not created | Check lifespan hook is called; verify DATABASE_URL |
| Safety check always fails | Groq API key missing | Set GROQ_API_KEY; note: safety fails open (shouldn't block) |
| Jobs stay "queued" forever | Celery worker not running | Ensure worker process is started separately |
| Images not displaying | S3 bucket policy wrong or CORS issue | Check bucket policy; add frontend domain to S3 CORS |
| CORS errors | Frontend origin not in allow_origins | Update main.py allow_origins list |
| TTS not working | edge-tts can't reach internet | Verify outbound HTTPS is allowed from backend host |
| 3D models fail | Tripo API key not set | Add TRIPO_API_KEY to env |
| Redis connection timeout | Upstash URL wrong or SSL misconfigured | Use `rediss://` URL; verify `broker_use_ssl=True` |
| next/image broken | Hostname not in remotePatterns | Add S3 bucket hostname to next.config.js |
