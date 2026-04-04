/**
 * useBellaAnimations — manages Bella's emotional state and applies
 * corresponding VRM bone/expression animations.
 * Requirements: 10.8, 10.9
 *
 * States:
 *   neutral   — idle breathing (handled by BellaCanvas rAF loop)
 *   thinking  — head tilt + relaxed expression
 *   happy     — smile (happy expression) + small wave
 *   celebrate — jump + clap (happy expression + arm raise)
 */
import { useEffect, useRef } from 'react'
import type { VRM } from '@pixiv/three-vrm'
import { VRMHumanBoneName, VRMExpressionPresetName } from '@pixiv/three-vrm'
import { computeEmotionExpressions } from './BellaOverlay'

export type BellaEmotionalState = 'neutral' | 'thinking' | 'happy' | 'celebrate'

/**
 * Applies bone and expression overrides for the given emotional state.
 * The idle animation loop in BellaCanvas continues to run; this hook
 * layers additional offsets on top.
 */
export function useBellaAnimations(vrm: VRM | null, state: BellaEmotionalState) {
  const frameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(performance.now())

  useEffect(() => {
    if (!vrm) return

    // Reset start time for each new state
    startTimeRef.current = performance.now()

    // Apply expression values immediately
    const em = vrm.expressionManager
    if (em) {
      const { happy, relaxed, surprised } = computeEmotionExpressions(state)
      em.setValue(VRMExpressionPresetName.Happy, happy)
      em.setValue(VRMExpressionPresetName.Relaxed, relaxed)
      em.setValue(VRMExpressionPresetName.Surprised, surprised)
    }

    const humanoid = vrm.humanoid

    // Apply bone overrides per state
    const applyBones = () => {
      const elapsed = (performance.now() - startTimeRef.current) / 1000

      if (state === 'thinking') {
        // Head tilt to the side
        const head = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
        if (head) {
          head.rotation.z = 0.15 * Math.sin(elapsed * 0.5 + Math.PI / 2)
        }
      } else if (state === 'happy') {
        // Small wave: right arm raises and waves
        const rightArm = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
        const rightForeArm = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm)
        if (rightArm) {
          rightArm.rotation.z = -(0.8 + Math.sin(elapsed * 4) * 0.2)
        }
        if (rightForeArm) {
          rightForeArm.rotation.z = -(0.3 + Math.sin(elapsed * 4 + 0.5) * 0.15)
        }
      } else if (state === 'celebrate') {
        // Both arms raised + slight jump (hip Y offset)
        const leftArm = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
        const rightArm = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
        const hips = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips)
        if (leftArm) leftArm.rotation.z = 1.2 + Math.sin(elapsed * 6) * 0.1
        if (rightArm) rightArm.rotation.z = -(1.2 + Math.sin(elapsed * 6 + 0.3) * 0.1)
        if (hips) hips.position.y = Math.abs(Math.sin(elapsed * 5)) * 0.04
      }

      frameRef.current = requestAnimationFrame(applyBones)
    }

    if (state !== 'neutral') {
      frameRef.current = requestAnimationFrame(applyBones)
    }

    return () => {
      cancelAnimationFrame(frameRef.current)
      // Reset bones to neutral on cleanup
      if (humanoid) {
        const head = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head)
        if (head) head.rotation.z = 0
        const rightArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
        if (rightArm) rightArm.rotation.z = 0
        const rightForeArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm)
        if (rightForeArm) rightForeArm.rotation.z = 0
        const leftArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
        if (leftArm) leftArm.rotation.z = 0
        const hips = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Hips)
        if (hips) hips.position.y = 0
      }
    }
  }, [vrm, state])
}
