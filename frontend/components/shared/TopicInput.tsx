'use client'
import { useState } from 'react'

interface Props {
  onSubmit: (topic: string) => void
  loading?: boolean
  placeholder?: string
  buttonLabel?: string
  defaultValue?: string
  children?: React.ReactNode
}

export default function TopicInput({
  onSubmit,
  loading = false,
  placeholder = 'Enter a topic — e.g. Photosynthesis, Newton\'s Laws...',
  buttonLabel = 'Generate',
  defaultValue = '',
  children,
}: Props) {
  const [topic, setTopic] = useState(defaultValue)

  const handleSubmit = () => {
    if (!topic.trim() || loading) return
    onSubmit(topic.trim())
  }

  return (
    <div className="w-full bg-bg-card border border-border rounded-2xl p-5">
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder={placeholder}
          disabled={loading}
          className="flex-1 bg-bg-elevated border border-border rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-accent-purple transition-all disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={!topic.trim() || loading}
          className="px-6 py-3 rounded-xl font-semibold text-white bg-gradient-anime hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm whitespace-nowrap shadow-glow-purple"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Working...
            </span>
          ) : (
            `${buttonLabel} ✨`
          )}
        </button>
      </div>
      {children}
    </div>
  )
}
