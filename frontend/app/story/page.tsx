'use client'
import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import StoryPlayer from '@/components/story/StoryPlayer'
import { api } from '@/lib/api'

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

export interface StoryPlan {
  story_id: string
  title: string
  synopsis: string
  topic: string
  characters: { name: string; role: string; description: string }[]
  episodes: EpisodePlan[]
  total_scenes: number
  status: 'planning' | 'generating' | 'complete' | 'failed'
}

export default function StoryPage() {
  const searchParams = useSearchParams()
  const [topic, setTopic] = useState(searchParams.get('topic') || '')
  const [episodeCount, setEpisodeCount] = useState(3)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [progressLabel, setProgressLabel] = useState('')
  const [story, setStory] = useState<StoryPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPolling = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const job = await api.getJob(id)
        setJobStatus(job.status)

        if (job.status === 'processing') {
          setProgressLabel('Generating story scenes...')
        } else if (job.status === 'queued') {
          setProgressLabel('Planning story structure...')
        }

        if (job.status === 'complete') {
          clearInterval(pollRef.current!)
          setLoading(false)
          setProgressLabel('Story complete!')

          // Get story_id from the job's asset metadata
          if (job.asset_id) {
            try {
              const planAsset = await api.getAsset(job.asset_id)
              const meta = planAsset.metadata as Record<string, unknown>
              const storyId = meta?.story_id as string | undefined

              if (storyId) {
                // Fetch full StoryPlan from asset metadata
                const storyPlan = meta as unknown as StoryPlan
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
              }
            } catch {
              setError('Story generated but failed to load plan. Please refresh.')
            }
          }
        } else if (job.status === 'failed') {
          clearInterval(pollRef.current!)
          setLoading(false)
          setError(job.error_message ?? 'Story generation failed. Please try again.')
        }
      } catch {
        clearInterval(pollRef.current!)
        setLoading(false)
        setError('Lost connection while polling job status.')
      }
    }, 3000)
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
      startPolling(job.job_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit story job. Please try again.')
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = searchParams.get('topic')
    if (t) handleGenerate(t)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-accent-purple/20 flex items-center justify-center text-xl">📖</div>
          <div>
            <h1 className="text-2xl font-bold text-white">Anime Story Generator</h1>
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

      {jobId && jobStatus !== 'complete' && jobStatus !== 'failed' && (
        <div className="mb-6">
          <JobProgressBar jobId={jobId} status={jobStatus} label={progressLabel} />
        </div>
      )}

      {error && (
        <div className="mb-6">
          <ErrorCard message={error} onRetry={() => topic && handleGenerate(topic)} />
        </div>
      )}

      {story && <StoryPlayer story={story} />}

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
