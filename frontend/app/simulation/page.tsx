'use client'
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import SimulationFrame from '@/components/simulation/SimulationFrame'
import { api } from '@/lib/api'

const categories = ['physics', 'chemistry', 'biology', 'mathematics', 'history'] as const
type Category = typeof categories[number]

const categoryIcons: Record<Category, string> = {
  physics: '⚛️',
  chemistry: '🧪',
  biology: '🌱',
  mathematics: '📐',
  history: '🏛️',
}

interface SimulationResult {
  asset_id: string
  asset_url: string
  topic: string
  category: Category
}

export default function SimulationPage() {
  const searchParams = useSearchParams()
  const [topic, setTopic] = useState(searchParams.get('topic') || '')
  const [category, setCategory] = useState<Category>('physics')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [simulationHtml, setSimulationHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPolling = (id: string, currentTopic: string, currentCategory: Category) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const job = await api.getJob(id)
        setJobStatus(job.status)
        if (job.status === 'complete') {
          clearInterval(pollRef.current!)
          setLoading(false)
          if (job.asset_id) {
            try {
              const asset = await api.getAsset(job.asset_id)
              setResult({
                asset_id: asset.asset_id,
                asset_url: asset.presigned_url,
                topic: currentTopic,
                category: currentCategory,
              })
              // Fetch the HTML bundle from the asset URL
              const res = await fetch(asset.presigned_url)
              const html = await res.text()
              setSimulationHtml(html)
            } catch {
              if (job.asset_url) {
                setResult({
                  asset_id: job.asset_id!,
                  asset_url: job.asset_url!,
                  topic: currentTopic,
                  category: currentCategory,
                })
                const res = await fetch(job.asset_url)
                const html = await res.text()
                setSimulationHtml(html)
              }
            }
          }
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current!)
          setLoading(false)
          setError(job.error_message ?? 'Simulation generation failed. Please try again.')
        }
      } catch {
        clearInterval(pollRef.current!)
        setLoading(false)
        setError('Lost connection while polling job status.')
      }
    }, 2000)
  }

  const handleGenerate = async (t: string) => {
    setTopic(t)
    setError(null)
    setJobId(null)
    setJobStatus(null)
    setResult(null)
    setSimulationHtml(null)
    setLoading(true)
    try {
      const job = await api.generateSimulation(t, category)
      setJobId(job.job_id)
      setJobStatus(job.status)
      startPolling(job.job_id, t, category)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit simulation job. Please try again.')
      setLoading(false)
    }
  }

  // Auto-generate if topic is in query params
  useEffect(() => {
    const t = searchParams.get('topic')
    if (t) handleGenerate(t)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const shareUrl = result
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/simulation?topic=${encodeURIComponent(result.topic)}`
    : undefined

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-accent-cyan/20 flex items-center justify-center text-xl">🔬</div>
          <div>
            <h1 className="text-2xl font-bold text-white">Simulation Engine</h1>
            <p className="text-slate-400 text-sm">Generate interactive browser-based educational simulations</p>
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="mb-6">
        <TopicInput
          onSubmit={handleGenerate}
          loading={loading}
          defaultValue={topic}
          buttonLabel="Generate Simulation"
        >
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                  category === c
                    ? 'bg-accent-cyan text-bg-primary font-semibold'
                    : 'bg-bg-elevated text-slate-400 hover:text-white border border-border'
                }`}
              >
                {categoryIcons[c]} {c}
              </button>
            ))}
          </div>
        </TopicInput>
      </div>

      {/* Progress */}
      {jobId && jobStatus !== 'complete' && jobStatus !== 'failed' && (
        <div className="mb-6">
          <JobProgressBar jobId={jobId} status={jobStatus} label="Generating simulation code..." />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6">
          <ErrorCard message={error} onRetry={() => topic && handleGenerate(topic)} />
        </div>
      )}

      {/* Result */}
      {simulationHtml && result && (
        <SimulationFrame
          html={simulationHtml}
          topic={result.topic}
          shareUrl={shareUrl}
        />
      )}

      {/* Empty state */}
      {!simulationHtml && !loading && !jobId && (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">🔬</div>
          <p className="text-sm">Enter a topic to generate an interactive simulation</p>
        </div>
      )}
    </div>
  )
}
