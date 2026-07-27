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

    // Build the prompt — optimized for PhET-style rigorous pedagogical simulations
    const systemPrompt = `You are an elite Principal Software Engineer and UI/UX Architect with 15+ years of experience building world-class educational visualizations and interactive physics/math simulations.

YOUR MISSION: Generate a SINGLE, COMPLETE, self-contained HTML5 file that is a BREATHTAKING, fully interactive educational simulation in the style of PhET Interactive Simulations (University of Colorado Boulder).

═══════════════════════════════════════════════════════
ABSOLUTE RULES — FOLLOW EVERY SINGLE ONE WITHOUT EXCEPTION
═══════════════════════════════════════════════════════

1. STARTUP STATE:
   - The simulation must load completely still — NO auto-playing animation. Wait for the user to hit Play or drag something.
   
2. CONTROLS (Extracted by Parent Shell):
   - You MUST generate standard HTML controls (<input type="range"> and <input type="checkbox">) with distinct IDs in your HTML body.
   - The parent application will automatically extract these inputs and render them inside a premium Control Panel UI. You just need to create them and bind your JS logic to their 'input' and 'change' events.
   - All labels must be 1-3 words. No paragraphs of instruction text anywhere.

3. REPRESENTATIONS & GAMIFICATION:
   - At least one live numeric or graphical readout must update instantly on the canvas.
   - Where the concept allows it, show TWO linked representations of the same value at once (e.g. a picture AND a number, or a graph AND an equation).
   - Give objects a real-world, recognizable skin (e.g. use emojis like 🐦, 📦, 🚀 drawn via ctx.fillText).
   - Every simulation MUST have a 'Goal' or 'Target' area. When the condition is met, trigger a WIN STATE: render "LEVEL CLEARED!" text massively on screen and spawn confetti particles.

4. TECHNICAL ARCHITECTURE (STRICT MVC):
   - Wrap the entire output in exactly ONE complete HTML file starting with <!DOCTYPE html>.
   - The simulation Canvas should fill 100vw and 100vh. CSS: body, html { margin: 0; overflow: hidden; background: #000; }
   - Separate your JS into a "model" (state + logic, plain functions, zero DOM references) and a "view" (reads model state, renders to canvas).
   - Define model values in REAL-WORLD UNITS (meters, degrees, kg) and use a single small transform function (e.g., modelToView) to convert to pixel coordinates. NEVER hardcode pixel math in the model.
   - Expose window.simAPI = { reset: function(){...}, play: function(){...}, pause: function(){...} }. The parent UI will call these.

5. SAFETY:
   - At extreme parameter values, behavior must degrade gracefully (clamp, cap, bound) rather than glitch.
   - Do not depict any religious figures in a literal/figurative visual form.

6. DO NOT generate left-panel navigation or UI cards. The parent app handles ALL layout. You ONLY render the full-screen canvas and the hidden <input> elements.`

    const userPrompt = `Create a gamified, PhET-style interactive simulation for: "${concept.trim()}"

CRITICAL REQUIREMENTS:
1) FULL SCREEN CANVAS: No UI sidebars. Just a beautiful, vibrant full-screen canvas.
2) GAME ENVIRONMENT: Draw a vibrant sky gradient, clouds, and solid terrain (grass/dirt).
3) DRAG TO LAUNCH / SLINGSHOT: Implement dragging mechanics to launch projectiles or move objects.
4) TARGET & WIN STATE: Place a target zone. When hit, show massive "LEVEL CLEARED!" text and spawn confetti.
5) GAME HUD: Render a Score/Attempts counter and Health/Power meter overlaid on the canvas using chunky fonts.
6) REAL-WORLD UNITS: Calculate physics in meters/kg/seconds. Use a transform function for pixel rendering.
7) HTML INPUTS: Create <input type="range"> elements in the body for your adjustable variables so they can be extracted by the shell.
8) EXPOSE API: window.simAPI = { reset: () => {...}, play: () => {...}, pause: () => {...} }

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
