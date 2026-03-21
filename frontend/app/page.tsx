'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const generationTypes = [
  {
    id: 'anime',
    label: 'Anime Scene',
    icon: '🎨',
    description: 'Generate anime-style characters and scenes',
    color: 'purple',
    href: '/anime',
  },
  {
    id: 'simulation',
    label: 'Simulation',
    icon: '🔬',
    description: 'Interactive browser-based simulations',
    color: 'cyan',
    href: '/simulation',
  },
  {
    id: 'model3d',
    label: '3D Model',
    icon: '🧊',
    description: 'Generate 3D models of real-world objects',
    color: 'pink',
    href: '/model3d',
  },
  {
    id: 'story',
    label: 'Anime Story',
    icon: '📖',
    description: 'Full multi-episode educational anime series',
    color: 'purple',
    href: '/story',
  },
]

const colorMap: Record<string, string> = {
  purple: 'border-accent-purple/40 hover:border-accent-purple hover:shadow-glow-purple',
  cyan: 'border-accent-cyan/40 hover:border-accent-cyan hover:shadow-glow-cyan',
  pink: 'border-accent-pink/40 hover:border-accent-pink hover:shadow-glow-pink',
}

const iconBgMap: Record<string, string> = {
  purple: 'bg-accent-purple/20 text-accent-purple-light',
  cyan: 'bg-accent-cyan/20 text-accent-cyan',
  pink: 'bg-accent-pink/20 text-accent-pink-light',
}

export default function HomePage() {
  const [topic, setTopic] = useState('')
  const [selected, setSelected] = useState('anime')
  const router = useRouter()

  const handleGenerate = () => {
    if (!topic.trim()) return
    const type = generationTypes.find((t) => t.id === selected)
    if (type) router.push(`${type.href}?topic=${encodeURIComponent(topic.trim())}`)
  }

  return (
    <div className="min-h-screen bg-gradient-hero flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-accent-purple/10 border border-accent-purple/30 text-accent-purple-light text-xs font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-pulse" />
          AI-Powered Educational Content
        </div>

        {/* Heading */}
        <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight">
          Learn Through{' '}
          <span className="gradient-text">Anime</span>
        </h1>
        <p className="text-slate-400 text-lg md:text-xl max-w-xl mb-12">
          Transform any educational topic into anime scenes, interactive simulations, 3D models, and full story series.
        </p>

        {/* Input card */}
        <div className="w-full max-w-2xl bg-bg-card border border-border rounded-2xl p-6 shadow-card">
          {/* Topic input */}
          <div className="relative mb-5">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              placeholder="Enter a topic — e.g. Photosynthesis, Newton's Laws, World War II..."
              className="w-full bg-bg-elevated border border-border rounded-xl px-5 py-4 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-accent-purple focus:shadow-glow-purple transition-all"
            />
          </div>

          {/* Type selector */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {generationTypes.map((type) => (
              <button
                key={type.id}
                onClick={() => setSelected(type.id)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200 card-hover ${
                  selected === type.id
                    ? colorMap[type.color] + ' bg-bg-elevated'
                    : 'border-border bg-bg-secondary hover:bg-bg-elevated'
                }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${
                  selected === type.id ? iconBgMap[type.color] : 'bg-bg-elevated'
                }`}>
                  {type.icon}
                </div>
                <span className="text-xs font-medium text-slate-300">{type.label}</span>
              </button>
            ))}
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!topic.trim()}
            className="w-full py-4 rounded-xl font-semibold text-white bg-gradient-anime hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-glow-purple text-sm"
          >
            Generate {generationTypes.find((t) => t.id === selected)?.label} ✨
          </button>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-3 mt-10">
          {['Open Source Models', 'No GPU Required', 'Groq + Fal.ai', 'Safe for Education'].map((f) => (
            <span key={f} className="px-3 py-1 rounded-full bg-bg-card border border-border text-slate-500 text-xs">
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="border-t border-border bg-bg-secondary px-6 py-6">
        <div className="max-w-2xl mx-auto grid grid-cols-4 gap-4 text-center">
          {[
            { label: 'Anime Styles', value: '4' },
            { label: 'Sim Categories', value: '5' },
            { label: '3D Categories', value: '5' },
            { label: 'Max Episodes', value: '10' },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-2xl font-bold gradient-text">{s.value}</div>
              <div className="text-xs text-slate-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
