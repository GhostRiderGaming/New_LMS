'use client'
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import { api } from '@/lib/api'

// Avoid SSR issues with Three.js Canvas
const ModelViewer3D = dynamic(() => import('@/components/model3d/ModelViewer3D'), { ssr: false })

const categories = ['anatomy', 'chemistry', 'astronomy', 'historical', 'mechanical'] as const
type Category = typeof categories[number]

const categoryIcons: Record<Category, string> = {
  anatomy: '🫀',
  chemistry: '⚗️',
  astronomy: '🔭',
  historical: '🏺',
  mechanical: '⚙️',
}

interface Model3DResult {
  asset_id: string
  asset_url: string
  object_name: string
  description: string
}

export default function Model3DPage() {
  const searchParams = useSearchParams()
  const [objectName, setObjectName] = useState(searchParams.get('object') || '')
  const [category, setCategory] = useState<Category>('anatomy')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [result, setResult] = useState<Model3DResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPolling = (id: string, currentObjectName: string) => {
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
              const meta = asset.metadata as Record<string, string>
              setResult({
                asset_id: asset.asset_id,
                asset_url: asset.asset_url,
                object_name: meta?.object_name ?? currentObjectName,
                description: meta?.description ?? '',
              })
            } catch {
              if (job.asset_url) {
                setResult({
                  asset_id: job.asset_id!,
                  asset_url: job.asset_url!,
                  object_name: currentObjectName,
                  description: '',
                })
              }
            }
          }
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current!)
          setLoading(false)
          setError(job.error_message ?? '3D model generation failed. Please try again.')
        }
      } catch {
        clearInterval(pollRef.current!)
        setLoading(false)
        setError('Lost connection while polling job status.')
      }
    }, 2000)
  }

  const handleGenerate = async (name: string) => {
    setObjectName(name)
    setError(null)
    setJobId(null)
    setJobStatus(null)
    setResult(null)
    setLoading(true)
    try {
      const job = await api.generateModel3D(name, category)
      setJobId(job.job_id)
      setJobStatus(job.status)
      startPolling(job.job_id, name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit 3D model job. Please try again.')
      setLoading(false)
    }
  }

  // Auto-generate if object is in query params
  useEffect(() => {
    const obj = searchParams.get('object')
    if (obj) handleGenerate(obj)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-accent-pink/20 flex items-center justify-center text-xl">🧊</div>
          <div>
            <h1 className="text-2xl font-bold text-white">3D Model Generator</h1>
            <p className="text-slate-400 text-sm">Generate interactive 3D models of real-world objects</p>
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="mb-6">
        <TopicInput
          onSubmit={handleGenerate}
          loading={loading}
          defaultValue={objectName}
          placeholder="Enter an object name — e.g. Human Heart, Water Molecule, Saturn..."
          buttonLabel="Generate 3D Model"
        >
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                  category === c
                    ? 'bg-accent-pink text-white shadow-glow-pink'
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
          <JobProgressBar jobId={jobId} status={jobStatus} label="Generating 3D model..." />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6">
          <ErrorCard message={error} onRetry={() => objectName && handleGenerate(objectName)} />
        </div>
      )}

      {/* Result */}
      {result && (
        <ModelViewer3D
          gltfUrl={result.asset_url}
          metadata={{ name: result.object_name, description: result.description, object_name: result.object_name }}
        />
      )}

      {/* Empty state */}
      {!result && !loading && !jobId && (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">🧊</div>
          <p className="text-sm">Enter an object name to generate a 3D model</p>
        </div>
      )}
    </div>
  )
}
