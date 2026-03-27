"""
Prompt builder service — uses Groq API (LLaMA 3.3 70B) to generate
structured prompts for each generation pipeline.

Public API:
  build_anime_prompt(topic, style) -> str
  build_story_prompt(topic, episode_count) -> str
  build_simulation_prompt(topic, category) -> str
  build_3d_prompt(object_name, category) -> str

Each function calls Groq and returns a non-empty structured prompt string.
Requirement 1.2: Generator SHALL produce a structured Prompt from the Topic
before invoking any image model.
"""
from __future__ import annotations

import os

from groq import AsyncGroq

_MODEL = "llama-3.3-70b-versatile"

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_ANIME_SYSTEM = (
    "You are an anime art director for an educational platform. "
    "Given a topic and style, output a single Animagine XL image prompt. "
    "Format: comma-separated tags describing character, setting, educational element, "
    "art quality tags. Include the topic keywords. "
    "Output ONLY the prompt string — no explanation, no markdown."
)

_STORY_SYSTEM = (
    "You are an educational anime story writer. "
    "Given a topic and episode count, output a concise story generation prompt "
    "that instructs an LLM to create a structured JSON StoryPlan. "
    "The prompt must reference the topic, specify the episode count, "
    "and request: title, synopsis, characters list, episodes list with scenes. "
    "Output ONLY the prompt string — no explanation, no markdown."
)

_SIMULATION_SYSTEM = (
    "You are an educational simulation developer. "
    "Given a topic and category, output a concise code generation prompt "
    "that instructs an LLM to produce a self-contained HTML/JS simulation "
    "using D3.js, Matter.js, or Three.js (browser-only, no external URLs). "
    "The prompt must reference the topic and category. "
    "Output ONLY the prompt string — no explanation, no markdown."
)

_MODEL3D_SYSTEM = (
    "You are a 3D asset art director for an educational platform. "
    "Given an object name and category, output a detailed text-to-3D generation prompt "
    "for Hunyuan3D-2.1 that describes the object's shape, materials, and educational detail. "
    "Include the object name. "
    "Output ONLY the prompt string — no explanation, no markdown."
)


# ---------------------------------------------------------------------------
# PromptBuilder
# ---------------------------------------------------------------------------

class PromptBuilder:
    def __init__(self) -> None:
        self._groq = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""))

    async def _call(self, system: str, user: str) -> str:
        completion = await self._groq.chat.completions.create(
            model=_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_tokens=300,
            temperature=0.7,
        )
        return (completion.choices[0].message.content or "").strip()

    async def build_anime_prompt(self, topic: str, style: str) -> str:
        """
        Build an Animagine XL prompt for the given topic and style.
        Style: classroom | laboratory | outdoor | fantasy
        """
        user = f"Topic: {topic}\nStyle: {style}"
        return await self._call(_ANIME_SYSTEM, user)

    async def build_story_prompt(self, topic: str, episode_count: int) -> str:
        """Build a story planning prompt for the given topic and episode count."""
        user = f"Topic: {topic}\nEpisode count: {episode_count}"
        return await self._call(_STORY_SYSTEM, user)

    async def build_simulation_prompt(self, topic: str, category: str) -> str:
        """
        Build a simulation code generation prompt.
        Category: physics | chemistry | biology | mathematics | history
        """
        user = f"Topic: {topic}\nCategory: {category}"
        return await self._call(_SIMULATION_SYSTEM, user)

    async def build_3d_prompt(self, object_name: str, category: str) -> str:
        """
        Build a text-to-3D generation prompt for Hunyuan3D-2.1.
        Category: anatomy | chemistry | astronomy | historical | mechanical
        """
        user = f"Object: {object_name}\nCategory: {category}"
        return await self._call(_MODEL3D_SYSTEM, user)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

prompt_builder = PromptBuilder()
