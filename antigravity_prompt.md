# Task: Integrate Smart Image Resolver into the Anime (Scene Generation) Model

## Context

I am building a K-12 AI educational platform in Next.js. It has an "Anime (Scene Generation)" model that currently takes a topic from the user and generates an image using Animagine XL via the Pollinations API.

**The problem:** For scientific/educational concepts like "Photosynthesis", "Concave Lens Ray Diagram", or "Electric Motor", the AI-generated images are complex and confusing for 6th–10th grade students. Real textbook-quality diagrams already exist on the web.

**The solution I want you to implement:** Before generating any image, classify the topic. If it is a well-known scientific/educational concept that has standard textbook diagrams, fetch a real image from Google Custom Search API and display it directly — no AI generation needed. For everything else (historical events, fictional lore, geography, social concepts), continue using AI generation with a smarter prompt.

---

## Existing File to Replace / Integrate With

The current image generation is triggered via `prompt_builder.py` which has a `build_anime_prompt(topic, style)` function. Replace its usage with the new `image_resolver.py` described below.

---

## New File to Create: `image_resolver.py`

Create this file in the same directory as `prompt_builder.py`. Here is the complete implementation — copy it exactly:

```python
"""
image_resolver.py — Smart image source router for the Anime (Scene Generation) model.

Logic:
  - SCIENTIFIC_DIAGRAM  → Google Custom Search API (real textbook diagrams)
  - Everything else     → AI generation via Animagine XL prompt

Public API:
  resolve_image(topic, style, category?) -> ImageResult

ImageResult fields:
  source       : "google" | "ai_generated"
  url          : str | None   — direct image URL (Google path)
  ai_prompt    : str | None   — prompt to feed into Animagine XL (AI path)
  search_query : str | None   — Google query used (for debug/display)
  category     : str          — classified topic type

Required env vars:
  GROQ_API_KEY      — for topic classification
  GOOGLE_API_KEY    — Google Cloud API key with Custom Search JSON API enabled
  GOOGLE_CSE_ID     — Custom Search Engine ID (whole-web search, image ON, SafeSearch ON)
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx
from groq import AsyncGroq

log = logging.getLogger(__name__)
_GROQ_MODEL = "llama-3.3-70b-versatile"

@dataclass
class ImageResult:
    source: str
    url: str | None = None
    ai_prompt: str | None = None
    search_query: str | None = None
    category: str = "SCIENTIFIC_DIAGRAM"

_GOOGLE_CATEGORIES = {"SCIENTIFIC_DIAGRAM"}

_CLASSIFIER_SYSTEM = (
    "You are a topic classifier for an educational image pipeline. "
    "Classify the topic into exactly one category and describe what to show.\n\n"
    "SCIENTIFIC_DIAGRAM — A science/math concept that has well-known standard textbook diagrams. "
    "Examples: Photosynthesis, Concave Lens Ray Diagram, Electric Motor, Cell Division, "
    "Newton's Laws, Water Cycle, Human Digestive System, Ohm's Law circuit, Pythagorean Theorem.\n\n"
    "HISTORICAL_EVENT — A real historical event, war, civilization, era, or person. "
    "Examples: WWII, French Revolution, Mughal Empire, Hiroshima, Moon Landing.\n\n"
    "FICTIONAL_LORE — A fictional universe, character, or event from games, anime, literature, mythology. "
    "Examples: Elden Ring, Naruto, Greek Mythology, Lord of the Rings, Hogwarts.\n\n"
    "GEOGRAPHY_NATURE — A place, ecosystem, natural phenomenon, or space topic. "
    "Examples: Amazon Rainforest, Volcanoes, Solar System, Tectonic Plates, Northern Lights.\n\n"
    "SOCIAL_CONCEPT — An abstract social, economic, or psychological concept. "
    "Examples: Democracy, Supply and Demand, Maslow's Hierarchy, Inflation.\n\n"
    "Respond in EXACTLY this format (no markdown, no extra lines):\n"
    "CATEGORY: <one category name>\n"
    "SEARCH_QUERY: <4-8 word Google image search query to find the best textbook diagram — ONLY if SCIENTIFIC_DIAGRAM, else write NONE>\n"
    "KEY_VISUAL: <one sentence describing what image to show, written for a 12-year-old>"
)

_AI_SYSTEM_HISTORICAL = (
    "You are a historical anime art director. "
    "Given a historical event and its key visual, generate an Animagine XL image prompt. "
    "Show the actual historical scene — soldiers, leaders, battles, ruins from the correct era. "
    "Art tags: anime style, cinematic composition, dramatic lighting, historical accuracy, masterpiece, best quality. "
    "Output ONLY the comma-separated prompt — no explanation, no markdown."
)

_AI_SYSTEM_FICTIONAL = (
    "You are a lore-accurate anime art director. "
    "Given a fictional universe topic and its key visual, generate an Animagine XL image prompt. "
    "If a named character exists (e.g. Queen Marika, Naruto, Sauron), describe their CANONICAL design "
    "— hair, clothing, weapons, colors — as seen in the source material. Do NOT invent a generic character. "
    "Art tags: anime style, official art style, lore-accurate, highly detailed, cinematic, masterpiece, best quality. "
    "Output ONLY the comma-separated prompt — no explanation, no markdown."
)

_AI_SYSTEM_GEOGRAPHY = (
    "You are a nature and geography anime art director. "
    "Given a geography or nature topic and its key visual, generate an Animagine XL image prompt. "
    "Show the actual place or phenomenon — Amazon canopy, volcano erupting, Saturn's rings. No classroom, no students. "
    "Art tags: anime style, nature illustration, dramatic lighting, wide establishing shot, masterpiece, best quality. "
    "Output ONLY the comma-separated prompt — no explanation, no markdown."
)

_AI_SYSTEM_SOCIAL = (
    "You are an infographic anime art director. "
    "Given an abstract concept and its key visual, generate an Animagine XL image prompt. "
    "Use symbolic visual metaphors — a pyramid for hierarchy, scales for balance. Minimal characters, concept-first. "
    "Art tags: anime style, symbolic illustration, infographic style, vibrant colors, masterpiece, best quality. "
    "Output ONLY the comma-separated prompt — no explanation, no markdown."
)

_CATEGORY_TO_AI_SYSTEM = {
    "HISTORICAL_EVENT": _AI_SYSTEM_HISTORICAL,
    "FICTIONAL_LORE":   _AI_SYSTEM_FICTIONAL,
    "GEOGRAPHY_NATURE": _AI_SYSTEM_GEOGRAPHY,
    "SOCIAL_CONCEPT":   _AI_SYSTEM_SOCIAL,
}

_AI_FALLBACKS = {
    "HISTORICAL_EVENT": "{topic}, historical scene, period-accurate, soldiers or leaders of the era, anime style, dramatic lighting, masterpiece, best quality",
    "FICTIONAL_LORE":   "{topic}, lore-accurate canonical design from source material, detailed fantasy environment, anime style, cinematic, masterpiece, best quality",
    "GEOGRAPHY_NATURE": "{topic}, wide shot of real environment or natural phenomenon, dramatic lighting, no humans, anime nature style, masterpiece, best quality",
    "SOCIAL_CONCEPT":   "{topic}, symbolic visual metaphor, infographic style, minimal characters, vibrant colors, anime illustration style, masterpiece, best quality",
}


class ImageResolver:
    def __init__(self) -> None:
        self._groq = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""), timeout=30.0, max_retries=2)
        self._google_api_key = os.environ.get("GOOGLE_API_KEY", "")
        self._google_cse_id  = os.environ.get("GOOGLE_CSE_ID", "")

    async def _groq_call(self, system: str, user: str, max_tokens: int = 200) -> str:
        try:
            r = await self._groq.chat.completions.create(
                model=_GROQ_MODEL,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                max_tokens=max_tokens,
                temperature=0.6,
            )
            return (r.choices[0].message.content or "").strip()
        except Exception as exc:
            log.warning("Groq call failed: %s", exc)
            return ""

    def _parse_classification(self, raw: str) -> tuple[str, str, str]:
        category, search_query, key_visual = "SCIENTIFIC_DIAGRAM", "", ""
        for line in raw.splitlines():
            line = line.strip()
            if line.startswith("CATEGORY:"):
                cat = line.split(":", 1)[1].strip()
                if cat in (*_GOOGLE_CATEGORIES, *_CATEGORY_TO_AI_SYSTEM):
                    category = cat
            elif line.startswith("SEARCH_QUERY:"):
                sq = line.split(":", 1)[1].strip()
                if sq.upper() != "NONE":
                    search_query = sq
            elif line.startswith("KEY_VISUAL:"):
                key_visual = line.split(":", 1)[1].strip()
        return category, search_query, key_visual

    async def _google_image_search(self, query: str) -> str | None:
        if not self._google_api_key or not self._google_cse_id:
            log.warning("Google API credentials missing — skipping")
            return None
        params = {
            "key": self._google_api_key, "cx": self._google_cse_id,
            "q": query, "searchType": "image", "safe": "active", "num": "5", "imgType": "photo",
            "rights": "cc_publicdomain,cc_attribute,cc_sharealike",
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get("https://www.googleapis.com/customsearch/v1", params=params)
                resp.raise_for_status()
                data = resp.json()
            for item in data.get("items", []):
                url = item.get("link", "")
                if url and not url.endswith(".svg"):
                    return url
            return None
        except Exception as exc:
            log.warning("Google image search failed: %s", exc)
            return None

    async def _build_ai_prompt(self, topic: str, style: str, category: str, key_visual: str) -> str:
        system = _CATEGORY_TO_AI_SYSTEM.get(category)
        if not system:
            return f"{topic}, educational illustration, anime style, masterpiece, best quality"
        user = f"Topic: {topic}\nStyle preference: {style}\nKey visual: {key_visual}"
        result = await self._groq_call(system, user, max_tokens=350)
        if result:
            return result
        return _AI_FALLBACKS.get(category, "{topic}, educational illustration, anime style, masterpiece, best quality").format(topic=topic)

    async def resolve_image(self, topic: str, style: str = "outdoor", category: str | None = None) -> ImageResult:
        search_query = ""
        key_visual = f"educational visual of {topic}"

        if category is None:
            raw = await self._groq_call(_CLASSIFIER_SYSTEM, f"Topic: {topic}", max_tokens=120)
            if raw:
                category, search_query, key_visual = self._parse_classification(raw)
            else:
                category = "SCIENTIFIC_DIAGRAM"

        if category in _GOOGLE_CATEGORIES:
            if not search_query:
                search_query = f"{topic} diagram educational"
            if "diagram" not in search_query.lower() and "chart" not in search_query.lower():
                search_query = f"{search_query} diagram"

            url = await self._google_image_search(search_query)
            if url:
                return ImageResult(source="google", url=url, search_query=search_query, category=category)
            else:
                ai_prompt = (
                    f"{topic}, simple children's science illustration, 3 to 4 key visual elements, "
                    f"bold saturated colors, large clear shapes, process shown with arrows, "
                    f"no labels, no classroom, friendly anime illustration style, masterpiece, best quality"
                )
                return ImageResult(source="ai_generated", ai_prompt=ai_prompt, search_query=search_query, category=category)
        else:
            ai_prompt = await self._build_ai_prompt(topic, style, category, key_visual)
            return ImageResult(source="ai_generated", ai_prompt=ai_prompt, category=category)


image_resolver = ImageResolver()
```

---

## How to Integrate in the Existing Codebase

Find wherever `build_anime_prompt(topic, style)` is called in the Anime (Scene Generation) model's pipeline. Replace that call with the following pattern:

```python
from image_resolver import image_resolver

result = await image_resolver.resolve_image(topic=topic, style=style)

if result.source == "google":
    # Display result.url directly — no image generation call needed
    # Pass this URL straight to the frontend <img src>
    image_url = result.url

else:
    # result.source == "ai_generated"
    # Feed result.ai_prompt into your existing Animagine XL / Pollinations call
    # exactly as you were feeding the output of build_anime_prompt() before
    image_url = await generate_image_via_pollinations(result.ai_prompt)
```

---

## Environment Variables to Add in `.env`

```
GOOGLE_API_KEY=your_google_cloud_api_key_here
GOOGLE_CSE_ID=your_custom_search_engine_id_here
```

**How to get these:**
1. `GOOGLE_API_KEY`: Go to Google Cloud Console → Enable "Custom Search JSON API" → Create API Key
2. `GOOGLE_CSE_ID`: Go to https://cse.google.com → Create new search engine → Set "Search the entire web" ON → Enable "Image search" ON → Enable "SafeSearch" ON → Copy the Search Engine ID

---

## New Dependency to Install

```bash
pip install httpx
```
(`groq` is already installed.)

---

## What This Does (Summary for your understanding)

| Topic entered by user | What happens |
|---|---|
| "Photosynthesis" | Google image search → real textbook diagram URL → display directly |
| "Concave Lens Ray Diagram" | Google image search → real labeled ray diagram → display directly |
| "Electric Motor" | Google image search → real diagram → display directly |
| "WWII" | Groq builds an Animagine XL prompt → AI generates historical anime scene |
| "Elden Ring - Queen Marika" | Groq builds lore-accurate prompt with canonical design → AI generates |
| "Amazon Rainforest" | Groq builds nature prompt → AI generates wide establishing shot |
| Google fails for any reason | Falls back to a simplified AI prompt automatically — no crash |

Do NOT modify the logic of any other model (Story, Simulation, 3D). This change only affects the Anime (Scene Generation) model's image sourcing step.
