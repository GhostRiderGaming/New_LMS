"""
Integration tests: Education Anime Generator mounted under CatchupXV1's auth and database.

These tests verify that the module's routers, auth dependency, and DB models work correctly
when wired together as they would be inside CatchupXV1 — using a shared in-memory SQLite DB,
a swapped-in CatchupXV1-style auth dependency, and a TestClient that exercises the full
request/response cycle without hitting external APIs.

Feature: education-anime-generator
Validates: Requirements 4.7 (auth integration), 4.1 (API structure), 4.2 (job submission),
           4.5 (job status), 6.3 (asset retrieval), 6.4 (asset deletion), 4.4 (OpenAPI spec)
"""
from __future__ import annotations

import uuid
from typing import Generator
from unittest.mock import MagicMock, patch, AsyncMock

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from app.models.anime_assets import Base, Job, Asset, get_db
from app.routers import anime, simulation, model3d, story, jobs, assets, bella, webhooks

# ---------------------------------------------------------------------------
# Shared in-memory database (mirrors CatchupXV1's test DB setup)
# ---------------------------------------------------------------------------

TEST_DATABASE_URL = "sqlite:///:memory:"

_test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
_TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)


def _override_get_db() -> Generator[Session, None, None]:
    """Override get_db to use the shared in-memory test database."""
    db = _TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# CatchupXV1-style auth dependency override
# Simulates CatchupXV1's get_current_user returning a user object with an .id
# ---------------------------------------------------------------------------

class _FakeUser:
    """Minimal stand-in for CatchupXV1's User model."""
    def __init__(self, user_id: str = "test-user-001"):
        self.id = user_id
        self.email = "test@example.com"


def _catchupxv1_auth_override() -> dict:
    """
    Simulates CatchupXV1's auth dependency returning a session context.
    In production, this would validate a JWT and return the user's session.
    """
    user = _FakeUser()
    return {"session_id": str(user.id), "api_key": None}


# ---------------------------------------------------------------------------
# App fixture — mirrors how CatchupXV1 would mount the module
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def app() -> FastAPI:
    """
    Build a FastAPI app that mirrors CatchupXV1's main.py structure:
    - All new routers registered under /api/v1/
    - Auth dependency overridden with CatchupXV1-style auth
    - DB dependency overridden with shared in-memory SQLite
    """
    from app.core.auth import get_current_session

    # Create all tables on the test engine before any test runs
    Base.metadata.create_all(bind=_test_engine)

    catchupxv1_app = FastAPI(title="CatchupXV1 (test)", version="1.0.0")

    # Register all new routers exactly as INTEGRATION.md specifies
    catchupxv1_app.include_router(anime.router,       prefix="/api/v1/anime",       tags=["anime"])
    catchupxv1_app.include_router(simulation.router,  prefix="/api/v1/simulation",  tags=["simulation"])
    catchupxv1_app.include_router(model3d.router,     prefix="/api/v1/model3d",     tags=["model3d"])
    catchupxv1_app.include_router(story.router,       prefix="/api/v1/story",       tags=["story"])
    catchupxv1_app.include_router(jobs.router,        prefix="/api/v1/jobs",        tags=["jobs"])
    catchupxv1_app.include_router(assets.router,      prefix="/api/v1/assets",      tags=["assets"])
    catchupxv1_app.include_router(bella.router,       prefix="/api/v1/bella",       tags=["bella"])
    catchupxv1_app.include_router(webhooks.router,    prefix="/api/v1/webhooks",    tags=["webhooks"])

    # Override dependencies to use CatchupXV1's auth and shared test DB
    catchupxv1_app.dependency_overrides[get_current_session] = _catchupxv1_auth_override
    catchupxv1_app.dependency_overrides[get_db] = _override_get_db

    return catchupxv1_app


@pytest.fixture(scope="module")
def client(app: FastAPI) -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clean_db():
    """Wipe all rows between tests to ensure isolation."""
    yield
    db = _TestSessionLocal()
    try:
        db.query(Job).delete()
        db.query(Asset).delete()
        db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _seed_job(db: Session, status: str = "complete", topic: str = "photosynthesis") -> Job:
    job = Job(
        job_id=str(uuid.uuid4()),
        type="anime",
        status=status,
        topic=topic,
        session_id="test-user-001",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _seed_asset(db: Session, job_id: str) -> Asset:
    from datetime import datetime, timezone, timedelta
    asset = Asset(
        asset_id=str(uuid.uuid4()),
        job_id=job_id,
        type="image",
        topic="photosynthesis",
        file_path="test/path.png",
        file_size_bytes=1024,
        mime_type="image/png",
        asset_metadata={"caption": "Test caption"},
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        session_id="test-user-001",
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


# ---------------------------------------------------------------------------
# Auth integration tests (Requirement 4.7)
# ---------------------------------------------------------------------------

class TestAuthIntegration:
    """Verify the module respects CatchupXV1's auth dependency override."""

    def test_protected_endpoints_accept_catchupxv1_auth(self, client: TestClient) -> None:
        """
        When CatchupXV1's auth dependency is injected, all protected endpoints
        must accept requests without returning 401.
        """
        response = client.get("/api/v1/jobs")
        assert response.status_code != 401, (
            f"Expected non-401 with CatchupXV1 auth override, got {response.status_code}"
        )

    def test_unauthenticated_request_returns_401_without_override(self, app: FastAPI) -> None:
        """
        Without the auth override, requests with no credentials must return 401.
        This confirms the module's own auth guard is active before the override.
        """
        from app.core.auth import get_current_session

        # Temporarily remove the override
        original = app.dependency_overrides.pop(get_current_session, None)
        try:
            with TestClient(app) as raw_client:
                response = raw_client.get("/api/v1/jobs")
            assert response.status_code == 401
        finally:
            if original is not None:
                app.dependency_overrides[get_current_session] = original

    def test_session_id_derived_from_catchupxv1_user_id(self, client: TestClient) -> None:
        """
        The session context returned by the CatchupXV1 auth override must
        contain a non-empty session_id derived from the user's ID.
        """
        session = _catchupxv1_auth_override()
        assert session["session_id"] == "test-user-001"
        assert session["api_key"] is None


# ---------------------------------------------------------------------------
# Job submission and status (Requirements 4.2, 4.5)
# ---------------------------------------------------------------------------

class TestJobEndpoints:
    """Verify job submission and status endpoints work under CatchupXV1's DB."""

    def test_job_list_returns_200(self, client: TestClient) -> None:
        response = client.get("/api/v1/jobs")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)

    def test_job_list_scoped_to_session(self, client: TestClient) -> None:
        """Jobs from other sessions must not appear in the list."""
        db = _TestSessionLocal()
        try:
            # Seed a job for a different session
            other_job = Job(
                job_id=str(uuid.uuid4()),
                type="anime",
                status="complete",
                topic="gravity",
                session_id="other-user-999",
            )
            db.add(other_job)
            db.commit()
            other_job_id = other_job.job_id  # capture before session closes
        finally:
            db.close()

        response = client.get("/api/v1/jobs")
        assert response.status_code == 200
        job_ids = [j["job_id"] for j in response.json()]
        assert other_job_id not in job_ids, (
            "Jobs from other sessions must not be visible to the current session"
        )

    def test_get_job_by_id_returns_correct_job(self, client: TestClient) -> None:
        db = _TestSessionLocal()
        try:
            job = _seed_job(db)
            job_id = job.job_id
        finally:
            db.close()

        response = client.get(f"/api/v1/jobs/{job_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["job_id"] == job_id
        assert data["status"] == "complete"

    def test_get_nonexistent_job_returns_404(self, client: TestClient) -> None:
        response = client.get(f"/api/v1/jobs/{uuid.uuid4()}")
        assert response.status_code == 404

    def test_job_status_field_is_valid(self, client: TestClient) -> None:
        db = _TestSessionLocal()
        try:
            _seed_job(db, status="queued")
            _seed_job(db, status="processing")
            _seed_job(db, status="complete")
            _seed_job(db, status="failed")
        finally:
            db.close()

        response = client.get("/api/v1/jobs")
        assert response.status_code == 200
        valid_statuses = {"queued", "processing", "complete", "failed"}
        for job in response.json():
            assert job["status"] in valid_statuses, (
                f"Unexpected status {job['status']!r} in job list"
            )


# ---------------------------------------------------------------------------
# Asset endpoints (Requirements 6.3, 6.4, 6.5)
# ---------------------------------------------------------------------------

class TestAssetEndpoints:
    """Verify asset CRUD endpoints work against CatchupXV1's shared DB."""

    def test_get_asset_returns_metadata(self, client: TestClient) -> None:
        db = _TestSessionLocal()
        try:
            job = _seed_job(db)
            asset = _seed_asset(db, job.job_id)
            asset_id = asset.asset_id
        finally:
            db.close()

        with patch("app.routers.assets.asset_manager") as mock_am:
            mock_am.get_presigned_url.return_value = "https://r2.example.com/test.png"
            response = client.get(f"/api/v1/assets/{asset_id}")

        assert response.status_code == 200
        data = response.json()
        assert data["asset_id"] == asset_id
        assert data["topic"] == "photosynthesis"
        assert data["type"] == "image"

    def test_get_nonexistent_asset_returns_404(self, client: TestClient) -> None:
        response = client.get(f"/api/v1/assets/{uuid.uuid4()}")
        assert response.status_code == 404

    def test_delete_asset_returns_204(self, client: TestClient) -> None:
        db = _TestSessionLocal()
        try:
            job = _seed_job(db)
            asset = _seed_asset(db, job.job_id)
            asset_id = asset.asset_id
        finally:
            db.close()

        with patch("app.routers.assets.asset_manager") as mock_am:
            mock_am.delete_file.return_value = None
            response = client.delete(f"/api/v1/assets/{asset_id}")

        assert response.status_code == 204

    def test_deleted_asset_is_not_retrievable(self, client: TestClient) -> None:
        """After deletion, GET must return 404 — asset is permanently gone."""
        db = _TestSessionLocal()
        try:
            job = _seed_job(db)
            asset = _seed_asset(db, job.job_id)
            asset_id = asset.asset_id
        finally:
            db.close()

        with patch("app.routers.assets.asset_manager") as mock_am:
            mock_am.delete_file.return_value = None
            client.delete(f"/api/v1/assets/{asset_id}")
            mock_am.get_presigned_url.return_value = "https://r2.example.com/test.png"
            response = client.get(f"/api/v1/assets/{asset_id}")

        assert response.status_code == 404, (
            "Deleted asset must return 404 on subsequent GET (Requirement 6.4, 6.5)"
        )

    def test_asset_scoped_to_session(self, client: TestClient) -> None:
        """Assets from other sessions must return 404 for the current session."""
        db = _TestSessionLocal()
        try:
            other_job = Job(
                job_id=str(uuid.uuid4()),
                type="anime",
                status="complete",
                topic="gravity",
                session_id="other-user-999",
            )
            db.add(other_job)
            db.flush()
            from datetime import datetime, timezone, timedelta
            other_asset = Asset(
                asset_id=str(uuid.uuid4()),
                job_id=other_job.job_id,
                type="image",
                topic="gravity",
                file_path="other/path.png",
                file_size_bytes=512,
                mime_type="image/png",
                asset_metadata={},
                expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
                session_id="other-user-999",
            )
            db.add(other_asset)
            db.commit()
            other_asset_id = other_asset.asset_id
        finally:
            db.close()

        response = client.get(f"/api/v1/assets/{other_asset_id}")
        assert response.status_code == 404, (
            "Assets from other sessions must not be accessible (session isolation)"
        )


# ---------------------------------------------------------------------------
# Generation endpoint contract tests (Requirements 4.2, 4.9)
# ---------------------------------------------------------------------------

class TestGenerationEndpoints:
    """Verify generation endpoints return correct HTTP contracts."""

    def test_anime_generate_malformed_request_returns_400_or_422(self, client: TestClient) -> None:
        """Malformed request body must return 400 or 422 with error details."""
        response = client.post("/api/v1/anime/generate", json={})
        assert response.status_code in (400, 422), (
            f"Expected 400/422 for missing required fields, got {response.status_code}"
        )

    def test_simulation_generate_malformed_request_returns_400_or_422(self, client: TestClient) -> None:
        response = client.post("/api/v1/simulation/generate", json={"topic": ""})
        assert response.status_code in (400, 422)

    def test_model3d_generate_malformed_request_returns_400_or_422(self, client: TestClient) -> None:
        response = client.post("/api/v1/model3d/generate", json={})
        assert response.status_code in (400, 422)

    def test_story_generate_malformed_request_returns_400_or_422(self, client: TestClient) -> None:
        response = client.post("/api/v1/story/generate", json={"episode_count": 999})
        assert response.status_code in (400, 422)

    def test_anime_generate_valid_request_enqueues_job(self, client: TestClient) -> None:
        """
        A valid anime generation request must return 202 with a job_id and
        status='queued' within 500ms — no blocking on AI inference.
        """
        with patch("app.routers.anime.safety_service") as mock_safety, \
             patch("app.worker.generate_anime_task") as mock_task:
            mock_safety.check_topic = AsyncMock(return_value=MagicMock(safe=True))
            mock_task.delay.return_value = MagicMock(id="celery-task-id")

            import time
            start = time.perf_counter()
            response = client.post(
                "/api/v1/anime/generate",
                json={"topic": "photosynthesis", "style": "classroom"},
            )
            elapsed_ms = (time.perf_counter() - start) * 1000

        assert response.status_code == 202, f"Expected 202, got {response.status_code}"
        data = response.json()
        assert "job_id" in data
        assert data["status"] == "queued"
        uuid.UUID(data["job_id"])  # must be a valid UUID
        assert elapsed_ms < 500, f"Job submission took {elapsed_ms:.1f}ms — exceeds 500ms SLA"

    def test_simulation_generate_valid_request_enqueues_job(self, client: TestClient) -> None:
        with patch("app.routers.simulation.safety_service") as mock_safety, \
             patch("app.worker.generate_simulation_task") as mock_task:
            mock_safety.check_topic = AsyncMock(return_value=MagicMock(safe=True))
            mock_task.delay.return_value = MagicMock(id="celery-task-id")

            response = client.post(
                "/api/v1/simulation/generate",
                json={"topic": "Newton's laws", "category": "physics"},
            )

        assert response.status_code == 202
        assert response.json()["status"] == "queued"

    def test_model3d_generate_valid_request_enqueues_job(self, client: TestClient) -> None:
        with patch("app.routers.model3d.safety_service") as mock_safety, \
             patch("app.worker.generate_model3d_task") as mock_task:
            mock_safety.check_topic = AsyncMock(return_value=MagicMock(safe=True))
            mock_task.delay.return_value = MagicMock(id="celery-task-id")

            response = client.post(
                "/api/v1/model3d/generate",
                json={"object_name": "human heart", "category": "anatomy"},
            )

        assert response.status_code == 202
        assert response.json()["status"] == "queued"

    def test_story_generate_valid_request_enqueues_job(self, client: TestClient) -> None:
        with patch("app.routers.story.safety_service") as mock_safety, \
             patch("app.worker.generate_story_task") as mock_task:
            mock_safety.check_topic = AsyncMock(return_value=MagicMock(safe=True))
            mock_task.delay.return_value = MagicMock(id="celery-task-id")

            response = client.post(
                "/api/v1/story/generate",
                json={"topic": "World War II", "episode_count": 3},
            )

        assert response.status_code == 202
        assert response.json()["status"] == "queued"


# ---------------------------------------------------------------------------
# Safety pre-check integration (Requirements 8.4)
# ---------------------------------------------------------------------------

class TestSafetyIntegration:
    """Verify safety filter is invoked before any job is enqueued."""

    def test_unsafe_topic_rejected_before_enqueue(self, client: TestClient) -> None:
        """
        When the safety filter flags a topic, the endpoint must return 422
        and must NOT enqueue a Celery task.
        """
        with patch("app.routers.anime.safety_service") as mock_safety:
            mock_safety.check_topic = AsyncMock(return_value=MagicMock(safe=False, reason="unsafe content"))
            # Reset the worker mock's call count
            import app.worker as _worker
            _worker.generate_anime_task.delay.reset_mock()

            response = client.post(
                "/api/v1/anime/generate",
                json={"topic": "unsafe topic", "style": "classroom"},
            )

        assert response.status_code == 422
        _worker.generate_anime_task.delay.assert_not_called()

    def test_safe_topic_proceeds_to_enqueue(self, client: TestClient) -> None:
        """When the safety filter passes, the Celery task must be dispatched."""
        with patch("app.routers.anime.safety_service") as mock_safety:
            mock_safety.check_topic = AsyncMock(return_value=MagicMock(safe=True))
            import app.worker as _worker
            _worker.generate_anime_task.delay.reset_mock()

            response = client.post(
                "/api/v1/anime/generate",
                json={"topic": "photosynthesis", "style": "laboratory"},
            )

        assert response.status_code == 202
        _worker.generate_anime_task.delay.assert_called_once()


# ---------------------------------------------------------------------------
# Bella endpoints (Requirements 10.3, 10.11, 10.12)
# ---------------------------------------------------------------------------

class TestBellaIntegration:
    """Verify Bella endpoints work under CatchupXV1's auth and DB."""

    def test_bella_chat_returns_text_response(self, client: TestClient) -> None:
        """POST /bella/chat must return a text response even when TTS is mocked."""
        from app.services.bella_service import ChatResult
        with patch("app.routers.bella.bella_service") as mock_svc:
            mock_svc.chat = AsyncMock(return_value=ChatResult(
                reply="Photosynthesis is the process by which plants make food.",
                audio_b64=None,
                phonemes=[],
                tts_available=False,
            ))
            response = client.post(
                "/api/v1/bella/chat",
                json={"message": "Explain photosynthesis", "session_id": "test-user-001"},
            )

        assert response.status_code == 200
        data = response.json()
        assert "reply" in data
        assert len(data["reply"]) > 0

    def test_bella_chat_tts_failure_returns_text_only(self, client: TestClient) -> None:
        """
        When TTS fails, Bella must still return the text response with
        tts_available=False — no error status returned to client (Requirement 10.12).
        """
        from app.services.bella_service import ChatResult
        with patch("app.routers.bella.bella_service") as mock_svc:
            mock_svc.chat = AsyncMock(return_value=ChatResult(
                reply="Here is the explanation.",
                audio_b64=None,
                phonemes=[],
                tts_available=False,
            ))
            response = client.post(
                "/api/v1/bella/chat",
                json={"message": "Tell me about gravity", "session_id": "test-user-001"},
            )

        assert response.status_code == 200
        data = response.json()
        assert data["tts_available"] is False
        assert len(data["reply"]) > 0, "Text response must be non-empty even when TTS fails"

    def test_bella_history_returns_list(self, client: TestClient) -> None:
        """GET /bella/history must return a list (possibly empty) for the session."""
        with patch("app.routers.bella.bella_service") as mock_svc:
            mock_svc.get_history.return_value = []
            response = client.get("/api/v1/bella/history")

        assert response.status_code == 200
        data = response.json()
        assert "messages" in data
        assert isinstance(data["messages"], list)


# ---------------------------------------------------------------------------
# OpenAPI spec availability (Requirement 4.4)
# ---------------------------------------------------------------------------

class TestOpenAPISpec:
    """Verify the OpenAPI spec is accessible and includes all new endpoints."""

    def test_openapi_json_is_accessible(self, client: TestClient) -> None:
        """GET /openapi.json must return a valid OpenAPI document."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        spec = response.json()
        assert "openapi" in spec
        assert "paths" in spec

    def test_openapi_includes_all_new_routers(self, client: TestClient) -> None:
        """The OpenAPI spec must include paths for all new module endpoints."""
        response = client.get("/openapi.json")
        assert response.status_code == 200
        paths = response.json()["paths"]

        expected_prefixes = [
            "/api/v1/anime",
            "/api/v1/simulation",
            "/api/v1/model3d",
            "/api/v1/story",
            "/api/v1/jobs",
            "/api/v1/assets",
            "/api/v1/bella",
            "/api/v1/webhooks",
        ]
        for prefix in expected_prefixes:
            matching = [p for p in paths if p.startswith(prefix)]
            assert matching, (
                f"No paths found for prefix {prefix!r} in OpenAPI spec. "
                "Ensure the router is registered in main.py."
            )


# ---------------------------------------------------------------------------
# Webhook registration (Requirement 4.8)
# ---------------------------------------------------------------------------

class TestWebhookIntegration:
    """Verify webhook registration works under CatchupXV1's DB."""

    def test_register_webhook_returns_201(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/webhooks/register",
            json={"url": "https://catchupxv1.example.com/webhook"},
        )
        assert response.status_code in (200, 201)
        data = response.json()
        assert "webhook_id" in data

    def test_register_webhook_with_invalid_url_returns_error(self, client: TestClient) -> None:
        response = client.post(
            "/api/v1/webhooks/register",
            json={"url": "not-a-url"},
        )
        assert response.status_code in (400, 422)
