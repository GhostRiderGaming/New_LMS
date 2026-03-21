'use client'
import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMHumanBoneName, VRMExpressionPresetName } from '@pixiv/three-vrm'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'bella'
  text: string
  timestamp: Date
}

type EmotionState = 'neutral' | 'thinking' | 'happy' | 'celebrate'

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
  const lipTimerRef = useRef(0)
  const lipOpenRef = useRef(false)

  // Update emotion on VRM expressions
  useEffect(() => {
    const vrm = vrmRef.current
    if (!vrm?.expressionManager) return
    const em = vrm.expressionManager
    // Reset all
    em.setValue(VRMExpressionPresetName.Happy, 0)
    em.setValue(VRMExpressionPresetName.Surprised, 0)
    em.setValue(VRMExpressionPresetName.Relaxed, 0)
    if (emotion === 'happy' || emotion === 'celebrate') {
      em.setValue(VRMExpressionPresetName.Happy, 1)
    } else if (emotion === 'thinking') {
      em.setValue(VRMExpressionPresetName.Relaxed, 0.5)
    }
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
        // Idle body sway
        const spine = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine)
        if (spine) {
          spine.rotation.z = Math.sin(elapsed * 0.8) * 0.02
          spine.rotation.x = Math.sin(elapsed * 0.5) * 0.01
        }

        // Head look-around idle
        const head = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
        if (head) {
          head.rotation.y = Math.sin(elapsed * 0.4) * 0.08
          head.rotation.x = Math.sin(elapsed * 0.3) * 0.04
        }

        // Arm idle float
        const leftArm = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
        const rightArm = vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
        if (leftArm) leftArm.rotation.z = 0.6 + Math.sin(elapsed * 0.6) * 0.03
        if (rightArm) rightArm.rotation.z = -(0.6 + Math.sin(elapsed * 0.6 + 1) * 0.03)

        // Auto blink
        blinkTimerRef.current += delta
        const em = vrm.expressionManager
        if (em) {
          if (blinkStateRef.current === 'open' && blinkTimerRef.current > 3 + Math.random() * 2) {
            blinkStateRef.current = 'closing'
            blinkTimerRef.current = 0
          } else if (blinkStateRef.current === 'closing') {
            const v = Math.min(blinkTimerRef.current / 0.07, 1)
            em.setValue(VRMExpressionPresetName.BlinkLeft, v)
            em.setValue(VRMExpressionPresetName.BlinkRight, v)
            if (v >= 1) { blinkStateRef.current = 'opening'; blinkTimerRef.current = 0 }
          } else if (blinkStateRef.current === 'opening') {
            const v = 1 - Math.min(blinkTimerRef.current / 0.07, 1)
            em.setValue(VRMExpressionPresetName.BlinkLeft, v)
            em.setValue(VRMExpressionPresetName.BlinkRight, v)
            if (v <= 0) { blinkStateRef.current = 'open'; blinkTimerRef.current = 0 }
          }

          // Lip sync while talking
          if (isTalking) {
            lipTimerRef.current += delta
            if (lipTimerRef.current > 0.1) {
              lipOpenRef.current = !lipOpenRef.current
              em.setValue(VRMExpressionPresetName.Aa, lipOpenRef.current ? 0.4 + Math.random() * 0.4 : 0)
              lipTimerRef.current = 0
            }
          } else {
            em.setValue(VRMExpressionPresetName.Aa, 0)
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
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addBellaMessage = useCallback((text: string, em: EmotionState = 'neutral') => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'bella', text, timestamp: new Date() }])
    setEmotion(em)
    setIsTalking(true)
    // Simulate talking duration based on text length
    const duration = Math.min(Math.max(text.length * 40, 1500), 6000)
    setTimeout(() => {
      setIsTalking(false)
      setEmotion('neutral')
    }, duration)
  }, [])

  const handleSend = async () => {
    if (!input.trim() || thinking) return
    const userText = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: userText, timestamp: new Date() }])
    setThinking(true)
    setEmotion('thinking')

    await new Promise((r) => setTimeout(r, 1200 + Math.random() * 800))

    const responses = [
      `Great question about "${userText}"! The key concept here is that everything connects through fundamental principles that build on each other.`,
      `"${userText}" is something I love explaining! Think of it like building blocks — each piece supports the next. Want me to generate an anime scene to visualize it?`,
      `Excellent! "${userText}" involves some really interesting ideas. Shall I create a story series about it?`,
    ]
    setThinking(false)
    addBellaMessage(responses[Math.floor(Math.random() * responses.length)], 'happy')
  }

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
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-accent-purple text-white rounded-br-sm'
                      : 'bg-bg-elevated text-slate-300 rounded-bl-sm border border-border'
                  }`}
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
            <div className="flex gap-2">
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
                disabled={!input.trim() || thinking}
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

          {/* Talking indicator */}
          {isTalking && (
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
