"""
image_resolver.py — Smart image source router for the Anime (Scene Generation) model.

Logic:
  - SCIENTIFIC_DIAGRAM  → Wikimedia Commons API (real textbook diagrams, completely free)
  - Everything else     → AI generation via Animagine XL prompt

Public API:
  resolve_image(topic, style, category?) -> ImageResult

ImageResult fields:
  source       : "wikimedia" | "ai_generated"
  url          : str | None   — direct image URL (Wikimedia path)
  ai_prompt    : str | None   — prompt to feed into Animagine XL (AI path)
  search_query : str | None   — search query used (for debug/display)
  category     : str          — classified topic type

Required env vars:
  GROQ_API_KEY      — for topic classification
  (No API key needed for Wikimedia Commons — it is completely free)
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

# ---------------------------------------------------------------------------
# Hardcoded educational topic → Wikipedia article title
# _fetch_wikimedia_image resolves these via the REST API, which always returns
# valid thumbnail URLs.  Wikimedia enforces a strict allowlist of thumbnail
# widths (20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840) — hardcoded
# full URLs with arbitrary sizes (640px, 800px, etc.) are now rejected.
# ---------------------------------------------------------------------------
_TOPIC_TITLE_MAP: dict[str, str] = {
    # Biology
    "photosynthesis":           "Photosynthesis",
    "cell division":            "Cell_division",
    "mitosis":                  "Mitosis",
    "human digestive system":   "Human_digestive_system",
    "digestive system":         "Human_digestive_system",
    "human heart":              "Heart",
    "heart":                    "Heart",
    "dna structure":            "DNA",
    "dna":                      "DNA",
    "food chain":               "Food_chain",
    "food web":                 "Food_web",
    "plant cell":               "Plant_cell",
    "animal cell":              "Animal_cell",
    "water cycle":              "Water_cycle",
    "carbon cycle":             "Carbon_cycle",
    "nitrogen cycle":           "Nitrogen_cycle",

    # Physics
    "electric motor":           "Electric_motor",
    "electric motor diagram":   "Electric_motor",
    "concave lens":             "Lens_(optics)",
    "concave lens ray diagram": "Lens_(optics)",
    "convex lens":              "Lens_(optics)",
    "convex lens ray diagram":  "Lens_(optics)",
    "reflection of light":      "Reflection_(physics)",
    "refraction of light":      "Refraction",
    "ohm's law":                "Ohm%27s_law",
    "ohms law":                 "Ohm%27s_law",
    "newton's laws":            "Newton%27s_laws_of_motion",
    "electromagnetic spectrum": "Electromagnetic_spectrum",
    "circuit diagram":          "Circuit_diagram",
    "series circuit":           "Series_and_parallel_circuits",
    "parallel circuit":         "Series_and_parallel_circuits",
    "solar system":             "Solar_System",
    "layers of earth":          "Internal_structure_of_Earth",
    "tectonic plates":          "Plate_tectonics",

    # Chemistry
    "periodic table":           "Periodic_table",
    "water molecule":           "Properties_of_water",
    "atom structure":           "Atom",
    "atomic structure":         "Atom",

    # Math
    "pythagorean theorem":      "Pythagorean_theorem",
    "pythagoras theorem":       "Pythagorean_theorem",
    "types of triangles":       "Triangle",
}

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
        # No API key needed — Wikimedia Commons is completely free

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

    async def _fetch_wikimedia_image(self, query: str) -> str | None:
        """
        Get a real educational diagram image URL via the Wikipedia REST API.

        Priority order:
        1. _TOPIC_TITLE_MAP lookup → REST API with known article title
        2. REST API with raw query as title (best-effort)
        3. opensearch → pageimages API (fuzzy match fallback)

        Returns a direct thumbnail URL (always a valid Wikimedia size), or None.
        """
        normalized = query.strip().lower()

        # ── Priority 1: Known topic → Wikipedia article title ─────────────
        title: str | None = None

        # Exact match
        if normalized in _TOPIC_TITLE_MAP:
            title = _TOPIC_TITLE_MAP[normalized]
            log.info("Title map hit: '%s' → '%s'", normalized, title)

        # Partial match (e.g. "concave lens ray diagram" matches "concave lens")
        if not title:
            for key, mapped_title in _TOPIC_TITLE_MAP.items():
                if key in normalized or normalized in key:
                    title = mapped_title
                    log.info("Partial title map match: '%s' → '%s'", normalized, key)
                    break

        # Fall back to using raw query as the title
        if not title:
            title = query.strip().replace(" ", "_")

        headers = {
            "User-Agent": "EduPlatform/1.0 (educational K-12 project)",
            "Accept": "application/json",
        }

        async with httpx.AsyncClient(timeout=10.0, headers=headers) as client:

            # ── Priority 2: Wikipedia REST summary API ─────────────────────
            # Returns thumbnail URLs with sizes from Wikimedia's allowlist
            # (330px for thumbnail, 500px+ for originalimage).
            try:
                resp = await client.get(
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
                )
                if resp.status_code == 200:
                    data = resp.json()
                    # Prefer originalimage (larger), fall back to thumbnail
                    for img_key in ("originalimage", "thumbnail"):
                        src = data.get(img_key, {}).get("source", "")
                        if src and src.startswith("http") and not src.endswith(".svg") and not src.endswith(".gif"):
                            log.info("Wikipedia REST hit for '%s' (%s): %s", title, img_key, src)
                            return src
            except Exception as exc:
                log.warning("Wikipedia REST summary failed: %s", exc)

            # ── Priority 3: opensearch → pageimages ───────────────────────
            try:
                search_resp = await client.get(
                    "https://en.wikipedia.org/w/api.php",
                    params={
                        "action": "opensearch",
                        "search": query,
                        "limit":  "3",
                        "format": "json",
                        "origin": "*",
                    },
                )
                search_resp.raise_for_status()
                titles = search_resp.json()[1] if len(search_resp.json()) > 1 else []

                for t in titles[:2]:
                    img_resp = await client.get(
                        "https://en.wikipedia.org/w/api.php",
                        params={
                            "action":      "query",
                            "titles":      t,
                            "prop":        "pageimages",
                            "pithumbsize": 1000,
                            "format":      "json",
                            "origin":      "*",
                        },
                    )
                    img_resp.raise_for_status()
                    pages = img_resp.json().get("query", {}).get("pages", {})
                    for page in pages.values():
                        src = page.get("thumbnail", {}).get("source", "")
                        if src and src.startswith("http") and not src.endswith(".svg") and not src.endswith(".gif"):
                            log.info("Wikipedia pageimages hit for '%s': %s", t, src)
                            return src
            except Exception as exc:
                log.warning("Wikipedia pageimages fallback failed: %s", exc)

        log.warning("All image strategies failed for query: %s", query)
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
            # For Wikipedia REST API, the raw topic name works best
            # e.g. "Photosynthesis" not "Photosynthesis labeled diagram"
            if not search_query:
                search_query = topic

            url = await self._fetch_wikimedia_image(search_query)
            if url:
                return ImageResult(source="wikimedia", url=url, search_query=search_query, category=category)
            else:
                ai_prompt = (
                    f"{topic} science diagram, "
                    f"isolated illustration on plain white background, "
                    f"no humans, no children, no people, no students, no characters, "
                    f"flat design infographic style, arrows showing process flow, "
                    f"bold saturated colors, clean minimal artwork, "
                    f"textbook illustration quality, educational poster style, "
                    f"masterpiece, best quality"
                )
                return ImageResult(source="ai_generated", ai_prompt=ai_prompt, search_query=search_query, category=category)
        else:
            ai_prompt = await self._build_ai_prompt(topic, style, category, key_visual)
            return ImageResult(source="ai_generated", ai_prompt=ai_prompt, category=category)


    # ---------------------------------------------------------------------------
    # Character Portrait Resolution (Bug 3)
    # ---------------------------------------------------------------------------

    # Figures for whom figurative depiction is culturally inappropriate.
    # Return a respectful non-figurative representation instead.
    _DEPICTION_RESTRICTED: set[str] = {
        "muhammad", "prophet muhammad", "mohammed", "prophet mohammed",
        "prophet muhammed", "muhammed",
    }

    async def _validate_image_url(self, url: str) -> bool:
        """HEAD-check that a URL actually returns an image (200 + image/* content-type)."""
        try:
            async with httpx.AsyncClient(
                timeout=8.0,
                headers={"User-Agent": "EduPlatform/1.0 (educational K-12 project)"},
            ) as client:
                resp = await client.head(url, follow_redirects=True)
                if resp.status_code == 200:
                    ct = resp.headers.get("content-type", "")
                    return ct.startswith("image/")
        except Exception as exc:
            log.warning("Image URL validation failed for %s: %s", url[:80], exc)
        return False

    async def resolve_character_portrait(
        self,
        name: str,
        source_work: str = "",
        topic_summary: str = "",
    ) -> "PortraitResult":
        """
        Multi-source portrait resolution for a named figure.

        Priority:
          1. Cultural sensitivity check — restricted figures get a non-figurative result.
          2. Wikipedia/Wikimedia Commons — find real reference image, then restyle
             via Pollinations image-to-image to get anime-style portrait while
             preserving the character's actual design (reference-anchored).
          3. AI generation (Pollinations) as last resort — labeled "AI Interpretation".

        Returns a PortraitResult with source, url, label.
        """
        # ── Cultural sensitivity guardrail ────────────────────────────────
        name_lower = name.strip().lower()
        if name_lower in self._DEPICTION_RESTRICTED:
            return PortraitResult(
                source="restricted",
                url=None,
                ai_prompt=None,
                label="Respectful Representation",
            )

        # ── Priority 1 & 2: Wikipedia — find a reference image ────────────
        reference_url = await self._fetch_wikimedia_image(name)
        if reference_url and not await self._validate_image_url(reference_url):
            reference_url = None

        if not reference_url and source_work:
            combined_query = f"{name} {source_work}"
            reference_url = await self._fetch_wikimedia_image(combined_query)
            if reference_url and not await self._validate_image_url(reference_url):
                reference_url = None

        # ── If reference found: build a reference-anchored restyled URL ───
        if reference_url:
            # Build a Pollinations image-to-image URL that preserves identity
            restyle_prompt = (
                f"Redraw this character exactly as shown in the reference image, "
                f"in high-quality anime illustration style. "
                f"Character: {name}"
                + (f" from {source_work}" if source_work else "")
                + ". Preserve exact face shape, hair color, hair style, eye color, "
                f"eye pattern, outfit design, and color scheme. "
                f"Do not change or reinterpret the character design. "
                f"Clean background, professional anime portrait."
            )
            import urllib.parse
            encoded_prompt = urllib.parse.quote(restyle_prompt)
            encoded_ref = urllib.parse.quote(reference_url)
            restyled_url = (
                f"https://image.pollinations.ai/prompt/{encoded_prompt}"
                f"?image={encoded_ref}"
                f"&width=512&height=512&nologo=true"
            )
            return PortraitResult(
                source="reference_styled",
                url=restyled_url,
                reference_url=reference_url,
                label="Reference-Styled",
            )

        # ── Priority 3: AI generation (last resort) ──────────────────────
        # Build the most detailed prompt possible from available information
        appearance_hint = ""
        if topic_summary:
            # Ask Groq to extract appearance details
            try:
                desc_prompt = (
                    f"From the following text, extract ONLY the physical appearance "
                    f"details of '{name}' (hair color, clothing, weapons, distinctive "
                    f"features). If no appearance details are found, describe what "
                    f"'{name}' would typically look like based on their role. "
                    f"Output ONLY comma-separated visual descriptors.\n\n{topic_summary[:500]}"
                )
                appearance_hint = await self._groq_call(
                    "You extract visual appearance descriptors from text. "
                    "Output ONLY comma-separated visual tags — no explanation.",
                    desc_prompt,
                    max_tokens=100,
                )
            except Exception:
                pass

        ai_prompt = (
            f"portrait of {name}"
            + (f", {appearance_hint}" if appearance_hint else "")
            + (f", from {source_work}" if source_work else "")
            + ", detailed character portrait, high quality, masterpiece"
        )

        return PortraitResult(
            source="ai_interpretation",
            url=None,
            ai_prompt=ai_prompt,
            label="AI Interpretation",
        )


@dataclass
class PortraitResult:
    """Result from character portrait resolution."""
    source: str  # "wikimedia" | "reference_styled" | "ai_interpretation" | "restricted"
    url: str | None = None
    ai_prompt: str | None = None
    reference_url: str | None = None  # original Wikipedia image used as reference
    label: str = "Reference Image"


image_resolver = ImageResolver()

