'use client'
import { useState } from 'react'

interface Props {
  gltfUrl: string | null
  metadata?: { name: string; description: string } | null
}

export default function ModelViewer3D({ gltfUrl, metadata }: Props) {
  const [downloaded, setDownloaded] = useState(false)

  const handleDownload = () => {
    if (!gltfUrl) return
    const a = document.createElement('a')
    a.href = gltfUrl
    a.download = `${metadata?.name?.replace(/\s+/g, '-').toLowerCase() ?? 'model'}.gltf`
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
          <span className="text-xs text-slate-400 font-medium">{metadata?.name ?? '3D Model'}</span>
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

      {/* Viewer area */}
      <div className="relative h-[420px] bg-bg-elevated flex items-center justify-center">
        {gltfUrl ? (
          /* Real impl: <Canvas><Suspense><Model url={gltfUrl} /></Suspense><OrbitControls /></Canvas> */
          <div className="text-center text-slate-500">
            <div className="text-6xl mb-3 float">🧊</div>
            <p className="text-sm">3D viewer renders here</p>
            <p className="text-xs mt-1 text-slate-600">@react-three/fiber + GLTFLoader</p>
          </div>
        ) : (
          <div className="text-center">
            {/* Placeholder spinning cube */}
            <div className="relative w-32 h-32 mx-auto mb-4">
              <div className="absolute inset-0 rounded-2xl border-2 border-accent-pink/40 animate-spin-slow" />
              <div className="absolute inset-4 rounded-xl border-2 border-accent-purple/40 animate-spin-slow" style={{ animationDirection: 'reverse' }} />
              <div className="absolute inset-0 flex items-center justify-center text-4xl">🧊</div>
            </div>
            <p className="text-slate-400 text-sm font-medium">{metadata?.name}</p>
            <p className="text-slate-600 text-xs mt-1">Model generated — connect GLTF viewer to display</p>
          </div>
        )}

        {/* Controls hint */}
        <div className="absolute bottom-3 left-3 flex gap-2">
          {['🖱️ Drag to orbit', '⚲ Scroll to zoom', '⇧ Shift+drag to pan'].map((hint) => (
            <span key={hint} className="px-2 py-1 rounded bg-black/60 backdrop-blur-sm text-xs text-slate-400">
              {hint}
            </span>
          ))}
        </div>
      </div>

      {/* Metadata */}
      {metadata && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-slate-300 text-sm leading-relaxed">{metadata.description}</p>
        </div>
      )}
    </div>
  )
}
