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

  // Write HTML directly into the iframe document after mount
  // This is more reliable than srcDoc for complex HTML with canvas/scripts
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !html) return
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) return
    doc.open()
    doc.write(html)
    doc.close()
  }, [html])

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

      {/* Iframe — sandbox allows scripts for canvas animations */}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin"
        className={`w-full border-0 block ${fullscreen ? 'h-[calc(100%-48px)]' : 'h-[520px]'}`}
        style={{ background: '#0f172a' }}
        title={`${topic} simulation`}
      />
    </div>
  )
}