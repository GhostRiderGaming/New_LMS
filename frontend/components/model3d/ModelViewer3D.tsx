'use client'
import { useState, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment, Grid } from '@react-three/drei'

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} />
}

interface Props {
  gltfUrl: string | null
  metadata?: { name: string; description: string; object_name?: string } | null
}

export default function ModelViewer3D({ gltfUrl, metadata }: Props) {
  const [downloaded, setDownloaded] = useState(false)

  const handleDownload = () => {
    if (!gltfUrl) return
    const a = document.createElement('a')
    a.href = gltfUrl
    a.download = `${(metadata?.object_name ?? metadata?.name ?? 'model').replace(/\s+/g, '-').toLowerCase()}.gltf`
    a.click()
    setDownloaded(true)
    setTimeout(() => setDownloaded(false), 2000)
  }

  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-accent-pink text-sm">🧊</span>
          <span className="text-xs text-slate-400 font-medium">{metadata?.object_name ?? metadata?.name ?? '3D Model'}</span>
          <span className="px-2 py-0.5 rounded bg-accent-pink/10 text-accent-pink text-xs">GLTF</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600">Orbit · Zoom · Pan</span>
          {gltfUrl && (
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-lg bg-accent-pink/20 hover:bg-accent-pink/30 text-accent-pink text-xs font-medium transition-colors"
            >
              {downloaded ? '✓ Downloaded' : '↓ Download GLTF'}
            </button>
          )}
        </div>
      </div>

      {/* 3D Canvas */}
      <div className="relative h-[420px] bg-bg-elevated">
        {gltfUrl ? (
          <Canvas camera={{ position: [0, 1.5, 4], fov: 45 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={1} />
            <Suspense fallback={null}>
              <Model url={gltfUrl} />
              <Environment preset="city" />
            </Suspense>
            <OrbitControls enablePan enableZoom enableRotate />
            <Grid infiniteGrid fadeDistance={20} fadeStrength={2} cellColor="#7c3aed" sectionColor="#ec4899" />
          </Canvas>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center">
              <div className="relative w-32 h-32 mx-auto mb-4">
                <div className="absolute inset-0 rounded-2xl border-2 border-accent-pink/40 animate-spin-slow" />
                <div className="absolute inset-4 rounded-xl border-2 border-accent-purple/40 animate-spin-slow" style={{ animationDirection: 'reverse' }} />
                <div className="absolute inset-0 flex items-center justify-center text-4xl">🧊</div>
              </div>
              <p className="text-slate-400 text-sm font-medium">{metadata?.name}</p>
              <p className="text-slate-600 text-xs mt-1">Generating 3D model...</p>
            </div>
          </div>
        )}

        {/* Controls hint */}
        {gltfUrl && (
          <div className="absolute bottom-3 left-3 flex gap-2 pointer-events-none">
            {['🖱️ Drag to orbit', '⚲ Scroll to zoom', '⇧ Shift+drag to pan'].map((hint) => (
              <span key={hint} className="px-2 py-1 rounded bg-black/60 backdrop-blur-sm text-xs text-slate-400">
                {hint}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Metadata */}
      {metadata?.description && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-slate-300 text-sm leading-relaxed">{metadata.description}</p>
        </div>
      )}
    </div>
  )
}
