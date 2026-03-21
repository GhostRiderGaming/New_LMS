'use client'
import { useState, useRef } from 'react'

interface Props {
  html: string
  topic: string
  shareUrl?: string
}

export default function SimulationFrame({ html, topic, shareUrl }: Props) {
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const handleCopyUrl = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleDownload = () => {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${topic.replace(/\s+/g, '-').toLowerCase()}-simulation.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`bg-bg-card border border-border rounded-2xl overflow-hidden ${fullscreen ? 'fixed inset-4 z-50' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <div className="w-2 h-2 rounded-full bg-yellow-500" />
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="ml-3 text-xs text-slate-400 font-medium">{topic} — Interactive Simulation</span>
        </div>
        <div className="flex items-center gap-2">
          {shareUrl && (
            <button
              onClick={handleCopyUrl}
              className="px-3 py-1.5 rounded-lg bg-bg-elevated hover:bg-border text-slate-400 hover:text-white text-xs transition-colors border border-border"
            >
              {copied ? '✓ Copied' : '🔗 Share'}
            </button>
          )}
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 rounded-lg bg-bg-elevated hover:bg-border text-slate-400 hover:text-white text-xs transition-colors border border-border"
          >
            ↓ Download HTML
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="px-3 py-1.5 rounded-lg bg-accent-cyan/20 hover:bg-accent-cyan/30 text-accent-cyan text-xs transition-colors"
          >
            {fullscreen ? '⊠ Exit' : '⊞ Fullscreen'}
          </button>
        </div>
      </div>

      {/* Iframe */}
      <iframe
        ref={iframeRef}
        srcDoc={html}
        sandbox="allow-scripts"
        className={`w-full bg-bg-primary ${fullscreen ? 'h-[calc(100%-48px)]' : 'h-[480px]'}`}
        title={`${topic} simulation`}
      />
    </div>
  )
}
