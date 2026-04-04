# CatchupXV1 Integration Guide

This guide covers everything needed to merge the Education Anime Generator into the CatchupXV1 codebase.

---

## 1. Backend — New Files to Copy

Copy these files into the CatchupXV1 `backend/` directory, preserving the relative paths:

### Models
```
app/models/anime_assets.py
```

### Routers
```
app/routers/anime.py
app/routers/simulation.py
app/routers/model3d.py
app/routers/story.py
app/routers/jobs.py
app/routers/assets.py
app/routers/bella.py
app/routers/webhooks.py
```

### Services
```
app/services/anime_generator.py
app/services/simulation_engine.py
app/services/model3d_engine.py
app/services/story_engine.py
app/services/prompt_builder.py
app/services/asset_manager.py
app/services/safety.py
app/services/bella_service.py
app/services/quota.py
```

### Worker tasks
```
app/worker.py   ← merge Celery task imports into CatchupXV1's existing worker.py
```

### Tests
```
tests/test_properties_anime.py
tests/test_properties_assets.py
tests/test_properties_auth.py
tests/test_properties_bella.py
tests/test_properties_jobs.py
tests/test_properties_model3d.py
tests/test_properties_post_generation_safety.py
tests/test_properties_prompt_builder.py
tests/test_properties_quota.py
tests/test_properties_safety.py
tests/test_properties_simulation.py
tests/test_properties_story.py
tests/test_bella.py
tests/test_integration_catchupxv1.py
```

---

## 2. Backend — Router Registration

Add the following lines to CatchupXV1's `backend/app/main.py`, inside the router registration block:

```python
from app.routers import anime, simulation, model3d, story, jobs, assets, bella, webhooks

app.include_router(anime.router,       prefix="/api/v1/anime",       tags=["anime"])
app.include_router(simulation.router,  prefix="/api/v1/simulation",  tags=["simulation"])
app.include_router(model3d.router,     prefix="/api/v1/model3d",     tags=["model3d"])
app.include_router(story.router,       prefix="/api/v1/story",       tags=["story"])
app.include_router(jobs.router,        prefix="/api/v1/jobs",        tags=["jobs"])
app.include_router(assets.router,      prefix="/api/v1/assets",      tags=["assets"])
app.include_router(bella.router,       prefix="/api/v1/bella",       tags=["bella"])
app.include_router(webhooks.router,    prefix="/api/v1/webhooks",    tags=["webhooks"])
```

Add table auto-creation to the lifespan handler (or startup event):

```python
from app.models.anime_assets import Base as AnimeBase, engine as anime_engine

# Inside lifespan or @app.on_event("startup"):
AnimeBase.metadata.create_all(bind=anime_engine)
```

> If CatchupXV1 already uses a shared `Base` and `engine`, import those instead and register
> the `anime_assets` models against them by setting `DATABASE_URL` to the same value.

---

## 3. Backend — New Environment Variables

Add these to CatchupXV1's `backend/.env`:

```dotenv
# Fal.ai — anime image gen, 3D model gen, Bella TTS
FAL_API_KEY=

# Cloudflare R2 object storage
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY=
CLOUDFLARE_R2_SECRET_KEY=
CLOUDFLARE_R2_BUCKET=catchupx-anime-assets

# Upstash Redis (Celery broker) — skip if CatchupXV1 already has UPSTASH_REDIS_URL
UPSTASH_REDIS_URL=

# Storage quota per session (bytes). Default = 500 MB.
STORAGE_QUOTA_BYTES=524288000
```

> `GROQ_API_KEY` is already present in CatchupXV1 — reused as-is for LLaMA 3.3 70B,
> Whisper Large v3, and LlamaGuard 3 calls.

---

## 4. Backend — pip Packages to Install

Packages not already in CatchupXV1's `requirements.txt`:

```bash
pip install fal-client==0.4.1 boto3==1.34.110 pillow==10.3.0 beautifulsoup4==4.12.3 slowapi==0.1.9
```

If Celery/Redis is not yet installed:

```bash
pip install celery[redis]==5.4.0 redis==5.0.4
```

Full reference list (add only what is missing):

```
fal-client==0.4.1
boto3==1.34.110
pillow==10.3.0
beautifulsoup4==4.12.3
slowapi==0.1.9
celery[redis]==5.4.0
redis==5.0.4
```

---

## 5. Frontend — New Files to Copy

Copy these into the CatchupXV1 `frontend/` (Next.js App Router) directory:

### Pages
```
app/anime/page.tsx
app/simulation/page.tsx
app/model3d/page.tsx
app/story/page.tsx
app/gallery/page.tsx
```

### Components
```
components/anime/AnimeSceneCard.tsx
components/simulation/SimulationFrame.tsx
components/model3d/ModelViewer3D.tsx
components/story/StoryPlayer.tsx
components/bella/BellaOverlay.tsx
components/bella/BellaCanvas.tsx
components/bella/BellaChatUI.tsx
components/bella/useBellaAnimations.ts
components/bella/useBellaLipSync.ts
components/bella/useBellaProactive.ts
components/shared/TopicInput.tsx
components/shared/JobProgressBar.tsx
components/shared/ErrorCard.tsx
```

### API client
```
lib/api.ts   ← merge typed wrappers into CatchupXV1's existing lib/api.ts
```

### Styles
```
app/globals.css   ← merge dark anime theme variables into CatchupXV1's globals.css
```

---

## 6. Frontend — Layout Changes

Add `BellaOverlay` to CatchupXV1's root layout so it persists across all pages:

```tsx
// catchupx-v1/app/layout.tsx
import BellaOverlay from "@/components/bella/BellaOverlay";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <BellaOverlay />   {/* ← add this line */}
      </body>
    </html>
  );
}
```

Add navigation links to the existing sidebar/nav component:

```tsx
{ href: "/anime",      label: "Anime Generator" },
{ href: "/simulation", label: "Simulations" },
{ href: "/model3d",    label: "3D Models" },
{ href: "/story",      label: "Story Player" },
{ href: "/gallery",    label: "Gallery" },
```

---

## 7. Frontend — npm Packages to Install

Packages not already in CatchupXV1's `package.json`:

```bash
npm install @pixiv/three-vrm@^2.1.2 d3@^7.9.0 matter-js@^0.19.0
npm install -D @types/d3@^7.4.3 @types/matter-js@^0.19.6
```

> `three`, `@react-three/fiber`, `@react-three/drei`, `framer-motion`, and `zustand`
> are already installed in CatchupXV1.

---

## 8. Frontend — Environment Variables

Add to CatchupXV1's `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
```

> In production, set this to the deployed backend URL.

---

## 9. Auth Compatibility Note

The module's `app/core/auth.py` uses `X-API-Key` header or `session_id` cookie.
CatchupXV1 uses JWT-based auth via `get_current_user`.

**To reuse CatchupXV1's auth**, replace the `get_current_session` dependency in each router with CatchupXV1's `get_current_user`, then derive `session_id` from the user's ID:

```python
# Example swap in any router
from app.core.auth import get_current_user   # CatchupXV1's existing dependency

@router.post("/generate")
async def generate(request: AnimeRequest, user=Depends(get_current_user), db=Depends(get_db)):
    session = {"session_id": str(user.id), "api_key": None}
    ...
```

---

## 10. Verification Checklist

After integration, confirm:

- [ ] `GET /api/v1/openapi.json` returns the full spec including all new endpoints
- [ ] `POST /api/v1/anime/generate` returns `202 { job_id, status: "queued" }` within 500ms
- [ ] `GET /api/v1/jobs/{job_id}` returns correct status
- [ ] `POST /api/v1/bella/chat` returns text response (TTS optional)
- [ ] Bella overlay renders on all pages without breaking existing layout
- [ ] `pytest --tb=short` passes in `backend/`
- [ ] `npx vitest --run` passes in `frontend/`
