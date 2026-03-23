from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.routers import bella, jobs, assets, anime, simulation, model3d, story

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Education Anime Generator API", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://your-production-domain.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router registration
app.include_router(bella.router, prefix="/bella", tags=["bella"])
app.include_router(jobs.router, prefix="/api/v1/jobs", tags=["jobs"])
app.include_router(assets.router, prefix="/api/v1/assets", tags=["assets"])
app.include_router(anime.router, prefix="/api/v1/anime", tags=["anime"])
app.include_router(simulation.router, prefix="/api/v1/simulation", tags=["simulation"])
app.include_router(model3d.router, prefix="/api/v1/model3d", tags=["model3d"])
app.include_router(story.router, prefix="/api/v1/story", tags=["story"])


@app.get("/health")
async def health():
    return {"status": "ok"}
