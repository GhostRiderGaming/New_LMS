'use client'
import { useEffect, useRef, useCallback } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type EmotionState = 'neutral' | 'thinking' | 'happy'

export interface Live2DViewerProps {
  emotion: EmotionState
  isTalking: boolean
  onLoaded: () => void
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const MODEL_PATH = '/live2d/bella/bella.model3.json'

// Expression mapping: emotion state → Live2D expression name (from model3.json)
const EXPRESSION_MAP: Record<string, string | null> = {
  neutral: null,       // Reset to default face
  thinking: null,      // We'll handle via parameter tweaking
  happy: 'heart_eyes', // Love-eyes for happy state
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export function Live2DViewer({ emotion, isTalking, onLoaded }: Live2DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const appRef = useRef<any>(null)
  const modelRef = useRef<any>(null)
  const frameRef = useRef<number>(0)
  const destroyedRef = useRef(false)

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
    let animFrame: number = 0

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

      // Create PixiJS Application
      pixiApp = new PIXI.Application({
        view: canvas,
        autoStart: true,
        backgroundAlpha: 0,
        resizeTo: canvas.parentElement || undefined,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        autoDensity: true,
      })
      appRef.current = pixiApp

      // Load the Live2D model
      try {
        const model = await Live2DModel.from(MODEL_PATH, {
          motionPreload: MotionPreloadStrategy.IDLE,
        })

        if (destroyedRef.current) {
          model.destroy()
          return
        }

        modelRef.current = model

        // Fit model to canvas
        const canvasW = canvas.clientWidth
        const canvasH = canvas.clientHeight

        // Scale model to fill the viewport nicely
        const modelW = model.width
        const modelH = model.height
        const scale = Math.min(canvasW / modelW, canvasH / modelH) * 1.1
        model.scale.set(scale, scale)

        // Center horizontally, align bottom
        model.anchor.set(0.5, 0.5)
        model.x = canvasW / 2
        model.y = canvasH / 2

        // Disable PixiJS internal event tracking for this model to prevent the
        // "currentTarget.isInteractive is not a function" error in Pixi v7.
        // We handle mouse tracking manually via window.mousemove anyway.
        model.eventMode = 'none'
        pixiApp.stage.eventMode = 'none'

        pixiApp.stage.addChild(model)

        // ─── ANIMATION LOOP ──────────────────────────────────────────
        let breathPhase = 0
        let talkPhase = 0
        let mouthValue = 0
        let targetMouth = 0
        let mouthToggleTimer = 0

        // Idle brow/thinking state
        let browTarget = 0
        let browActual = 0

        // Cursor Tracking variables
        let targetCursorX = 0
        let targetCursorY = 0
        let currentCursorX = 0
        let currentCursorY = 0

        // Use the native Live2D model update event instead of a disconnected requestAnimationFrame
        // This ensures our parameter overrides don't conflict with the model's internal physics/focus updates.
        model.internalModel.on('beforeModelUpdate', () => {
          if (destroyedRef.current) return
          
          // Ticker delta is typically ~1 for 60fps
          const delta = pixiApp.ticker.deltaMS / 1000

          const coreModel: any = model?.internalModel?.coreModel
          if (!coreModel) return

          // ── Breathing ──
          breathPhase += delta * 1.5
          const breathVal = (Math.sin(breathPhase) + 1) / 2 // 0..1
          try {
            coreModel.setParameterValueById('ParamBreath', breathVal)
          } catch {}

          // ── Lip Sync ──
          if (isTalkingRef.current) {
            talkPhase += delta
            mouthToggleTimer -= delta
            if (mouthToggleTimer <= 0) {
              // Vary mouth opening for natural speech feel
              targetMouth = 0.3 + Math.random() * 0.7
              mouthToggleTimer = 0.06 + Math.random() * 0.14
            }
          } else {
            targetMouth = 0
            talkPhase = 0
          }
          // Smooth interpolation for mouth
          mouthValue += (targetMouth - mouthValue) * Math.min(1, delta * 18)
          try {
            coreModel.setParameterValueById('ParamMouthOpenY', mouthValue)
          } catch {}

          // ── Thinking Expression (brow furrow) ──
          browTarget = emotionRef.current === 'thinking' ? 0.6 : 0
          browActual += (browTarget - browActual) * Math.min(1, delta * 3)
          try {
            coreModel.setParameterValueById('ParamBrowForm', browActual)
          } catch {}
        })

        // ── Cursor Tracking (Continuous Ticker) ──
        pixiApp.ticker.add(() => {
          if (destroyedRef.current) return
          
          const coreModel: any = model?.internalModel?.coreModel
          if (!coreModel) return

          // Smoothly lerp toward target
          currentCursorX += (targetCursorX - currentCursorX) * 0.08
          currentCursorY += (targetCursorY - currentCursorY) * 0.08

          // Clamp values to prevent over-rotation
          const clampedX = Math.max(-1, Math.min(1, currentCursorX))
          const clampedY = Math.max(-1, Math.min(1, currentCursorY))

          try {
            // Set parameters EVERY FRAME to ensure it overrides Live2D motions
            coreModel.setParameterValueById('ParamAngleX', clampedX * 30)
            coreModel.setParameterValueById('ParamAngleY', clampedY * 30)
            coreModel.setParameterValueById('ParamEyeBallX', clampedX)
            coreModel.setParameterValueById('ParamEyeBallY', clampedY)
          } catch {}
        })

        // ─── MOUSE TRACKING ──────────────────────────────────────────
        const onMouseMove = (e: MouseEvent) => {
          if (!model || destroyedRef.current) return
          // Normalize mouse coordinates to [-1, 1] for the Live2D model
          // Center of screen is (0, 0)
          targetCursorX = (e.clientX / window.innerWidth) * 2 - 1
          targetCursorY = -((e.clientY / window.innerHeight) * 2 - 1)
        }
        window.addEventListener('mousemove', onMouseMove)

        // Store cleanup ref
        ;(canvasRef.current as any).__live2d_cleanup = () => {
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
        const interval = setInterval(() => {
          attempts++
          if ((window as any).Live2DCubismCore) {
            clearInterval(interval)
            init()
          } else if (attempts > 100) {
            clearInterval(interval)
            console.error('[Live2D] Cubism Core SDK not loaded after 10s')
          }
        }, 100)
      }
    }

    waitForCubismCore()

    return () => {
      destroyedRef.current = true
      cancelAnimationFrame(animFrame)

      // Clean up mouse listener
      const cleanup = (canvasRef.current as any)?.__live2d_cleanup
      if (cleanup) cleanup()

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
  }, []) // Empty dependency array ensures PixiJS is only initialized ONCE per mount

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ background: 'transparent', pointerEvents: 'none' }}
    />
  )
}
