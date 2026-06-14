# Integration Guide — AnimeEdu

How to integrate AnimeEdu into CatchupXV1 and how all external services connect.

---

## 1. Integration with CatchupXV1 LMS

AnimeEdu is designed as a module that slots into the existing CatchupXV1 FastAPI backend and Next.js frontend. It does not replace CatchupXV1 — it adds new routers, services, and pages alongside existing ones.

### Backend integration steps

**Step 1 — Add requirements**
Add to CatchupXV1's `requirements.txt`:
```
# AnimeEdu additions
edge-tts>=6.1.12
httpx>=0.27.0
groq>=0.9.0
pillow>=10.3.0
celery[redis]>=5.4.0
redis>=5.0.7
```

**Step 2 — Register routers in CatchupXV1's main.py**
```python
from education_anime.routers import anime, simulation, model3d, story, jobs, assets, bella, webhooks

app.include_router(anime.router, prefix="/api/v1/anime", tags=["anime"])
app.include_router(simulation.router, prefix="/api/v1/simulation", tags=["simulation"])
app.include_router(model3d.router, prefix="/api/v1/model3d", tags=["model3d"])
app.include_router(story.router, prefix="/api/v1/story", tags=["story"])
app.include_router(jobs.router, prefix="/api/v1/jobs", tags=["jobs"])
app.include_router(assets.router, prefix="/api/v1/assets", tags=["assets"])
app.include_router(bella.router, prefix="/api/v1/bella", tags=["bella"])
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["webhooks"])
```

**Step 3 — Add environment variables**
```bash
# Add to CatchupXV1's .env:
GROQ_API_KEY=gsk_...
HF_API_TOKEN=hf_...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=catchupx-anime-assets
UPSTASH_REDIS_URL=rediss://...
STORAGE_QUOTA_BYTES=524288000
```

**Step 4 — Run Celery worker alongside uvicorn**
```bash
# Terminal 1: API server
uvicorn app.main:app --reload --port 8000

# Terminal 2: Celery worker
celery -A app.worker worker --loglevel=info
```

**Step 5 — Database migration**
SQLAlchemy auto-creates tables on startup via `Base.metadata.create_all(bind=engine)` in the lifespan hook. For production PostgreSQL:
```bash
# Set DATABASE_URL to PostgreSQL connection string:
DATABASE_URL=postgresql://user:pass@host:5432/dbname
```

### Frontend integration steps

**Step 1 — Copy pages and components**
Copy from AnimeEdu:
```
frontend/app/anime/        → catchupxv1/app/learn/anime/
frontend/app/simulation/   → catchupxv1/app/learn/simulation/
frontend/app/model3d/      → catchupxv1/app/learn/model3d/
frontend/app/story/        → catchupxv1/app/learn/story/
frontend/app/gallery/      → catchupxv1/app/learn/gallery/
frontend/components/       → catchupxv1/components/animeedu/
frontend/lib/api.ts        → catchupxv1/lib/animeeduApi.ts (rename to avoid conflicts)
frontend/lib/bellaStore.ts → catchupxv1/lib/bellaStore.ts
```

**Step 2 — Mount Bella in CatchupXV1's root layout**
```tsx
// In catchupxv1/app/layout.tsx:
import { BellaPresence } from '@/components/animeedu/bella/BellaPresence'

// Add to layout body (before closing </body>):
<BellaPresence />
```

**Step 3 — Mount GameHUD or merge with existing nav**
If CatchupXV1 has its own navigation, add XP counter to it rather than adding a second nav bar:
```tsx
// Import XP display from AnimeEdu:
import { XPCounter } from '@/components/animeedu/shared/XPCounter'
// Place it in CatchupXV1's existing nav
```

**Step 4 — Add Cubism SDK script**
Required for Live2D rendering:
```tsx
// In CatchupXV1's layout.tsx <head>:
<Script
  src="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
  strategy="beforeInteractive"
/>
```

**Step 5 — Add next.config.js image domains**
```js
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '*.amazonaws.com' },
    { protocol: 'http', hostname: 'localhost' },
    // ... existing patterns
  ]
}
```

---

## 2. External API Integration Details

### Groq API

**Base URL:** `https://api.groq.com/openai/v1`  
**Auth:** `Authorization: Bearer {GROQ_API_KEY}` (handled by groq Python SDK)  
**SDK:** `groq>=0.9.0` — `AsyncGroq` client

**Usage in AnimeEdu:**
| Service | Model | Endpoint |
|---------|-------|----------|
| LLM (chat, prompts, code gen, story) | `llama-3.3-70b-versatile` | `/chat/completions` |
| STT (Bella voice) | `whisper-large-v3-turbo` | `/audio/transcriptions` |
| Safety classifier | `openai/gpt-oss-safeguard-20b` | `/chat/completions` |

**Rate limits (free tier):**
- `llama-3.3-70b-versatile`: 6000 tokens/min, 30 req/min
- `whisper-large-v3-turbo`: 7200 audio-seconds/hour
- Safety model: separate rate limit bucket

**Error handling:**
```python
# All Groq calls wrapped in try/except; fail-open or fallback as appropriate
try:
    completion = await groq.chat.completions.create(...)
except Exception as exc:
    logger.warning("Groq call failed: %s", exc)
    # Return fallback or default safe value
```

---

### Pollinations.ai

**Base URL:** `https://image.pollinations.ai`  
**Auth:** None (tokenless, free)  
**Endpoint:** `GET /prompt/{encoded_prompt}?width=512&height=768&nologo=true&seed={seed}&model=flux`

**Integration notes:**
- URL-encode the prompt via `urllib.parse.quote()`
- Randomise seed per request: `uuid.uuid4().int % 100000`
- Two URL variants as failover (flux model + default model)
- Check response size > 1000 bytes (smaller = error page)
- Expected content-type: `image/jpeg` or `image/png`

**Rate limiting:**
- No documented limit but throttled; retry 429/500 with exponential backoff
- Max 5 retries per call; base delay 3s

---

### Tripo AI

**Base URL:** `https://platform.tripo3d.ai/v2`  
**Auth:** `Authorization: Bearer {TRIPO_API_KEY}` (add `TRIPO_API_KEY` to env)  
**Flow:**
1. `POST /task` with `{ "type": "text_to_model", "prompt": object_name }` → `{ task_id }`
2. Poll `GET /task/{task_id}` until `status == "success"` or `"failed"`
3. Download GLB from `result.model.url`
4. Upload GLB binary to S3

**Timeout:** 120s total poll time  
**On failure:** Return suggestions list for category

---

### HF Inference API (Animagine XL 4.0)

**Base URL:** `https://api-inference.huggingface.co/models/cagliostrolab/animagine-xl-4.0`  
**Auth:** `Authorization: Bearer {HF_API_TOKEN}`  
**Note:** Currently Pollinations.ai is the primary path. HF Inference is available as an alternate if Pollinations.ai is down.

**Request:**
```json
{
  "inputs": "anime style educational scene, photosynthesis...",
  "parameters": { "width": 512, "height": 768 }
}
```
**Response:** Raw binary (PNG)

---

### AWS S3

**SDK:** `boto3>=1.34.110`  
**Config:** Region + bucket via env vars  
**Operations:**
```python
# Upload
s3_client.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)

# Generate presigned URL (24h TTL)
url = s3_client.generate_presigned_url(
    'get_object',
    Params={'Bucket': BUCKET, 'Key': key},
    ExpiresIn=86400
)

# Delete
s3_client.delete_object(Bucket=BUCKET, Key=key)
```

**Local development fallback:**
If `AWS_ACCESS_KEY_ID` is not set, `asset_manager.py` falls back to local filesystem storage under `backend/storage/`. Files are served via FastAPI's `StaticFiles` mount at `/api/v1/storage`.

---

### Redis (Upstash)

**SDK:** `celery[redis]>=5.4.0` + `redis>=5.0.7`  
**URL format:**
- Local: `redis://localhost:6379/0`
- Upstash: `rediss://default:{token}@{host}.upstash.io:6379`

**SSL:** Automatic — `broker_use_ssl` set based on URL scheme prefix (`rediss://`)  
**Timeout:** 1s connect + 1s socket (fail fast; in-process fallback available)  
**Free tier limits:** 10,000 requests/day; 256MB storage

---

### edge-tts

**No API key required.** Connects to Microsoft Edge TTS servers over HTTPS.  
**SDK:** `edge-tts>=6.1.12`  
**Voice:** `en-US-AriaNeural`

```python
communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
async for chunk in communicate.stream():
    if chunk["type"] == "audio":
        buf.write(chunk["data"])
```

**Failure mode:** Requires outbound internet. In fully offline environments, TTS will fail; `tts_available: false` returned, text reply unaffected.

---

## 3. WebSocket Integration

### Job status WebSocket
**URL:** `ws://{host}/api/v1/jobs/{job_id}/ws?api_key={key}`  
**Protocol:** JSON messages
**Message format:**
```json
{ "job_id": "uuid", "status": "processing|complete|failed", "asset_id": "uuid?", "error_message": "string?" }
```

**Client implementation pattern:**
```typescript
const ws = new WebSocket(api.getJobWsUrl(job_id))
ws.onmessage = (e) => {
  const data = JSON.parse(e.data)
  if (data.status === 'complete') {
    setAssetId(data.asset_id)
    ws.close()
  } else if (data.status === 'failed') {
    setError(data.error_message)
    ws.close()
  }
}
ws.onerror = () => {
  // Fall back to polling
  startPolling(job_id)
}
```

### job_notifier pattern (backend)
```python
# app/services/job_notifier.py
# Pushes job status updates to all connected WebSocket clients for a job_id
def notify(job_id: str, payload: dict) -> None:
    # Looks up registered WebSocket connections for job_id
    # Sends JSON-serialized payload to each
    ...
```

---

## 4. CORS Configuration

```python
# backend/app/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://your-production-domain.com",  # update for deployment
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Important:** Add `https://your-vercel-app.vercel.app` to `allow_origins` before deploying.

---

## 5. API Key Auth Flow

```
Frontend request
  → X-API-Key: {NEXT_PUBLIC_API_KEY}
  → FastAPI dependency: get_current_session(x_api_key: str = Header(...))
  → Validates key matches backend API_KEY env var
  → Extracts session_id from cookie or request body
  → Injects session_id into endpoint handlers
```

For local development, both frontend and backend default to `"dev-api-key"`.

---

## 6. Environment Variable Reference

### Backend `.env`
```bash
# AI APIs
GROQ_API_KEY=gsk_...
HF_API_TOKEN=hf_...
TRIPO_API_KEY=...

# Storage
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=catchupx-anime-assets

# Database
DATABASE_URL=sqlite:///./app.db   # or postgresql://...

# Queue
UPSTASH_REDIS_URL=redis://localhost:6379/0  # or rediss://...

# Quota
STORAGE_QUOTA_BYTES=524288000   # 500MB default

# Auth
API_KEY=dev-api-key   # change for production
```

### Frontend `.env.local`
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_API_KEY=dev-api-key
```
