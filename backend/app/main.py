from dotenv import load_dotenv
load_dotenv()

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.routers import bella, jobs, assets, anime, simulation, model3d, story, webhooks


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

# CORS must be added before any other middleware so it runs on all responses including errors
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://your-production-domain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
import os

storage_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "storage"))
os.makedirs(storage_path, exist_ok=True)
app.mount("/api/v1/storage", StaticFiles(directory=storage_path), name="storage")


@app.get("/health")
async def health():
    return {"status": "ok"}
