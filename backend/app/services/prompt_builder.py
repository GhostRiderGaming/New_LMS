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
# Topic classifier system prompt
# ---------------------------------------------------------------------------
# Used BEFORE image prompt generation to understand what kind of visual
# the topic actually needs — diagram, historical scene, or fictional lore.

_CLASSIFIER_SYSTEM = (
    "You are a topic classifier for an educational image generation pipeline. "
    "Given a topic, classify it into exactly one of these categories and explain the key visual:\n\n"
    "SCIENTIFIC_DIAGRAM — A biology/chemistry/physics/math concept that needs a clear visual explanation "
    "(e.g. Photosynthesis, Newton's Laws, Cell Division, Pythagorean Theorem). "
    "Focus: a SIMPLE, VISUAL SCENE showing the concept happening — like a children's science book illustration. "
    "The KEY_VISUAL must describe what a 12-year-old would INSTANTLY understand: "
    "show the process or result, not a complex diagram. "
    "Example for Photosynthesis: 'a bright green cartoon leaf with sunlight arrows entering, "
    "oxygen bubbles floating out, and glowing glucose energy at the base, clean blue sky background'. "
    "NEVER describe a classroom, a student, a chalkboard, or a complex labeled cross-section.\n\n"
    "HISTORICAL_EVENT — A real-world historical event, war, civilization, or period "
    "(e.g. WWII, French Revolution, Ancient Egypt, Cold War). "
    "Focus: the key scene, era, or iconic moment — soldiers, ruins, maps, leaders.\n\n"
    "FICTIONAL_LORE — A fictional universe, character, or event from games, anime, literature, mythology "
    "(e.g. Elden Ring, Naruto, Greek Mythology, Lord of the Rings). "
    "Focus: the canonical visual — existing character design, iconic scene, lore-accurate depiction.\n\n"
    "GEOGRAPHY_NATURE — A place, ecosystem, natural phenomenon, or geography topic "
    "(e.g. Amazon Rainforest, Volcanoes, Solar System, Tectonic Plates). "
    "Focus: the real visual of that place or phenomenon.\n\n"
    "SOCIAL_CONCEPT — An abstract social, economic, or psychological concept "
    "(e.g. Democracy, Supply and Demand, Maslow's Hierarchy). "
    "Focus: an infographic-style or symbolic scene representing the concept.\n\n"
    "Respond in this EXACT format (no markdown, no extra text):\n"
    "CATEGORY: <one of the five above>\n"
    "KEY_VISUAL: <one sentence describing the single most iconic/accurate visual for this topic>\n"
    "AVOID: <one sentence describing what to NOT show — generic classroom, random students, etc.>"
)

# ---------------------------------------------------------------------------
# Image prompt system prompts (one per topic category)
# ---------------------------------------------------------------------------

_ANIME_SCIENTIFIC = (
    "You are a children's science book illustrator creating images for 6th–10th grade students. "
    "Given a scientific topic and its key visual, generate an Animagine XL image prompt. "
    "\n\n"
    "GOLDEN RULE: The image must be INSTANTLY understandable to a 12-year-old who has never studied this topic. "
    "Show the PROCESS or CONCEPT happening visually — not a complex diagram full of labels. "
    "\n\n"
    "HOW TO DESIGN IT:\n"
    "- Show the concept as a simple, clear SCENE or STORY MOMENT (e.g. Photosynthesis = a bright cartoon "
    "leaf with sunlight arrows going IN and oxygen bubbles coming OUT, glucose shown as glowing energy)\n"
    "- Use a MAXIMUM of 3-4 visual elements — do not crowd the image\n"
    "- Bold, saturated, friendly colors — like a children's science book, not a research paper\n"
    "- Large, clear shapes that read well even as a thumbnail\n"
    "- No tiny text labels in the image itself\n"
    "- No complex cross-sections unless the topic specifically requires it (e.g. Earth's layers)\n"
    "- If the concept has a direction/flow (energy, force, cycle), show it with arrows or glowing paths\n"
    "\n"
    "Art quality tags to always include: anime illustration style, children's educational book art, "
    "bright saturated colors, simple clean composition, large clear shapes, "
    "friendly and approachable style, masterpiece, best quality. "
    "\n"
    "Output ONLY the comma-separated prompt string — no explanation, no markdown."
)

_ANIME_HISTORICAL = (
    "You are a historical anime art director. "
    "Given a historical event and its key visual, generate an Animagine XL image prompt. "
    "The image MUST depict the actual historical scene — soldiers, leaders, battles, ruins, or maps "
    "from the correct era and location. Show the real environment (e.g. WWII: bombed European cities, "
    "soldiers in period-accurate uniforms, warplanes; French Revolution: revolutionary crowd, guillotine, Bastille). "
    "ABSOLUTELY DO NOT show: classrooms, modern furniture, contemporary technology, students sitting at desks, "
    "whiteboards, projectors, or any modern educational setting. The scene must be period-accurate. "
    "Art tags: anime style, cinematic composition, dramatic lighting, historical accuracy, "
    "detailed environment, masterpiece, best quality. "
    "Output ONLY the comma-separated prompt string — no explanation, no markdown."
)

_ANIME_FICTIONAL = (
    "You are a lore-accurate anime art director. "
    "Given a fictional universe topic and its key visual, generate an Animagine XL image prompt. "
    "CRITICAL: If the topic involves a known character (e.g. Queen Marika, Naruto, Sauron), "
    "describe their CANONICAL design as accurately as possible — hair, clothing, weapons, colors "
    "as seen in the source material. Do NOT invent a generic character. "
    "For events (e.g. Night of the Black Knives in Elden Ring), show the iconic scene from the lore. "
    "ABSOLUTELY DO NOT show: classrooms, modern furniture, contemporary technology, students sitting at desks, "
    "whiteboards, or any modern educational setting. Show the actual fantasy/fictional environment. "
    "Art tags: anime style, official art style, lore-accurate, highly detailed, cinematic, "
    "masterpiece, best quality. "
    "Output ONLY the comma-separated prompt string — no explanation, no markdown."
)

_ANIME_GEOGRAPHY = (
    "You are a nature and geography anime art director. "
    "Given a geography or nature topic and its key visual, generate an Animagine XL image prompt. "
    "The image MUST show the actual place or phenomenon — the Amazon canopy, a volcano erupting, "
    "Saturn's rings, tectonic plates shifting. No classroom, no students, no modern educational setting, "
    "no desks, no whiteboards. "
    "Art tags: anime style, nature illustration, photorealistic detail, dramatic lighting, "
    "wide establishing shot, masterpiece, best quality. "
    "Output ONLY the comma-separated prompt string — no explanation, no markdown."
)

_ANIME_SOCIAL = (
    "You are an infographic anime art director. "
    "Given an abstract social or economic concept and its key visual, generate an Animagine XL image prompt. "
    "The image should use symbolic visual metaphors or a clean infographic-style scene — "
    "e.g. a pyramid for hierarchy, scales for balance, a network for democracy. "
    "Minimal characters; focus on concept visualization. "
    "DO NOT show a classroom, students at desks, a teacher at a whiteboard, or any modern school setting. "
    "Art tags: anime style, symbolic illustration, infographic style, clean composition, "
    "vibrant accent colors, masterpiece, best quality. "
    "Output ONLY the comma-separated prompt string — no explanation, no markdown."
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
    "You are an elite Principal Software Engineer and UI/UX Architect with 15+ years of experience, building breathtaking educational simulations. "
    "Given a topic, output a concise code generation prompt that instructs an LLM to produce a self-contained HTML/JS simulation of exceptional quality. "
    "The prompt MUST demand: "
    "1) A strict CSS Design System (CSS variables for a sleek #0f172a dark mode, system-ui typography, glassmorphism panels with backdrop-filter). "
    "2) A professional layout (e.g. Flexbox/Grid with a sidebar for controls/info and a main stage for the canvas). "
    "3) Beautifully styled custom UI controls (custom range sliders, buttons with hover transitions). "
    "4) High-performance canvas graphics with vibrant, glowing colors and requestAnimationFrame 60fps loops. "
    "5) A dynamic, flawlessly written 'Learn' info box that perfectly explains the concept and updates in real-time. "
    "6) No external libraries. "
    "Output ONLY the prompt string — no explanation, no markdown."
)

_MODEL3D_SYSTEM = (
    "You are a 3D asset art director for an educational platform. "
    "Given an object name and category, output a detailed text-to-3D generation prompt "
    "for Hunyuan3D-2.1 that describes the object's shape, materials, and educational detail. "
    "Include the object name. "
    "Output ONLY the prompt string — no explanation, no markdown."
)

def _get_explanation_system(language: str | None) -> str:
    if language == "hindi":
        return (
            "You are Bella, an enthusiastic and warm educational tutor with an anime personality. "
            "You speak in Hinglish — a natural mix of Hindi and English. Use Hindi for conversational parts "
            "and English for technical terms (e.g. 'Yeh photosynthesis ka process hai jisme plants...'). "
            "A student just opened a topic in a specific educational module and is looking at it right now. "
            "\n\n"
            "YOUR JOB: Explain what the student is SEEING, then teach the concept behind it. "
            "\n\n"
            "RULES:\n"
            "- Start by acknowledging what they are looking at based on the section (e.g. 'Yeh simulation...', 'Is 3D model mein...', 'Yeh scene dekho...')\n"
            "- Explain the concept in 2-3 brief sentences in very simple, clear, and easy-to-understand Hinglish\n"
            "- End with one fun fact or cool detail about the topic\n"
            "- Speak directly to the student. Be encouraging.\n"
            "- Use basic language a school student would understand\n"
            "- Output ONLY the spoken explanation — no markdown, no bullets, no headers, no emojis."
        )
    else:
        return (
            "You are Bella, an enthusiastic and warm educational tutor with an anime personality. "
            "You speak clearly in English. "
            "A student just opened a topic in a specific educational module and is looking at it right now. "
            "\n\n"
            "YOUR JOB: Explain what the student is SEEING, then teach the concept behind it. "
            "\n\n"
            "RULES:\n"
            "- Start by acknowledging what they are looking at based on the section (e.g. 'This simulation...', 'In this 3D model...', 'Look at this scene...')\n"
            "- Explain the concept in 2-3 brief sentences in very simple, clear, and easy-to-understand English\n"
            "- End with one fun fact or cool detail about the topic\n"
            "- Speak directly to the student. Be encouraging.\n"
            "- Use basic language a school student would understand\n"
            "- Output ONLY the spoken explanation — no markdown, no bullets, no headers, no emojis."
        )

# ---------------------------------------------------------------------------
# Category → system prompt mapping
# ---------------------------------------------------------------------------

_CATEGORY_TO_SYSTEM: dict[str, str] = {
    "SCIENTIFIC_DIAGRAM": _ANIME_SCIENTIFIC,
    "HISTORICAL_EVENT":   _ANIME_HISTORICAL,
    "FICTIONAL_LORE":     _ANIME_FICTIONAL,
    "GEOGRAPHY_NATURE":   _ANIME_GEOGRAPHY,
    "SOCIAL_CONCEPT":     _ANIME_SOCIAL,
}

# Hard-coded fallback prompts per category (used when Groq is unavailable)
_FALLBACK_BY_CATEGORY: dict[str, str] = {
    "SCIENTIFIC_DIAGRAM": (
        "{topic}, simple educational scene showing the concept visually, "
        "bright cartoon-style illustration, only 3 to 4 key visual elements, "
        "bold saturated colors, large clear shapes, process shown with glowing arrows or flow, "
        "no complex labels, no classroom, no students, "
        "anime children's book illustration style, friendly and approachable, masterpiece, best quality"
    ),
    "HISTORICAL_EVENT": (
        "{topic}, historical scene, period-accurate environment, dramatic cinematic shot, "
        "soldiers or leaders of the era, authentic architecture and clothing, "
        "anime style, epic composition, dramatic lighting, masterpiece, best quality"
    ),
    "FICTIONAL_LORE": (
        "{topic}, lore-accurate character or scene, canonical design from source material, "
        "detailed fantasy environment, dramatic atmosphere, "
        "anime style, official art quality, cinematic, masterpiece, best quality"
    ),
    "GEOGRAPHY_NATURE": (
        "{topic}, wide establishing shot of the real environment or phenomenon, "
        "dramatic natural lighting, no human characters, accurate geography, "
        "anime nature art style, lush detail, masterpiece, best quality"
    ),
    "SOCIAL_CONCEPT": (
        "{topic}, symbolic visual metaphor illustrating the concept, infographic style, "
        "minimal characters, clean composition, vibrant accent colors, "
        "anime illustration style, masterpiece, best quality"
    ),
}


# ---------------------------------------------------------------------------
# PromptBuilder
# ---------------------------------------------------------------------------

class PromptBuilder:
    def __init__(self) -> None:
        self._groq = AsyncGroq(
            api_key=os.environ.get("GROQ_API_KEY", ""),
            timeout=30.0,
            max_retries=2,
        )

    async def _call(self, system: str, user: str, max_tokens: int = 300, **kwargs) -> str:
        """Call Groq and return the response text.  Returns empty string on failure."""
        try:
            completion = await self._groq.chat.completions.create(
                model=_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                max_tokens=max_tokens,
                temperature=0.7,
                **kwargs,
            )
            return (completion.choices[0].message.content or "").strip()
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "PromptBuilder Groq call failed (%s) — using fallback prompt", exc
            )
            return ""

    # -----------------------------------------------------------------------
    # Topic classification (internal)
    # -----------------------------------------------------------------------

    async def _classify_topic(self, topic: str) -> tuple[str, str]:
        """
        Classify the topic into a visual category and extract the key visual description.

        Returns:
            (category, key_visual) where category is one of SCIENTIFIC_DIAGRAM,
            HISTORICAL_EVENT, FICTIONAL_LORE, GEOGRAPHY_NATURE, SOCIAL_CONCEPT.
            Falls back to SCIENTIFIC_DIAGRAM if classification fails.
        """
        raw = await self._call(_CLASSIFIER_SYSTEM, f"Topic: {topic}", max_tokens=120)
        category = "SCIENTIFIC_DIAGRAM"
        key_visual = f"accurate educational visual of {topic}"

        if raw:
            for line in raw.splitlines():
                line = line.strip()
                if line.startswith("CATEGORY:"):
                    cat = line.split(":", 1)[1].strip()
                    if cat in _CATEGORY_TO_SYSTEM:
                        category = cat
                elif line.startswith("KEY_VISUAL:"):
                    key_visual = line.split(":", 1)[1].strip()

        return category, key_visual

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    async def build_anime_prompt(self, topic: str, style: str) -> str:
        """
        Build an Animagine XL prompt for the given topic and style.
        Style: classroom | laboratory | outdoor | fantasy

        Flow:
          1. Classify the topic → category + key_visual
          2. Pick the matching system prompt for that category
          3. Ask Groq to produce a precise, context-aware image prompt
          4. Fall back to a hard-coded category-specific template if Groq fails
        """
        # Step 1 — Classify
        category, key_visual = await self._classify_topic(topic)

        # Step 2 — Pick the right system prompt
        system = _CATEGORY_TO_SYSTEM[category]

        # Step 3 — Generate the image prompt
        user = (
            f"Topic: {topic}\n"
            f"Style preference: {style}\n"
            f"Key visual to depict: {key_visual}"
        )
        result = await self._call(system, user, max_tokens=350)
        if result:
            return result

        # Step 4 — Category-aware fallback
        template = _FALLBACK_BY_CATEGORY[category]
        return template.format(topic=topic)

    async def build_story_prompt(self, topic: str, episode_count: int) -> str:
        """Build a story planning prompt for the given topic and episode count."""
        user = f"Topic: {topic}\nEpisode count: {episode_count}"
        result = await self._call(_STORY_SYSTEM, user)
        if result:
            return result
        return (
            f"Create a structured JSON StoryPlan about '{topic}' with {episode_count} episodes. "
            f"Include: title, synopsis, list of characters, and for each episode: "
            f"episode_number, title, scenes with description and caption."
        )

    async def build_simulation_prompt(self, topic: str, category: str) -> str:
        """
        Build a simulation code generation prompt.
        Category: physics | chemistry | biology | mathematics | history
        """
        user = f"Topic: {topic}\nCategory: {category}"
        result = await self._call(_SIMULATION_SYSTEM, user)
        if result:
            return result
        return (
            f"Create a PhET-grade interactive HTML5 simulation about '{topic}' in the '{category}' category. "
            f"Act as a Principal SWE with 15+ years of experience. You MUST implement: "
            f"1) Strict two-column CSS grid: left sidebar (340px) with 6 glassmorphism section cards "
            f"(Title, Definition, Formula, Live Measurements, Controls with custom sliders + Play/Pause + Reset, Did You Know). "
            f"Right panel (1fr) with full-height HTML5 canvas. "
            f"2) MAKE THE INVISIBLE VISIBLE: Draw labeled force vectors (gravity=#f472b6, normal=#34d399, friction=#fbbf24) "
            f"on all objects. Draw velocity (cyan) and acceleration (pink dashed) arrows from object centers. "
            f"3) ENERGY BAR CHART: Render a live KE vs PE bar chart overlay in the bottom-right corner of the canvas. "
            f"4) DRAGGABLE OBJECT: At least one canvas object must be draggable with cursor:grab affordance and hover glow. "
            f"5) MVC CODE: Separate state object, update(dt) for physics (no ctx calls), render() for drawing (no state mutation). "
            f"6) Canvas: radial gradient background, dot grid, 30-50 ambient floating particles, "
            f"globalCompositeOperation='lighter' glow effects, fading trails. "
            f"7) CSS variables: --bg: #060a14, --bg-card: rgba(12,18,36,0.85), --accent: #6366f1, --cyan: #22d3ee. "
            f"Zero scrollbars on body/html. Responsive mobile stack. "
            f"The simulation must rival PhET (University of Colorado) in visual quality and educational depth."
        )

    async def build_3d_prompt(self, object_name: str, category: str) -> str:
        """
        Build a text-to-3D generation prompt for Hunyuan3D-2.1.
        Category: anatomy | chemistry | astronomy | historical | mechanical
        """
        user = f"Object: {object_name}\nCategory: {category}"
        result = await self._call(_MODEL3D_SYSTEM, user)
        if result:
            return result
        return (
            f"A detailed, high-quality 3D model of a {object_name} for educational purposes. "
            f"Category: {category}. Realistic materials, accurate proportions, clean geometry."
        )

    async def build_explanation_prompt(self, topic: str, section: str | None = None, image_context: dict | None = None, language: str | None = None) -> str:
        """
        Generate a spoken educational explanation of the topic for Bella's voice narration.
        Used after generating content in any section.
        """
        # Build a rich user message that tells the LLM what the student sees
        parts = [f"Topic: {topic}"]

        if section == 'simulation':
            parts.append("Context: The student just opened an interactive web simulation about this topic.")
            parts.append("Instruction: Tell them what they can learn by playing with this simulation.")
        elif section == 'model3d':
            parts.append("Context: The student just generated a 3D model of this topic.")
            parts.append("Instruction: Tell them to rotate and inspect the 3D model, and explain its key features.")
        elif section == 'story':
            parts.append("Context: The student just generated an educational story/visual novel about this topic.")
            parts.append("Instruction: Give a brief teaser of what they will learn by reading the story.")
        else:
            # Default or Anime (Scene Forge)
            if image_context:
                source = image_context.get("source", "")
                category = image_context.get("category", "")
                caption = image_context.get("caption", "")
                prompt = image_context.get("prompt", "")

                if source == "external":
                    parts.append("Image type: Real educational diagram from Wikipedia/Wikimedia Commons")
                    parts.append("The student is looking at a real textbook-quality diagram.")
                else:
                    parts.append("Image type: AI-generated anime-style educational illustration")
                    if prompt:
                        parts.append(f"The image was generated from this prompt: {prompt}")

                if category:
                    parts.append(f"Category: {category}")
                if caption:
                    parts.append(f"Image caption: {caption}")

        user = "\n".join(parts)
        result = await self._call(_get_explanation_system(language), user, max_tokens=400)
        if result:
            return result
        # Fallback
        if language == "hindi":
            return (
                f"Great choice! Toh, {topic} ek bahut hi fascinating subject hai. "
                f"Isme bahut kuch seekhne ko milta hai. Chalo isko explore karte hain! "
                f"Agar koi sawaal ho toh mujhse poocho."
            )
        else:
            return (
                f"Great choice! {topic} is a fascinating subject. "
                f"There's so much to learn about it. Let's explore it together! "
                f"If you have any questions, just ask me."
            )


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------

prompt_builder = PromptBuilder()
