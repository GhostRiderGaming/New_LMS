'use client'
import { useEffect, useRef, useState } from 'react'
import { api, getJobWsUrl, type Job, type JobStatus } from '@/lib/api'

interface Props {
  jobId: string | null
  status: JobStatus | null
  label?: string
  onComplete?: (job: Job) => void
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
  complete: ['Complete!'],
  failed: ['Generation failed'],
}

export default function JobProgressBar({ jobId, status: initialStatus, label, onComplete }: Props) {
  const [status, setStatus] = useState<JobStatus | null>(initialStatus)
  const [progress, setProgress] = useState(0)
  const [msgIndex, setMsgIndex] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const completedJobRef = useRef<Job | null>(null)

  // Keep status in sync if parent passes a new initialStatus (e.g. before WS connects)
  useEffect(() => {
    if (initialStatus && !status) setStatus(initialStatus)
  }, [initialStatus])

  // Animate progress bar while processing
  useEffect(() => {
    if (progressRef.current) clearInterval(progressRef.current)

    if (status === 'complete') { setProgress(100); return }
    if (status === 'failed') { setProgress(100); return }
    if (status === 'queued') { setProgress(10); return }
    if (status === 'processing') {
      progressRef.current = setInterval(() => {
        setProgress((p) => Math.min(p + Math.random() * 8, 88))
        setMsgIndex((i) => (i + 1) % statusMessages.processing.length)
      }, 1200)
      return () => { if (progressRef.current) clearInterval(progressRef.current) }
    }
  }, [status])

  // Fire onComplete callback once when status becomes 'complete'
  useEffect(() => {
    if (status === 'complete') {
      onComplete?.(completedJobRef.current ?? { job_id: jobId ?? '', status: 'complete' })
    }
  }, [status])

  // WebSocket connection with polling fallback
  useEffect(() => {
    if (!jobId) return
    if (status === 'complete' || status === 'failed') return

    let cancelled = false

    function startPolling() {
      if (pollRef.current) return
      pollRef.current = setInterval(async () => {
        try {
          const job = await api.getJob(jobId!)
          if (cancelled) return
          completedJobRef.current = job
          setStatus(job.status)
          if (job.status === 'complete' || job.status === 'failed') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          }
        } catch {
          // ignore transient errors
        }
      }, 2000)
    }

    function connectWs() {
      const url = getJobWsUrl(jobId!)
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch {
        startPolling()
        return
      }
      wsRef.current = ws

      ws.onmessage = (event) => {
        if (cancelled) return
        try {
          const data: Job = JSON.parse(event.data)
          completedJobRef.current = data
          setStatus(data.status)
        } catch {
          // ignore malformed frames
        }
      }

      ws.onerror = () => {
        // WebSocket failed — fall back to polling
        ws.close()
        if (!cancelled) startPolling()
      }

      ws.onclose = () => {
        wsRef.current = null
      }
    }

    connectWs()

    return () => {
      cancelled = true
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [jobId])

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
