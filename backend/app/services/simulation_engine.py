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
    """
    Fallback simulation with a real canvas + requestAnimationFrame loop.
    Used when Groq generation fails or times out.
    Satisfies Requirement 2.4: MUST use HTML5 canvas with requestAnimationFrame.
    """
    t = topic.replace("<", "&lt;").replace(">", "&gt;")
    c = category.replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>{t} Simulation</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: #0f172a; color: #e2e8f0; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; padding: 1.5rem; min-height: 100vh; }}
  h1 {{ color: #8b5cf6; font-size: 1.4rem; margin-bottom: 0.25rem; }}
  .badge {{ background: #06b6d4; color: #0f172a; border-radius: 6px; padding: 2px 10px; font-size: 0.8rem; margin-bottom: 1rem; display: inline-block; }}
  canvas {{ border-radius: 12px; border: 1px solid #1e293b; background: #0a0f1e; margin: 1rem 0; }}
  .controls {{ display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; margin-bottom: 1rem; }}
  .ctrl {{ background: #1e293b; border-radius: 10px; padding: 0.75rem 1rem; min-width: 160px; }}
  label {{ font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 4px; }}
  input[type=range] {{ width: 100%; accent-color: #8b5cf6; }}
  .info {{ background: #1e293b; border-left: 3px solid #06b6d4; border-radius: 8px; padding: 0.75rem 1rem; max-width: 560px; font-size: 0.85rem; color: #94a3b8; line-height: 1.5; }}
  .info strong {{ color: #e2e8f0; }}
</style>
</head>
<body>
<h1>{t}</h1>
<span class="badge">{c}</span>
<canvas id="c" width="560" height="320"></canvas>
<div class="controls">
  <div class="ctrl">
    <label>Speed: <span id="sv">50</span></label>
    <input type="range" id="speed" min="1" max="100" value="50">
  </div>
  <div class="ctrl">
    <label>Particles: <span id="pv">20</span></label>
    <input type="range" id="count" min="5" max="60" value="20">
  </div>
</div>
<div class="info">
  <strong>About this simulation:</strong> This interactive visualization represents concepts from <strong>{t}</strong>.
  Adjust the sliders to explore how speed and particle count affect the system.
  Each glowing dot represents a unit of energy or matter in motion.
</div>
<script>
var canvas = document.getElementById('c');
var ctx = canvas.getContext('2d');
var W = canvas.width, H = canvas.height;
var speedSlider = document.getElementById('speed');
var countSlider = document.getElementById('count');
var sv = document.getElementById('sv');
var pv = document.getElementById('pv');

var particles = [];
function makeParticle() {{
  return {{
    x: Math.random() * W,
    y: Math.random() * H,
    vx: (Math.random() - 0.5) * 2,
    vy: (Math.random() - 0.5) * 2,
    r: 3 + Math.random() * 5,
    hue: 200 + Math.random() * 120,
    life: Math.random() * Math.PI * 2
  }};
}}

function syncParticles() {{
  var n = parseInt(countSlider.value);
  while (particles.length < n) particles.push(makeParticle());
  while (particles.length > n) particles.pop();
}}
syncParticles();

speedSlider.addEventListener('input', function() {{ sv.textContent = speedSlider.value; }});
countSlider.addEventListener('input', function() {{ pv.textContent = countSlider.value; syncParticles(); }});

function draw() {{
  var spd = parseInt(speedSlider.value) / 50;
  ctx.fillStyle = 'rgba(10,15,30,0.18)';
  ctx.fillRect(0, 0, W, H);

  for (var i = 0; i < particles.length; i++) {{
    var p = particles[i];
    p.life += 0.04;
    p.x += p.vx * spd;
    p.y += p.vy * spd;
    if (p.x < 0 || p.x > W) p.vx *= -1;
    if (p.y < 0 || p.y > H) p.vy *= -1;

    var glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
    glow.addColorStop(0, 'hsla(' + p.hue + ',90%,70%,0.9)');
    glow.addColorStop(1, 'hsla(' + p.hue + ',90%,50%,0)');
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = 'hsla(' + p.hue + ',100%,80%,1)';
    ctx.fill();
  }}
  requestAnimationFrame(draw);
}}
draw();
</script>
</body>
</html>"""


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
    groq = AsyncGroq(
        api_key=os.environ.get("GROQ_API_KEY", ""),
        timeout=120.0,
        max_retries=3,
    )

    # Build a structured prompt via the prompt builder (first Groq call).
    # If this fails (e.g. Groq connection error), fall back to a direct prompt
    # so the main generation call still has a chance to succeed.
    try:
        code_gen_prompt = await prompt_builder.build_simulation_prompt(topic, category)
    except Exception:
        code_gen_prompt = (
            f"Create a complete, self-contained HTML5 interactive simulation about "
            f"'{topic}' in the '{category}' category for 6th-grade students. "
            f"Use an HTML5 canvas with requestAnimationFrame for smooth animation. "
            f"Include a control panel with at least 2 interactive sliders/buttons "
            f"and a 'Learn' info box explaining the concept in simple language."
        )

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