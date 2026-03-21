'use client'
import { useState } from 'react'
import Image from 'next/image'

interface Scene {
  asset_id: string
  asset_url: string
  topic: string
  caption: string
  style: string
}

interface Props {
  scene: Scene
  onAddToStory?: (scene: Scene) => void
}

export default function AnimeSceneCard({ scene, onAddToStory }: Props) {
  const [copied, setCopied] = useState(false)
  const [imgError, setImgError] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(scene.asset_url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden card-hover group">
      {/* Image */}
      <div className="relative aspect-square bg-bg-elevated overflow-hidden">
        {!imgError ? (
          <Image
            src={scene.asset_url}
            alt={scene.topic}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            <div className="text-center">
              <div className="text-4xl mb-2">🎨</div>
              <p className="text-xs">Image unavailable</p>
            </div>
          </div>
        )}

        {/* Style badge */}
        <div className="absolute top-3 left-3">
          <span className="px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-xs text-white font-medium capitalize">
            {scene.style}
          </span>
        </div>

        {/* Hover actions */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
          <a
            href={scene.asset_url}
            download
            className="px-4 py-2 rounded-lg bg-accent-purple hover:bg-accent-purple-light text-white text-xs font-medium transition-colors"
          >
            ↓ Download
          </a>
          <button
            onClick={handleCopy}
            className="px-4 py-2 rounded-lg bg-bg-elevated hover:bg-bg-card text-white text-xs font-medium transition-colors border border-border"
          >
            {copied ? '✓ Copied' : '🔗 Copy URL'}
          </button>
        </div>
      </div>

      {/* Caption */}
      <div className="p-4">
        <p className="text-slate-300 text-sm leading-relaxed mb-3">{scene.caption}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 font-mono truncate max-w-[140px]">{scene.topic}</span>
          {onAddToStory && (
            <button
              onClick={() => onAddToStory(scene)}
              className="text-xs text-accent-purple hover:text-accent-purple-light transition-colors font-medium"
            >
              + Add to Story
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
