/**
 * nemotronService.ts
 * ------------------
 * Calls the local Next.js API proxy at /api/nvidia/generate which in turn
 * calls NVIDIA Nemotron server-side (avoiding browser CORS restrictions).
 *
 * The prompt building and HTML extraction logic lives in the API route.
 */

/**
 * Generate a self-contained HTML simulation for the given concept.
 * Calls our own /api/nvidia/generate proxy endpoint.
 * @throws Error if the request fails or no HTML is returned.
 */
export async function generateSimulation(concept: string): Promise<string> {
  const response = await fetch('/api/nvidia/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ concept }),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || `Generation failed (HTTP ${response.status})`)
  }

  if (!data.html) {
    throw new Error('The AI returned an empty response. Please try a different concept.')
  }

  return data.html
}
