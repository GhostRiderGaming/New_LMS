'use client'
import { useState, useRef, useEffect } from 'react'

interface Props {
  html: string
  topic: string
  shareUrl?: string
}

export default function SimulationFrame({ html, topic, shareUrl }: Props) {
  const [fullscreen, setFullscreen] = useState(false)
  const [copied, setCopied] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!html || !iframeRef.current) return
    
    // Use a Blob URL instead of doc.write or srcDoc for maximum reliability.
    // This avoids React Strict Mode double-execution issues and string escaping bugs.
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    iframeRef.current.src = url
    
    return () => {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }, [html])

  // Escape key exits fullscreen
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreen) setFullscreen(false)
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [fullscreen])

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

  const handleOpenNewTab = () => {
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
  }

  return (
    <div className={`bg-bg-card border border-border rounded-2xl overflow-hidden transition-all duration-300 ${fullscreen ? 'fixed inset-0 z-50 rounded-none' : ''}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 transition-transform hover:scale-125" />
          <div className="w-2 h-2 rounded-full bg-yellow-500 transition-transform hover:scale-125" />
          <div className="w-2 h-2 rounded-full bg-green-500 transition-transform hover:scale-125" />
          <span className="ml-3 text-xs text-slate-400 font-medium truncate max-w-[200px]">{topic} — Interactive Simulation</span>
        </div>
        <div className="flex items-center gap-2">
          {shareUrl && (
            <button
              onClick={handleCopyUrl}
              className="px-3 py-1.5 rounded-lg bg-bg-elevated hover:bg-border text-slate-400 hover:text-white text-xs transition-all border border-border hover:-translate-y-0.5"
            >
              {copied ? '✓ Copied' : '🔗 Share'}
            </button>
          )}
          <button
            onClick={handleOpenNewTab}
            className="px-3 py-1.5 rounded-lg bg-bg-elevated hover:bg-border text-slate-400 hover:text-white text-xs transition-all border border-border hover:-translate-y-0.5"
          >
            ↗ New Tab
          </button>
          <button
            onClick={handleDownload}
            className="px-3 py-1.5 rounded-lg bg-bg-elevated hover:bg-border text-slate-400 hover:text-white text-xs transition-all border border-border hover:-translate-y-0.5"
          >
            ↓ Download
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="px-3 py-1.5 rounded-lg bg-accent-cyan/20 hover:bg-accent-cyan/30 text-accent-cyan text-xs transition-all hover:-translate-y-0.5"
          >
            {fullscreen ? '✕ Exit' : '⊞ Fullscreen'}
          </button>
        </div>
      </div>

      {/* Iframe — sandbox allows scripts + same-origin for canvas/DOM features */}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin"
        className={`w-full border-0 block ${fullscreen ? 'h-[calc(100vh-48px)]' : 'h-[560px]'}`}
        style={{ background: '#0f172a' }}
        title={`${topic} simulation`}
      />
    </div>
  )
}