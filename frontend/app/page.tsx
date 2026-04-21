'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const missions = [
  {
    id: 'anime',
    title: 'Scene Forge',
    subtitle: 'Anime Generator',
    icon: '🎨',
    description: 'Transform any topic into stunning anime-style educational scenes',
    color: 'purple',
    href: '/anime',
    stats: '4 Styles',
  },
  {
    id: 'simulation',
    title: 'Lab Engine',
    subtitle: 'Simulation Builder',
    icon: '🔬',
    description: 'Create interactive browser-based simulations for any subject',
    color: 'cyan',
    href: '/simulation',
    stats: '5 Categories',
  },
  {
    id: 'model3d',
    title: 'Holodeck',
    subtitle: '3D Model Creator',
    icon: '🧊',
    description: 'Generate interactive 3D models of real-world objects',
    color: 'pink',
    href: '/model3d',
    stats: '5 Categories',
  },
  {
    id: 'story',
    title: 'Chronicle',
    subtitle: 'Story Creator',
    icon: '📖',
    description: 'Create full multi-episode educational anime series',
    color: 'gold',
    href: '/story',
    stats: '10 Episodes',
  },
]

const colorClasses: Record<string, { border: string; glow: string; bg: string; text: string }> = {
  purple: {
    border: 'border-accent-purple/30 hover:border-accent-purple/60',
    glow: 'hover:shadow-glow-purple',
    bg: 'bg-accent-purple/10',
    text: 'text-accent-purple',
  },
  cyan: {
    border: 'border-accent-cyan/30 hover:border-accent-cyan/60',
    glow: 'hover:shadow-glow-cyan',
    bg: 'bg-accent-cyan/10',
    text: 'text-accent-cyan',
  },
  pink: {
    border: 'border-accent-pink/30 hover:border-accent-pink/60',
    glow: 'hover:shadow-glow-pink',
    bg: 'bg-accent-pink/10',
    text: 'text-accent-pink',
  },
  gold: {
    border: 'border-accent-gold/30 hover:border-accent-gold/60',
    glow: 'hover:shadow-[0_0_25px_rgba(251,191,36,0.3)]',
    bg: 'bg-accent-gold/10',
    text: 'text-accent-gold',
  },
}

export default function HomePage() {
  const [topic, setTopic] = useState('')
  const [selected, setSelected] = useState('anime')
  const [showContent, setShowContent] = useState(false)
  const [typedText, setTypedText] = useState('')
  const router = useRouter()

  const fullText = "Every great discovery begins with curiosity..."

  useEffect(() => {
    // Typing animation
    let i = 0
    const interval = setInterval(() => {
      setTypedText(fullText.slice(0, i + 1))
      i++
      if (i >= fullText.length) {
        clearInterval(interval)
        setTimeout(() => setShowContent(true), 300)
      }
    }, 40)
    
    return () => clearInterval(interval)
  }, [])

  const handleGenerate = () => {
    if (!topic.trim()) return
    const mission = missions.find((m) => m.id === selected)
    if (mission) router.push(`${mission.href}?topic=${encodeURIComponent(topic.trim())}`)
  }

  return (
    <div className="min-h-[80vh] flex flex-col">
      {/* ─── Hero Section ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center relative">
        {/* Decorative circle */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.2) 0%, transparent 70%)' }} />

        {/* Tagline typing */}
        <div className="mb-6 h-6">
          <p className="text-sm text-accent-purple/80 font-medium tracking-wide italic">
            {typedText}
            <span className="animate-pulse">|</span>
          </p>
        </div>

        {/* Main heading */}
        <div className="animate-fadeInUp">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-accent-purple text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-pulse" />
            AI-Powered Learning Universe
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-7xl font-black mb-4 leading-tight tracking-tight">
            Learn Through{' '}
            <span className="gradient-text">Anime</span>
          </h1>
          <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-12 leading-relaxed">
            Transform any educational topic into immersive anime scenes, interactive simulations, 3D holograms, and epic story series.
          </p>
        </div>

        {/* ─── Command Input ─────────────────────────────────────────── */}
        {showContent && (
          <div className="w-full max-w-2xl animate-fadeInUp" style={{ animationDelay: '0.1s' }}>
            <div className="card-game p-6">
              {/* Topic input */}
              <div className="relative mb-5">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-accent-purple/50 text-sm">⚡</div>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                  placeholder="Enter your quest — e.g. Photosynthesis, Newton's Laws, World War II..."
                  className="w-full bg-bg-elevated/80 border border-border rounded-xl px-10 py-4 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-accent-purple focus:shadow-glow-purple transition-all"
                  id="topic-input"
                />
              </div>

              {/* Mission selector */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                {missions.map((mission) => {
                  const colors = colorClasses[mission.color]
                  return (
                    <button
                      key={mission.id}
                      onClick={() => setSelected(mission.id)}
                      className={`mission-card flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-300 ${
                        selected === mission.id
                          ? `${colors.border} ${colors.glow} bg-bg-elevated`
                          : 'border-border bg-bg-secondary/50 hover:bg-bg-elevated'
                      }`}
                    >
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                        selected === mission.id ? colors.bg : 'bg-bg-elevated'
                      }`}>
                        {mission.icon}
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-bold text-slate-200">{mission.title}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{mission.stats}</div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Generate button */}
              <button
                onClick={handleGenerate}
                disabled={!topic.trim()}
                className="w-full py-4 rounded-xl font-bold text-white bg-gradient-game hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300 shadow-glow-purple text-sm tracking-wide"
                id="generate-button"
              >
                🚀 Launch {missions.find((m) => m.id === selected)?.title ?? 'Mission'}
              </button>
            </div>
          </div>
        )}

        {/* Quick hints */}
        {showContent && (
          <div className="flex flex-wrap justify-center gap-3 mt-8 animate-fadeInUp" style={{ animationDelay: '0.2s' }}>
            {['Open Source Models', 'No GPU Required', 'Groq + Fal.ai', 'Safe for Education'].map((f) => (
              <span key={f} className="px-3 py-1.5 rounded-full glass text-slate-500 text-xs">
                {f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ─── Stats Bar ───────────────────────────────────────────────── */}
      {showContent && (
        <div className="glass px-6 py-6 animate-fadeInUp" style={{ animationDelay: '0.3s', borderTop: '1px solid var(--border)' }}>
          <div className="max-w-3xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            {[
              { label: 'Anime Styles', value: '4', icon: '🎨' },
              { label: 'Sim Categories', value: '5', icon: '🔬' },
              { label: '3D Categories', value: '5', icon: '🧊' },
              { label: 'Max Episodes', value: '10', icon: '📖' },
            ].map((s) => (
              <div key={s.label} className="group">
                <div className="text-lg mb-0.5">{s.icon}</div>
                <div className="text-2xl font-black gradient-text">{s.value}</div>
                <div className="text-[10px] text-slate-500 mt-1 group-hover:text-slate-400 transition-colors">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
