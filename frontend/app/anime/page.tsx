'use client'
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import AnimeSceneCard from '@/components/anime/AnimeSceneCard'
import { api } from '@/lib/api'

const styles = ['classroom', 'laboratory', 'outdoor', 'fantasy'] as const
type Style = typeof styles[number]

const styleIcons: Record<Style, string> = {
  classroom: '🏫',
  laboratory: '🧪',
  outdoor: '🌿',
  fantasy: '✨',
}

interface Scene {
  asset_id: string
  asset_url: string
  topic: string
  caption: string
  style: Style
}

export default function AnimePage() {
  const searchParams = useSearchParams()
  const [topic, setTopic] = useState(searchParams.get('topic') || '')
  const [style, setStyle] = useState<Style>('classroom')
  const [includeAnimation, setIncludeAnimation] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll job status until terminal state
  const startPolling = (id: string, currentTopic: string, currentStyle: Style) => {
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
              setScenes((prev) => [
                ...prev,
                {
                  asset_id: asset.asset_id,
                  asset_url: asset.asset_url,
                  topic: currentTopic,
                  caption: meta?.caption ?? `This scene illustrates "${currentTopic}" in an anime ${currentStyle} setting.`,
                  style: currentStyle,
                },
              ])
            } catch {
              // asset fetch failed — use job url if available
              if (job.asset_url) {
                setScenes((prev) => [
                  ...prev,
                  {
                    asset_id: job.asset_id!,
                    asset_url: job.asset_url!,
                    topic: currentTopic,
                    caption: `This scene illustrates "${currentTopic}" in an anime ${currentStyle} setting.`,
                    style: currentStyle,
                  },
                ])
              }
            }
          }
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current!)
          setLoading(false)
          setError(job.error_message ?? 'Generation failed. Please try again.')
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
    setLoading(true)
    try {
      const job = await api.generateAnime(t, style, includeAnimation)
      setJobId(job.job_id)
      setJobStatus(job.status)
      startPolling(job.job_id, t, style)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit generation job. Please try again.')
      setLoading(false)
    }
  }

  // Auto-generate if topic is in query params
  useEffect(() => {
    const t = searchParams.get('topic')
    if (t) handleGenerate(t)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  const handleAddToStory = (scene: Scene) => {
    window.location.href = `/story?topic=${encodeURIComponent(scene.topic)}`
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-accent-purple/20 flex items-center justify-center text-xl">🎨</div>
          <div>
            <h1 className="text-2xl font-bold text-white">Anime Generator</h1>
            <p className="text-slate-400 text-sm">Transform topics into anime-style educational scenes</p>
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="mb-6">
        <TopicInput
          onSubmit={handleGenerate}
          loading={loading}
          defaultValue={topic}
          buttonLabel="Generate Scene"
        >
          {/* Style selector */}
          <div className="flex flex-wrap gap-2 mb-3">
            {styles.map((s) => (
              <button
                key={s}
                onClick={() => setStyle(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  style === s
                    ? 'bg-accent-purple text-white shadow-glow-purple'
                    : 'bg-bg-elevated text-slate-400 hover:text-white border border-border'
                }`}
              >
                {styleIcons[s]} {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          {/* Animation toggle */}
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <div
              onClick={() => setIncludeAnimation(!includeAnimation)}
              className={`w-9 h-5 rounded-full transition-colors relative ${includeAnimation ? 'bg-accent-purple' : 'bg-bg-elevated border border-border'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${includeAnimation ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs text-slate-400">Include animation (WebM)</span>
          </label>
        </TopicInput>
      </div>

      {/* Progress */}
      {jobId && jobStatus !== 'complete' && jobStatus !== 'failed' && (
        <div className="mb-6">
          <JobProgressBar jobId={jobId} status={jobStatus} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6">
          <ErrorCard message={error} onRetry={() => topic && handleGenerate(topic)} />
        </div>
      )}

      {/* Results */}
      {scenes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Generated Scenes</h2>
            <span className="text-xs text-slate-500">{scenes.length} scene{scenes.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {scenes.map((scene) => (
              <AnimeSceneCard key={scene.asset_id} scene={scene} onAddToStory={handleAddToStory} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {scenes.length === 0 && !loading && !jobId && (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">🎨</div>
          <p className="text-sm">Enter a topic above to generate your first anime scene</p>
        </div>
      )}
    </div>
  )
}
