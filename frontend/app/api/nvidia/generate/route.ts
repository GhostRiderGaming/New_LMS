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

    // Build the prompt
    const systemPrompt = `You are an expert educational simulation developer specializing in physics and mathematics visualizations for K-12 students.

RULES:
1. Generate a SINGLE, COMPLETE, self-contained HTML file.
2. Use only vanilla HTML5, CSS3, and JavaScript — NO external libraries, CDNs, or imports.
3. Use HTML5 Canvas or SVG for all visualizations and animations.
4. Include interactive controls (sliders, buttons, toggles) so the student can experiment.
5. Add clear labels, a title, and a brief explanation of the concept being demonstrated.
6. Use a dark theme background (#0f172a) with vibrant accent colors for visibility.
7. Make the simulation responsive — it must work at any container width.
8. Use requestAnimationFrame for smooth 60fps animations.
9. Include educational annotations that explain what is happening in real-time.
10. The HTML must be COMPLETE — start with <!DOCTYPE html> and end with </html>.
11. Return ONLY the HTML code block — no explanatory text before or after.`

    const userPrompt = `Create an interactive, animated educational simulation for the concept: "${concept.trim()}"

Requirements:
- The simulation must clearly demonstrate the core principle of "${concept.trim()}"
- Include at least 2 interactive controls (e.g., sliders for variables, play/pause, reset)
- Display real-time values/measurements that update during the animation
- Add a brief educational description (2-3 sentences) at the top explaining the concept
- Use smooth animations with requestAnimationFrame
- Dark background (#0f172a) with bright, high-contrast visual elements
- Responsive layout that fills the container width
- Include a title bar with the concept name

Return the complete HTML file inside a single markdown code block.`

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
        max_tokens: 8192,
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
