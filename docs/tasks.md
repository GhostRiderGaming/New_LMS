# Task List — AnimeEdu

Actionable development tasks organised by priority and domain. Each task is atomic, assignable, and verifiable.

---

## Status Legend
- `✅ Done` — Implemented and tested
- `🔄 In Progress` — Actively being worked on
- `📋 Backlog` — Planned, not started
- `🚫 Blocked` — Cannot proceed without dependency
- `❌ Cancelled` — No longer needed

---

## P0 — Critical (blocking launch)

| # | Task | Status | Notes |
|---|------|--------|-------|
| P0-1 | Replace SQLite with PostgreSQL for production | 📋 Backlog | SQLite write-contention with multiple Celery workers |
| P0-2 | Configure production CORS origins (Vercel URL) | 📋 Backlog | Update `allow_origins` in `main.py` before deploy |
| P0-3 | Configure Railway/Render production env vars | 📋 Backlog | All vars in deployment.md §3.1 |
| P0-4 | Set up Upstash Redis and verify Celery connection | 📋 Backlog | Test `rediss://` URL with SSL config |
| P0-5 | Add S3 CORS policy for presigned URL access from frontend | 📋 Backlog | GLB viewer and image display broken without this |
| P0-6 | Change default `API_KEY` from `dev-api-key` to a secure key | 📋 Backlog | Both backend and frontend env must match |
| P0-7 | Run full smoke test suite on production deployment | 📋 Backlog | See deployment.md §5 |

---

## P1 — High Priority (feature complete)

### Backend

| # | Task | Status | Notes |
|---|------|--------|-------|
| B1-1 | Implement `quota.py` storage quota enforcement | ✅ Done | 500MB default, configurable |
| B1-2 | Implement `job_notifier.py` WebSocket push | ✅ Done | Used by all Celery tasks |
| B1-3 | Implement `model3d_engine.py` Tripo AI integration | ✅ Done | GLB via Tripo AI polling API |
| B1-4 | Add `deliver_webhook` Celery task | ✅ Done | POST notification on job complete |
| B1-5 | Add Alembic migration setup for PostgreSQL | 📋 Backlog | Needed before production schema changes |
| B1-6 | Add request_id field to all error responses | 📋 Backlog | Required by coding-rules §2 |
| B1-7 | Write `test_integration_catchupxv1.py` full coverage | ✅ Done | TestClient integration tests |
| B1-8 | Add `pytest-asyncio` async test support | 📋 Backlog | Some async tests may need this |
| B1-9 | Bella history: add session expiry (TTL-based cleanup) | 📋 Backlog | Memory leak risk in long-running server |
| B1-10 | Add `X-Request-ID` header to all responses | 📋 Backlog | Improves debugging in production logs |

### Frontend

| # | Task | Status | Notes |
|---|------|--------|-------|
| F1-1 | `ModelViewer3D` — `useGLTF` + OrbitControls + autoRotate | ✅ Done | Three.js GLB viewer working |
| F1-2 | `StoryPlayer` — episode/scene navigation + progressive images | ✅ Done | Renders StoryPlan with scene polling |
| F1-3 | `JobProgressBar` — polling + WebSocket + status display | ✅ Done | Both transport methods |
| F1-4 | Gallery filter client-side by type | ✅ Done | |
| F1-5 | `BellaPresence` — floating overlay, chat panel, mic input | ✅ Done | |
| F1-6 | GameHUD — XP counter + level badge | ✅ Done | |
| F1-7 | Add per-page metadata (title, description, canonical) | 📋 Backlog | See seo.md §2 |
| F1-8 | Add `sitemap.ts` and `robots.ts` | 📋 Backlog | Required for SEO |
| F1-9 | Add JSON-LD structured data to home page | 📋 Backlog | SoftwareApplication schema |
| F1-10 | Add `dynamic()` imports for ModelViewer3D and BellaPresence | 📋 Backlog | Improve initial page load; avoid SSR issues |

---

## P2 — Medium Priority (quality and robustness)

### Testing

| # | Task | Status | Notes |
|---|------|--------|-------|
| T2-1 | `test_properties_safety.py` — 100 examples per property | ✅ Done | |
| T2-2 | `test_properties_anime.py` — caption overlay, GIF assembly | ✅ Done | |
| T2-3 | `test_properties_simulation.py` — fallback, HTML validation | ✅ Done | |
| T2-4 | `test_properties_model3d.py` — suggestions, GLB handling | ✅ Done | |
| T2-5 | `test_properties_story.py` — StoryPlan, placeholder scenes | ✅ Done | |
| T2-6 | `test_properties_jobs.py` — retry countdown, status transitions | ✅ Done | |
| T2-7 | `test_properties_bella.py` — local fallback, history | ✅ Done | |
| T2-8 | `test_properties_assets.py` — key patterns, MIME types | ✅ Done | |
| T2-9 | `test_properties_quota.py` — quota monotonicity | ✅ Done | |
| T2-10 | `test_properties_auth.py` — key validation | ✅ Done | |
| T2-11 | `test_properties_prompt_builder.py` — non-empty strings | ✅ Done | |
| T2-12 | `test_properties_post_generation_safety.py` — content check | ✅ Done | |
| T2-13 | Frontend Vitest tests for `lib/api.ts` error extraction | 📋 Backlog | |
| T2-14 | Frontend fast-check PBT for `useGameProgress` XP invariants | 📋 Backlog | |

### Error handling

| # | Task | Status | Notes |
|---|------|--------|-------|
| E2-1 | Humanise all Celery task error_message strings | ✅ Done | Connection errors get friendly messages |
| E2-2 | Add user-facing error messages for quota_exceeded | 📋 Backlog | Currently returns raw error code |
| E2-3 | Add retry UI ("Try again" button after job failure) | 📋 Backlog | UX improvement |
| E2-4 | Log all 5xx errors to structured logging output | 📋 Backlog | Production debugging |

---

## P3 — Low Priority (polish and extras)

### UX/Design

| # | Task | Status | Notes |
|---|------|--------|-------|
| U3-1 | Add sample topic chips to empty states | 📋 Backlog | See ux.md §5 |
| U3-2 | Bella onboarding message (first session only) | 📋 Backlog | |
| U3-3 | Image lightbox on click in AnimeSceneCard | 📋 Backlog | |
| U3-4 | Add `prefers-reduced-motion` CSS | 📋 Backlog | Accessibility |
| U3-5 | Toast notification system (top-right, auto-dismiss 4s) | 📋 Backlog | Currently using basic alerts |
| U3-6 | StoryPlayer — prev/next keyboard navigation | 📋 Backlog | |
| U3-7 | Gallery — swipe gesture support on mobile | 📋 Backlog | |

### Performance

| # | Task | Status | Notes |
|---|------|--------|-------|
| P3-1 | Add `next/image` blur placeholder for generated images | 📋 Backlog | Better loading UX |
| P3-2 | Bundle Cubism SDK locally (remove CDN dependency) | 📋 Backlog | Live2D offline resilience |
| P3-3 | Simulation iframe preload (hidden iframe before display) | 📋 Backlog | Faster simulation display |
| P3-4 | Reduce Hypothesis max_examples to 20 for dev profile | 📋 Backlog | Faster local test iteration |

### SEO (future)

| # | Task | Status | Notes |
|---|------|--------|-------|
| S3-1 | Create `/share/{asset_id}` public page for SEO | 📋 Backlog | |
| S3-2 | Dynamic OG image generation for share pages | 📋 Backlog | See seo.md §7 |
| S3-3 | Add FAQ section to home page | 📋 Backlog | Long-tail keyword targeting |
| S3-4 | Add example gallery with pre-generated assets | 📋 Backlog | Demonstrates capabilities to new users |

---

## Integration Tasks (CatchupXV1 merge)

| # | Task | Status | Notes |
|---|------|--------|-------|
| I-1 | Add AnimeEdu requirements to CatchupXV1 requirements.txt | 📋 Backlog | See integration.md §1 |
| I-2 | Register AnimeEdu routers in CatchupXV1 main.py | 📋 Backlog | |
| I-3 | Add AnimeEdu env vars to CatchupXV1 .env | 📋 Backlog | |
| I-4 | Mount BellaPresence in CatchupXV1 root layout | 📋 Backlog | |
| I-5 | Merge XP counter into CatchupXV1 nav | 📋 Backlog | Don't add a second nav bar |
| I-6 | Run full integration test suite against CatchupXV1 | 📋 Backlog | |
| I-7 | Add Cubism SDK script to CatchupXV1 layout | 📋 Backlog | Live2D dependency |
| I-8 | Verify no route prefix conflicts with existing CatchupXV1 routes | 📋 Backlog | |

---

## Sprint Suggestions

### Sprint 1 — Production Ready
- P0-1 through P0-7 (all blockers)
- F1-7, F1-8, F1-9, F1-10 (SEO and performance)
- B1-5, B1-6 (backend polish)

### Sprint 2 — Quality and UX
- E2-2, E2-3, E2-4 (error handling)
- U3-1 through U3-5 (UX polish)
- T2-13, T2-14 (frontend tests)

### Sprint 3 — Integration and Growth
- All Integration Tasks (I-1 through I-8)
- S3-1 through S3-4 (SEO growth)
