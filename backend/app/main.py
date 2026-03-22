from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import bella

app = FastAPI(title="Education Anime Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Router registration
# ---------------------------------------------------------------------------

app.include_router(bella.router, prefix="/bella", tags=["bella"])
