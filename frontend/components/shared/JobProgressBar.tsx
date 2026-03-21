'use client'
import { useEffect, useState } from 'react'

interface Props {
  jobId: string | null
  status: 'queued' | 'processing' | 'complete' | 'failed' | null
  label?: string
  onComplete?: () => void
}

const statusMessages: Record<string, string[]> = {
  queued: ['Queued...', 'Waiting for worker...'],
  processing: [
    'Building prompt...',
    'Calling AI model...',
    'Generating content...',
    'Processing result...',
    'Uploading asset...',
    'Almost done...',
  ],
  complete: ['Done!'],
  failed: ['Generation failed'],
}

export default function JobProgressBar({ jobId, status, label, onComplete }: Props) {
  const [progress, setProgress] = useState(0)
  const [msgIndex, setMsgIndex] = useState(0)

  useEffect(() => {
    if (!status) return
    if (status === 'complete') { setProgress(100); onComplete?.(); return }
    if (status === 'failed') { setProgress(100); return }
    if (status === 'queued') setProgress(10)
    if (status === 'processing') {
      const interval = setInterval(() => {
        setProgress((p) => Math.min(p + Math.random() * 8, 88))
        setMsgIndex((i) => (i + 1) % statusMessages.processing.length)
      }, 1200)
      return () => clearInterval(interval)
    }
  }, [status])

  if (!status || !jobId) return null

  const msgs = statusMessages[status] || []
  const currentMsg = label || msgs[msgIndex % msgs.length] || ''
  const isFailed = status === 'failed'
  const isComplete = status === 'complete'

  return (
    <div className="w-full bg-bg-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {!isComplete && !isFailed && (
            <div className="w-3 h-3 rounded-full bg-accent-purple pulse-glow" />
          )}
          {isComplete && <span className="text-green-400 text-sm">✓</span>}
          {isFailed && <span className="text-red-400 text-sm">✗</span>}
          <span className={`text-sm font-medium ${isFailed ? 'text-red-400' : isComplete ? 'text-green-400' : 'text-slate-300'}`}>
            {currentMsg}
          </span>
        </div>
        <span className="text-xs text-slate-500">{Math.round(progress)}%</span>
      </div>

      <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            isFailed
              ? 'bg-red-500'
              : isComplete
              ? 'bg-green-500'
              : 'bg-gradient-anime'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {jobId && (
        <div className="mt-2 text-xs text-slate-600 font-mono">
          job: {jobId.slice(0, 8)}...
        </div>
      )}
    </div>
  )
}
