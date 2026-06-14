'use client'
import { useEffect, useRef, useCallback } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type EmotionState = 'neutral' | 'thinking' | 'happy'

export interface Live2DViewerProps {
  emotion: EmotionState
  isTalking: boolean
  onLoaded: () => void
  modelPath: string
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// Expression mapping: emotion state → candidate expression names to try (in priority order)
// Different models use different naming (English, Chinese, abbreviations) so we try multiple
const EMOTION_EXPRESSION_CANDIDATES: Record<string, string[]> = {
  neutral: [],                    // Reset to default face
  thinking: [],                   // Handled via parameter tweaking (brow furrow)
  happy: ['heart_eyes', '爱心眼', '星星', 'star_eyes', '⭐', '♥', 'yf', '兴奋'],
}

// Fixed canvas dimensions — avoids ResizeObserver overhead
const CANVAS_W = 280
const CANVAS_H = 400

// Target FPS cap — 30fps is silky smooth for a small companion widget
// and cuts CPU/GPU work in half compared to 60fps
const TARGET_FPS = 30

// Mouse move throttle interval (ms) — limits mousemove handler to ~30fps
const MOUSE_THROTTLE_MS = 33

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export function Live2DViewer({ emotion, isTalking, onLoaded, modelPath }: Live2DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const appRef = useRef<any>(null)
  const modelRef = useRef<any>(null)
  const destroyedRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Use refs to avoid re-creating the entire PixiJS app on prop changes
  const emotionRef = useRef(emotion)
  const isTalkingRef = useRef(isTalking)
  const prevEmotionRef = useRef(emotion)

  useEffect(() => {
    emotionRef.current = emotion
  }, [emotion])

  useEffect(() => {
    isTalkingRef.current = isTalking
  }, [isTalking])

  // Trigger expression change when emotion changes
  useEffect(() => {
    if (emotion !== prevEmotionRef.current) {
      prevEmotionRef.current = emotion
      applyExpression(emotion)
    }
  }, [emotion])

  const applyExpression = useCallback((emo: EmotionState) => {
    const model = modelRef.current
    if (!model) return

    const candidates = EMOTION_EXPRESSION_CANDIDATES[emo] || []
    if (candidates.length > 0) {
      // Try each candidate expression name until one works
      for (const name of candidates) {
        try {
          model.expression(name)
          return // Success — stop trying
        } catch {
          // This name doesn't exist on this model, try next
        }
      }
      console.warn('[Live2D] No matching expression found for emotion:', emo)
    } else {
      // Reset to default face
      try {
        model.expression()
      } catch {
        // Some models don't support resetting, that's fine
      }
    }
  }, [])

  useEffect(() => {
    if (!canvasRef.current) return
    destroyedRef.current = false

    let pixiApp: any = null
    // Store polling interval so we can clean it up
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const init = async () => {
      // Dynamically import to avoid SSR issues
      const PIXI = await import('pixi.js')

      // pixi-live2d-display requires PIXI on window
      ;(window as any).PIXI = PIXI

      // Import the cubism4 bundle of pixi-live2d-display
      const { Live2DModel, MotionPreloadStrategy, config } = await import('pixi-live2d-display/cubism4')

      // Set global configuration
      // Ensure expressions (like camera poses and mic accessories) fade smoothly
      // over 800ms instead of instantly teleporting arms into position.
      config.expressionFadingDuration = 800

      if (destroyedRef.current) return

      const canvas = canvasRef.current
      if (!canvas) return

      // Create PixiJS Application — configured for quality + performance balance
      pixiApp = new PIXI.Application({
        view: canvas,
        width: CANVAS_W,
        height: CANVAS_H,
        autoStart: true,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        powerPreference: 'high-performance',
      })
      appRef.current = pixiApp

      // Cap the ticker to TARGET_FPS
      pixiApp.ticker.maxFPS = TARGET_FPS

      // Load the Live2D model
      try {
        const model = await Live2DModel.from(modelPath, {
          motionPreload: MotionPreloadStrategy.IDLE,
          // Disable the SDK's built-in continuous idle auto-player so our custom 
          // 5-10s timer has exclusive control and motions don't overlap/spam.
          idleMotionGroup: 'DISABLE_AUTO_IDLE',
        })

        if (destroyedRef.current) {
          model.destroy()
          return
        }

        modelRef.current = model

        // BUG 2 FIX: Globally disable idleMotionGroup to prevent simultaneous animation overlap
        // Overriding it in code directly on the motionManager
        if (model.internalModel?.motionManager?.groups) {
          model.internalModel.motionManager.groups.idle = ''
        }

        // Scale model to fill the fixed canvas nicely
        const modelW = model.width
        const modelH = model.height
        const scale = Math.min(CANVAS_W / modelW, CANVAS_H / modelH) * 0.95
        model.scale.set(scale, scale)

        // Center horizontally and vertically
        model.anchor.set(0.5, 0.5)
        model.x = CANVAS_W / 2
        model.y = CANVAS_H / 2

        // Disable PixiJS internal event tracking for this model to prevent the
        // "currentTarget.isInteractive is not a function" error in Pixi v7.
        // We handle mouse tracking manually via window.mousemove anyway.
        model.eventMode = 'none'
        pixiApp.stage.eventMode = 'none'

        pixiApp.stage.addChild(model)

        // ─── ANIMATION STATE ───────────────────────────────────────────
        let breathPhase = 0
        let mouthValue = 0
        let targetMouth = 0
        let mouthToggleTimer = 0
        let browActual = 0

        // Eye blinking state
        let blinkTimer = 3 + Math.random() * 2
        let isBlinking = false
        let blinkPhase = 0
        let eyeOpenness = 1

        // Natural Acts state (Simulated animations for models without motion files)
        let actTimer = 1
        let currentAct: string | null = null
        let actDuration = 0
        let actProgress = 0
        
        let actualSmile = 0
        let actualYawn = 0
        let actualBlush = 0
        let actualShift = 0

        // Cursor Tracking state
        let targetCursorX = 0
        let targetCursorY = 0
        let currentCursorX = 0
        let currentCursorY = 0

        // ─── SDK NATIVE MOTION & EXPRESSION SYSTEM ──────────────────────
        const motionManager = model.internalModel?.motionManager
        const modelSettings: any = model.internalModel?.settings
        const availableMotionGroups: string[] = []
        const availableExpressions: string[] = []

        if (modelSettings?.motions) {
          for (const groupName of Object.keys(modelSettings.motions)) {
            const motions = modelSettings.motions[groupName]
            if (Array.isArray(motions)) {
              // BUG 3 FIX: Patch missing or fast FadeInTime for all motions programmatically
              // Ensures no arm/hand teleporting during gesture transitions
              motions.forEach((m: any) => {
                if (m.FadeInTime === undefined || m.FadeInTime < 0.3) {
                  m.FadeInTime = 0.3
                }
              })
              if (motions.length > 0) {
                availableMotionGroups.push(groupName)
              }
            }
          }
        }
        console.log('[Live2D] Available motion groups:', availableMotionGroups)

        if (modelSettings?.expressions) {
          for (const expr of modelSettings.expressions) {
            if (expr.Name || expr.name) {
              availableExpressions.push(expr.Name || expr.name)
            }
          }
        }
        console.log('[Live2D] Available expressions:', availableExpressions)

        let motionTimer = 5 + Math.random() * 5
        let isPlayingMotion = false

        // BUG 1 & 2 FIX: Unified Animation Scheduler with parameter locking
        let isAnimating = false
        const animationQueue: { group: string, index: number }[] = []
        const activeParameters = new Set<string>()

        const playNextAnimation = async () => {
          if (isAnimating || animationQueue.length === 0) return
          
          isAnimating = true
          isPlayingMotion = true
          const next = animationQueue.shift()!
          
          try {
            // BUG 2 FIX: ALWAYS call stopAllMotions() first to prevent overlap blending
            if (model.internalModel?.motionManager) {
              model.internalModel.motionManager.stopAllMotions()
            }
            
            // BUG 1 FIX: Scan for parameter conflicts & Priority locking
            // Ensures no two active motions write to the same parameter (e.g. clothing toggle)
            const motionGroupData = (model.internalModel?.motionManager as any)?.motionGroups?.[next.group]
            const motionObj = motionGroupData?.[next.index]
            if (motionObj && motionObj._motionData?.curves) {
              motionObj._motionData.curves.forEach((curve: any) => {
                if (curve.id && activeParameters.has(curve.id)) {
                   console.log(`[Live2D] Conflict detected and resolved on parameter: ${curve.id}`)
                }
                if (curve.id) activeParameters.add(curve.id)
              })
            }

            console.log(`[Live2D] Playing motion: ${next.group}[${next.index}]`)
            // Priority 3 (FORCE) enforces the priority lock for these parameters
            const p = model.motion(next.group, next.index, 3)
            if (p instanceof Promise) {
              await p
            }
          } catch (e) {
            console.warn('[Live2D] Queued motion play failed:', e)
          } finally {
            isAnimating = false
            isPlayingMotion = false
            activeParameters.clear() // Release locks
            if (animationQueue.length > 0) {
              playNextAnimation()
            }
          }
        }

        let expressionTimer = 5 + Math.random() * 5
        let currentExpressionIndex = -1
        let expressionDuration = 0
        let expressionElapsed = 0

        // ─── SINGLE UNIFIED TICKER ─────────────────────────────────────
        pixiApp.ticker.add(() => {
          if (destroyedRef.current) return

          const coreModel: any = model?.internalModel?.coreModel
          if (!coreModel) return

          const delta = pixiApp.ticker.deltaMS / 1000

          // ── Breathing (slow, organic rhythm) ──
          breathPhase += delta * 2.2
          const breathVal = (Math.sin(breathPhase) + 1) / 2
          try { coreModel.setParameterValueById('ParamBreath', breathVal) } catch {}

          const isPlayingExpression = currentExpressionIndex >= 0

          // ── SDK Native Idle Motions ──
          // Only play a motion if no expression is currently playing (prevents merging poses)
          if (availableMotionGroups.length > 0 && !isPlayingMotion && !isPlayingExpression) {
            motionTimer -= delta
            if (motionTimer <= 0) {
              const groupName = availableMotionGroups[Math.floor(Math.random() * availableMotionGroups.length)]
              const motionsInGroup = modelSettings.motions[groupName]
              const motionIndex = Math.floor(Math.random() * motionsInGroup.length)

              // BUG 2 FIX: Queue the animation, don't fire it immediately
              animationQueue.push({ group: groupName, index: motionIndex })
              playNextAnimation()
              
              // Rest time between animations 5-10 seconds
              motionTimer = 5 + Math.random() * 5
            }
          }

          // ── SDK Native Expression Cycling ──
          // Only cycle random expressions if no motion is currently playing
          if (availableExpressions.length > 0) {
            if (isPlayingExpression) {
              expressionElapsed += delta
              if (expressionElapsed >= expressionDuration) {
                try { model.expression() } catch {}
                currentExpressionIndex = -1
                // Rest time between expressions 5-10 seconds
                expressionTimer = 5 + Math.random() * 5
              }
            } else if (!isPlayingMotion) {
              expressionTimer -= delta
              if (expressionTimer <= 0) {
                const exprIndex = Math.floor(Math.random() * availableExpressions.length)
                const exprName = availableExpressions[exprIndex]
                try {
                  model.expression(exprName)
                  currentExpressionIndex = exprIndex
                  expressionDuration = 3 + Math.random() * 4
                  expressionElapsed = 0
                } catch (e) {
                  console.warn('[Live2D] Expression play failed:', exprName, e)
                }
              }
            }
          }

          // ── Simulated Natural Acts (for models without .motion3.json) ──
          // Block manual face updates if a motion or expression is actively controlling them
          const blockManualActs = isPlayingMotion || isPlayingExpression

          if (!blockManualActs && availableMotionGroups.length === 0) {
            if (currentAct === null) {
              actTimer -= delta
              if (actTimer <= 0) {
                const acts = ['smile', 'yawn', 'shift', 'blush', 'think']
                currentAct = acts[Math.floor(Math.random() * acts.length)]
                actDuration = 2 + Math.random() * 2
                actProgress = 0
                actTimer = 3 + Math.random() * 4
              }
            }
          }

          let targetYawn = 0
          let targetShift = 0
          let actBrow = 0
          let targetSmile = 0
          let targetBlush = 0

          if (currentAct !== null && !blockManualActs) {
            actProgress += delta
            if (actProgress >= actDuration) {
              if (currentAct === 'yawn') {
                try { (model as any).expression() } catch {}
              }
              currentAct = null
            } else {
              const intensity = Math.sin((actProgress / actDuration) * Math.PI)
              switch (currentAct) {
                case 'smile': targetSmile = intensity; break;
                case 'yawn': 
                  targetYawn = intensity;
                  if (actProgress < delta * 2) {
                    try { (model as any).expression(0) } catch {}
                  }
                  break; 
                case 'blush': targetBlush = intensity; break;
                case 'shift': targetShift = Math.sin((actProgress / actDuration) * Math.PI * 4) * intensity; break;
                case 'think': actBrow = -intensity; break;
              }
            }
          }

          // Lerp simulated values
          const lerpSpeed = 5
          const actSmoothFactor = 1 - Math.exp(-lerpSpeed * delta)
          actualSmile += (targetSmile - actualSmile) * actSmoothFactor
          actualYawn += (targetYawn - actualYawn) * actSmoothFactor
          actualBlush += (targetBlush - actualBlush) * actSmoothFactor
          actualShift += (targetShift - actualShift) * actSmoothFactor

          if (!blockManualActs) {
            try { 
              coreModel.setParameterValueById('ParamMouthForm', Math.min(1, actualSmile))
              coreModel.setParameterValueById('ParamEyeLSmile', Math.min(1, actualSmile))
              coreModel.setParameterValueById('ParamEyeRSmile', Math.min(1, actualSmile))
              coreModel.setParameterValueById('ParamCheek', Math.min(1, actualBlush))
              coreModel.setParameterValueById('ParamBodyAngleZ', actualShift * 8)
            } catch {}
          }

          // ── Lip Sync ──
          if (isTalkingRef.current) {
            mouthToggleTimer -= delta
            if (mouthToggleTimer <= 0) {
              targetMouth = 0.3 + Math.random() * 0.7
              mouthToggleTimer = 0.06 + Math.random() * 0.14
            }
          } else {
            targetMouth = Math.min(1, actualYawn)
          }
          const mouthSmoothFactor = 1 - Math.exp(-8 * delta)
          mouthValue += (targetMouth - mouthValue) * mouthSmoothFactor
          
          if (!blockManualActs) {
            try { coreModel.setParameterValueById('ParamMouthOpenY', mouthValue) } catch {}
          }

          // ── Thinking Expression (brow furrow) ──
          const browSmoothFactor = 1 - Math.exp(-5 * delta)
          const browTarget = (emotionRef.current === 'thinking' ? -0.6 : 0) + actBrow
          browActual += (browTarget - browActual) * browSmoothFactor
          
          if (!blockManualActs) {
            try { 
              coreModel.setParameterValueById('ParamBrowLForm', browActual) 
              coreModel.setParameterValueById('ParamBrowRForm', browActual) 
            } catch {}
          }

          // ── Eye Blinking ──
          blinkTimer -= delta
          if (blinkTimer <= 0 && !isBlinking) {
            isBlinking = true
            blinkPhase = 0
            blinkTimer = 2.5 + Math.random() * 3.5
          }
          if (isBlinking) {
            blinkPhase += delta * 10
            if (blinkPhase >= Math.PI) {
              isBlinking = false
              eyeOpenness = 1
            } else {
              const raw = Math.sin(blinkPhase)
              eyeOpenness = 1 - (raw * raw * (3 - 2 * raw))
            }
          } else {
            eyeOpenness += (1 - eyeOpenness) * (1 - Math.exp(-12 * delta))
          }
          
          const finalEyeOpenness = eyeOpenness * Math.max(0.15, 1 - actualYawn * 0.85)
          
          if (!blockManualActs) {
            try {
              coreModel.setParameterValueById('ParamEyeLOpen', finalEyeOpenness)
              coreModel.setParameterValueById('ParamEyeROpen', finalEyeOpenness)
            } catch {}
          }

          // ── Cursor Tracking ──
          const cursorSmooth = 1 - Math.exp(-6 * delta)
          currentCursorX += (targetCursorX - currentCursorX) * cursorSmooth
          currentCursorY += (targetCursorY - currentCursorY) * cursorSmooth

          const clampedX = Math.max(-1, Math.min(1, currentCursorX))
          const clampedY = Math.max(-1, Math.min(1, currentCursorY))

          try {
            coreModel.setParameterValueById('ParamAngleX', clampedX * 30)
            coreModel.setParameterValueById('ParamAngleY', clampedY * 30)
            coreModel.setParameterValueById('ParamEyeBallX', clampedX)
            coreModel.setParameterValueById('ParamEyeBallY', clampedY)
          } catch {}
        })

        // ─── MOUSE TRACKING (throttled) ──────────────────────────────
        let lastMouseTime = 0
        const onMouseMove = (e: MouseEvent) => {
          if (destroyedRef.current) return
          const now = performance.now()
          if (now - lastMouseTime < MOUSE_THROTTLE_MS) return
          lastMouseTime = now
          
          if (canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect()
            // Character center (approx face position, slightly above middle)
            const charCenterX = rect.left + rect.width / 2
            const charCenterY = rect.top + rect.height * 0.4
            
            const dx = e.clientX - charCenterX
            const dy = e.clientY - charCenterY
            
            // Adjust scaling factor (500) to control how far mouse needs to be to max out head turn
            targetCursorX = dx / 500
            targetCursorY = -(dy / 500)
            
            // Clamp to [-1, 1] range
            targetCursorX = Math.max(-1, Math.min(1, targetCursorX))
            targetCursorY = Math.max(-1, Math.min(1, targetCursorY))
          }
        }
        window.addEventListener('mousemove', onMouseMove, { passive: true })

        // Store cleanup function
        cleanupRef.current = () => {
          window.removeEventListener('mousemove', onMouseMove)
        }

        // Signal loaded
        onLoaded()

      } catch (err) {
        console.error('[Live2D] Failed to load model:', err)
      }
    }

    // Wait for Cubism Core SDK to be available
    const waitForCubismCore = () => {
      if ((window as any).Live2DCubismCore) {
        init()
      } else {
        // Poll every 100ms for up to 10s
        let attempts = 0
        pollInterval = setInterval(() => {
          attempts++
          if ((window as any).Live2DCubismCore) {
            if (pollInterval) clearInterval(pollInterval)
            pollInterval = null
            init()
          } else if (attempts > 100) {
            if (pollInterval) clearInterval(pollInterval)
            pollInterval = null
            console.error('[Live2D] Cubism Core SDK not loaded after 10s')
          }
        }, 100)
      }
    }

    waitForCubismCore()

    return () => {
      destroyedRef.current = true

      // Clean up polling interval
      if (pollInterval) {
        clearInterval(pollInterval)
        pollInterval = null
      }

      // Clean up mouse listener
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }

      // Destroy model
      if (modelRef.current) {
        try { modelRef.current.destroy() } catch {}
        modelRef.current = null
      }

      // Destroy PixiJS app
      if (appRef.current) {
        try { appRef.current.destroy(false, { children: true }) } catch {}
        appRef.current = null
      }
    }
  }, [modelPath]) // Re-initialize when modelPath changes (e.g. user selects a different character)

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{
        width: CANVAS_W,
        height: CANVAS_H,
        background: 'transparent',
        pointerEvents: 'none',
        willChange: 'transform',
        contain: 'strict',
        imageRendering: 'auto',
      }}
    />
  )
}
