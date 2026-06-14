# Testing Guide — AnimeEdu

Complete testing strategy, test types, how to run them, and what's covered.

---

## 1. Testing Stack

| Layer | Framework | File pattern |
|-------|-----------|-------------|
| Backend PBT (Property-Based) | Hypothesis (min 100 examples) | `tests/test_properties_{domain}.py` |
| Backend unit / integration | pytest + pytest-benchmark | `tests/test_{module}.py` |
| Backend integration (full) | pytest + FastAPI TestClient | `tests/test_integration_{suite}.py` |
| Frontend PBT | fast-check | `*.test.ts` (fc.property) |
| Frontend unit | Vitest / Jest | `*.test.ts` |

---

## 2. Running Tests

### Backend (all tests)
```bash
cd backend
pytest --tb=short
```

### Backend (specific domain)
```bash
pytest tests/test_properties_safety.py -v
pytest tests/test_properties_anime.py -v
pytest tests/test_bella.py -v
```

### Backend (with coverage)
```bash
pytest --cov=app --cov-report=html --tb=short
```

### Backend (benchmarks)
```bash
pytest --benchmark-only tests/
```

### Frontend (all tests)
```bash
cd frontend
npx vitest --run
```

### Frontend (watch mode — development only)
```bash
npx vitest
```

---

## 3. Backend Property-Based Tests

Located in `backend/tests/test_properties_{domain}.py`. Each file tests one service domain using Hypothesis.

### test_properties_safety.py
```python
from hypothesis import given, settings
from hypothesis import strategies as st
from app.services.safety import _contains_blocked_keyword, SafetyResult

@given(st.text(min_size=0, max_size=1000))
@settings(max_examples=100)
def test_blocklist_never_raises(text: str):
    """Property: keyword check never raises for any text input."""
    result = _contains_blocked_keyword(text)
    assert result is None or isinstance(result, str)

@given(st.text(min_size=1, max_size=100))
@settings(max_examples=100)
def test_safe_result_always_has_safe_field(text: str):
    """Property: SafetyResult always has a boolean safe field."""
    result = SafetyResult(safe=True, reason=text)
    assert isinstance(result.safe, bool)
```

**Key properties tested:**
- Blocklist never raises on any string input
- Blocklist always returns str or None
- SafetyResult is always a valid dataclass
- `check_topic` on clearly safe academic topics → safe=True
- Violations are always logged (side-effect property)

### test_properties_prompt_builder.py
**Key properties:**
- `build_anime_prompt` always returns a non-empty string for any (topic, style) pair
- `build_simulation_prompt` always returns a non-empty string
- Returned prompts are always strings, never None
- Prompt length always > 20 characters

### test_properties_anime.py
**Key properties:**
- `_add_caption_overlay` always returns valid PNG bytes for any caption string
- Caption overlay bytes are always larger than input bytes (overlay adds data)
- GIF assembly produces valid GIF header (`GIF89a`)
- Storage key always matches pattern `anime/{job_id}/{uuid}.{ext}`

### test_properties_simulation.py
**Key properties:**
- `_fallback_simulation` always returns valid HTML with `<!DOCTYPE html>` for any topic/category
- `_extract_html` strips markdown fences without losing HTML content
- `_validate_html` raises ValueError on any input containing `src="https://..."`
- Fallback never contains external URLs (post-inline check)

### test_properties_model3d.py
**Key properties:**
- `get_suggestions_for_category` returns a list of 5 strings for any known category
- Suggestions are always non-empty strings
- Unknown category returns a non-empty default list

### test_properties_story.py
**Key properties:**
- `_placeholder_scene` always returns a valid dict with scene_number field
- StoryPlan validates correctly for episode_count 1–6
- Episode list length always equals requested episode_count
- All scene captions are non-empty strings

### test_properties_jobs.py
**Key properties:**
- Job status transitions are monotonic: queued → processing → complete/failed
- Job with retry_count >= 3 always gets status "failed"
- `_retry_countdown` always returns positive integer
- Exponential backoff: countdown(n+1) > countdown(n)

### test_properties_assets.py
**Key properties:**
- Asset file_path always starts with type prefix (`anime/`, `simulation/`, etc.)
- Asset mime_type always matches file extension
- Presigned URL TTL always >= 86400 seconds
- Storage quota is monotonically non-decreasing on each store_asset call

### test_properties_quota.py
**Key properties:**
- Quota never allows storage beyond `STORAGE_QUOTA_BYTES`
- Adding 0 bytes never changes quota
- Quota is always >= 0
- Quota after delete is always <= quota before delete

### test_properties_auth.py
**Key properties:**
- Valid API key always returns a session_id
- Invalid API key always raises 403
- session_id is always a non-empty string
- session_id format is always a valid UUID

---

## 4. Backend Integration Tests

### test_integration_catchupxv1.py
Tests the full request lifecycle with FastAPI `TestClient`:

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_anime_generate_returns_202():
    resp = client.post("/api/v1/anime/generate",
        json={"topic": "photosynthesis", "style": "classroom", "include_animation": False},
        headers={"X-API-Key": "dev-api-key"}
    )
    assert resp.status_code == 202
    assert "job_id" in resp.json()

def test_safety_blocks_harmful_topic():
    resp = client.post("/api/v1/anime/generate",
        json={"topic": "how to make a bomb", "style": "classroom", "include_animation": False},
        headers={"X-API-Key": "dev-api-key"}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "safety_violation"
```

**Covered scenarios:**
- Each generation endpoint returns 202 for valid input
- Safety filter blocks blocklist keywords → 422
- Missing API key → 403
- Invalid request body → 422 (Pydantic validation)
- Job status endpoint returns correct schema
- Asset list endpoint returns array
- Bella chat returns reply + tts_available fields
- Health endpoint returns 200

### test_bella.py
Focused tests for BellaService:
- Chat with no API key → returns local fallback, not exception
- TTS failure → returns tts_available=False, reply not empty
- History grows with each message pair
- Transcribe endpoint accepts audio blob

### test_properties_bella.py
PBT for Bella:
- `_local_fallback` never raises for any message string
- `_local_fallback` always returns a non-empty string
- Session history append is always idempotent per message count
- ChatResult always has `tts_available` as bool

### test_properties_post_generation_safety.py
PBT for the post-generation safety pipeline:
- `check_content` with clearly safe educational text always returns safe=True
- `check_content` with blocklist keyword always returns safe=False immediately
- Post-generation check on empty string fails open (safe=True)

---

## 5. Fixtures and Conftest

### backend/tests/conftest.py
```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.models.anime_assets import Base

@pytest.fixture(scope="session")
def test_db():
    """In-memory SQLite DB for integration tests."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    yield TestingSessionLocal
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="session")
def client():
    """FastAPI test client with dev API key."""
    return TestClient(app, headers={"X-API-Key": "dev-api-key"})
```

---

## 6. Frontend Tests

### API wrapper tests (`lib/api.test.ts`)
Using `msw` (Mock Service Worker) or `vi.fn()` to mock fetch:
```typescript
import { vi } from 'vitest'
import { api } from '../lib/api'

vi.mock('global', () => ({
  fetch: vi.fn()
}))

test('generateAnime returns job on 202', async () => {
  // mock fetch to return 202
  const job = await api.generateAnime('photosynthesis', 'classroom', false)
  expect(job.status).toBe('queued')
  expect(job.job_id).toBeTruthy()
})
```

### Error extraction tests (`lib/api.test.ts`)
```typescript
import * as fc from 'fast-check'
test('httpStatusMessage always returns a string', () => {
  fc.assert(fc.property(
    fc.integer({ min: 400, max: 599 }),
    (status) => typeof httpStatusMessage(status) === 'string'
  ))
})
```

### GameProgress hook tests
- XP always increases on `awardXP(n)` for positive n
- Level is always >= 1
- Level increases when XP crosses threshold
- XP persists to localStorage

---

## 7. What's NOT Tested (and why)

| Area | Reason |
|------|--------|
| Live Groq API calls | External; mocked in unit tests; tested manually |
| Pollinations.ai image quality | Subjective; integration tested by checking bytes > 1000 |
| Live2D animation correctness | Visual; no automated test; manual QA |
| Three.js 3D rendering | WebGL not available in test environment |
| edge-tts audio quality | Subjective; test only that bytes are returned |
| Celery task execution end-to-end | Requires Redis; tested with in-process fallback |

---

## 8. CI/CD Test Expectations

All of the following must pass before merging:
```
pytest --tb=short                   # all backend tests pass
npx vitest --run                    # all frontend tests pass
pytest --hypothesis-seed=0          # reproducible PBT run
```

No test should depend on:
- External API keys being present (mock or skip if missing)
- Redis being running (use in-process fallback)
- S3 being accessible (use local filesystem fallback)
- Specific random seeds (Hypothesis manages this)

---

## 9. Hypothesis Configuration

```python
# backend/conftest.py or pyproject.toml:
from hypothesis import settings, HealthCheck

settings.register_profile("ci", max_examples=100, suppress_health_check=[HealthCheck.too_slow])
settings.register_profile("dev", max_examples=20)
settings.load_profile("ci")  # in CI; "dev" during rapid local iteration
```

Database: Hypothesis stores found examples in `.hypothesis/` — commit this directory for reproducible failures.
