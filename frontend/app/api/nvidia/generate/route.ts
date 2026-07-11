import { NextRequest, NextResponse } from 'next/server'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'
const MODEL_ID = 'nvidia/llama-3.3-nemotron-super-49b-v1'

/**
 * POST /api/nvidia/generate
 * 
 * Server-side proxy to NVIDIA Nemotron API.
 * Avoids CORS issues by making the request from the Node.js server
 * instead of the browser.
 * 
 * Body: { concept: string }
 * Returns: { html: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { concept } = await request.json()

    if (!concept || typeof concept !== 'string' || !concept.trim()) {
      return NextResponse.json(
        { error: 'Concept is required.' },
        { status: 400 }
      )
    }

    const apiKey = process.env.NEXT_PUBLIC_NVIDIA_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not configured. Add NEXT_PUBLIC_NVIDIA_API_KEY to your .env.local file.' },
        { status: 500 }
      )
    }

    // Build the prompt — optimized for clear section separation, no scrollbars, premium UI
    const systemPrompt = `You are an elite Principal Software Engineer and UI/UX Architect with 15+ years of experience building world-class educational visualizations and interactive physics/math simulations.

YOUR MISSION: Generate a SINGLE, COMPLETE, self-contained HTML5 file that is a stunning, fully interactive educational simulation. The output is rendered inside an iframe on a dark-themed educational platform.

═══════════════════════════════════════════════════════
ABSOLUTE RULES — FOLLOW EVERY SINGLE ONE WITHOUT EXCEPTION
═══════════════════════════════════════════════════════

1. OUTPUT FORMAT:
   - Generate exactly ONE complete HTML file starting with <!DOCTYPE html> and ending with </html>.
   - No external libraries, CDNs, or imports. 100% vanilla HTML + CSS + JS.
   - Wrap the entire output in a markdown code block.

2. CRITICAL CSS — ZERO SCROLLBARS (non-negotiable):
   - The VERY FIRST CSS rule: \`*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\`
   - Body: \`body { margin: 0; padding: 0; overflow: hidden; width: 100vw; height: 100vh; background: #0a0e1a; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #e2e8f0; }\`
   - IMPORTANT: html AND body must both have \`overflow: hidden\`. No element should cause scrollbars.
   - Use CSS custom properties:
     \`:root { --bg: #0a0e1a; --bg-sidebar: #0f1424; --bg-card: rgba(15, 23, 42, 0.7); --bg-card-hover: rgba(20, 30, 55, 0.8); --border: rgba(99, 102, 241, 0.12); --border-accent: rgba(99, 102, 241, 0.25); --text: #e2e8f0; --text-muted: #94a3b8; --text-dim: #64748b; --accent: #6366f1; --accent-light: #818cf8; --cyan: #22d3ee; --emerald: #34d399; --pink: #f472b6; --amber: #fbbf24; --red: #f87171; --section-radius: 10px; }\`

3. MASTER LAYOUT — TWO-COLUMN CSS GRID:
   \`\`\`
   .app { display: grid; grid-template-columns: 340px 1fr; height: 100vh; overflow: hidden; }
   \`\`\`
   - LEFT PANEL (340px): Scrollable panel with all information, controls, and measurements. It must use \`overflow-y: auto\` with a thin custom scrollbar, and \`overflow-x: hidden\`.
   - RIGHT PANEL (1fr): Canvas visualization area. Must fill 100% width and height of its grid cell. \`overflow: hidden\`.

4. LEFT PANEL — STRUCTURE WITH VISUALLY DISTINCT SECTIONS:
   The left panel must have \`padding: 16px; display: flex; flex-direction: column; gap: 12px;\`.
   
   EVERY section below must be wrapped in a DISTINCT CARD with this exact styling:
   \`\`\`
   .section-card {
     background: var(--bg-card);
     border: 1px solid var(--border);
     border-radius: var(--section-radius);
     padding: 14px 16px;
   }
   \`\`\`
   Each section card must have a SECTION HEADER styled as:
   \`\`\`
   .section-header {
     font-size: 10px;
     font-weight: 700;
     text-transform: uppercase;
     letter-spacing: 0.1em;
     color: var(--text-dim);
     margin-bottom: 8px;
     padding-bottom: 6px;
     border-bottom: 1px solid var(--border);
     display: flex;
     align-items: center;
     gap: 6px;
   }
   \`\`\`

   THE SECTIONS MUST APPEAR IN THIS EXACT ORDER — each one a separate card:

   ━━━ SECTION 1: TITLE CARD ━━━
   - A compact header with an emoji + the concept name.
   - Font-size: 18px, font-weight: 800, color: white.
   - Below the title: a ONE-LINE subtitle describing the branch (e.g., "Classical Mechanics • Kinematics").
   - This card should NOT have a section header label.

   ━━━ SECTION 2: DEFINITION CARD ━━━
   - Section header label: "📖 DEFINITION"
   - A clear, concise 2-3 sentence definition of the concept.
   - Font-size: 13px, line-height: 1.55, color: var(--text-muted).
   - Highlight key terms using \`<strong style="color: var(--cyan)">\`.

   ━━━ SECTION 3: FORMULA CARD ━━━
   - Section header label: "📐 KEY FORMULA"
   - Display the primary formula/equation in a prominent mono-styled block:
     \`background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.15); border-radius: 8px; padding: 12px; text-align: center; font-family: 'Courier New', monospace; font-size: 18px; font-weight: 700; color: var(--accent-light); letter-spacing: 0.02em;\`
   - Below the formula, add a brief (1-2 line) explanation of each variable in the formula.
     Style variables as: \`color: var(--cyan); font-weight: 600; font-family: monospace;\`

   ━━━ SECTION 4: LIVE MEASUREMENTS CARD ━━━
   - Section header label: "📊 LIVE MEASUREMENTS"
   - Show 3-5 real-time values (position, velocity, time, angle, force, energy, etc.) that UPDATE every animation frame via JavaScript.
   - Each measurement row must be styled as:
     \`\`\`
     .measure-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid rgba(255,255,255,0.04); }
     .measure-label { font-size: 12px; color: var(--text-dim); }
     .measure-value { font-size: 13px; font-weight: 700; font-family: 'Courier New', monospace; color: var(--cyan); min-width: 80px; text-align: right; }
     \`\`\`
   - The last row should NOT have a border-bottom.
   - Values must update in real-time by setting textContent in the animation loop.

   ━━━ SECTION 5: CONTROLS CARD ━━━
   - Section header label: "🎮 CONTROLS"
   - Contains 2-3 range sliders with labels and real-time value readouts.
   - Each slider group: label on top (font-size: 11px, color: var(--text-dim), uppercase), then the range input, then the current value on the right.
   - Slider styling (MUST apply):
     \`\`\`
     input[type=range] { -webkit-appearance: none; width: 100%; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.08); outline: none; margin: 6px 0; }
     input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--accent); cursor: pointer; box-shadow: 0 0 8px var(--accent); border: 2px solid rgba(255,255,255,0.2); }
     \`\`\`
   - After all sliders, add a horizontal divider: \`<hr style="border: none; border-top: 1px solid var(--border); margin: 10px 0;">\`
   - Then a row with two buttons side by side (\`display: flex; gap: 8px;\`):
     a. PLAY/PAUSE button — toggle text between "▶ Play" and "⏸ Pause". Style: \`flex: 1; padding: 9px 0; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.2s;\` When playing: \`background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.25);\` When paused: \`background: rgba(251, 191, 36, 0.12); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.2);\`
     b. RESET button — \`flex: 1; background: rgba(255,255,255,0.05); color: var(--text-muted); border: 1px solid var(--border); border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;\` Hover: brighter border/text.

   ━━━ SECTION 6: INFO CARD (optional but recommended) ━━━
   - Section header label: "💡 DID YOU KNOW?"
   - A single interesting real-world fact about this concept.
   - Font-size: 12px, color: var(--text-dim), font-style: italic.

5. RIGHT PANEL — CANVAS VISUALIZATION:
   - The right panel div: \`position: relative; overflow: hidden; background: var(--bg);\`
   - Use a \`<canvas>\` element inside. **CRITICAL CSS for Canvas**: \`canvas { width: 100%; height: 100%; display: block; }\`
   - **CRITICAL JAVASCRIPT for Canvas Sizing**:
     \`\`\`javascript
     const resize = () => {
       canvas.width = canvas.parentElement.clientWidth * (window.devicePixelRatio || 1);
       canvas.height = canvas.parentElement.clientHeight * (window.devicePixelRatio || 1);
     };
     window.addEventListener('resize', resize);
     setTimeout(resize, 0); // Wait for CSS to apply layout before grabbing dimensions
     \`\`\`
   - Draw a subtle dot grid background (small dots at ~40px intervals, color: rgba(148, 163, 184, 0.15)).
   - **CRITICAL JAVASCRIPT RULES (PREVENT CRASHES)**:
     1. NEVER use CSS variables like \`var(--bg)\` or \`var(--cyan)\` inside JavaScript (e.g. \`ctx.fillStyle = var(--cyan)\`). This causes a Fatal SyntaxError because \`var\` is a JS keyword. ALWAYS use raw hex strings (e.g. \`ctx.fillStyle = '#22d3ee'\`).
     2. Defensive coding: Ensure DOM elements exist before accessing them. Initialize variables properly before the animation loop.
     3. Wrap your \`requestAnimationFrame\` drawing logic in a \`try { ... } catch(e) { console.error(e) }\` block to prevent complete crashes from a single math error.
   - Use vibrant colors (use these HEX codes in JS): cyan (#22d3ee), pink (#f472b6), emerald (#34d399), amber (#fbbf24), white (#ffffff), bg (#0a0e1a).
   - Add glow effects: \`ctx.shadowColor = color; ctx.shadowBlur = 15;\` for key elements, then reset shadow after drawing.
   - Draw labeled vectors/arrows where relevant (arrowheads + text labels in 11px font).
   - Add a subtle gradient or trail effect for moving objects.
   - The canvas should show the title of the concept in the top-left corner: \`ctx.font = '13px system-ui'; ctx.fillStyle = 'rgba(148,163,184,0.3)'; ctx.fillText(conceptName, 16, 24);\`

6. ANIMATION & PHYSICS:
   - Use requestAnimationFrame for smooth 60fps animation.
   - Implement delta-time physics: \`const dt = (timestamp - lastTimestamp) / 1000;\`
   - Animation starts automatically on page load.
   - Play/Pause button pauses/resumes the animation loop (toggle a boolean flag).
   - Reset button restores all physics parameters to initial values and clears trails.

7. SCROLLBAR STYLING (for the left panel only):
   \`\`\`
   .left-panel::-webkit-scrollbar { width: 3px; }
   .left-panel::-webkit-scrollbar-track { background: transparent; }
   .left-panel::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.2); border-radius: 3px; }
   .left-panel { scrollbar-width: thin; scrollbar-color: rgba(99, 102, 241, 0.2) transparent; }
   \`\`\`

8. RESPONSIVENESS:
   - @media (max-width: 768px): \`grid-template-columns: 1fr; grid-template-rows: auto 50vh;\` — sidebar stacks above canvas. Left panel gets max-height: 50vh.

CRITICAL REMINDERS:
- ZERO SCROLLBARS on body/html. Only the left panel may have a thin vertical scrollbar if content overflows.
- Each section MUST be a visually distinct card — do NOT merge or blend sections together.
- Keep text COMPACT — use small font sizes (11-13px). Do not write essays. Be concise but educational.
- The simulation must actually WORK — sliders must change parameters, play/pause must toggle, reset must work.
- All measurement values must update EVERY FRAME inside the requestAnimationFrame callback.`

    const userPrompt = `Create a stunning, production-ready interactive simulation for: "${concept.trim()}"

CRITICAL LAYOUT REQUIREMENTS:
- Left panel: 6 distinct section cards stacked vertically — Title, Definition, Formula, Live Measurements, Controls (sliders + play/pause + reset), Fun Fact.
- Right panel: Full-height canvas with smooth animation, glow effects, and grid background.
- ZERO scrollbars on body/html. Left panel uses thin custom scrollbar only if needed.
- Each section must look like a separate card with its own border and background — NOT merged together.

The simulation renders inside an iframe. It must fill 100vw × 100vh with overflow:hidden on both html and body.

Wrap the complete code in a single markdown HTML code block.`

    // Call NVIDIA API (server-to-server, no CORS)
    const nvidiaResponse = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 16384,
        top_p: 0.9,
      }),
    })

    if (!nvidiaResponse.ok) {
      const errorText = await nvidiaResponse.text().catch(() => '')
      if (nvidiaResponse.status === 401 || nvidiaResponse.status === 403) {
        return NextResponse.json(
          { error: 'Invalid NVIDIA API key. Please check your NEXT_PUBLIC_NVIDIA_API_KEY.' },
          { status: 401 }
        )
      }
      if (nvidiaResponse.status === 429) {
        return NextResponse.json(
          { error: 'Rate limit exceeded. Please wait a moment and try again.' },
          { status: 429 }
        )
      }
      return NextResponse.json(
        { error: `NVIDIA API error (${nvidiaResponse.status}): ${errorText || 'Unknown error'}` },
        { status: 502 }
      )
    }

    const data = await nvidiaResponse.json()
    const content = data?.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json(
        { error: 'The AI returned an empty response. Please try a different concept.' },
        { status: 502 }
      )
    }

    // Extract HTML from the response
    const html = extractHtml(content)

    return NextResponse.json({ html })
  } catch (err) {
    console.error('[NVIDIA Proxy] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error.' },
      { status: 500 }
    )
  }
}

/**
 * Extract HTML from the model response — handles fenced code blocks or raw HTML.
 */
function extractHtml(raw: string): string {
  // Try fenced code block
  const fencedMatch = raw.match(/```(?:html)?\s*\n([\s\S]*?)```/)
  if (fencedMatch) return fencedMatch[1].trim()

  // Try raw HTML
  const htmlMatch = raw.match(/(<!DOCTYPE[\s\S]*<\/html>)/i)
  if (htmlMatch) return htmlMatch[1].trim()

  // Last resort
  const trimmed = raw.trim()
  if (trimmed.startsWith('<') && trimmed.includes('</')) return trimmed

  throw new Error('The AI response did not contain valid simulation code. Please try again.')
}
