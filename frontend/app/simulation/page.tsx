'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import SimulationFrame from '@/components/simulation/SimulationFrame'
import { api, type Job } from '@/lib/api'
import { useGameProgress } from '@/lib/useGameProgress'

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
  return (
    <Suspense fallback={<div className="p-6 max-w-4xl mx-auto text-center py-20 text-slate-600"><div className="text-5xl mb-4 animate-pulse">🔬</div><p className="text-sm">Loading Lab Engine...</p></div>}>
      <SimulationPageInner />
    </Suspense>
  )
}

function SimulationPageInner() {
  const searchParams = useSearchParams()
  const [topic, setTopic] = useState(searchParams.get('topic') || '')
  const [category, setCategory] = useState<Category>('physics')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [simulationHtml, setSimulationHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { completeMission } = useGameProgress()

  // Handles job completion/failure — called by JobProgressBar's resilient polling
  const handleJobComplete = async (job: Job) => {
    setJobStatus(job.status)
    setLoading(false)

    if (job.status === 'complete') {
      setError(null)
      completeMission('simulation')
      if (job.asset_id) {
        try {
          const asset = await api.getAsset(job.asset_id)
          setResult({
            asset_id: asset.asset_id,
            asset_url: asset.presigned_url,
            topic,
            category,
          })
          // Fetch HTML through the backend proxy — avoids S3 CORS issues
          const res = await fetch(api.downloadAsset(asset.asset_id), {
            headers: { 'X-API-Key': process.env.NEXT_PUBLIC_API_KEY ?? 'dev-api-key' }
          })
          const html = await res.text()
          setSimulationHtml(html)
        } catch {
          setError('Simulation generated but failed to load. Please try again.')
        }
      }
    } else if (job.status === 'failed') {
      setError(job.error_message ?? 'Simulation generation failed. Please try again.')
    }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit simulation job. Please try again.')
      setLoading(false)
    }
  }

  // Auto-generate if topic is in query params
  useEffect(() => {
    const t = searchParams.get('topic')
    if (t) handleGenerate(t)
  }, [])

  const shareUrl = result
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/simulation?topic=${encodeURIComponent(result.topic)}`
    : undefined

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fadeInUp">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-accent-cyan/20 flex items-center justify-center text-2xl border border-accent-cyan/20">🔬</div>
          <div>
            <h1 className="text-2xl font-black text-white">Lab Engine</h1>
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

      {/* Progress — JobProgressBar handles polling resiliently */}
      {jobId && jobStatus && jobStatus !== 'complete' && jobStatus !== 'failed' && (
        <div className="mb-6">
          <JobProgressBar jobId={jobId} status={jobStatus} label="Generating simulation code..." onComplete={handleJobComplete} />
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
