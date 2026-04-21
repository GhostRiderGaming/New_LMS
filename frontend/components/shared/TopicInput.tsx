'use client'
import { useState, ReactNode } from 'react'

interface Props {
  onSubmit: (topic: string) => void
  loading?: boolean
  defaultValue?: string
  placeholder?: string
  buttonLabel?: string
  children?: ReactNode
}

export default function TopicInput({
  onSubmit,
  loading = false,
  defaultValue = '',
  placeholder = 'Enter a topic — e.g. Photosynthesis, Newton\'s Laws, World War II...',
  buttonLabel = '⚡ Generate',
  children,
}: Props) {
  const [value, setValue] = useState(defaultValue)

  const handleSubmit = () => {
    if (value.trim() && !loading) onSubmit(value.trim())
  }

  return (
    <div className="card-game p-5">
      {children && <div className="mb-4">{children}</div>}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-accent-purple/40 text-xs">⚡</div>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder={placeholder}
            className="w-full bg-bg-elevated/80 border border-border rounded-xl pl-8 pr-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-accent-purple focus:shadow-glow-purple transition-all"
          />
        </div>
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || loading}
          className="px-6 py-3 rounded-xl font-bold text-white bg-gradient-game hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-sm whitespace-nowrap shadow-glow-purple"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Working...
            </span>
          ) : (
            buttonLabel
          )}
        </button>
      </div>
    </div>
  )
}
