"""
Simulation code generation service.
Requirements: 2.1, 2.2, 2.4, 2.5
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from enum import Enum
from html.parser import HTMLParser
from typing import Optional

from groq import AsyncGroq
from sqlalchemy.orm import Session

from app.models.anime_assets import Asset
from app.services.asset_manager import asset_manager
from app.services.prompt_builder import prompt_builder

_GROQ_MODEL = "llama-3.3-70b-versatile"


class SimulationCategory(str, Enum):
    physics = "physics"
    chemistry = "chemistry"
    biology = "biology"
    mathematics = "mathematics"
    history = "history"


_SIMULATION_SYSTEM = (
    "You are a world-class educational simulation developer building interactive learning tools for 6th-grade students (ages 11-12).\n"
    "Generate a COMPLETE, self-contained HTML5 simulation that makes complex concepts visually intuitive.\n\n"
    "MANDATORY REQUIREMENTS:\n"
    "1. Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown fencing, no explanation.\n"
    "2. ALL JavaScript inline in <script> tags. ALL CSS inline in <style> tags.\n"
    "3. ZERO external URLs — no CDN links, no external scripts/stylesheets. Vanilla JS only.\n"
    "4. You MUST use an HTML5 <canvas> element with a requestAnimationFrame() loop for smooth, continuous animation.\n"
    "5. Include a CONTROL PANEL with at least 2 interactive elements (sliders, buttons, toggles) that change the simulation in real-time.\n"
    "6. Include a 'LEARN' info box that explains what's happening in simple language a 6th grader can understand.\n"
    "7. Use this premium dark theme: background #0f172a, accent colors #8b5cf6 (purple) and #06b6d4 (cyan), white text.\n"
    "8. The canvas must show ANIMATED MOVEMENT — particles, objects, waves, orbits, chemical reactions, etc. NOT just static shapes.\n"
    "9. Add visual labels ON the canvas (drawText) to explain what each element represents.\n"
    "10. Use clear variable names and add brief code comments so students can learn from the code too.\n\n"
    "STYLE: glassmorphism panels (backdrop-filter: blur), rounded corners, subtle box shadows, glowing accents.\n"
    "LANGUAGE: All text in the UI must use simple words a 6th grader would understand. Avoid jargon.\n"
    "LENGTH: The simulation should be thorough and complete. Do NOT cut corners or truncate code.\n"
)


class _ExternalURLChecker(HTMLParser):
    _EXTERNAL = re.compile(r"^https?://", re.IGNORECASE)

    def __init__(self) -> None:
        super().__init__()
        self.external_urls: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        for attr_name, attr_value in attrs:
            if attr_name in ("src", "href") and attr_value:
                if self._EXTERNAL.match(attr_value):
                    self.external_urls.append((attr_name, attr_value))


def _validate_html(html: str) -> None:
    checker = _ExternalURLChecker()
    try:
        checker.feed(html)
    except Exception as exc:
        raise ValueError(f"HTML parse error: {exc}") from exc
    if checker.external_urls:
        raise ValueError(
            f"Simulation contains external URLs: {checker.external_urls[:3]}"
        )


def _extract_html(raw: str) -> str:
    stripped = re.sub(r"^```(?:html)?\s*\n?", "", raw.strip(), flags=re.IGNORECASE)
    stripped = re.sub(r"\n?```\s*$", "", stripped.strip())
    return stripped.strip()


def _inline_external_scripts(html: str) -> str:
    html = re.sub(
        r'<script\s+[^>]*src=["\']https?://[^"\']+["\'][^>]*>.*?</script>',
        "<!-- external script removed -->",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    html = re.sub(
        r'<link\s+[^>]*href=["\']https?://[^"\']+["\'][^>]*/?>',
        "<!-- external link removed -->",
        html,
        flags=re.IGNORECASE,
    )
    return html


def _fallback_simulation(topic: str, category: str) -> str:
    t = topic.replace("<", "&lt;").replace(">", "&gt;")
    c = category.replace("<", "&lt;").replace(">", "&gt;")
    return (
        "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
        f"<title>{t}</title>"
        "<style>body{{background:#1a1a2e;color:#e2e8f0;font-family:sans-serif;"
        "padding:2rem;text-align:center}}h1{{color:#7c3aed}}"
        ".card{{background:#16213e;border:1px solid #7c3aed;border-radius:12px;"
        "padding:2rem;max-width:600px;margin:2rem auto}}"
        ".badge{{display:inline-block;background:#06b6d4;color:#0a0a0f;"
        "border-radius:6px;padding:.25rem .75rem;font-size:.85rem;margin-bottom:1rem}}"
        "button{{background:#7c3aed;color:white;border:none;border-radius:8px;"
        "padding:.5rem 1.5rem;cursor:pointer;font-size:1rem;margin-top:1rem}}"
        "#info{{margin-top:1rem;color:#06b6d4;min-height:2rem}}</style></head>"
        f"<body><h1>{t}</h1><div class='card'><span class='badge'>{c}</span>"
        f"<p>Interactive simulation: <strong>{t}</strong></p>"
        "<label for='p'>Parameter: <span id='v'>50</span></label><br>"
        "<input type='range' id='p' min='0' max='100' value='50' "
        "style='width:80%;margin:1rem 0'><br>"
        "<button id='b'>Explain</button><div id='info'></div></div>"
        "<script>"
        "var s=document.getElementById('p'),v=document.getElementById('v'),"
        "i=document.getElementById('info');"
        "var f=['Increasing amplifies the effect.','At max, system saturates.',"
        "'Relationship is approximately linear.','Try different values.'];"
        "s.addEventListener('input',function(){v.textContent=s.value;"
        "i.textContent='Value: '+s.value+' - '+f[Math.floor(s.value/26)];});"
        "document.getElementById('b').addEventListener('click',function(){"
        f"i.textContent='Topic: {t}. Category: {c}. Adjust slider to explore.'"
        ";});</script></body></html>"
    )


async def generate_simulation(
    topic: str,
    category: str,
    db: Session,
    session_id: str,
    job_id: str,
) -> Asset:
    """
    Generate a self-contained HTML simulation.
    Requirements: 2.1, 2.2, 2.4, 2.5
    """
    groq = AsyncGroq(api_key=os.environ.get("GROQ_API_KEY", ""))

    code_gen_prompt = await prompt_builder.build_simulation_prompt(topic, category)

    try:
        completion = await groq.chat.completions.create(
            model=_GROQ_MODEL,
            messages=[
                {"role": "system", "content": _SIMULATION_SYSTEM},
                {"role": "user", "content": code_gen_prompt},
            ],
            max_tokens=8192,
            temperature=0.4,
        )
        raw_output = (completion.choices[0].message.content or "").strip()
    except Exception:
        raw_output = ""

    html = _extract_html(raw_output) if raw_output else ""
    if html:
        html = _inline_external_scripts(html)

    use_fallback = False
    if not html or "<!DOCTYPE" not in html.upper():
        use_fallback = True
    else:
        try:
            _validate_html(html)
        except ValueError:
            use_fallback = True

    if use_fallback:
        html = _fallback_simulation(topic, category)

    html_bytes = html.encode("utf-8")
    key = f"simulation/{job_id}/{uuid.uuid4()}.html"
    now = datetime.now(timezone.utc)

    asset_manager.store_asset(
        data=html_bytes,
        key=key,
        content_type="text/html; charset=utf-8",
        topic=topic,
        asset_type="simulation",
        metadata={"category": category, "fallback": use_fallback},
        created_at=now,
    )

    asset = Asset(
        asset_id=str(uuid.uuid4()),
        job_id=job_id,
        type="simulation",
        topic=topic,
        file_path=key,
        file_size_bytes=len(html_bytes),
        mime_type="text/html; charset=utf-8",
        asset_metadata={"category": category, "fallback": use_fallback},
        created_at=now,
        session_id=session_id,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset