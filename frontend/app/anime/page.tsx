'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import AnimeSceneCard from '@/components/anime/AnimeSceneCard'
import { api, type Job } from '@/lib/api'
import { useGameProgress } from '@/lib/useGameProgress'
import { useBellaStore } from '@/lib/bellaStore'

const styles = ['classroom', 'laboratory', 'outdoor', 'fantasy', 'character'] as const
type Style = typeof styles[number]

const styleIcons: Record<Style, string> = {
  classroom: '🏫',
  laboratory: '🧪',
  outdoor: '🌿',
  fantasy: '✨',
  character: '👤',
}

interface Scene {
  asset_id: string
  asset_url: string
  topic: string
  caption: string
  style: string
  source?: string  // "external" for Wikipedia URLs, undefined for normal S3
}

export default function AnimePage() {
  return (
    <Suspense fallback={<div className="p-6 max-w-4xl mx-auto text-center py-20 text-slate-600"><div className="text-5xl mb-4 animate-pulse">🎨</div><p className="text-sm">Loading Scene Forge...</p></div>}>
      <AnimePageInner />
    </Suspense>
  )
}

function AnimePageInner() {
  const searchParams = useSearchParams()
  const [topic, setTopic] = useState(searchParams.get('topic') || '')
  const [style, setStyle] = useState<Style>('classroom')
  const [includeAnimation, setIncludeAnimation] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { completeMission } = useGameProgress()
  const { triggerExplanation, isExplaining, requestStopSpeaking } = useBellaStore()

  // Handles job completion/failure — called by JobProgressBar's resilient polling
  const handleJobComplete = async (job: Job) => {
    setJobStatus(job.status)
    setLoading(false)

    if (job.status === 'complete') {
      setError(null)
      completeMission('anime')
      if (job.asset_id) {
        let meta: Record<string, string> | undefined
        try {
          const asset = await api.getAsset(job.asset_id)
          meta = asset.metadata as Record<string, string>
          setScenes((prev) => [
            ...prev,
            {
              asset_id: asset.asset_id,
              asset_url: asset.presigned_url,
              topic,
              caption: meta?.caption ?? `This scene illustrates "${topic}" in an anime ${style} setting.`,
              style,
              source: (meta?.source as string) || undefined,
            },
          ])
        } catch {
          // Fallback: use asset_url from job if asset fetch fails
          if (job.asset_url) {
            setScenes((prev) => [
              ...prev,
              {
                asset_id: job.asset_id!,
                asset_url: job.asset_url!,
                topic,
                caption: `This scene illustrates "${topic}" in an anime ${style} setting.`,
                style,
                source: undefined,
              },
            ])
          }
        }

        // Trigger Bella to explain the topic based on the generated image
        const imageContext = meta ? {
          source: meta.source as string | undefined,
          category: meta.category as string | undefined,
          caption: meta.caption as string | undefined,
          prompt: meta.prompt as string | undefined,
        } : undefined
        api.bellaExplain(topic, { image_context: imageContext, section: 'anime', language: useBellaStore.getState().language })
          .then((data) => {
            triggerExplanation({
              topic,
              text: data.explanation,
              audioB64: data.audio_b64 ?? null,
            })
          })
          .catch((err) => {
            console.warn('[SceneForge] Bella explain failed (non-fatal):', err)
          })
      }
    } else if (job.status === 'failed') {
      setError(job.error_message ?? 'Generation failed. Please try again.')
    }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit generation job. Please try again.')
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = searchParams.get('topic')
    if (t) handleGenerate(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddToStory = (scene: Scene) => {
    window.location.href = `/story?topic=${encodeURIComponent(scene.topic)}`
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fadeInUp">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-accent-purple/20 flex items-center justify-center text-2xl border border-accent-purple/20">🎨</div>
          <div>
            <h1 className="text-2xl font-black text-white">Scene Forge</h1>
            <p className="text-slate-400 text-sm">Transform topics into anime-style educational scenes</p>
          </div>
        </div>
      </div>

      {/* Input */}
      <div className="mb-6 animate-fadeInUp" style={{ animationDelay: '0.1s' }}>
        <TopicInput
          onSubmit={handleGenerate}
          loading={loading}
          defaultValue={topic}
          buttonLabel="⚡ Generate Scene"
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

      {/* Progress — shown for all active job states; JobProgressBar handles polling resiliently */}
      {jobId && jobStatus && jobStatus !== 'complete' && jobStatus !== 'failed' && (
        <div className="mb-6">
          <JobProgressBar jobId={jobId} status={jobStatus} onComplete={handleJobComplete} />
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
        <div className="animate-fadeInUp">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Generated Scenes</h2>
            <div className="flex items-center gap-3">
              {/* Stop Bella button — shown when she's explaining */}
              {isExplaining && (
                <button
                  onClick={requestStopSpeaking}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all animate-fadeInUp"
                >
                  <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                  🔇 Stop Bella
                </button>
              )}
              <span className="text-xs text-slate-500">{scenes.length} scene{scenes.length !== 1 ? 's' : ''}</span>
            </div>
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
