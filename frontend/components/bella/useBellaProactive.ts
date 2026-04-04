/**
 * useBellaProactive — proactive hints and contextual explanations.
 * Requirements: 10.6, 10.7
 *
 * - 60-second idle timer: if no user interaction, trigger a hint via Bella's chat
 * - On job completion: accepts lastJobContext and sends it to Bella for explanation
 */
import { useEffect, useRef } from 'react'

const IDLE_TIMEOUT_MS = 60_000

const IDLE_HINTS = [
  "Did you know you can ask me to explain any topic in a simpler way? Just type your question!",
  "Try generating an anime scene for a topic you're studying — it makes learning more fun!",
  "I can help you understand complex concepts. What are you working on today?",
  "You can ask me to create a story, simulation, or 3D model for any educational topic!",
]

export interface UseBellaProactiveOptions {
  /** Called when the idle timer fires — pass the hint message to display */
  onHint: (message: string) => void
  /** Called when a job context is ready to be explained */
  onJobContext: (message: string) => void
  /** The last completed job context string (e.g. "Generated anime scene: Photosynthesis") */
  lastJobContext: string | null
  /** Whether the chat is currently active (resets idle timer) */
  isActive: boolean
}

export function useBellaProactive({
  onHint,
  onJobContext,
  lastJobContext,
  isActive,
}: UseBellaProactiveOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hintIndexRef = useRef(0)
  const lastContextRef = useRef<string | null>(null)

  // Reset idle timer whenever the user is active
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)

    timerRef.current = setTimeout(() => {
      const hint = IDLE_HINTS[hintIndexRef.current % IDLE_HINTS.length]
      hintIndexRef.current++
      onHint(hint)
    }, IDLE_TIMEOUT_MS)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [isActive, onHint])

  // Trigger contextual explanation when a new job context arrives
  useEffect(() => {
    if (!lastJobContext || lastJobContext === lastContextRef.current) return
    lastContextRef.current = lastJobContext

    const message = `I just helped generate: "${lastJobContext}". Would you like me to explain the key concepts behind it?`
    onJobContext(message)
  }, [lastJobContext, onJobContext])
}
