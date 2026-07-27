"""
Simulation library router.

GET /api/v1/simulation/list — list all pre-built simulations, categorized.
GET /api/v1/simulation/file/{category}/{filename} — serve a simulation HTML file.

Reads HTML files from storage/Bucket_simulation/{Maths_simulations,Science_simulations}
and extracts <title> tags for display names.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

router = APIRouter()

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_STORAGE_ROOT = Path(__file__).resolve().parent.parent.parent / "storage" / "Bucket_simulation"

_CATEGORY_MAP = {
    "Maths": {
        "dir": "Maths_simulations",
        "icon": "📐",
    },
    "Science": {
        "dir": "Science_simulations",
        "icon": "🔬",
    },
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _extract_title(filepath: Path) -> str:
    """Read just enough of the file to grab the <title> tag."""
    try:
        # Read first 2KB — titles are always near the top
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            head = f.read(2048)
        match = _TITLE_RE.search(head)
        if match:
            # Clean up the title: strip suffixes like " | Interactive Simulation"
            raw = match.group(1).strip()
            # Remove common verbose suffixes for a cleaner display name
            for sep in [" | ", " - ", " — ", ": "]:
                if sep in raw:
                    parts = raw.split(sep)
                    # Keep up to the first meaningful part if the rest is generic
                    generic_words = {"interactive", "simulation", "lab", "laboratory",
                                     "premium", "educational", "experience",
                                     "visualizer", "visualization", "explorer",
                                     "science", "physics", "math"}
                    # If the last part is mostly generic descriptor words, drop it
                    last_words = set(parts[-1].lower().split())
                    if last_words and last_words.issubset(generic_words):
                        raw = sep.join(parts[:-1])
                        break
            return raw
        return filepath.stem.replace("-", " ").replace("_", " ").title()
    except Exception:
        return filepath.stem.replace("-", " ").replace("_", " ").title()


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class SimulationItem(BaseModel):
    id: str
    title: str
    filename: str
    category: str


class CategoryGroup(BaseModel):
    name: str
    icon: str
    simulations: list[SimulationItem]


class SimulationListResponse(BaseModel):
    categories: list[CategoryGroup]
    total: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/list", response_model=SimulationListResponse)
async def list_simulations():
    """Return all pre-built simulations grouped by category."""
    categories: list[CategoryGroup] = []
    total = 0

    for cat_name, cat_info in _CATEGORY_MAP.items():
        cat_dir = _STORAGE_ROOT / cat_info["dir"]
        if not cat_dir.is_dir():
            continue

        sims: list[SimulationItem] = []
        for html_file in sorted(cat_dir.glob("*.html")):
            title = _extract_title(html_file)
            sims.append(SimulationItem(
                id=html_file.stem,
                title=title,
                filename=html_file.name,
                category=cat_name,
            ))

        total += len(sims)
        categories.append(CategoryGroup(
            name=cat_name,
            icon=cat_info["icon"],
            simulations=sims,
        ))

    return SimulationListResponse(categories=categories, total=total)


@router.get("/file/{category}/{filename}", response_class=HTMLResponse)
async def get_simulation_file(category: str, filename: str):
    """Serve a specific simulation HTML file."""
    # Validate category
    cat_info = _CATEGORY_MAP.get(category)
    if not cat_info:
        raise HTTPException(status_code=404, detail=f"Category '{category}' not found")

    # Security: prevent path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    filepath = _STORAGE_ROOT / cat_info["dir"] / filename
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail=f"Simulation '{filename}' not found")

    content = filepath.read_text(encoding="utf-8", errors="replace")
    return HTMLResponse(content=content)
