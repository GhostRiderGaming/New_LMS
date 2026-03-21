'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import AnimeSceneCard from '@/components/anime/AnimeSceneCard'

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

  const handleGenerate = async (t: string) => {
    setTopic(t)
    setError(null)
    setJobId(null)
    setJobStatus(null)
    setLoading(true)
    try {
      // Simulate job submission — replace with real api.generateAnime(t, style)
      await new Promise((r) => setTimeout(r, 500))
      const fakeJobId = crypto.randomUUID()
      setJobId(fakeJobId)
      setJobStatus('queued')
      setTimeout(() => setJobStatus('processing'), 1500)
      setTimeout(() => {
        setJobStatus('complete')
        setScenes((prev) => [
          ...prev,
          {
            asset_id: crypto.randomUUID(),
            asset_url: `https://picsum.photos/seed/${Date.now()}/512/512`,
            topic: t,
            caption: `This scene illustrates the concept of "${t}" in an anime ${style} setting.`,
            style,
          },
        ])
        setLoading(false)
      }, 5000)
    } catch {
      setError('Failed to submit generation job. Please try again.')
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = searchParams.get('topic')
    if (t && !topic) handleGenerate(t)
  }, [])

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
              <AnimeSceneCard key={scene.asset_id} scene={scene} />
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
