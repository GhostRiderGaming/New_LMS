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
    "You are an elite Principal Software Engineer and UI/UX Architect with 15+ years of experience building world-class educational visualizations and interactive physics/math simulations.\n\n"
    "YOUR MISSION: Generate a SINGLE, COMPLETE, self-contained HTML5 file that is a BREATHTAKING, fully interactive educational simulation. It must look like a $10,000 production-grade visualization tool — not a student project. The output is rendered inside an iframe.\n\n"
    "═══════════════════════════════════════════════════════\n"
    "ABSOLUTE RULES — FOLLOW EVERY SINGLE ONE WITHOUT EXCEPTION\n"
    "═══════════════════════════════════════════════════════\n\n"
    "1. OUTPUT FORMAT:\n"
    "   - Generate exactly ONE complete HTML file starting with <!DOCTYPE html> and ending with </html>.\n"
    "   - No markdown fencing. No explanation. Raw HTML only.\n"
    "   - No external libraries, CDNs, or imports. 100% vanilla HTML + CSS + JS.\n\n"
    "2. CRITICAL CSS — ZERO SCROLLBARS (non-negotiable):\n"
    "   - FIRST CSS rule: `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`\n"
    "   - `html, body { margin: 0; padding: 0; overflow: hidden; width: 100vw; height: 100vh; background: #060a14; font-family: 'Segoe UI', system-ui, sans-serif; color: #e2e8f0; }`\n"
    "   - CSS custom properties:\n"
    "     `:root { --bg: #060a14; --bg-sidebar: #0a0f1e; --bg-card: rgba(12, 18, 36, 0.85); --border: rgba(99, 102, 241, 0.1); --border-accent: rgba(99, 102, 241, 0.3); --text: #e2e8f0; --text-muted: #94a3b8; --text-dim: #64748b; --accent: #6366f1; --accent-light: #818cf8; --cyan: #22d3ee; --emerald: #34d399; --pink: #f472b6; --amber: #fbbf24; --section-radius: 12px; }`\n\n"
    "3. MASTER LAYOUT — TWO-COLUMN CSS GRID:\n"
    "   `.app { display: grid; grid-template-columns: 340px 1fr; height: 100vh; overflow: hidden; }`\n"
    "   - LEFT PANEL (340px): `background: var(--bg-sidebar); overflow-y: auto; overflow-x: hidden; padding: 16px; display: flex; flex-direction: column; gap: 10px; border-right: 1px solid var(--border);`\n"
    "   - RIGHT PANEL (1fr): Canvas area. `position: relative; overflow: hidden; background: var(--bg);`\n\n"
    "4. LEFT PANEL — 6 VISUALLY DISTINCT SECTION CARDS:\n"
    "   Each section card MUST have this styling:\n"
    "   `.section-card { background: var(--bg-card); backdrop-filter: blur(16px); border: 1px solid var(--border); border-radius: var(--section-radius); padding: 14px 16px; transition: all 0.3s ease; }`\n"
    "   `.section-card:hover { border-color: var(--border-accent); background: rgba(15, 22, 45, 0.9); box-shadow: 0 4px 20px rgba(99, 102, 241, 0.06); }`\n"
    "   Section header: `.section-header { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 6px; }`\n\n"
    "   SECTIONS IN ORDER:\n\n"
    "   ━━━ SECTION 1: TITLE CARD ━━━\n"
    "   Emoji + concept name (font-size: 18px, font-weight: 800, color: white). Below: ONE-LINE subtitle.\n"
    "   Add a thin GRADIENT BAR under the title: `height: 3px; background: linear-gradient(90deg, #6366f1, #22d3ee, #f472b6); border-radius: 2px; margin-top: 8px;`\n\n"
    "   ━━━ SECTION 2: DEFINITION ━━━\n"
    "   Header: \"📖 DEFINITION\". 2-3 sentence definition. Font: 13px. Highlight key terms: `<strong style=\"color: #22d3ee\">`.\n\n"
    "   ━━━ SECTION 3: FORMULA ━━━\n"
    "   Header: \"📐 KEY FORMULA\". Formula in a mono-styled block with a subtle GLOW BORDER:\n"
    "   `background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 8px; padding: 14px; text-align: center; font-family: 'Courier New', monospace; font-size: 20px; font-weight: 700; color: #a5b4fc; letter-spacing: 0.03em; box-shadow: 0 0 20px rgba(99, 102, 241, 0.08), inset 0 0 20px rgba(99, 102, 241, 0.03);`\n"
    "   Below: brief variable explanation. Variable names styled: `color: #22d3ee; font-weight: 600; font-family: monospace;`\n\n"
    "   ━━━ SECTION 4: LIVE MEASUREMENTS ━━━\n"
    "   Header: \"📊 LIVE MEASUREMENTS\". 4-6 real-time values that update EVERY FRAME.\n"
    "   Each row: `.measure-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }`\n"
    "   Label: `font-size: 12px; color: var(--text-dim);`\n"
    "   Value: `font-size: 13px; font-weight: 700; font-family: 'Courier New', monospace; color: #22d3ee; min-width: 90px; text-align: right; transition: color 0.15s;`\n"
    "   IMPORTANT: When a value changes significantly (e.g. sign flip, threshold cross), briefly change its color to #f472b6 or #34d399 for 200ms, then back to #22d3ee. This creates a \"flicker highlight\" effect.\n\n"
    "   ━━━ SECTION 5: CONTROLS ━━━\n"
    "   Header: \"🎮 CONTROLS\". 2-3 range sliders.\n"
    "   Slider: `input[type=range] { -webkit-appearance: none; width: 100%; height: 4px; border-radius: 2px; background: linear-gradient(90deg, rgba(99,102,241,0.3), rgba(34,211,238,0.3)); outline: none; margin: 6px 0; }`\n"
    "   Thumb: `input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #818cf8); cursor: pointer; box-shadow: 0 0 12px rgba(99,102,241,0.5), 0 0 4px rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.25); transition: box-shadow 0.2s; }`\n"
    "   Thumb hover: `input[type=range]::-webkit-slider-thumb:hover { box-shadow: 0 0 20px rgba(99,102,241,0.7), 0 0 6px rgba(255,255,255,0.3); transform: scale(1.1); }`\n"
    "   After sliders, a divider, then two buttons side by side:\n"
    "   PLAY/PAUSE: playing → `background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.2); border-radius: 8px; font-weight: 600; padding: 10px; cursor: pointer; flex: 1;`\n"
    "   paused → `background: rgba(251,191,36,0.1); color: #fbbf24; border: 1px solid rgba(251,191,36,0.15);`\n"
    "   RESET: `background: rgba(255,255,255,0.04); color: var(--text-muted); border: 1px solid var(--border); border-radius: 8px; font-weight: 600; padding: 10px; cursor: pointer; flex: 1; transition: all 0.2s;`\n\n"
    "   ━━━ SECTION 6: DID YOU KNOW? ━━━\n"
    "   Header: \"💡 DID YOU KNOW?\". One fascinating real-world fact. Font: 12px, italic, color: var(--text-dim).\n\n"
    "5. SCROLLBAR STYLING:\n"
    "   `.left-panel::-webkit-scrollbar { width: 3px; }` `.left-panel::-webkit-scrollbar-track { background: transparent; }` `.left-panel::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.15); border-radius: 3px; }`\n"
    "   `.left-panel { scrollbar-width: thin; scrollbar-color: rgba(99,102,241,0.15) transparent; }`\n\n"
    "═══════════════════════════════════════════════════════\n"
    "CANVAS RENDERING — GAMIFIED VIDEO GAME AESTHETIC\n"
    "═══════════════════════════════════════════════════════\n\n"
    "6. CANVAS SETUP:\n"
    "   CSS: `canvas { width: 100%; height: 100%; display: block; }`\n"
    "   JS sizing (CRITICAL): `const dpr = window.devicePixelRatio || 1; function resize() { canvas.width = canvas.parentElement.clientWidth * dpr; canvas.height = canvas.parentElement.clientHeight * dpr; ctx.scale(dpr, dpr); W = canvas.parentElement.clientWidth; H = canvas.parentElement.clientHeight; } window.addEventListener('resize', resize); setTimeout(resize, 0);`\n\n"
    "7. CANVAS BACKGROUND — GAME ENVIRONMENTS:\n"
    "   Do NOT use dark space/math backgrounds. Draw vibrant environments (e.g. skies, grass, dirt, clouds):\n"
    "   a. SKY GRADIENT: `const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#7dd3fc'); sky.addColorStop(1, '#e0f2fe'); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);`\n"
    "   b. SCENERY/CLOUDS: Draw stylized clouds or distant mountains to give depth.\n"
    "   c. TERRAIN: Draw solid ground shapes using `ctx.lineTo()` down to the bottom of the screen, filled with green (grass) and brown (dirt). Give the ground a thick dark-green stroke on top.\n\n"
    "8. OBJECT RENDERING — SPRITES & EMOJIS:\n"
    "   a. CHARACTERS/OBJECTS: Use EMOJIS (like 🐦, 📦, 🐷, 🚀, 🚗) scaled up using `ctx.fillText` OR stylized vector drawings instead of plain geometric shapes.\n"
    "      `ctx.font = '40px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🐦', x, y);`\n"
    "   b. TRAIL EFFECT: Store the last 40 positions of moving objects. Draw trails as fading circles: \n"
    "      `for(let i = 0; i < trail.length; i++) { const alpha = (i / trail.length) * 0.4; ctx.fillStyle = \\`rgba(255,255,255,${alpha})\\`; ctx.beginPath(); ctx.arc(trail[i].x, trail[i].y, radius * (i/trail.length), 0, Math.PI*2); ctx.fill(); }`\n"
    "   c. VECTORS/ARROWS: Still draw physics vectors (Gravity=pink, Normal=green, Velocity=cyan) but style them playfully (thicker lines, rounded caps).\n\n"
    "═══════════════════════════════════════════════════════\n"
    "GAMIFICATION & LEVEL DESIGN (CRITICAL)\n"
    "═══════════════════════════════════════════════════════\n\n"
    "9. LEVEL GOALS & TARGETS:\n"
    "   Every simulation MUST have a 'Goal' or 'Target' area. For example, hitting a target box with a projectile, landing a skater in a zone, or balancing a scale.\n"
    "   Render a distinct 'Target Zone' (e.g. a glowing box, a flag, a pig emoji).\n"
    "   When the condition is met, trigger a WIN STATE: render \"LEVEL CLEARED!\" text massively on screen and spawn confetti particles.\n\n"
    "10. GAME HUD (Heads-Up Display):\n"
    "    Instead of a dry 'energy bar chart', render a GAME HUD overlaid on the canvas:\n"
    "    - Score / Attempts counter in the top-left corner.\n"
    "    - A stylized 'Energy Meter' that looks like a health bar or power meter (e.g. filled rectangles with thick borders).\n"
    "    - Use chunky, stylized fonts for HUD elements (`ctx.font = 'bold 16px sans-serif'`).\n\n"
    "11. PLAYFUL INTERACTIVITY (SLINGSHOTS, DRAGGING):\n"
    "    - At least ONE object MUST be draggable or launchable by the user.\n"
    "    - If it's a projectile simulation, implement a 'slingshot' pull-back mechanic (drag away from the launch point, release to shoot). Render the slingshot bands as thick brown/black lines.\n"
    "    - Sliders in the left panel should act as 'Game Modifiers' (e.g. \"Gravity Level\", \"Bounciness\").\n\n"
    "═══════════════════════════════════════════════════════\n"
    "CODE STRUCTURE & RULES\n"
    "═══════════════════════════════════════════════════════\n\n"
    "12. MVC CODE STRUCTURE (mandatory):\n"
    "    a. STATE (Model): `const state = { ... }` — all physics variables, score, win flags.\n"
    "    b. `function update(dt)` (Physics): Pure math. NEVER call `ctx` methods.\n"
    "    c. `function render()` (View): Reads `state`, draws to canvas.\n"
    "    d. Animation loop: `function animate(t) { const dt = Math.min((t - lastT) / 1000, 0.05); lastT = t; if(playing) update(dt); try { render(); } catch(e) { console.error(e); } requestAnimationFrame(animate); }`\n\n"
    "13. CRITICAL JAVASCRIPT RULES:\n"
    "    - NEVER use `var(--anything)` in JS. Use hex strings. `var` is a JS keyword.\n"
    "    - Wrap render() in try/catch.\n"
    "    - Initialize ALL state before the loop starts.\n"
    "    - Clamp dt to 0.05 to prevent physics explosions.\n\n"
    "QUALITY STANDARDS (non-negotiable):\n"
    "- The simulation MUST look like a vibrant, playful video game (e.g., Angry Birds).\n"
    "- Force vectors MUST still be drawn for educational value, even within the game aesthetic.\n"
    "- A WIN STATE (confetti/text) MUST occur when the player hits the target.\n"
    "- Emojis or sprites MUST be used for characters instead of plain circles.\n"
    "- DO NOT truncate code. Complete implementation required.\n"
)


def _extract_html(raw: str) -> str:
    # Try to find a markdown html block
    match = re.search(r"```(?:html)?\s*(.*?)```", raw, flags=re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1).strip()
    # Otherwise try to extract <!DOCTYPE html> to </html>
    match = re.search(r"(<!DOCTYPE html>.*?</html>)", raw, flags=re.IGNORECASE | re.DOTALL)
    if match:
        return match.group(1).strip()
    return raw.strip()


def _sanitize_html(html: str) -> str:
    """
    Sanitize HTML by removing external scripts, stylesheets, and iframes.
    Allows safe external URLs like <img> and <a>.
    """
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    external = re.compile(r"^https?://", re.IGNORECASE)

    for script in soup.find_all("script"):
        if script.has_attr("src") and external.match(script["src"]):
            script.decompose()

    for link in soup.find_all("link"):
        if link.has_attr("href") and external.match(link["href"]):
            link.decompose()

    for iframe in soup.find_all("iframe"):
        iframe.decompose()

    return str(soup)


def _fallback_simulation(topic: str, category: str) -> str:
    """
    Fallback simulation with a breathtaking premium two-column layout, glow effects,
    ambient particles, and requestAnimationFrame loop.
    """
    t = topic.replace("<", "&lt;").replace(">", "&gt;")
    c = category.replace("<", "&lt;").replace(">", "&gt;")
    return """<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; background: #060a14; font-family: 'Segoe UI', system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
    canvas { background: #87CEEB; box-shadow: 0 4px 12px rgba(0,0,0,0.5); border-radius: 8px; cursor: default; }
    .controls { margin-top: 15px; display: flex; gap: 20px; background: rgba(15, 23, 42, 0.85); color: #e2e8f0; padding: 10px 20px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.5); border: 1px solid rgba(99,102,241,0.2); }
    button { background: rgba(99,102,241,0.1); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); padding: 5px 15px; border-radius: 4px; cursor: pointer; font-weight: bold; }
    button:hover { background: rgba(99,102,241,0.2); }
  </style>
</head>
<body>

  <canvas id="simCanvas" width="800" height="500"></canvas>
  
  <div class="controls">
    <label>Gravity: <input type="range" id="gravitySlider" min="1" max="20" step="0.5" value="9.8"></label>
    <label>Launch Power: <input type="range" id="powerSlider" min="0.5" max="3" step="0.1" value="1.5"></label>
    <button id="resetBtn">Reset Level</button>
  </div>

  <script>
    const canvas = document.getElementById('simCanvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    // 1. STATE (MODEL)
    const state = {
      bird: { x: 150, y: 350, vx: 0, vy: 0, mass: 1, radius: 20, isDragged: false, isHovered: false, state: 'idle', trail: [] },
      slingshot: { x: 150, y: 350, maxDrag: 100 },
      target: { x: 650, y: 360, width: 50, height: 50, active: true },
      physics: { gravity: 9.8, power: 1.5, dt: 0.02 },
      game: { score: 0, attempts: 0, levelCleared: false, confetti: [] }
    };

    // 2. INPUT (CONTROLLER)
    let rect = canvas.getBoundingClientRect();
    window.addEventListener('resize', () => { rect = canvas.getBoundingClientRect(); });

    function getMousePos(e) { return { x: e.clientX - rect.left, y: e.clientY - rect.top }; }

    canvas.addEventListener('mousemove', (e) => {
      const mouse = getMousePos(e);
      const dist = Math.hypot(mouse.x - state.bird.x, mouse.y - state.bird.y);
      state.bird.isHovered = dist < state.bird.radius * 1.5 && state.bird.state === 'idle';
      
      if (state.bird.isDragged) {
        let dx = mouse.x - state.slingshot.x;
        let dy = mouse.y - state.slingshot.y;
        const dragDist = Math.hypot(dx, dy);
        if (dragDist > state.slingshot.maxDrag) {
          dx = (dx / dragDist) * state.slingshot.maxDrag;
          dy = (dy / dragDist) * state.slingshot.maxDrag;
        }
        state.bird.x = state.slingshot.x + dx;
        state.bird.y = state.slingshot.y + dy;
      }
      canvas.style.cursor = state.bird.isDragged ? 'grabbing' : (state.bird.isHovered ? 'grab' : 'default');
    });

    canvas.addEventListener('mousedown', (e) => {
      if (state.bird.isHovered && state.bird.state === 'idle') state.bird.isDragged = true;
    });

    window.addEventListener('mouseup', () => { 
      if (state.bird.isDragged) {
        state.bird.isDragged = false; 
        state.bird.state = 'flying';
        state.game.attempts++;
        
        // Launch velocity (opposite to drag direction)
        const dx = state.slingshot.x - state.bird.x;
        const dy = state.slingshot.y - state.bird.y;
        state.bird.vx = dx * state.physics.power;
        state.bird.vy = dy * state.physics.power;
      }
    });
    
    document.getElementById('gravitySlider').addEventListener('input', (e) => { state.physics.gravity = parseFloat(e.target.value); });
    document.getElementById('powerSlider').addEventListener('input', (e) => { state.physics.power = parseFloat(e.target.value); });
    document.getElementById('resetBtn').addEventListener('click', resetLevel);

    function resetLevel() {
      state.bird = { x: 150, y: 350, vx: 0, vy: 0, mass: 1, radius: 20, isDragged: false, isHovered: false, state: 'idle', trail: [] };
      state.target.active = true;
      state.game.levelCleared = false;
      state.game.confetti = [];
    }

    // 3. PHYSICS UPDATE
    function update() {
      if (state.bird.state === 'flying') {
        state.bird.vy += state.physics.gravity * 50 * state.physics.dt;
        state.bird.x += state.bird.vx * state.physics.dt;
        state.bird.y += state.bird.vy * state.physics.dt;

        // Trail
        state.bird.trail.push({ x: state.bird.x, y: state.bird.y });
        if (state.bird.trail.length > 40) state.bird.trail.shift();

        // Floor collision
        if (state.bird.y >= 400 - state.bird.radius) {
          state.bird.y = 400 - state.bird.radius;
          state.bird.vy *= -0.5; // Bounce
          state.bird.vx *= 0.8;  // Friction
          if (Math.abs(state.bird.vx) < 5) state.bird.state = 'stopped';
        }

        // Target collision
        if (state.target.active) {
          const distX = Math.abs(state.bird.x - (state.target.x + state.target.width/2));
          const distY = Math.abs(state.bird.y - (state.target.y + state.target.height/2));
          if (distX < (state.target.width/2 + state.bird.radius) && distY < (state.target.height/2 + state.bird.radius)) {
            state.target.active = false;
            state.game.levelCleared = true;
            state.game.score += 1000;
            // Spawn confetti
            for(let i=0; i<100; i++) {
              state.game.confetti.push({
                x: state.target.x + 25, y: state.target.y + 25,
                vx: (Math.random()-0.5)*15, vy: (Math.random()-1)*15,
                color: ['#f472b6', '#34d399', '#22d3ee', '#fbbf24'][Math.floor(Math.random()*4)],
                size: Math.random()*5+3
              });
            }
          }
        }
      } else if (state.bird.state === 'stopped') {
         if (state.bird.trail.length > 0) state.bird.trail.shift();
      }

      if (state.game.levelCleared) {
        state.game.confetti.forEach(c => {
          c.x += c.vx; c.y += c.vy;
          c.vy += 0.2; // gravity
        });
      }
    }

    function drawArrow(x1, y1, x2, y2, color, label, isDashed=false) {
      if(Math.hypot(x2-x1, y2-y1) < 5) return; 
      const angle = Math.atan2(y2-y1, x2-x1);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      if (isDashed) ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.save();
      ctx.translate(x2, y2);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-10, -6); ctx.lineTo(-10, 6); ctx.fill();
      ctx.restore();

      if (label) {
        ctx.fillStyle = color;
        ctx.font = '14px bold system-ui';
        ctx.fillText(label, x2 + 10, y2 + 5);
      }
    }

    // 4. VIEW (RENDER)
    function render() {
      // Background Sky
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#38bdf8');
      sky.addColorStop(1, '#bae6fd');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Clouds (Stylized)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.beginPath(); ctx.arc(150, 100, 30, 0, Math.PI*2); ctx.arc(190, 100, 40, 0, Math.PI*2); ctx.arc(230, 100, 30, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(600, 150, 40, 0, Math.PI*2); ctx.arc(650, 130, 50, 0, Math.PI*2); ctx.arc(700, 150, 40, 0, Math.PI*2); ctx.fill();

      // Terrain (Grass and Dirt)
      const grass = ctx.createLinearGradient(0, 400, 0, H);
      grass.addColorStop(0, '#4ade80');
      grass.addColorStop(1, '#15803d');
      ctx.fillStyle = grass;
      ctx.beginPath(); ctx.moveTo(0, 400); ctx.lineTo(W, 400); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
      
      // Terrain Edge
      ctx.strokeStyle = '#166534';
      ctx.lineWidth = 12;
      ctx.beginPath(); ctx.moveTo(0, 400); ctx.lineTo(W, 400); ctx.stroke();

      // Slingshot
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(140, 400); ctx.lineTo(150, 360); ctx.lineTo(130, 330); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(150, 360); ctx.lineTo(170, 330); ctx.stroke();
      
      // Slingshot band (back)
      if (state.bird.state === 'idle' || state.bird.isDragged) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(130, 330); ctx.lineTo(state.bird.x, state.bird.y); ctx.stroke();
      }

      // Trail
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < state.bird.trail.length; i++) {
        const alpha = (i / state.bird.trail.length) * 0.5;
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath(); ctx.arc(state.bird.trail[i].x, state.bird.trail[i].y, state.bird.radius * 0.5, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // The Bird 🐦
      ctx.font = '40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowBlur = state.bird.isDragged ? 15 : (state.bird.isHovered ? 10 : 0);
      ctx.shadowColor = '#fbbf24';
      ctx.fillText('🐦', state.bird.x, state.bird.y);
      ctx.shadowBlur = 0;

      // Slingshot band (front)
      if (state.bird.state === 'idle' || state.bird.isDragged) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(170, 330); ctx.lineTo(state.bird.x, state.bird.y); ctx.stroke();
      }

      // Vectors (only when flying)
      if (state.bird.state === 'flying') {
        drawArrow(state.bird.x, state.bird.y, state.bird.x + state.bird.vx * 0.5, state.bird.y + state.bird.vy * 0.5, '#22d3ee', 'v');
        drawArrow(state.bird.x, state.bird.y, state.bird.x, state.bird.y + state.physics.gravity * 5, '#f472b6', 'g');
      }

      // Target 🐷 / 📦
      if (state.target.active) {
        ctx.fillStyle = '#b45309';
        ctx.fillRect(state.target.x, state.target.y, state.target.width, state.target.height);
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 4;
        ctx.strokeRect(state.target.x, state.target.y, state.target.width, state.target.height);
        ctx.fillText('🐷', state.target.x + 25, state.target.y + 25);
      }

      // HUD
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.roundRect(20, 20, 160, 60, 10);
      ctx.fill();
      ctx.font = 'bold 18px system-ui';
      ctx.fillStyle = '#fbbf24';
      ctx.textAlign = 'left';
      ctx.fillText(`SCORE: ${state.game.score}`, 35, 45);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '14px system-ui';
      ctx.fillText(`ATTEMPTS: ${state.game.attempts}`, 35, 65);

      // Win State & Confetti
      if (state.game.levelCleared) {
        state.game.confetti.forEach(c => {
          ctx.fillStyle = c.color;
          ctx.beginPath(); ctx.arc(c.x, c.y, c.size, 0, Math.PI*2); ctx.fill();
        });

        ctx.font = 'bold 64px system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fbbf24';
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#000000';
        ctx.fillText('LEVEL CLEARED!', W/2, H/2 - 20);
        ctx.shadowBlur = 0;
        
        ctx.font = '24px system-ui';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('+1000 POINTS', W/2, H/2 + 30);
      }
    }

    function loop() { update(); render(); requestAnimationFrame(loop); }
    loop();
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
            f"Create a PhET-grade interactive simulation about '{topic}' in the '{category}' category. "
            f"CRITICAL REQUIREMENTS: "
            f"1) Two-column grid: 340px sidebar with 6 glassmorphism section cards, 1fr canvas. "
            f"2) MAKE THE INVISIBLE VISIBLE: Draw labeled force vectors (gravity=pink, normal=green, friction=amber) on all objects. "
            f"   Draw velocity (cyan) and acceleration (pink dashed) arrows from object centers. "
            f"3) ENERGY BAR CHART: Render a live KE vs PE bar chart overlay in the bottom-right corner of the canvas. "
            f"4) DRAGGABLE OBJECT: At least one object must be draggable on the canvas with cursor:grab affordance. "
            f"5) MVC structure: separate state object, update(dt) for physics, render() for drawing. "
            f"6) Custom-styled sliders with glowing thumbs, Play/Pause + Reset buttons. "
            f"7) The simulation must rival PhET simulations in both visual quality and educational depth."
        )

    html = ""
    use_fallback = False

    for attempt in range(2):
        try:
            completion = await groq.chat.completions.create(
                model=_GROQ_MODEL,
                messages=[
                    {"role": "system", "content": _SIMULATION_SYSTEM},
                    {"role": "user", "content": code_gen_prompt},
                ],
                max_tokens=16384,
                temperature=0.4 + (attempt * 0.2), # Increase temp on retry
            )
            raw_output = (completion.choices[0].message.content or "").strip()
        except Exception:
            raw_output = ""

        html = _extract_html(raw_output) if raw_output else ""
        
        if html and "<!DOCTYPE" in html.upper():
            html = _sanitize_html(html)
            break
        else:
            html = ""

    if not html:
        use_fallback = True
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