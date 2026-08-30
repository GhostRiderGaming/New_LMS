'use client'
import { useEffect, useRef, useCallback } from 'react'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type EmotionState = 'neutral' | 'thinking' | 'happy' | 'angry' | 'scared' | 'blush' | 'celebrate'

export interface Live2DViewerProps {
  emotion: EmotionState
  isTalking: boolean
  audioVolume?: number
  onLoaded: () => void
  modelPath: string
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const CANVAS_W = 280
const CANVAS_H = 400
const TARGET_FPS = 60        // 60fps with delta-time — smooth on modern screens
const MOUSE_THROTTLE_MS = 16 // ~60fps mouse sampling
const CURSOR_DEADZONE_PX = 8 // micro-jitter ignored below this distance

// ─── LERP HELPERS ─────────────────────────────────────────────────────────────

/** Exponential lerp — frame-rate independent. factor = 0.05–0.10 for smooth tracking. */
const expLerp = (current: number, target: number, factor: number, dt: number): number =>
  current + (target - current) * (1 - Math.pow(1 - factor, dt * 60))

/** Linear lerp — simple blend */
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// ─── ANIMATION MANAGER ───────────────────────────────────────────────────────

/**
 * AnimationManager — centralises all motion/expression scheduling.
 *
 * Priority tiers:
 *   P1 (always)  — breathing, eye blink, micro eye saccades
 *   P2 (10–20s)  — head tilt, body lean, hair sway
 *   P3 (45–120s) — hand gestures, full-body, expression changes
 */
class AnimationManager {
  private model: any
  private motionManager: any
  private modelSettings: any

  // Available groups by priority tier
  private p2Groups: string[] = []
  private p3Groups: string[] = []
  private allGroups: string[] = []
  private expressions: string[] = []

  // State
  private isPlayingMotion = false
  private isPlayingExpression = false
  private p2Timer = 10 + Math.random() * 10
  private p3Timer = 45 + Math.random() * 75
  private expressionTimer = 10 + Math.random() * 8
  private expressionDuration = 0
  private expressionElapsed = 0
  private lastPlayedMotion = ''
  private motionCooldowns: Map<string, number> = new Map()

  constructor(model: any) {
    this.model = model
    this.motionManager = model.internalModel?.motionManager
    this.modelSettings = model.internalModel?.settings

    this._discoverMotions()
    this._discoverExpressions()
    this._patchFadeTimes()
  }

  private _discoverMotions() {
    const motions = this.modelSettings?.motions
    if (!motions) return

    for (const group of Object.keys(motions)) {
      const list = motions[group]
      if (!Array.isArray(list) || list.length === 0) continue

      this.allGroups.push(group)
      const gl = group.toLowerCase()

      // Classify by tier based on naming conventions
      if (gl.includes('idle') || gl.includes('breath') || gl.includes('blink')) {
        // P1 — handled manually, skip from scheduler
      } else if (
        gl.includes('tap') || gl.includes('flick') || gl.includes('touch') ||
        gl.includes('gesture') || gl.includes('wave') || gl.includes('hand') ||
        gl.includes('special') || gl.includes('dance') ||
        gl.includes('zhao') || gl.includes('zhai') ||   // 照相 = photo, 摘 = grab
        gl.includes('photo') || gl.includes('camera') || gl.includes('pose')
      ) {
        this.p3Groups.push(group)
      } else {
        this.p2Groups.push(group)
      }
    }

    // Fallback: if no tier separation found, put everything in P2
    if (this.p2Groups.length === 0 && this.p3Groups.length === 0) {
      this.p2Groups = [...this.allGroups]
    }
  }

  private _discoverExpressions() {
    const exprs = this.modelSettings?.expressions
    if (!Array.isArray(exprs)) return
    for (const e of exprs) {
      const name = e.Name || e.name
      if (name) this.expressions.push(name)
    }
  }

  private _patchFadeTimes() {
    const motions = this.modelSettings?.motions
    if (!motions) return
    for (const group of Object.keys(motions)) {
      const list = motions[group]
      if (!Array.isArray(list)) continue
      for (const m of list) {
        const filename = (m.File || '').toLowerCase()
        const isArmMotion =
          filename.includes('arm')    ||
          filename.includes('hand')   ||
          filename.includes('zhao')   ||  // 照相 = photo-click arm motion
          filename.includes('zhai')   ||  // 摘眼 = grab/reach arm motion
          filename.includes('photo')  ||
          filename.includes('camera') ||
          filename.includes('pose')
        const minFade = isArmMotion ? 0.9 : 0.5
        if (!m.FadeInTime  || m.FadeInTime  < minFade) m.FadeInTime  = minFade
        if (!m.FadeOutTime || m.FadeOutTime < minFade) m.FadeOutTime = minFade
      }
    }
  }

  /** Tick — called every frame with delta seconds */
  tick(dt: number, blockManualFace: boolean) {
    // Cooldown decay
    this.motionCooldowns.forEach((v, k) => {
      const newV = v - dt
      if (newV <= 0) this.motionCooldowns.delete(k)
      else this.motionCooldowns.set(k, newV)
    })

    if (!this.isPlayingMotion) {
      // P2 scheduler
      this.p2Timer -= dt
      if (this.p2Timer <= 0 && this.p2Groups.length > 0) {
        this._playRandomFrom(this.p2Groups)
        this.p2Timer = 10 + Math.random() * 10 * (0.7 + Math.random() * 0.6) // ±30% jitter
      }

      // P3 scheduler (only if P2 is also idle)
      this.p3Timer -= dt
      if (this.p3Timer <= 0 && this.p3Groups.length > 0 && !this.isPlayingMotion) {
        this._playRandomFrom(this.p3Groups)
        this.p3Timer = 45 + Math.random() * 75
      }
    }

    // Expression scheduler (blocked while motion plays)
    if (!this.isPlayingMotion && this.expressions.length > 0) {
      if (this.isPlayingExpression) {
        this.expressionElapsed += dt
        if (this.expressionElapsed >= this.expressionDuration) {
          try { this.model.expression() } catch {}
          this.isPlayingExpression = false
          this.expressionTimer = 8 + Math.random() * 6
        }
      } else if (this.forcedEmotion === 'neutral' || this.forcedEmotion === 'thinking') {
        this.expressionTimer -= dt
        if (this.expressionTimer <= 0) {
          const name = this.expressions[Math.floor(Math.random() * this.expressions.length)]
          try {
            this.model.expression(name)
            this.isPlayingExpression = true
            this.expressionDuration = 3 + Math.random() * 3
            this.expressionElapsed = 0
          } catch {}
        }
      }
    }
  }

  private forcedEmotion: EmotionState = 'neutral'

  setForcedEmotion(emotion: EmotionState) {
    if (!this.model) return
    this.forcedEmotion = emotion
    try {
      if (emotion === 'happy') {
        this.model.expression('星星')
      } else if (emotion === 'angry') {
        this.model.expression('黑脸')
      } else if (emotion === 'scared') {
        this.model.expression('哭')
      } else if (emotion === 'blush') {
        this.model.expression('脸红')
        this._playSpecificMotion('照相')
      } else {
        // Try to clear or fall back
        this.model.expression('')
      }
    } catch {}
  }

  private async _playSpecificMotion(group: string) {
    const list = this.modelSettings?.motions?.[group]
    if (!list?.length) return
    if (this.isPlayingMotion) return
    this.isPlayingMotion = true
    try {
      const p = this.model.motion(group, 0, 3)
      if (p instanceof Promise) await p
    } catch (e) {
      console.warn('[Live2D] Specific motion failed:', group, e)
    } finally {
      this.isPlayingMotion = false
    }
  }

  private async _playRandomFrom(groups: string[]) {
    // Filter out groups on cooldown and the last played
    const available = groups.filter(g =>
      !this.motionCooldowns.has(g) && g !== this.lastPlayedMotion
    )
    if (available.length === 0) return

    const group = available[Math.floor(Math.random() * available.length)]
    const list = this.modelSettings?.motions?.[group]
    if (!list?.length) return

    const idx = Math.floor(Math.random() * list.length)
    this.isPlayingMotion = true
    this.lastPlayedMotion = group

    // Cooldown = 2× the motion duration (estimated 3s default)
    const motionDuration = list[idx]?.Duration ?? 3
    this.motionCooldowns.set(group, motionDuration * 2)

    // ── For arm/hand motions, add pre-blend delay so previous motion starts fading ──
    const filename = (list[idx]?.File || '').toLowerCase()
    const isArmMotion = filename.includes('zhao') || filename.includes('zhai') ||
                        filename.includes('arm') || filename.includes('hand') ||
                        filename.includes('photo')
    if (isArmMotion) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    try {
      // Priority 2 (NORMAL) — blends smoothly, no hard cut
      const p = this.model.motion(group, idx, 2)
      if (p instanceof Promise) await p
    } catch (e) {
      console.warn('[Live2D] Motion failed:', group, idx, e)
    } finally {
      this.isPlayingMotion = false
    }
  }

  getIsPlayingMotion() { return this.isPlayingMotion }
  getIsPlayingExpression() { return this.isPlayingExpression }
  hasMotions() { return this.allGroups.length > 0 }
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export function Live2DViewer({ emotion, isTalking, audioVolume = 0, onLoaded, modelPath }: Live2DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const appRef = useRef<any>(null)
  const modelRef = useRef<any>(null)
  const destroyedRef = useRef(false)

  const emotionRef = useRef(emotion)
  const isTalkingRef = useRef(isTalking)
  const audioVolumeRef = useRef(audioVolume)

  useEffect(() => { 
    emotionRef.current = emotion 
    if (appRef.current && (appRef.current as any).__animMgr) {
      (appRef.current as any).__animMgr.setForcedEmotion(emotion)
    }
  }, [emotion])
  useEffect(() => { isTalkingRef.current = isTalking }, [isTalking])
  useEffect(() => { audioVolumeRef.current = audioVolume }, [audioVolume])

  useEffect(() => {
    if (!canvasRef.current) return
    destroyedRef.current = false

    let pixiApp: any = null
    let pollInterval: ReturnType<typeof setInterval> | null = null
    let mouseMoveHandler: ((e: MouseEvent) => void) | null = null
    let visibilityHandler: (() => void) | null = null

    const init = async () => {
      const PIXI = await import('pixi.js')
      ;(window as any).PIXI = PIXI
      const { Live2DModel, MotionPreloadStrategy, config } = await import('pixi-live2d-display/cubism4')

      config.expressionFadingDuration = 600

      if (destroyedRef.current) return
      const canvas = canvasRef.current
      if (!canvas) return

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
      pixiApp.ticker.maxFPS = TARGET_FPS

      try {
        const model = await Live2DModel.from(modelPath, {
          motionPreload: MotionPreloadStrategy.IDLE,
          idleMotionGroup: 'DISABLE_AUTO_IDLE',
        })

        if (destroyedRef.current) { model.destroy(); return }
        modelRef.current = model

        // Disable SDK's built-in idle auto-player — our AnimationManager controls scheduling
        if (model.internalModel?.motionManager?.groups) {
          model.internalModel.motionManager.groups.idle = ''
        }

        // Scale & position (zoomed in to focus on upper body)
        const baseScale = Math.min(CANVAS_W / model.width, CANVAS_H / model.height)
        const scale = baseScale * 1.93
        model.scale.set(scale)
        model.anchor.set(0.5, 0.5)
        model.x = CANVAS_W / 2
        // Shift down so the head/chest is centered
        model.y = CANVAS_H * 0.9
        model.eventMode = 'none'
        pixiApp.stage.eventMode = 'none'
        pixiApp.stage.addChild(model)

        // Instantiate the centralised animation manager
        const animMgr = new AnimationManager(model)
        ;(pixiApp as any).__animMgr = animMgr
        animMgr.setForcedEmotion(emotionRef.current)

        // ── P1: Always-on parameter state ──────────────────────────────
        let breathPhase = Math.random() * Math.PI * 2  // start at random phase
        let breathBodyX = 0
        let breathBodyZ = 0

        // Eye blinking
        let blinkTimer = 3 + Math.random() * 3
        let isBlinking = false
        let blinkPhase = 0
        let eyeOpenness = 1

        // Slow blink (half-close)
        let slowBlinkTimer = 20 + Math.random() * 15
        let isSlowBlinking = false
        let slowBlinkPhase = 0

        // Micro eye saccades
        let saccadeTimer = 1 + Math.random() * 2
        let saccadeTargetX = 0
        let saccadeTargetY = 0
        let saccadeX = 0
        let saccadeY = 0

        // Mouth / lip sync
        let mouthValue = 0
        let targetMouth = 0
        let mouthToggleTimer = 0

        // Brow (emotion-driven)
        let browActual = 0

        // Simulated acts (for models without motion files)
        let actTimer = 8 + Math.random() * 4
        let currentAct: string | null = null
        let actDuration = 0
        let actProgress = 0
        let actualSmile = 0
        let actualYawn = 0
        let actualBlush = 0
        let actualShift = 0

        // Cursor tracking — HEAD leads, BODY follows with lag
        let rawTargetX = 0   // raw mouse input (normalised -1..1)
        let rawTargetY = 0
        let headX = 0        // current head angle (lerped)
        let headY = 0
        let bodyX = 0        // current body angle (lags behind head)
        let bodyY = 0

        let paused = false

        // ── Tab visibility guard — pause when hidden ────────────────────
        visibilityHandler = () => { paused = document.hidden }
        document.addEventListener('visibilitychange', visibilityHandler)

        // ── Single unified ticker ───────────────────────────────────────
        pixiApp.ticker.add(() => {
          if (destroyedRef.current || paused) return
          const coreModel: any = model?.internalModel?.coreModel
          if (!coreModel) return

          const dt = Math.min(pixiApp.ticker.deltaMS / 1000, 0.05) // cap at 50ms

          // ── P1: Breathing (0.25Hz — natural resting rate) ──
          breathPhase += dt * (2 * Math.PI * 0.25) // 0.25Hz
          const breathVal = (Math.sin(breathPhase) + 1) / 2
          const breathInfluence = Math.sin(breathPhase) // -1..1
          breathBodyX = expLerp(breathBodyX, breathInfluence * 1.2, 0.05, dt)
          breathBodyZ = expLerp(breathBodyZ, breathInfluence * 0.8, 0.04, dt)
          try { coreModel.setParameterValueById('ParamBreath', breathVal) } catch {}
          // Breathing subtly drives body sway
          try { coreModel.setParameterValueById('ParamBodyAngleZ', breathBodyZ) } catch {}

          // ── P1: Eye blinking (every 3–6s, 150–350ms duration) ──
          blinkTimer -= dt
          if (blinkTimer <= 0 && !isBlinking && !isSlowBlinking) {
            isBlinking = true
            blinkPhase = 0
            blinkTimer = 3 + Math.random() * 3
          }
          if (isBlinking) {
            blinkPhase += dt / 0.25  // 250ms total blink
            if (blinkPhase >= 1) { isBlinking = false; eyeOpenness = 1 }
            else {
              // Smooth cubic blink curve: fast close, slow open
              const t = blinkPhase < 0.4
                ? blinkPhase / 0.4          // close phase (40%)
                : (blinkPhase - 0.4) / 0.6  // open phase (60%)
              eyeOpenness = blinkPhase < 0.4
                ? 1 - t * t                  // fast quadratic close
                : t * t * t                  // slow cubic open
            }
          } else {
            eyeOpenness = expLerp(eyeOpenness, 1, 0.3, dt)
          }

          // ── P1: Slow blink (half-close, every 20–35s) ──
          slowBlinkTimer -= dt
          if (slowBlinkTimer <= 0 && !isBlinking) {
            isSlowBlinking = true
            slowBlinkPhase = 0
            slowBlinkTimer = 20 + Math.random() * 15
          }
          let slowBlinkContrib = 0
          if (isSlowBlinking) {
            slowBlinkPhase += dt / 0.8  // 800ms slow blink
            if (slowBlinkPhase >= 1) { isSlowBlinking = false }
            else slowBlinkContrib = Math.sin(slowBlinkPhase * Math.PI) * 0.5
          }

          // ── P1: Micro eye saccades ──
          saccadeTimer -= dt
          if (saccadeTimer <= 0) {
            saccadeTargetX = (Math.random() - 0.5) * 0.3
            saccadeTargetY = (Math.random() - 0.5) * 0.2
            saccadeTimer = 1 + Math.random() * 2
          }
          saccadeX = expLerp(saccadeX, saccadeTargetX, 0.12, dt)
          saccadeY = expLerp(saccadeY, saccadeTargetY, 0.12, dt)

          // Combine saccades with cursor tracking for eye ball
          const finalEyeX = headX * 0.8 + saccadeX
          const finalEyeY = headY * 0.8 + saccadeY

          const finalEye = Math.max(0, Math.min(1, (eyeOpenness - slowBlinkContrib) * Math.max(0.15, 1 - actualYawn * 0.85)))
          try {
            coreModel.setParameterValueById('ParamEyeLOpen', finalEye)
            coreModel.setParameterValueById('ParamEyeROpen', finalEye)
            coreModel.setParameterValueById('ParamEyeBallX', finalEyeX)
            coreModel.setParameterValueById('ParamEyeBallY', finalEyeY)
          } catch {}

          // ── P2/P3: Animation Manager tick ──
          const blockManualFace = animMgr.getIsPlayingMotion() || animMgr.getIsPlayingExpression()
          if (!animMgr.hasMotions()) {
            animMgr.tick(dt, blockManualFace)
          } else {
            animMgr.tick(dt, blockManualFace)
          }

          // ── Cursor Tracking — head leads, body follows with lag ──
          // HEAD: lerp factor 0.06, smooth and responsive
          headX = expLerp(headX, rawTargetX, 0.06, dt)
          headY = expLerp(headY, rawTargetY, 0.06, dt)
          // BODY: follows head with extra lag (lerp factor 0.025)
          bodyX = expLerp(bodyX, headX * 0.5, 0.025, dt)
          bodyY = expLerp(bodyY, headY * 0.3, 0.025, dt)

          try {
            coreModel.setParameterValueById('ParamAngleX', headX * 28 + breathBodyX)
            coreModel.setParameterValueById('ParamAngleY', headY * 20)
            coreModel.setParameterValueById('ParamBodyAngleX', bodyX * 10)
            coreModel.setParameterValueById('ParamBodyAngleY', bodyY * 6)
          } catch {}

          // ── Lip sync ──
          if (audioVolumeRef.current > 0.01) {
            // Audio-driven lip sync
            targetMouth = Math.min(1, audioVolumeRef.current * 2.0)
          } else if (isTalkingRef.current) {
            // Fallback random flap if talking but no volume data yet
            mouthToggleTimer -= dt
            if (mouthToggleTimer <= 0) {
              targetMouth = 0.3 + Math.random() * 0.7
              mouthToggleTimer = 0.06 + Math.random() * 0.12
            }
          } else {
            targetMouth = Math.min(1, actualYawn)
          }
          mouthValue = expLerp(mouthValue, targetMouth, 0.4, dt)
          if (!blockManualFace) {
            try { coreModel.setParameterValueById('ParamMouthOpenY', mouthValue) } catch {}
          }

          // ── Brow — emotion-driven ──
          const browTarget = emotionRef.current === 'thinking' ? -0.5 : 0
          browActual = expLerp(browActual, browTarget, 0.08, dt)
          if (!blockManualFace) {
            try {
              coreModel.setParameterValueById('ParamBrowLForm', browActual)
              coreModel.setParameterValueById('ParamBrowRForm', browActual)
            } catch {}
          }

          // ── Simulated acts (fallback for models without motions) ──
          if (!animMgr.hasMotions() && !blockManualFace) {
            if (currentAct === null) {
              actTimer -= dt
              if (actTimer <= 0) {
                const acts = ['smile', 'yawn', 'shift', 'blush', 'think']
                currentAct = acts[Math.floor(Math.random() * acts.length)]
                actDuration = 2.5 + Math.random() * 2
                actProgress = 0
                actTimer = 8 + Math.random() * 4
              }
            }
          }

          let targetSmile = 0, targetYawn = 0, targetBlush = 0, targetShift = 0
          if (currentAct !== null && !blockManualFace) {
            actProgress += dt
            if (actProgress >= actDuration) {
              currentAct = null
            } else {
              const intensity = Math.sin((actProgress / actDuration) * Math.PI)
              switch (currentAct) {
                case 'smile':  targetSmile = intensity;  break
                case 'yawn':   targetYawn  = intensity;  break
                case 'blush':  targetBlush = intensity;  break
                case 'shift':  targetShift = Math.sin((actProgress / actDuration) * Math.PI * 3) * intensity * 0.6; break
                case 'think':  browActual  = expLerp(browActual, -intensity * 0.5, 0.1, dt); break
              }
            }
          }

          const actSm = 1 - Math.exp(-5 * dt)
          actualSmile = lerp(actualSmile, targetSmile, actSm)
          actualYawn  = lerp(actualYawn,  targetYawn,  actSm)
          actualBlush = lerp(actualBlush, targetBlush, actSm)
          actualShift = lerp(actualShift, targetShift, actSm)

          if (!blockManualFace) {
            try {
              coreModel.setParameterValueById('ParamMouthForm',  Math.min(1, actualSmile))
              coreModel.setParameterValueById('ParamEyeLSmile',  Math.min(1, actualSmile))
              coreModel.setParameterValueById('ParamEyeRSmile',  Math.min(1, actualSmile))
              coreModel.setParameterValueById('ParamCheek',      Math.min(1, actualBlush))
              coreModel.setParameterValueById('ParamBodyAngleZ', (breathBodyZ + actualShift * 6))
            } catch {}
          }
        })

        // ── Mouse tracking with deadzone ──────────────────────────────
        let lastMouseTime = 0
        let lastRawX = 0
        let lastRawY = 0

        mouseMoveHandler = (e: MouseEvent) => {
          if (destroyedRef.current) return
          const now = performance.now()
          if (now - lastMouseTime < MOUSE_THROTTLE_MS) return
          lastMouseTime = now

          const el = canvasRef.current
          if (!el) return
          const rect = el.getBoundingClientRect()
          const charCX = rect.left + rect.width / 2
          const charCY = rect.top + rect.height * 0.38  // face is above center

          const dx = e.clientX - charCX
          const dy = e.clientY - charCY

          // Deadzone — ignore micro jitter
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < CURSOR_DEADZONE_PX) return

          // Normalise to -1..1 with a wide field (600px = full deflection)
          const newX = Math.max(-1, Math.min(1, dx / 600))
          const newY = Math.max(-1, Math.min(1, -(dy / 600)))

          // Only update if change is meaningful (additional jitter filter)
          if (Math.abs(newX - lastRawX) > 0.005 || Math.abs(newY - lastRawY) > 0.005) {
            rawTargetX = newX
            rawTargetY = newY
            lastRawX = newX
            lastRawY = newY
          }
        }

        window.addEventListener('mousemove', mouseMoveHandler, { passive: true })

        onLoaded()

      } catch (err) {
        console.error('[Live2D] Model load failed:', err)
      }
    }

    // Wait for Cubism Core
    const waitForCore = () => {
      if ((window as any).Live2DCubismCore) {
        init()
      } else {
        let attempts = 0
        pollInterval = setInterval(() => {
          if ((window as any).Live2DCubismCore) {
            clearInterval(pollInterval!)
            pollInterval = null
            init()
          } else if (++attempts > 100) {
            clearInterval(pollInterval!)
            pollInterval = null
            console.error('[Live2D] Cubism Core not loaded after 10s')
          }
        }, 100)
      }
    }

    waitForCore()

    return () => {
      destroyedRef.current = true

      if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
      if (mouseMoveHandler) { window.removeEventListener('mousemove', mouseMoveHandler); mouseMoveHandler = null }
      if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null }

      if (modelRef.current) { try { modelRef.current.destroy() } catch {} modelRef.current = null }
      if (appRef.current) { try { appRef.current.destroy(false, { children: true }) } catch {} appRef.current = null }
    }
  }, [modelPath])

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
