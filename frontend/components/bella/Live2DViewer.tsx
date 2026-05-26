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

// Expression mapping: emotion state → Live2D expression name (from model3.json)
const EXPRESSION_MAP: Record<string, string | null> = {
  neutral: null,       // Reset to default face
  thinking: null,      // We'll handle via parameter tweaking
  happy: 'heart_eyes', // Love-eyes for happy state
}

// Fixed canvas dimensions — avoids ResizeObserver overhead
const CANVAS_W = 280
const CANVAS_H = 400

// Target FPS cap — 30fps is silky smooth for a small companion widget
// and cuts CPU/GPU work in half compared to 60fps
const TARGET_FPS = 30

// Mouse move throttle interval (ms) — limits mousemove handler to ~30fps
// to prevent flooding the main thread with cursor updates
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

    const exprName = EXPRESSION_MAP[emo]
    if (exprName) {
      try {
        model.expression(exprName)
      } catch (e) {
        console.warn('[Live2D] Expression not found:', exprName, e)
      }
    } else {
      // Reset to default — apply expression index 0 or reset
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
      const { Live2DModel, MotionPreloadStrategy } = await import('pixi-live2d-display/cubism4')

      if (destroyedRef.current) return

      const canvas = canvasRef.current
      if (!canvas) return

      // Create PixiJS Application — configured for maximum visual quality
      pixiApp = new PIXI.Application({
        view: canvas,
        width: CANVAS_W,
        height: CANVAS_H,
        autoStart: true,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 2,
        autoDensity: true,
        powerPreference: 'high-performance',
      })
      appRef.current = pixiApp

      // Cap the ticker to TARGET_FPS — halves CPU/GPU load vs uncapped 60fps
      pixiApp.ticker.maxFPS = TARGET_FPS

      // Load the Live2D model
      try {
        const model = await Live2DModel.from(modelPath, {
          motionPreload: MotionPreloadStrategy.IDLE,
        })

        if (destroyedRef.current) {
          model.destroy()
          return
        }

        modelRef.current = model

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

        // Natural Acts state
        let actTimer = 1 // Start very soon so user sees it
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

        // ─── SINGLE UNIFIED TICKER ─────────────────────────────────────
        // Consolidate ALL animation into one ticker callback to avoid
        // the overhead of two separate loops + event listener conflicts.
        pixiApp.ticker.add(() => {
          if (destroyedRef.current) return

          const coreModel: any = model?.internalModel?.coreModel
          if (!coreModel) return

          const delta = pixiApp.ticker.deltaMS / 1000

          // ── Breathing ──
          breathPhase += delta * 2.5
          const breathVal = (Math.sin(breathPhase) + 1) / 2
          try { coreModel.setParameterValueById('ParamBreath', breathVal) } catch {}

          // ── Natural Random Acts Calculation ──
          if (currentAct === null) {
            actTimer -= delta
            if (actTimer <= 0) {
              const acts = ['smile', 'yawn', 'shift', 'blush', 'think']
              currentAct = acts[Math.floor(Math.random() * acts.length)]
              actDuration = 2 + Math.random() * 2 // 2 to 4 seconds
              actProgress = 0
              actTimer = 3 + Math.random() * 4 // next act in 3-7s
            }
          }

          let targetYawn = 0
          let targetShift = 0
          let actBrow = 0
          let targetSmile = 0
          let targetBlush = 0

          if (currentAct !== null) {
            actProgress += delta
            if (actProgress >= actDuration) {
              // When yawn ends, reset the expression
              if (currentAct === 'yawn') {
                try { (model as any).expression() } catch {} // clear expression
              }
              currentAct = null
            } else {
              const intensity = Math.sin((actProgress / actDuration) * Math.PI)
              switch (currentAct) {
                case 'smile': targetSmile = intensity; break;
                case 'yawn': 
                  targetYawn = intensity;
                  // Trigger the built-in 捂脸 (cover face / arms up) expression at peak
                  if (actProgress < delta * 2) {
                    try { (model as any).expression(0) } catch {} // expression index 0 = 捂脸
                  }
                  break; 
                case 'blush': targetBlush = intensity; break;
                case 'shift': targetShift = Math.sin((actProgress / actDuration) * Math.PI * 4) * intensity; break;
                case 'think': actBrow = -intensity; break;
              }
            }
          }

          // Lerp actual values (slow lerp = smooth, no vibration)
          const lerpSpeed = 4 // gentle speed to avoid fighting physics
          actualSmile += (targetSmile - actualSmile) * Math.min(1, delta * lerpSpeed)
          actualYawn += (targetYawn - actualYawn) * Math.min(1, delta * lerpSpeed)
          actualBlush += (targetBlush - actualBlush) * Math.min(1, delta * lerpSpeed)
          actualShift += (targetShift - actualShift) * Math.min(1, delta * lerpSpeed)

          // Apply facial acts (these params are NOT physics inputs, so they won't vibrate)
          try { 
            coreModel.setParameterValueById('ParamMouthForm', Math.min(1, actualSmile))
            coreModel.setParameterValueById('ParamEyeLSmile', Math.min(1, actualSmile))
            coreModel.setParameterValueById('ParamEyeRSmile', Math.min(1, actualSmile))
            coreModel.setParameterValueById('ParamCheek', Math.min(1, actualBlush))
            // Body sway - ParamBodyAngleZ is safe (not a physics input)
            coreModel.setParameterValueById('ParamBodyAngleZ', actualShift * 8)
          } catch {}

          // ── Lip Sync ──
          if (isTalkingRef.current) {
            mouthToggleTimer -= delta
            if (mouthToggleTimer <= 0) {
              targetMouth = 0.3 + Math.random() * 0.7
              mouthToggleTimer = 0.06 + Math.random() * 0.14
            }
          } else {
            targetMouth = Math.min(1, actualYawn) // Open mouth within safe range when yawning
          }
          mouthValue += (targetMouth - mouthValue) * Math.min(1, delta * lerpSpeed)
          try { coreModel.setParameterValueById('ParamMouthOpenY', mouthValue) } catch {}

          // ── Thinking Expression (brow furrow) ──
          // NOTE: ParamBrowLY is a physics INPUT (drives PhysicsSetting5 / 瞪眼).
          // Only set ParamBrowLForm/RForm which are NOT physics inputs.
          const browTarget = (emotionRef.current === 'thinking' ? -0.6 : 0) + actBrow
          browActual += (browTarget - browActual) * Math.min(1, delta * lerpSpeed)
          try { 
            coreModel.setParameterValueById('ParamBrowLForm', browActual) 
            coreModel.setParameterValueById('ParamBrowRForm', browActual) 
          } catch {}

          // ── Eye Blinking ──
          blinkTimer -= delta
          if (blinkTimer <= 0 && !isBlinking) {
            isBlinking = true
            blinkPhase = 0
            blinkTimer = 2 + Math.random() * 4
          }
          if (isBlinking) {
            blinkPhase += delta * 15 // Speed of blink
            if (blinkPhase >= Math.PI) {
              isBlinking = false
              eyeOpenness = 1
            } else {
              eyeOpenness = 1 - Math.sin(blinkPhase)
            }
          } else {
            eyeOpenness = 1
          }
          
          // Squint when yawning (gentle, within safe range)
          const finalEyeOpenness = eyeOpenness * Math.max(0.15, 1 - actualYawn * 0.85)
          
          try {
            coreModel.setParameterValueById('ParamEyeLOpen', finalEyeOpenness)
            coreModel.setParameterValueById('ParamEyeROpen', finalEyeOpenness)
          } catch {}

          // ── Cursor Tracking (smoothed lerp) ──
          currentCursorX += (targetCursorX - currentCursorX) * 0.15
          currentCursorY += (targetCursorY - currentCursorY) * 0.15

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
      }}
    />
  )
}
