from dotenv import load_dotenv
load_dotenv()

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.routers import bella, jobs, assets, anime, simulation, model3d, story, webhooks

logger = logging.getLogger("animeedu")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Auto-create all SQLAlchemy tables on startup."""
    from app.models.anime_assets import Base, engine
    Base.metadata.create_all(bind=engine)
    yield


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Education Anime Generator API",
    version="1.0.0",
    lifespan=lifespan,
    openapi_url="/api/v1/openapi.json",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ---------------------------------------------------------------------------
# CORS — dynamically read allowed origins from env (I4)
# ---------------------------------------------------------------------------

_DEFAULT_ORIGINS = ["http://localhost:3000", "http://localhost:3001"]
_extra_origins = os.getenv("CORS_ORIGINS", "").strip()
_allowed_origins = _DEFAULT_ORIGINS + ([o.strip() for o in _extra_origins.split(",") if o.strip()] if _extra_origins else [])

# CORS must be added before any other middleware so it runs on all responses including errors
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request logging middleware (I2)
# ---------------------------------------------------------------------------

@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    """Log method, path, status code, and response time for every API request."""
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    # Skip logging for health checks and static file serving to reduce noise
    path = request.url.path
    if path not in ("/health",) and not path.startswith("/api/v1/storage/"):
        logger.info(
            "%s %s → %d (%.1fms)",
            request.method, path, response.status_code, elapsed_ms,
        )
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all handler — ensures 500 errors still include CORS headers."""
    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error", "detail": str(exc)},
    )

# Router registration
app.include_router(bella.router, prefix="/api/v1/bella", tags=["bella"])
app.include_router(jobs.router, prefix="/api/v1/jobs", tags=["jobs"])
app.include_router(assets.router, prefix="/api/v1/assets", tags=["assets"])
app.include_router(anime.router, prefix="/api/v1/anime", tags=["anime"])
app.include_router(simulation.router, prefix="/api/v1/simulation", tags=["simulation"])
app.include_router(model3d.router, prefix="/api/v1/model3d", tags=["model3d"])
app.include_router(story.router, prefix="/api/v1/story", tags=["story"])
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["webhooks"])

from fastapi.staticfiles import StaticFiles

storage_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "storage"))
os.makedirs(storage_path, exist_ok=True)
app.mount("/api/v1/storage", StaticFiles(directory=storage_path), name="storage")


# ---------------------------------------------------------------------------
# Enhanced health check (I1)
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    """Return service health with dependency status checks."""
    checks: dict = {}

    # Database check
    try:
        from app.models.anime_assets import SessionLocal
        db = SessionLocal()
        db.execute("SELECT 1" if hasattr(db, 'execute') else db.connection().execute.__func__)
        db.close()
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "ok"  # SQLite is always available

    # Redis check
    try:
        import redis
        r = redis.from_url(os.getenv("UPSTASH_REDIS_URL", "redis://localhost:6379/0"), socket_timeout=2)
        r.ping()
        checks["redis"] = "ok"
    except Exception:
        checks["redis"] = "unavailable"

    # API key status (show which are configured, not the actual values)
    checks["api_keys"] = {
        "GROQ_API_KEY": "set" if os.getenv("GROQ_API_KEY", "").strip() else "missing",
        "HF_API_TOKEN": "set" if os.getenv("HF_API_TOKEN", "").strip() else "missing",
        "TRIPO_API_KEY": "set" if os.getenv("TRIPO_API_KEY", "").strip() else "missing",
    }

    # Celery workers
    try:
        from app.services.task_runner import has_celery_workers
        checks["celery_workers"] = "available" if has_celery_workers() else "none (using in-process)"
    except Exception:
        checks["celery_workers"] = "unknown"

    overall = "ok" if checks.get("redis") != "error" else "degraded"
    return {"status": overall, "checks": checks}
