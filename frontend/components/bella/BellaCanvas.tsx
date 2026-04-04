'use client'
/**
 * BellaCanvas — VRM model renderer using @pixiv/three-vrm + raw Three.js.
 * Requirements: 10.1, 10.2
 *
 * Implements idle animation loop:
 *   - Gentle breathing (spine/chest bone oscillation)
 *   - Eye blink (BlinkLeft / BlinkRight expression)
 *   - Head look-around sway
 */
import { useRef, useEffect } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRM, VRMHumanBoneName, VRMExpressionPresetName } from '@pixiv/three-vrm'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  computeSpineZ,
  computeSpineX,
  computeHeadY,
  computeHeadX,
  computeLeftUpperArmZ,
  computeRightUpperArmZ,
  computeBlinkClosing,
  computeBlinkOpening,
  computeLipSyncAa,
  computeEmotionExpressions,
  type EmotionState,
} from './BellaOverlay'

// Public CC0 VRM sample model
const VRM_URL =
  'https://pixiv.github.io/three-vrm/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm'

export interface BellaCanvasProps {
  emotion: EmotionState
  isTalking: boolean
  onLoaded?: () => void
}

export default function BellaCanvas({ emotion, isTalking, onLoaded }: BellaCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const vrmRef = useRef<VRM | null>(null)
  const clockRef = useRef(new THREE.Clock())
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const frameRef = useRef<number>(0)
  const blinkTimerRef = useRef(0)
  const blinkStateRef = useRef<'open' | 'closing' | 'opening'>('open')
  const nextBlinkRef = useRef(3 + Math.random() * 2)
  const lipTimerRef = useRef(0)
  const lipOpenRef = useRef(false)

  // Keep refs in sync with props so the rAF loop never has stale closures
  const emotionRef = useRef<EmotionState>(emotion)
  const isTalkingRef = useRef(isTalking)
  useEffect(() => { emotionRef.current = emotion }, [emotion])
  useEffect(() => { isTalkingRef.current = isTalking }, [isTalking])

  // Apply emotion expressions whenever emotion prop changes
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

    // Scene + camera
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, canvas.clientWidth / canvas.clientHeight, 0.1, 20)
    camera.position.set(0, 1.4, 2.2)
    camera.lookAt(0, 1.2, 0)

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const dir = new THREE.DirectionalLight(0xffffff, 1.2)
    dir.position.set(1, 2, 2)
    scene.add(dir)
    const rim = new THREE.DirectionalLight(0x9d5cf6, 0.6)
    rim.position.set(-2, 1, -1)
    scene.add(rim)

    // Orbit controls (limited look-around only)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 1.2, 0)
    controls.enablePan = false
    controls.enableZoom = false
    controls.minPolarAngle = Math.PI / 3
    controls.maxPolarAngle = Math.PI / 2
    controls.minAzimuthAngle = -Math.PI / 6
    controls.maxAzimuthAngle = Math.PI / 6
    controls.update()

    // Load VRM with graceful fallback
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.load(
      VRM_URL,
      (gltf) => {
        const vrm: VRM = gltf.userData.vrm
        vrm.scene.rotation.y = Math.PI
        scene.add(vrm.scene)
        vrmRef.current = vrm
        onLoaded?.()
      },
      undefined,
      () => {
        // VRM failed to load — call onLoaded anyway so UI unblocks
        onLoaded?.()
      }
    )

    // Animation loop — idle breathing + blink + lip sync
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate)
      const delta = clockRef.current.getDelta()
      const elapsed = clockRef.current.elapsedTime
      const vrm = vrmRef.current

      if (vrm) {
        const humanoid = vrm.humanoid

        // Idle body sway (breathing)
        const spine = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine)
        if (spine) {
          spine.rotation.z = computeSpineZ(elapsed)
          spine.rotation.x = computeSpineX(elapsed)
        }

        // Head look-around
        const head = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
        if (head) {
          head.rotation.y = computeHeadY(elapsed)
          head.rotation.x = computeHeadX(elapsed)
        }

        // Arm float
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
          } else {
            const v = computeBlinkOpening(blinkTimerRef.current)
            em.setValue(VRMExpressionPresetName.BlinkLeft, v)
            em.setValue(VRMExpressionPresetName.BlinkRight, v)
            if (v <= 0) {
              blinkStateRef.current = 'open'
              blinkTimerRef.current = 0
              nextBlinkRef.current = 3 + Math.random() * 2
            }
          }

          // Lip sync
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

    const onResize = () => {
      if (!canvas) return
      renderer.setSize(canvas.clientWidth, canvas.clientHeight)
      camera.aspect = canvas.clientWidth / canvas.clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', onResize)
      renderer.dispose()
      vrmRef.current = null
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
