/**
 * useBellaLipSync — phoneme-driven lip sync hook.
 * Requirements: 10.4
 *
 * Receives phoneme timestamps from TTS response and maps them to VRM
 * BlendShape viseme targets, synchronized to AudioContext currentTime.
 */
import { useEffect, useRef } from 'react'
import type { VRM } from '@pixiv/three-vrm'

export interface PhonemeTimestamp {
  phoneme: string
  time: number // seconds from audio start
}

// ARPAbet → VRM viseme mapping
const PHONEME_TO_VISEME: Record<string, string> = {
  AA: 'aa', AE: 'aa', AH: 'aa',
  IH: 'ih', IY: 'ih',
  UH: 'ou', UW: 'ou',
  EH: 'ee', EY: 'ee',
  OW: 'oh', AO: 'oh',
  // Consonants / silence → neutral (mouth closed)
  SIL: 'aa',
}

const VISEME_EXPRESSIONS = ['aa', 'ih', 'ou', 'ee', 'oh']

/**
 * Animates VRM lip sync from phoneme timestamps.
 *
 * @param vrm       - The loaded VRM instance (or null)
 * @param phonemes  - Array of { phoneme, time } from TTS response
 * @param audioCtx  - AudioContext whose currentTime drives sync
 * @param startTime - AudioContext.currentTime at which audio playback began
 * @param active    - Whether lip sync should be running
 */
export function useBellaLipSync(
  vrm: VRM | null,
  phonemes: PhonemeTimestamp[],
  audioCtx: AudioContext | null,
  startTime: number,
  active: boolean
) {
  const frameRef = useRef<number>(0)
  const phonemeIndexRef = useRef(0)

  useEffect(() => {
    if (!vrm || !audioCtx || !active || phonemes.length === 0) return

    phonemeIndexRef.current = 0

    const tick = () => {
      const elapsed = audioCtx.currentTime - startTime

      // Advance phoneme index to the current time
      while (
        phonemeIndexRef.current < phonemes.length - 1 &&
        phonemes[phonemeIndexRef.current + 1].time <= elapsed
      ) {
        phonemeIndexRef.current++
      }

      const current = phonemes[phonemeIndexRef.current]
      const viseme = current ? (PHONEME_TO_VISEME[current.phoneme.toUpperCase()] ?? null) : null
      const em = vrm.expressionManager

      if (em) {
        // Zero all viseme expressions
        for (const v of VISEME_EXPRESSIONS) {
          em.setValue(v, 0)
        }
        // Set the active viseme
        if (viseme) em.setValue(viseme, 0.6)
        em.update()
      }

      frameRef.current = requestAnimationFrame(tick)
    }

    frameRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameRef.current)
      // Close mouth on cleanup
      const em = vrm?.expressionManager
      if (em) {
        for (const v of VISEME_EXPRESSIONS) em.setValue(v, 0)
        em.update()
      }
    }
  }, [vrm, phonemes, audioCtx, startTime, active])
}
