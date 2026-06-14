# Coding Rules — AnimeEdu

Mandatory conventions for all backend and frontend code. AI coding agents MUST follow these rules exactly.

---

## 1. General Rules (all code)

1. **Never break existing patterns.** Read the adjacent code before writing new code. Match the style, naming, and structure of what's already there.
2. **No raw `fetch` in components.** All HTTP calls go through `lib/api.ts` typed wrappers. Never use `fetch` directly in a React component or page.
3. **No external URLs in generated HTML.** Simulation HTML files must contain zero external `src=` or `href=` attributes. Use inline CSS and JS only.
4. **No silent failures.** Every caught exception must either log a warning or return a user-visible error. Never `except: pass`.
5. **No secrets in code.** All API keys, credentials, and sensitive config read from environment variables only. Never hardcode.
6. **Type everything.** Python: Pydantic v2 models for all request/response bodies, SQLAlchemy typed column declarations. TypeScript: no `any` types; use explicit interfaces.
7. **Async is the default.** All backend service methods that call external APIs must be `async def`. All FastAPI endpoints must be `async def`.
8. **Fail open on safety classifier.** The safety classifier API failure MUST result in `SafetyResult(safe=True)` — never block content generation on a classifier API outage. Keyword blocklist violations are the only hard block.

---

## 2. Backend (Python / FastAPI)

### File structure
- Each router registers exactly one domain prefix. Do not mix concerns in a single router file.
- Services are stateless functions or singleton instances. No cross-service circular imports.
- All database access uses SQLAlchemy sessions opened and closed within the same function via try/finally.

### Router pattern
```python
# Every generation endpoint follows this exact pattern:
@router.post("/generate", status_code=202)
async def generate_X(
    req: XRequest,
    session_id: str = Depends(get_current_session),
    db: Session = Depends(get_db),
):
    safety = await safety_service.check_topic(req.topic)
    if not safety.safe:
        raise HTTPException(status_code=422, detail={"error": "safety_violation", "reason": safety.reason})
    
    job = Job(job_id=str(uuid.uuid4()), type="X", status="queued", ...)
    db.add(job)
    db.commit()
    
    try:
        generate_X_task.delay(job_id=job.job_id, ...)
    except Exception:
        # In-process fallback when Redis is down
        ...
    
    return {"job_id": job.job_id, "status": "queued"}
```

### Celery task pattern
```python
@celery_app.task(bind=True, max_retries=3, name="education_anime.generate_X")
def generate_X_task(self, job_id: str, ...):
    import asyncio
    from app.models.anime_assets import Job, SessionLocal
    
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.job_id == job_id).first()
        if not job:
            return
        job.status = "processing"
        db.commit()
        notify(job_id, {"job_id": job_id, "status": "processing"})
        
        loop = asyncio.new_event_loop()
        try:
            asset = loop.run_until_complete(generate_X_service(...))
            safety_result = loop.run_until_complete(safety_service.check_content(...))
        finally:
            loop.close()
        
        if not safety_result.safe:
            # delete asset, mark failed
            ...
            return
        
        job.status = "complete"
        job.asset_id = asset.asset_id
        db.commit()
        notify(job_id, {"job_id": job_id, "status": "complete", "asset_id": asset.asset_id})
    
    except Exception as exc:
        db.rollback()
        # update retry_count; if >= 3, mark failed
        raise self.retry(exc=exc, countdown=_retry_countdown(self.request.retries))
    finally:
        db.close()
```

### Error response format
```python
# ALL HTTP error responses must use this structure:
raise HTTPException(
    status_code=422,
    detail={"error": "safety_violation", "reason": "..."}
)
# Never: raise HTTPException(422, "raw message")
```

### Pydantic models
- Always use `model_config = ConfigDict(from_attributes=True)` for SQLAlchemy ORM models
- Use `Field(description="...")` on all request body fields for OpenAPI docs
- Use `model_validator` for cross-field validation, not inline code

### Logging
```python
import logging
logger = logging.getLogger(__name__)

# Use structured key=value format for anything machine-parseable:
logger.warning("SAFETY_VIOLATION topic=%r keyword=%r reason=%r", topic, kw, reason)
logger.info("ASSET_CREATED asset_id=%s type=%s size_bytes=%d", asset_id, type, size)
```

### Database sessions
```python
# ALWAYS use try/finally to close sessions:
db = SessionLocal()
try:
    ...
    db.commit()
finally:
    db.close()

# NEVER rely on garbage collection to close sessions
```

### Import order (PEP 8)
1. `from __future__ import annotations`
2. Standard library
3. Third-party packages
4. Local app imports (`from app.xxx import yyy`)

---

## 3. Frontend (TypeScript / Next.js)

### API calls
```typescript
// CORRECT — always go through lib/api.ts:
const job = await api.generateAnime(topic, style, includeAnimation)

// WRONG — never do this in a component:
const res = await fetch('/api/v1/anime/generate', { ... })
```

### Component naming
- Page files: `page.tsx` (Next.js convention)
- Component files: `PascalCase.tsx`
- Hook files: `useCamelCase.ts`
- Utility files: `camelCase.ts`
- No index.ts barrel files unless explicitly needed for tree-shaking

### State management
- **Zustand** for global state (Bella session, XP progress)
- **React useState/useEffect** for local UI state (loading, error, result)
- **No Redux** — Zustand is the project standard
- Store files live in `lib/` with descriptive names (`bellaStore.ts`, `useGameProgress.ts`)

### Error handling in components
```typescript
// Pattern for all generation forms:
const [error, setError] = useState<string | null>(null)
const [loading, setLoading] = useState(false)

const handleGenerate = async () => {
  setError(null)
  setLoading(true)
  try {
    const job = await api.generateX(...)
    // start polling or WebSocket
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Unknown error')
  } finally {
    setLoading(false)
  }
}
```

### Component structure (ordering within file)
1. Imports
2. Types / interfaces
3. Constants (outside component)
4. Component function
   1. Hooks (useState, useEffect, custom hooks)
   2. Event handlers
   3. Derived values
   4. Return JSX
5. Exported types

### TailwindCSS rules
- No inline `style={{}}` for values that have Tailwind equivalents
- Class order: layout → spacing → typography → color → border → effects → animation → responsive
- Never use magic hex values directly in className — use the design system tokens via CSS custom properties
- Responsive classes use mobile-first pattern: base + `sm:` + `md:` overrides

### Three.js / R3F rules
- Always wrap `useGLTF` in `<Suspense>` with a fallback
- Dispose of geometries and materials in `useEffect` cleanup when component unmounts
- Never create Three.js objects outside of R3F component tree (causes memory leaks)

### Accessibility requirements
- Every `<button>` must have visible text or `aria-label`
- Every `<img>` must have `alt` attribute
- Every `<iframe>` must have `title` attribute
- Focus management: trap focus inside modals and Bella panel when open
- Use semantic HTML elements (`<nav>`, `<main>`, `<section>`, `<article>`) not just `<div>`

---

## 4. Testing Rules

### Backend (Hypothesis PBT)
```python
from hypothesis import given, settings
from hypothesis import strategies as st

@given(st.text(min_size=1, max_size=500))
@settings(max_examples=100)
def test_property_name(topic: str):
    # Property: the function should never raise for any valid input
    result = function_under_test(topic)
    assert invariant(result)
```

- Minimum 100 examples per `@given` test
- File naming: `test_properties_{domain}.py`
- Unit tests: `test_{module}.py`
- Integration tests: `test_integration_{suite}.py`

### Frontend (Vitest / fast-check)
```typescript
import * as fc from 'fast-check'
import { functionUnderTest } from '../lib/utils'

test('property: description', () => {
  fc.assert(fc.property(
    fc.string({ minLength: 1, maxLength: 500 }),
    (input) => {
      const result = functionUnderTest(input)
      return invariant(result)
    }
  ))
})
```

### What to test
- **Properties:** Input/output invariants (safety filter always returns safe/unsafe, prompt builder always returns non-empty string)
- **Unit:** Individual service functions with mocked external calls
- **Integration:** Full request cycle with TestClient (FastAPI) or MSW (frontend)
- **Do NOT mock:** SQLAlchemy models in integration tests — use an in-memory SQLite test database

---

## 5. Environment and Config Rules

- Backend env: all in `backend/.env`, loaded via `python-dotenv` in `main.py` (`load_dotenv()` is the first line)
- Frontend env: `NEXT_PUBLIC_` prefix for values exposed to browser
- Never commit `.env` files — `.env.example` is the contract
- Required backend vars: `GROQ_API_KEY`, `HF_API_TOKEN`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`, `DATABASE_URL`, `UPSTASH_REDIS_URL`, `STORAGE_QUOTA_BYTES`
- Required frontend vars: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_API_KEY`

---

## 6. Git and PR Rules

- Feature branches: `feature/{short-description}`
- Bugfix branches: `fix/{short-description}`
- Commit messages: imperative tense — "Add simulation fallback" not "Added simulation fallback"
- Never commit directly to `main`
- PRs require: description, what was tested, any known issues
- Do not force-push to shared branches

---

## 7. Prohibited Patterns

| Pattern | Reason | Alternative |
|---------|--------|-------------|
| `fetch()` in components | Bypasses error handling in api.ts | Use `api.*` methods |
| `console.log` in production code | Use logger (backend) or `console.error` only | `logger.info(...)` |
| External URLs in generated HTML | Security/privacy risk | Inline all assets |
| `except: pass` | Hides errors | Log and re-raise or return error result |
| `any` in TypeScript | Removes type safety | Define an interface |
| `sleep` without backoff | Rate limit handling | Exponential backoff |
| Hardcoded API keys | Security | Environment variables |
| `git add .` in CI | May commit sensitive files | Stage specific files |
| `--no-verify` on commits | Bypasses hooks | Fix the issue |
