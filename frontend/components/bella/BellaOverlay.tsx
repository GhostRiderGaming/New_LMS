'use client'
import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMHumanBoneName, VRMExpressionPresetName } from '@pixiv/three-vrm'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ─── Idle Animation Formula Functions (exported for testability) ──────────────

export const computeSpineZ = (t: number) => Math.sin(t * 0.8) * 0.02;
export const computeSpineX = (t: number) => Math.sin(t * 0.5) * 0.01;
export const computeHeadY = (t: number) => Math.sin(t * 0.4) * 0.08;
export const computeHeadX = (t: number) => Math.sin(t * 0.3) * 0.04;
export const computeLeftUpperArmZ = (t: number) => 0.6 + Math.sin(t * 0.6) * 0.03;
export const computeRightUpperArmZ = (t: number) => -(0.6 + Math.sin(t * 0.6 + 1) * 0.03);

// ─── Blink Interpolation Formula Functions (exported for testability) ─────────

export function computeBlinkClosing(timer: number): number {
  return Math.min(timer / 0.07, 1);
}

export function computeBlinkOpening(timer: number): number {
  return 1 - Math.min(timer / 0.07, 1);
}

// ─── Lip Sync Formula Function (exported for testability) ────────────────────

/** Returns the Aa expression value for lip sync.
 *  lipOpen=true: maps rand [0,1] → [0.4, 0.8]
 *  lipOpen=false: returns 0 (mouth closed)
 */
export function computeLipSyncAa(lipOpen: boolean, rand: number): number {
  return lipOpen ? 0.4 + rand * 0.4 : 0;
}

// ─── TTS Fallback Duration (exported for testability) ────────────────────────

/** Clamps TTS fallback duration: text.length * 40ms, min 1500ms, max 6000ms */
export function computeTTSFallbackDuration(text: string): number {
  return Math.min(Math.max(text.length * 40, 1500), 6000);
}

// ─── Send Button Disabled Logic (exported for testability) ───────────────────

/** Returns true when the send button should be disabled. */
export function isSendDisabled(thinking: boolean, input: string): boolean {
  return thinking || !input.trim();
}

// ─── Message Alignment Logic (exported for testability) ──────────────────────

/** Returns the CSS alignment class for a message based on its role. */
export function messageAlignClass(role: 'user' | 'bella'): 'justify-end' | 'justify-start' {
  return role === 'user' ? 'justify-end' : 'justify-start';
}

/** Returns the CSS bubble class for a message based on its role. */
export function messageBubbleClass(role: 'user' | 'bella'): string {
  return role === 'user'
    ? 'bg-accent-purple text-white rounded-br-sm'
    : 'bg-bg-elevated text-slate-300 rounded-bl-sm border border-border';
}

// ─── Blink State Transition Functions (exported for testability) ──────────────

export type BlinkState = 'open' | 'closing' | 'opening';

/** Returns the next blink state given current state and accumulated timer (seconds). */
export function nextBlinkState(state: BlinkState, timer: number, nextBlinkThreshold: number): BlinkState {
  if (state === 'open') {
    return timer >= nextBlinkThreshold ? 'closing' : 'open';
  } else if (state === 'closing') {
    return computeBlinkClosing(timer) >= 1 ? 'opening' : 'closing';
  } else {
    return computeBlinkOpening(timer) <= 0 ? 'open' : 'opening';
  }
}

// ─── Emotion Expression Formula Function (exported for testability) ──────────

export type EmotionState = 'neutral' | 'thinking' | 'happy' | 'celebrate'

export function computeEmotionExpressions(emotion: EmotionState): {
  happy: number
  relaxed: number
  surprised: number
} {
  switch (emotion) {
    case 'happy':
    case 'celebrate':
      return { happy: 1, relaxed: 0, surprised: 0 }
    case 'thinking':
      return { happy: 0, relaxed: 0.5, surprised: 0 }
    case 'neutral':
    default:
      return { happy: 0, relaxed: 0, surprised: 0 }
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'bella'
  text: string
  timestamp: Date
}

// ─── VRM Canvas ───────────────────────────────────────────────────────────────

interface VRMViewerProps {
  emotion: EmotionState
  isTalking: boolean
  onLoaded: () => void
}

function VRMViewer({ emotion, isTalking, onLoaded }: VRMViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vrmRef = useRef<VRM | null>(null)
  const clockRef = useRef(new THREE.Clock())
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const frameRef = useRef<number>(0)
  const blinkTimerRef = useRef(0)
  const blinkStateRef = useRef<'open' | 'closing' | 'opening'>('open')
  const nextBlinkRef = useRef(3 + Math.random() * 2)
  const lipTimerRef = useRef(0)
  const lipOpenRef = useRef(false)
  // Ref mirrors so the rAF loop always reads current prop values (no stale closures)
  const emotionRef = useRef<EmotionState>(emotion)
  const isTalkingRef = useRef(isTalking)

  useEffect(() => { emotionRef.current = emotion }, [emotion])
  useEffect(() => { isTalkingRef.current = isTalking }, [isTalking])

  // Update emotion on VRM expressions
  useEffect(() => {
    const vrm = vrmRef.current
    if (!vrm?.expressionManager) return
    const em = vrm.expressionManager
    const { happy, relaxed, surprised } = computeEmotionExpressions(emotion)
    em.setValue(VRMExpressionPresetName.Happy, happy)
    em.setValue(VRMExpressionPresetName.Relaxed, relaxed)
    em.setValue(VRMExpressionPresetName.Surprised, surprised)
  }, [emotion])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setSize(canvas.clientWidth, canvas.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    rendererRef.current = renderer

    // Scene
    const scene = new THREE.Scene()
    sceneRef.current = scene

    // Camera — framed on upper body / face
    const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20)
    camera.position.set(0, 1.4, 2.2)
    camera.lookAt(0, 1.2, 0)
    cameraRef.current = camera

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.8)
    scene.add(ambient)
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
    dirLight.position.set(1, 2, 2)
    scene.add(dirLight)
    const rimLight = new THREE.DirectionalLight(0x9d5cf6, 0.6)
    rimLight.position.set(-2, 1, -1)
    scene.add(rimLight)

    // Orbit controls (limited — just slight look-around)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.2, 0)
    controls.enablePan = false
    controls.enableZoom = false
    controls.minPolarAngle = Math.PI / 3
    controls.maxPolarAngle = Math.PI / 2
    controls.minAzimuthAngle = -Math.PI / 6
    controls.maxAzimuthAngle = Math.PI / 6
    controls.update()

    // Load VRM — use a free CC0 VRM sample (AvatarSample_A from VRoid Hub)
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    // We use a publicly available sample VRM for demo purposes
    // In production, replace with your own hosted VRM file
    const VRM_URL = 'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'

    loader.load(
      VRM_URL,
      (gltf) => {
        const vrm: VRM = gltf.userData.vrm
        scene.add(vrm.scene)
        vrmRef.current = vrm
        // Rotate to face camera
        vrm.scene.rotation.y = Math.PI
        onLoaded()
      },
      undefined,
      () => {
        // Fallback: show placeholder if VRM fails to load
        onLoaded()
      }
    )

    // Animation loop
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate)
      const delta = clockRef.current.getDelta()
      const elapsed = clockRef.current.elapsedTime

      const vrm = vrmRef.current
      if (vrm) {
        const humanoid = vrm.humanoid

        // Idle body sway
        const spine = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine)
        if (spine) {
          spine.rotation.z = computeSpineZ(elapsed)
          spine.rotation.x = computeSpineX(elapsed)
        }

        // Head look-around idle
        const head = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
        if (head) {
          head.rotation.y = computeHeadY(elapsed)
          head.rotation.x = computeHeadX(elapsed)
        }

        // Arm idle float
        const leftArm = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
        const rightArm = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
        if (leftArm) leftArm.rotation.z = computeLeftUpperArmZ(elapsed)
        if (rightArm) rightArm.rotation.z = computeRightUpperArmZ(elapsed)

        // Auto blink
        blinkTimerRef.current += delta
        const em = vrm.expressionManager
        if (em) {
          if (blinkStateRef.current === 'open') {
            if (blinkTimerRef.current >= nextBlinkRef.current) {
              blinkStateRef.current = 'closing'
              blinkTimerRef.current = 0
            }
          } else if (blinkStateRef.current === 'closing') {
            const v = computeBlinkClosing(blinkTimerRef.current)
            em.setValue(VRMExpressionPresetName.BlinkLeft, v)
            em.setValue(VRMExpressionPresetName.BlinkRight, v)
            if (v >= 1) { blinkStateRef.current = 'opening'; blinkTimerRef.current = 0 }
          } else if (blinkStateRef.current === 'opening') {
            const v = computeBlinkOpening(blinkTimerRef.current)
            em.setValue(VRMExpressionPresetName.BlinkLeft, v)
            em.setValue(VRMExpressionPresetName.BlinkRight, v)
            if (v <= 0) {
              blinkStateRef.current = 'open'
              blinkTimerRef.current = 0
              nextBlinkRef.current = 3 + Math.random() * 2
            }
          }

          // Lip sync while talking
          if (isTalkingRef.current) {
            lipTimerRef.current += delta * 1000
            if (lipTimerRef.current > 100) {
              lipOpenRef.current = !lipOpenRef.current
              em.setValue('aa', computeLipSyncAa(lipOpenRef.current, Math.random()))
              lipTimerRef.current = 0
            }
          } else {
            em.setValue('aa', 0)
          }

          em.update()
        }

        vrm.update(delta)
      }

      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize handler
    const onResize = () => {
      if (!canvas) return
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      if (vrmRef.current) {
        sceneRef.current?.remove(vrmRef.current.scene)
        vrmRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ background: 'transparent' }}
    />
  )
}

// ─── Main Overlay ─────────────────────────────────────────────────────────────

const greetings = [
  "Hi! I'm Bella, your learning companion. What would you like to explore today?",
  "Hello! Ready to learn something amazing? Just ask me anything!",
  "Hey there! I'm here to help you understand any topic. What's on your mind?",
]

export default function BellaOverlay() {
  const [open, setOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'bella',
      text: greetings[Math.floor(Math.random() * greetings.length)],
      timestamp: new Date(),
    },
  ])
  const [emotion, setEmotion] = useState<EmotionState>('neutral')
  const [thinking, setThinking] = useState(false)
  const [isTalking, setIsTalking] = useState(false)
  const [vrmLoaded, setVrmLoaded] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string>(crypto.randomUUID())
  const recorderRef = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const playTTS = useCallback(async (text: string) => {
    try {
      const { api } = await import('@/lib/api')
      const arrayBuffer = await api.bellaTTS(text)
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onplay = () => setIsTalking(true)
      audio.onended = () => {
        setIsTalking(false)
        setEmotion('neutral')
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        // Fallback to timer if audio fails to play
        const duration = computeTTSFallbackDuration(text)
        setIsTalking(true)
        setTimeout(() => { setIsTalking(false); setEmotion('neutral') }, duration)
      }
      await audio.play()
    } catch {
      // TTS request failed — use timer-based fallback
      const duration = computeTTSFallbackDuration(text)
      setIsTalking(true)
      setTimeout(() => { setIsTalking(false); setEmotion('neutral') }, duration)
    }
  }, [])

  const addBellaMessage = useCallback((text: string, em: EmotionState = 'neutral') => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'bella', text, timestamp: new Date() }])
    setEmotion(em)
    playTTS(text)
  }, [playTTS])

  const handleSend = useCallback(async () => {
    if (!input.trim() || thinking) return
    const userText = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: userText, timestamp: new Date() }])
    setThinking(true)
    setEmotion('thinking')

    try {
      const { api } = await import('@/lib/api')
      const { reply } = await api.bellaChat(userText, sessionIdRef.current)
      setThinking(false)
      addBellaMessage(reply, 'happy')
    } catch {
      setThinking(false)
      setEmotion('neutral')
      addBellaMessage("Sorry, I had trouble connecting. Please try again.", 'neutral')
    }
  }, [input, thinking, addBellaMessage])

  const handleMicToggle = useCallback(async () => {
    setMicError(null)
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        const chunks: BlobPart[] = []
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          const blob = new Blob(chunks, { type: 'audio/webm' })
          try {
            const { api } = await import('@/lib/api')
            const { transcript } = await api.bellaTranscribe(blob)
            setInput(transcript)
            // Auto-send after transcription
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: transcript, timestamp: new Date() }])
            setThinking(true)
            setEmotion('thinking')
            try {
              const { api: api2 } = await import('@/lib/api')
              const { reply } = await api2.bellaChat(transcript, sessionIdRef.current)
              setThinking(false)
              setInput('')
              addBellaMessage(reply, 'happy')
            } catch {
              setThinking(false)
              setEmotion('neutral')
              setInput('')
              addBellaMessage("Sorry, I had trouble connecting. Please try again.", 'neutral')
            }
          } catch {
            setMicError('Transcription failed. Please try again.')
            setIsRecording(false)
          }
        }
        recorder.start()
        recorderRef.current = recorder
        setIsRecording(true)
      } catch {
        setMicError('Microphone access denied.')
      }
    } else {
      recorderRef.current?.stop()
      recorderRef.current = null
      setIsRecording(false)
    }
  }, [isRecording, addBellaMessage])

  // Floating button when closed
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full bg-gradient-anime shadow-glow-purple flex items-center justify-center text-2xl hover:scale-110 transition-transform"
        style={{ animation: 'float 3s ease-in-out infinite' }}
        title="Open Bella"
      >
        🌸
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-end gap-3">
      {/* Chat panel — slides in when chatOpen */}
      {chatOpen && (
        <div className="w-72 h-[420px] bg-bg-card border border-border rounded-2xl shadow-card flex flex-col overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-accent-purple/20 to-accent-pink/20 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-sm font-semibold text-white">Bella</span>
              <span className="text-xs text-slate-400">{thinking ? '· thinking...' : isTalking ? '· speaking...' : '· online'}</span>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="text-slate-500 hover:text-white text-xs transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${messageAlignClass(msg.role)}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${messageBubbleClass(msg.role)}`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="bg-bg-elevated border border-border px-3 py-2 rounded-xl rounded-bl-sm">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((d) => (
                      <div key={d} className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-border shrink-0">
            {micError && (
              <p className="text-xs text-red-400 mb-2 px-1">{micError}</p>
            )}
            <div className="flex gap-2">
              {/* Mic button */}
              <button
                onClick={handleMicToggle}
                disabled={thinking}
                className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm transition-colors shrink-0 relative ${
                  isRecording
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-bg-elevated border border-border text-slate-400 hover:text-white hover:border-accent-purple disabled:opacity-40'
                }`}
                title={isRecording ? 'Stop recording' : 'Start recording'}
              >
                🎤
                {isRecording && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" />
                )}
              </button>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask Bella anything..."
                className="flex-1 bg-bg-elevated border border-border rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent-purple transition-colors"
              />
              <button
                onClick={handleSend}
              disabled={isSendDisabled(thinking, input)}
                className="w-9 h-9 rounded-xl bg-accent-purple hover:bg-accent-purple-light disabled:opacity-40 flex items-center justify-center text-white text-sm transition-colors shrink-0"
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bella 3D panel */}
      <div className="flex flex-col items-center gap-2">
        {/* 3D canvas window */}
        <div
          className="relative rounded-2xl overflow-hidden border border-border shadow-card"
          style={{
            width: 200,
            height: 280,
            background: 'radial-gradient(ellipse at bottom, #1a0a2e 0%, #0a0a0f 70%)',
          }}
        >
          {/* Loading shimmer */}
          {!vrmLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
              <div className="text-4xl" style={{ animation: 'float 3s ease-in-out infinite' }}>🌸</div>
              <div className="text-xs text-slate-500">Loading Bella...</div>
              <div className="w-24 h-1 rounded-full bg-bg-elevated overflow-hidden">
                <div className="h-full bg-accent-purple rounded-full shimmer" />
              </div>
            </div>
          )}

          {/* Emotion badge */}
          {vrmLoaded && (
            <div className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-xs text-slate-300 border border-border">
              {emotion === 'thinking' ? '🤔 thinking' : emotion === 'happy' ? '😄 happy' : emotion === 'celebrate' ? '🎉 yay!' : '😊 idle'}
            </div>
          )}

          {/* Talking indicator — only shown after VRM loaded (Req 11.3) */}
          {vrmLoaded && isTalking && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center z-10">
              <div className="flex gap-0.5 items-end px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm">
                {[3, 6, 4, 7, 3, 5].map((h, i) => (
                  <div
                    key={i}
                    className="w-1 bg-accent-purple rounded-full"
                    style={{
                      height: h * 2,
                      animation: `bounce 0.${4 + i}s ease-in-out infinite`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <VRMViewer
            emotion={emotion}
            isTalking={isTalking}
            onLoaded={() => setVrmLoaded(true)}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2">
          {/* Chat toggle */}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              chatOpen
                ? 'bg-accent-purple text-white shadow-glow-purple'
                : 'bg-bg-card border border-border text-slate-400 hover:text-white hover:border-accent-purple'
            }`}
          >
            💬 Chat
          </button>

          {/* Close Bella */}
          <button
            onClick={() => { setOpen(false); setChatOpen(false) }}
            className="w-8 h-8 rounded-xl bg-bg-card border border-border text-slate-500 hover:text-white hover:border-red-500/50 flex items-center justify-center text-xs transition-all"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
