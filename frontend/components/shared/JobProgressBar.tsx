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
  queued: ['Initializing systems...', 'Preparing workspace...'],
  processing: [
    'Building prompt...',
    'Contacting AI model...',
    'Generating content...',
    'Processing results...',
    'Uploading asset...',
    'Finalizing...',
  ],
  complete: ['Mission Complete! ✨'],
  failed: ['Mission Failed ✗'],
}

export default function JobProgressBar({ jobId, status: initialStatus, label, onComplete }: Props) {
  const [status, setStatus] = useState<JobStatus | null>(initialStatus)
  const [progress, setProgress] = useState(0)
  const [step, setStep] = useState('')
  const [msgIndex, setMsgIndex] = useState(0)
  const [retryCount, setRetryCount] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const completedJobRef = useRef<Job | null>(null)
  const startTimeRef = useRef(Date.now())

  // Keep status in sync if parent passes a new initialStatus
  useEffect(() => {
    if (initialStatus && !status) setStatus(initialStatus)
  }, [initialStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timer for elapsed time
  useEffect(() => {
    if (status === 'complete' || status === 'failed') return
    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [status])

  // Animate progress bar — smoother with real step data
  useEffect(() => {
    if (progressRef.current) clearInterval(progressRef.current)

    if (status === 'complete') { setProgress(100); return }
    if (status === 'failed') { setProgress(100); return }
    if (status === 'queued') { setProgress(5); return }
    if (status === 'processing') {
      progressRef.current = setInterval(() => {
        setProgress((p) => {
          // Slow down as we approach 90% to avoid fake completion
          const increment = p < 30 ? Math.random() * 5 : p < 60 ? Math.random() * 3 : Math.random() * 1.5
          return Math.min(p + increment, 90)
        })
        setMsgIndex((i) => (i + 1) % statusMessages.processing.length)
      }, 2000)
      return () => { if (progressRef.current) clearInterval(progressRef.current) }
    }
  }, [status])

  // Fire onComplete callback
  useEffect(() => {
    if (status === 'complete') {
      onComplete?.(completedJobRef.current ?? { job_id: jobId ?? '', status: 'complete' })
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling-first with WebSocket upgrade
  useEffect(() => {
    if (!jobId) return
    if (status === 'complete' || status === 'failed') return

    let cancelled = false
    let failCount = 0
    let wsConnected = false

    // Phase 1: Start polling immediately (always reliable)
    function startPolling() {
      if (pollRef.current) return
      const poll = async () => {
        if (cancelled || wsConnected) return
        try {
          const job = await api.getJob(jobId!)
          if (cancelled) return
          completedJobRef.current = job
          setStatus(job.status)
          if (job.progress) setProgress(job.progress)
          if (job.step) setStep(job.step)
          failCount = 0
          if (job.status === 'complete' || job.status === 'failed') {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
            return
          }
        } catch {
          failCount++
          if (failCount > 20) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
            setStatus('failed')
          }
          setRetryCount(failCount)
        }
      }
      pollRef.current = setInterval(poll, 2500)
      // Also poll once immediately
      poll()
    }

    startPolling()

    // Phase 2: Try WS upgrade (enhances polling with real-time updates)
    function tryWs() {
      try {
        const url = getJobWsUrl(jobId!)
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          wsConnected = true
          // WS connected — stop polling, WS will provide updates
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          setRetryCount(0)
        }

        ws.onmessage = (event) => {
          if (cancelled) return
          try {
            const data = JSON.parse(event.data)
            completedJobRef.current = data
            setStatus(data.status)
            if (data.progress) setProgress(data.progress)
            if (data.step) setStep(data.step)
          } catch { /* ignore */ }
        }

        ws.onerror = () => {
          // Silently fall back — polling is already running or will restart
          wsConnected = false
          try { ws.close() } catch { /* ignore */ }
        }

        ws.onclose = () => {
          wsRef.current = null
          wsConnected = false
          // Restart polling if job isn't done yet
          if (!cancelled) startPolling()
        }
      } catch {
        // WS construction failed — polling continues as fallback
      }
    }

    // Delay WS attempt slightly to let the job register in the DB
    const wsTimer = setTimeout(tryWs, 500)

    return () => {
      cancelled = true
      clearTimeout(wsTimer)
      if (wsRef.current) { try { wsRef.current.close() } catch { /* ignore */ }; wsRef.current = null }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!status || !jobId) return null

  const msgs = statusMessages[status] || []
  const currentMsg = step || label || msgs[msgIndex % msgs.length] || ''
  const isFailed = status === 'failed'
  const isComplete = status === 'complete'

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60)
    const secs = s % 60
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  return (
    <div className="w-full card-game p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {!isComplete && !isFailed && (
            <div className="w-3 h-3 rounded-full bg-accent-purple animate-pulse-glow" />
          )}
          {isComplete && <span className="text-green-400 text-sm">✓</span>}
          {isFailed && <span className="text-red-400 text-sm">✗</span>}
          <span className={`text-sm font-medium ${isFailed ? 'text-red-400' : isComplete ? 'text-green-400' : 'text-slate-300'}`}>
            {currentMsg}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-600 font-mono">{formatTime(elapsed)}</span>
          <span className="text-xs text-slate-500 font-medium">{Math.round(progress)}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            isFailed
              ? 'bg-red-500'
              : isComplete
              ? 'bg-green-500'
              : 'progress-bar-fill'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-2">
        <div className="text-[10px] text-slate-600 font-mono">
          job: {jobId.slice(0, 8)}...
        </div>
        {retryCount > 0 && !isComplete && !isFailed && (
          <div className="text-[10px] text-yellow-500 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
            Reconnecting... ({retryCount})
          </div>
        )}
      </div>
    </div>
  )
}
