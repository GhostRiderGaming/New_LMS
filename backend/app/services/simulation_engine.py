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
    "You are an elite educational simulation engineer building interactive learning tools for middle and high school students.\n"
    "Generate a COMPLETE, self-contained HTML5 simulation that makes complex mathematical or scientific concepts visually intuitive.\n\n"
    "MANDATORY REQUIREMENTS:\n"
    "1. Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown fencing, no explanation.\n"
    "2. ALL JavaScript inline in <script> tags. ALL CSS inline in <style> tags.\n"
    "3. ZERO external URLs — no CDN links, no external scripts/stylesheets. Vanilla JS only.\n"
    "4. Canvas & Loop: You MUST use an HTML5 <canvas> element with a requestAnimationFrame() loop for smooth 60fps animation.\n"
    "5. Interactivity: Include a CONTROL PANEL with at least 3 interactive elements (sliders, dropdowns, buttons) that change the simulation in real-time.\n"
    "6. Scenarios: You MUST include a <select> dropdown that lets the user switch between at least 2 distinct 'Cases' or 'Scenarios' (e.g. Reflection vs Refraction, Isotope A vs B).\n"
    "7. Dynamic Pedagogy: Include a 'LEARN' info box whose text updates dynamically via JavaScript based on the current slider/dropdown values. Do not just use static text.\n"
    "8. High-Quality Graphics: The canvas must feature complex rendering. Use paths, dashed lines (setLineDash) for rays/vectors, trails (rgba clear trick) for orbits, and glowing effects (shadowBlur).\n"
    "9. Visual Pedagogy: Draw explicit vectors, force arrows, light rays, or grid lines to make invisible forces visible. Label them dynamically.\n"
    "10. Styling: Use a premium dark theme: background #0f172a, panels #1e293b, accent colors #8b5cf6 (purple) and #06b6d4 (cyan). Use glassmorphism (backdrop-filter: blur) and rounded corners.\n"
    "11. DO NOT truncate the code. The JavaScript physics math must be rigorous and fully implemented.\n"
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
  * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }}
  body {{ background: #0f172a; color: #e2e8f0; display: flex; flex-direction: column; align-items: center; padding: 1.5rem; min-height: 100vh; }}
  .container {{ width: 100%; max-width: 800px; display: flex; flex-direction: column; gap: 1rem; }}
  .header {{ display: flex; justify-content: space-between; align-items: center; background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); padding: 1rem 1.5rem; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); }}
  h1 {{ color: #8b5cf6; font-size: 1.5rem; }}
  .badge {{ background: #06b6d4; color: #0f172a; border-radius: 6px; padding: 4px 12px; font-size: 0.85rem; font-weight: bold; text-transform: uppercase; }}
  
  .main-content {{ display: flex; flex-direction: column; gap: 1rem; }}
  canvas {{ width: 100%; height: 400px; border-radius: 12px; background: #050811; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 4px 20px rgba(0,0,0,0.5); }}
  
  .panel {{ background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); padding: 1.5rem; }}
  
  .controls {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 1rem; }}
  .ctrl-group {{ display: flex; flex-direction: column; gap: 0.5rem; }}
  label {{ font-size: 0.85rem; color: #94a3b8; font-weight: 500; display: flex; justify-content: space-between; }}
  input[type=range] {{ width: 100%; accent-color: #8b5cf6; cursor: pointer; }}
  select {{ background: #0f172a; color: #e2e8f0; border: 1px solid rgba(255,255,255,0.2); padding: 0.5rem; border-radius: 6px; outline: none; cursor: pointer; }}
  
  .info-box {{ border-left: 4px solid #06b6d4; background: rgba(6, 182, 212, 0.1); padding: 1rem 1.5rem; border-radius: 0 8px 8px 0; margin-top: 0.5rem; }}
  .info-box h3 {{ color: #06b6d4; font-size: 1rem; margin-bottom: 0.5rem; }}
  .info-box p {{ font-size: 0.9rem; line-height: 1.6; color: #cbd5e1; }}
  
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>{t}</h1>
    <span class="badge">{c}</span>
  </div>
  
  <div class="main-content">
    <canvas id="c"></canvas>
    
    <div class="panel">
      <div class="controls">
        <div class="ctrl-group">
          <label>Scenario</label>
          <select id="scenario">
            <option value="orbit">Orbital Mechanics</option>
            <option value="bounce">Kinetic Bouncing</option>
          </select>
        </div>
        <div class="ctrl-group">
          <label><span>Speed / Energy</span> <span id="sv">1.0x</span></label>
          <input type="range" id="speed" min="1" max="100" value="50">
        </div>
        <div class="ctrl-group">
          <label><span>Particle Count</span> <span id="pv">30</span></label>
          <input type="range" id="count" min="5" max="100" value="30">
        </div>
      </div>
      
      <div class="info-box">
        <h3>Learn: Dynamics</h3>
        <p id="learn-text">Loading explanation...</p>
      </div>
    </div>
  </div>
</div>

<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// Make canvas crisp on high DPI
function resizeCanvas() {{
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}}
window.addEventListener('resize', resizeCanvas);

const speedSlider = document.getElementById('speed');
const countSlider = document.getElementById('count');
const scenarioSelect = document.getElementById('scenario');
const svLabel = document.getElementById('sv');
const pvLabel = document.getElementById('pv');
const learnText = document.getElementById('learn-text');

let particles = [];
let W, H;

function getSpeed() {{ return speedSlider.value / 50; }}

function makeParticle(scenario) {{
  if (scenario === 'orbit') {{
    const angle = Math.random() * Math.PI * 2;
    const radius = 50 + Math.random() * 150;
    return {{
      angle: angle,
      radius: radius,
      speed: (Math.random() * 0.02 + 0.01) * (Math.random() > 0.5 ? 1 : -1),
      hue: 280 + Math.random() * 60, // Purples/Pinks
      size: 2 + Math.random() * 4
    }};
  }} else {{
    return {{
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      hue: 180 + Math.random() * 60, // Cyans/Blues
      size: 3 + Math.random() * 6
    }};
  }}
}}

function initParticles() {{
  const rect = canvas.getBoundingClientRect();
  W = rect.width;
  H = rect.height;
  
  const n = parseInt(countSlider.value);
  const scenario = scenarioSelect.value;
  particles = [];
  for (let i = 0; i < n; i++) {{
    particles.push(makeParticle(scenario));
  }}
  updateLearnText();
}}

function updateLearnText() {{
  const s = scenarioSelect.value;
  const spd = getSpeed().toFixed(1);
  const n = countSlider.value;
  if (s === 'orbit') {{
    learnText.innerHTML = `Observing <strong>${{n}} bodies</strong> in orbit around a central mass. The simulation is running at <strong>${{spd}}x</strong> standard speed. Notice how bodies closer to the center generally need higher orbital velocities to avoid falling in, though this simplified model uses fixed paths.`;
  }} else {{
    learnText.innerHTML = `Observing <strong>${{n}} particles</strong> exhibiting kinetic motion. They are moving at <strong>${{spd}}x</strong> standard speed. As they bounce off the invisible boundaries, their momentum is conserved but direction changes.`;
  }}
}}

speedSlider.addEventListener('input', () => {{ svLabel.textContent = getSpeed().toFixed(1) + 'x'; updateLearnText(); }});
countSlider.addEventListener('input', () => {{ pvLabel.textContent = countSlider.value; initParticles(); }});
scenarioSelect.addEventListener('change', () => {{ initParticles(); }});

// Initialization
setTimeout(() => {{
  resizeCanvas();
  initParticles();
  requestAnimationFrame(draw);
}}, 100);

function drawOrbit(p, spd, cx, cy) {{
  p.angle += p.speed * spd;
  const x = cx + Math.cos(p.angle) * p.radius;
  const y = cy + Math.sin(p.angle) * p.radius;
  
  // Draw path
  ctx.beginPath();
  ctx.arc(cx, cy, p.radius, 0, Math.PI * 2);
  ctx.strokeStyle = `hsla(${{p.hue}}, 50%, 50%, 0.1)`;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Draw body
  ctx.beginPath();
  ctx.arc(x, y, p.size, 0, Math.PI * 2);
  ctx.fillStyle = `hsl(${{p.hue}}, 80%, 60%)`;
  ctx.shadowBlur = 10;
  ctx.shadowColor = ctx.fillStyle;
  ctx.fill();
  ctx.shadowBlur = 0;
}}

function drawBounce(p, spd) {{
  p.x += p.vx * spd;
  p.y += p.vy * spd;
  
  if (p.x < p.size || p.x > W - p.size) p.vx *= -1;
  if (p.y < p.size || p.y > H - p.size) p.vy *= -1;
  
  p.x = Math.max(p.size, Math.min(W - p.size, p.x));
  p.y = Math.max(p.size, Math.min(H - p.size, p.y));
  
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  ctx.fillStyle = `hsl(${{p.hue}}, 80%, 60%)`;
  ctx.shadowBlur = 15;
  ctx.shadowColor = ctx.fillStyle;
  ctx.fill();
  ctx.shadowBlur = 0;
}}

function draw() {{
  // Trail effect (semi-transparent clear)
  ctx.fillStyle = 'rgba(5, 8, 17, 0.2)';
  ctx.fillRect(0, 0, W, H);
  
  const scenario = scenarioSelect.value;
  const spd = getSpeed();
  const cx = W / 2;
  const cy = H / 2;
  
  if (scenario === 'orbit') {{
    // Central mass
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fillStyle = '#fcd34d';
    ctx.shadowBlur = 30;
    ctx.shadowColor = '#f59e0b';
    ctx.fill();
    ctx.shadowBlur = 0;
  }}

  for (let i = 0; i < particles.length; i++) {{
    if (scenario === 'orbit') drawOrbit(particles[i], spd, cx, cy);
    else drawBounce(particles[i], spd);
  }}
  
  requestAnimationFrame(draw);
}}
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
        timeout=60.0,
        max_retries=2,
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