'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import { api } from '@/lib/api'
import { useGameProgress } from '@/lib/useGameProgress'
import { useBellaStore } from '@/lib/bellaStore'
import { useModel3DCache, type CachedModel3D } from '@/components/Model3DEngine/useModel3DCache'
import Model3DGallery from '@/components/Model3DEngine/Model3DGallery'
import '@/components/Model3DEngine/Model3DEngine.css'

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
  return (
    <Suspense fallback={<div className="p-6 max-w-4xl mx-auto text-center py-20 text-slate-600"><div className="text-5xl mb-4 animate-pulse">🧊</div><p className="text-sm">Loading Holodeck...</p></div>}>
      <Model3DPageInner />
    </Suspense>
  )
}

function Model3DPageInner() {
  const searchParams = useSearchParams()
  const [objectName, setObjectName] = useState(searchParams.get('object') || '')
  const [category, setCategory] = useState<Category>('anatomy')
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [result, setResult] = useState<Model3DResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [fromCache, setFromCache] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryKey, setGalleryKey] = useState(0)
  
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { completeMission } = useGameProgress()
  const { getCached, setCached } = useModel3DCache()
  const { triggerExplanation, isExplaining, requestStopSpeaking } = useBellaStore()

  const explainModel = (topic: string) => {
    api.bellaExplain(topic, { section: 'model3d', language: useBellaStore.getState().language })
      .then((data) => {
        triggerExplanation({
          topic,
          text: data.explanation,
          audioB64: data.audio_b64 ?? null,
        })
      })
      .catch((err) => console.warn('[Model3D] Bella explain failed:', err))
  }

  const startPolling = (id: string, currentObjectName: string, currentCategory: Category) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const job = await api.getJob(id)
        setJobStatus(job.status)
        if (job.status === 'complete') {
          clearInterval(pollRef.current!)
          setLoading(false)
          completeMission('model3d')
          if (job.asset_id) {
            try {
              const asset = await api.getAsset(job.asset_id)
              const meta = asset.metadata as Record<string, string>
              const newResult = {
                asset_id: asset.asset_id,
                asset_url: asset.presigned_url,
                object_name: meta?.object_name ?? currentObjectName,
                description: meta?.description ?? '',
              }
              setResult(newResult)
              setCached({
                object_name: newResult.object_name,
                category: currentCategory,
                asset_url: newResult.asset_url,
                description: newResult.description
              })
              setGalleryKey(prev => prev + 1)
              explainModel(newResult.object_name)
            } catch {
              if (job.asset_url) {
                const newResult = {
                  asset_id: job.asset_id!,
                  asset_url: job.asset_url!,
                  object_name: currentObjectName,
                  description: '',
                }
                setResult(newResult)
                setCached({
                  object_name: newResult.object_name,
                  category: currentCategory,
                  asset_url: newResult.asset_url,
                  description: newResult.description
                })
                setGalleryKey(prev => prev + 1)
                explainModel(newResult.object_name)
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
    setFromCache(false)
    setLoading(true)

    // Check cache first
    const cached = getCached(name)
    if (cached) {
      setResult({
        asset_id: 'cached',
        asset_url: cached.asset_url,
        object_name: cached.object_name,
        description: cached.description
      })
      setCategory(cached.category as Category)
      setFromCache(true)
      setLoading(false)
      completeMission('model3d')
      explainModel(cached.object_name)
      return
    }

    try {
      const job = await api.generateModel3D(name, category)
      setJobId(job.job_id)
      setJobStatus(job.status)
      startPolling(job.job_id, name, category)
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
      <div className="mb-8 animate-fadeInUp flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-accent-pink/20 flex items-center justify-center text-2xl border border-accent-pink/20">🧊</div>
          <div>
            <h1 className="text-2xl font-black text-white">Holodeck</h1>
            <p className="text-slate-400 text-sm">Generate interactive 3D models of real-world objects</p>
          </div>
        </div>
        <button
          className="sim-engine__gallery-btn"
          onClick={() => setGalleryOpen(true)}
          title="View cached models"
        >
          <span className="sim-engine__gallery-btn-icon">📚</span>
          <span className="sim-engine__gallery-btn-label">Gallery</span>
        </button>
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
        <div className="animate-fadeInUp">
          <div className="flex items-center justify-between mb-2">
            {fromCache ? (
              <div className="sim-engine__cache-badge">
                <span className="sim-engine__cache-badge-icon">⚡</span>
                <span>Loaded from cache</span>
                <span className="sim-engine__cache-badge-dot" />
              </div>
            ) : <div />}
            {isExplaining && (
              <button
                onClick={requestStopSpeaking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all"
              >
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                🔇 Stop Bella
              </button>
            )}
          </div>
          <ModelViewer3D
            gltfUrl={result.asset_url}
            metadata={{ name: result.object_name, description: result.description, object_name: result.object_name }}
          />
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !jobId && (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">🧊</div>
          <p className="text-sm">Enter an object name to generate a 3D model</p>
        </div>
      )}

      {/* Gallery Sidebar */}
      {galleryOpen && (
        <Model3DGallery
          key={galleryKey}
          onSelect={(entry) => {
            setObjectName(entry.object_name)
            setCategory(entry.category as Category)
            setResult({
              asset_id: 'cached',
              asset_url: entry.asset_url,
              object_name: entry.object_name,
              description: entry.description
            })
            setFromCache(true)
            setGalleryOpen(false)
            explainModel(entry.object_name)
            setError(null)
          }}
          onClose={() => setGalleryOpen(false)}
          onCleared={() => setGalleryKey(prev => prev + 1)}
        />
      )}
    </div>
  )
}
