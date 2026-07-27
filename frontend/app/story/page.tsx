'use client'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import StoryPlayer from '@/components/story/StoryPlayer'
import { api } from '@/lib/api'
import type { Job, StoryPlan, EpisodePlan } from '@/lib/api'
import { useGameProgress } from '@/lib/useGameProgress'
import { useBellaStore } from '@/lib/bellaStore'

export interface ScenePlan {
  scene_number: number
  description: string
  caption: string
  asset_id?: string
  status: 'pending' | 'complete' | 'failed'
}

export interface EpisodePlan {
  episode_number: number
  title: string
  educational_concept: string
  scenes: ScenePlan[]
}

export interface CharacterPlan {
  name: string
  role: string
  description: string
  justification?: string
}

export interface StoryPlan {
  story_id: string
  title: string
  synopsis: string
  topic: string
  topic_category?: string
  setting_style?: string
  characters: CharacterPlan[]
  episodes: EpisodePlan[]
  total_scenes: number
  status: 'planning' | 'generating_assets' | 'generating_video' | 'complete' | 'failed'
}


export default function StoryPage() {
  return (
    <Suspense fallback={<div className="p-6 max-w-5xl mx-auto text-center py-20 text-slate-600"><div className="text-5xl mb-4 animate-pulse">📖</div><p className="text-sm">Loading Chronicle...</p></div>}>
      <StoryPageInner />
    </Suspense>
  )
}

function StoryPageInner() {
  const searchParams = useSearchParams()
  const [topic, setTopic] = useState(searchParams.get('topic') || '')
  const [episodeCount, setEpisodeCount] = useState(3)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [progressLabel, setProgressLabel] = useState('')
  const [story, setStory] = useState<StoryPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { completeMission } = useGameProgress()
  const { triggerExplanation, isExplaining, requestStopSpeaking } = useBellaStore()

  const explainStory = (t: string) => {
    api.bellaExplain(t, { section: 'story', language: useBellaStore.getState().language })
      .then((data) => {
        triggerExplanation({
          topic: t,
          text: data.explanation,
          audioB64: data.audio_b64 ?? null,
        })
      })
      .catch((err) => console.warn('[Story] Bella explain failed:', err))
  }

  const handleJobComplete = async (job: Job) => {
    setJobStatus(job.status)
    setLoading(false)

    if (job.status === 'complete') {
      setError(null)
      setProgressLabel('Story complete!')
      completeMission('story')

      // Helper to build StoryPlan from asset metadata
      const buildStoryFromMeta = (meta: Record<string, unknown>) => {
        const storyId = meta?.story_id as string | undefined
        if (!storyId) return false
        setStory({
          story_id: storyId,
          title: (meta.title as string) ?? 'Untitled Story',
          synopsis: (meta.synopsis as string) ?? '',
          topic: (meta.topic as string) ?? topic,
          characters: (meta.characters as StoryPlan['characters']) ?? [],
          episodes: (meta.episodes as EpisodePlan[]) ?? [],
          total_scenes: (meta.total_scenes as number) ?? 0,
          status: 'complete',
        })
        return true
      }

      // Primary path: fetch via asset_id
      if (job.asset_id) {
        try {
          const planAsset = await api.getAsset(job.asset_id)
          const meta = planAsset.metadata as Record<string, unknown>
          if (buildStoryFromMeta(meta)) {
            explainStory(topic)
            return
          }
        } catch {
          // Fall through to fallback
        }
      }

      // Fallback: if asset_id missing, search assets by job_id
      try {
        const assets = await api.listAssets()
        const planAsset = assets.find(
          (a) => a.job_id === job.job_id && a.type === 'story'
        )
        if (planAsset) {
          const meta = planAsset.metadata as Record<string, unknown>
          if (buildStoryFromMeta(meta)) {
            explainStory(topic)
            return
          }
        }
      } catch {
        // ignore
      }

      setError('Story generated but failed to load plan. Please refresh.')
    } else if (job.status === 'failed') {
      setError(job.error_message ?? 'Story generation failed. Please try again.')
    }
  }

  const handleGenerate = async (t: string) => {
    setTopic(t)
    setError(null)
    setJobId(null)
    setJobStatus(null)
    setStory(null)
    setLoading(true)
    setProgressLabel('Planning story structure...')

    try {
      const job = await api.generateStory(t, episodeCount)
      setJobId(job.job_id)
      setJobStatus(job.status)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit story job. Please try again.')
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = searchParams.get('topic')
    if (t) handleGenerate(t)
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8 animate-fadeInUp">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-accent-purple/20 flex items-center justify-center text-2xl border border-accent-purple/20">📖</div>
          <div>
            <h1 className="text-2xl font-black text-white">Chronicle</h1>
            <p className="text-slate-400 text-sm">Transform topics into full multi-episode educational anime series</p>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <TopicInput
          onSubmit={handleGenerate}
          loading={loading}
          defaultValue={topic}
          placeholder="Enter a topic — e.g. Quantum Physics, The French Revolution..."
          buttonLabel="Generate Story"
        >
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-400">Episodes:</span>
            <div className="flex gap-1.5">
              {[3, 5, 7, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => setEpisodeCount(n)}
                  className={`w-9 h-8 rounded-lg text-xs font-medium transition-all ${
                    episodeCount === n
                      ? 'bg-accent-purple text-white'
                      : 'bg-bg-elevated text-slate-400 hover:text-white border border-border'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-600">({episodeCount * 3}+ scenes total)</span>
          </div>
        </TopicInput>
      </div>

      {/* Progress — JobProgressBar handles polling resiliently */}
      {jobId && jobStatus && jobStatus !== 'complete' && jobStatus !== 'failed' && (
        <div className="mb-6">
          <JobProgressBar jobId={jobId} status={jobStatus} label={progressLabel} onComplete={handleJobComplete} />
        </div>
      )}

      {error && (
        <div className="mb-6">
          <ErrorCard message={error} onRetry={() => topic && handleGenerate(topic)} />
        </div>
      )}

      {story && (
        <div className="animate-fadeInUp">
          {isExplaining && (
            <div className="flex justify-end mb-4">
              <button
                onClick={requestStopSpeaking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all shadow-lg"
              >
                <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                🔇 Stop Bella
              </button>
            </div>
          )}
          <StoryPlayer story={story} />
        </div>
      )}

      {!story && !loading && !jobId && (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">📖</div>
          <p className="text-sm">Enter a topic to generate your educational anime series</p>
          <p className="text-xs mt-2 text-slate-700">Each episode contains 3+ scenes with educational captions</p>
        </div>
      )}
    </div>
  )
}
