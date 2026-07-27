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
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!html || !iframeRef.current) return
    
    setIframeLoaded(false)
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
    <div
      className={`relative overflow-hidden transition-all duration-400 ${
        fullscreen
          ? 'fixed inset-0 z-50 rounded-none'
          : 'rounded-2xl'
      }`}
      style={{
        background: '#0d0d22',
        border: fullscreen ? 'none' : '1.5px solid rgba(139, 92, 246, 0.2)',
        boxShadow: fullscreen
          ? 'none'
          : '0 8px 40px rgba(0,0,0,0.5), 0 0 80px rgba(139,92,246,0.06), inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Animated gradient accent line */}
      {!fullscreen && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '2px',
            background: 'linear-gradient(90deg, #8b5cf6, #22d3ee, #f472b6, #8b5cf6)',
            backgroundSize: '300% 100%',
            animation: 'simGradientShift 4s ease-in-out infinite',
            zIndex: 10,
            opacity: 0.7,
          }}
        />
      )}

      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 gap-2"
        style={{
          background: 'linear-gradient(180deg, rgba(10,10,32,0.95), rgba(12,12,36,0.95))',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
        }}
      >
        <div className="flex items-center gap-2">
          {/* macOS dots */}
          {['#ef4444', '#eab308', '#22c55e'].map((color, i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full transition-transform hover:scale-[1.4]"
              style={{
                background: color,
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.boxShadow = `0 0 8px ${color}`
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.boxShadow = 'none'
              }}
            />
          ))}
          <span className="ml-3 text-xs text-slate-500 font-medium truncate max-w-[200px]">
            {topic} — Interactive Simulation
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {shareUrl && (
            <button
              onClick={handleCopyUrl}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:-translate-y-px"
              style={{
                background: copied ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255,255,255,0.04)',
                color: copied ? '#4ade80' : '#64748b',
                border: `1px solid ${copied ? 'rgba(34, 197, 94, 0.25)' : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              {copied ? '✓ Copied' : '🔗 Share'}
            </button>
          )}
          <button
            onClick={handleOpenNewTab}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:-translate-y-px"
            style={{
              background: 'rgba(255,255,255,0.04)',
              color: '#64748b',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.color = '#e2e8f0';
              (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.color = '#64748b';
              (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
            }}
          >
            ↗ New Tab
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:-translate-y-px"
            style={{
              background: 'rgba(255,255,255,0.04)',
              color: '#64748b',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.color = '#e2e8f0';
              (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.color = '#64748b';
              (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
            }}
          >
            ↓ Download
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:-translate-y-px"
            style={{
              background: fullscreen ? 'rgba(239, 68, 68, 0.08)' : 'rgba(34, 211, 238, 0.08)',
              color: fullscreen ? '#f87171' : '#22d3ee',
              border: `1px solid ${fullscreen ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 211, 238, 0.15)'}`,
            }}
          >
            {fullscreen ? '✕ Exit' : '⊞ Fullscreen'}
          </button>
        </div>
      </div>

      {/* Loading shimmer placeholder */}
      {!iframeLoaded && (
        <div
          className="absolute inset-0 z-[5] flex items-center justify-center"
          style={{
            top: '42px', /* below toolbar */
            background: '#0f172a',
          }}
        >
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(139, 92, 246, 0.12)',
                border: '2px solid rgba(139, 92, 246, 0.25)',
                animation: 'spin 1.5s linear infinite',
              }}
            >
              <span className="text-lg" style={{ animation: 'pulse 2s ease-in-out infinite' }}>🔬</span>
            </div>
            <p className="text-xs text-slate-500 font-medium">Loading simulation…</p>
          </div>
        </div>
      )}

      {/* Iframe — sandbox allows scripts + same-origin for canvas/DOM features */}
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin"
        className={`w-full border-0 block transition-opacity duration-300 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
        style={{
          background: '#0f172a',
          height: fullscreen ? 'calc(100vh - 42px)' : '560px',
        }}
        title={`${topic} simulation`}
        onLoad={() => setIframeLoaded(true)}
      />

      {/* Status indicator */}
      {iframeLoaded && (
        <div
          className="flex items-center justify-center gap-2 py-1.5 text-xs"
          style={{
            background: 'rgba(34, 211, 238, 0.04)',
            borderTop: '1px solid rgba(34, 211, 238, 0.08)',
            color: '#22c55e',
            animation: 'fadeIn 0.3s ease-out',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: '#22c55e',
              boxShadow: '0 0 6px #22c55e',
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
          Simulation loaded successfully
        </div>
      )}

      {/* Inject keyframe animations */}
      <style>{`
        @keyframes simGradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </div>
  )
}