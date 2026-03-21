'use client'
import { useState } from 'react'
import TopicInput from '@/components/shared/TopicInput'
import JobProgressBar from '@/components/shared/JobProgressBar'
import ErrorCard from '@/components/shared/ErrorCard'
import StoryPlayer from '@/components/story/StoryPlayer'

export interface Scene {
  scene_number: number
  description: string
  caption: string
  asset_url?: string
  status: 'pending' | 'complete' | 'failed'
}

export interface Episode {
  episode_number: number
  title: string
  educational_concept: string
  scenes: Scene[]
}

export interface StoryPlan {
  story_id: string
  title: string
  synopsis: string
  topic: string
  characters: { name: string; role: string }[]
  episodes: Episode[]
  status: 'planning' | 'generating' | 'complete' | 'failed'
}

export default function StoryPage() {
  const [episodeCount, setEpisodeCount] = useState(3)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'complete' | 'failed' | null>(null)
  const [progressLabel, setProgressLabel] = useState('')
  const [story, setStory] = useState<StoryPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleGenerate = async (topic: string) => {
    setError(null)
    setJobId(null)
    setJobStatus(null)
    setStory(null)
    setLoading(true)

    try {
      await new Promise((r) => setTimeout(r, 500))
      const fakeJobId = crypto.randomUUID()
      setJobId(fakeJobId)
      setJobStatus('queued')
      setProgressLabel('Planning story structure...')

      setTimeout(() => { setJobStatus('processing'); setProgressLabel('Generating story plan with LLaMA 3.3 70B...') }, 1500)
      setTimeout(() => setProgressLabel('Creating characters...'), 4000)
      setTimeout(() => setProgressLabel(`Generating scenes for ${episodeCount} episodes...`), 7000)

      setTimeout(() => {
        setJobStatus('complete')
        setLoading(false)
        // Mock story plan
        const episodes: Episode[] = Array.from({ length: episodeCount }, (_, i) => ({
          episode_number: i + 1,
          title: `Episode ${i + 1}: ${['The Discovery', 'The Challenge', 'The Breakthrough', 'The Revelation', 'The Mastery'][i % 5]}`,
          educational_concept: `Core concept ${i + 1} of ${topic}`,
          scenes: Array.from({ length: 3 }, (_, j) => ({
            scene_number: j + 1,
            description: `Scene ${j + 1} of episode ${i + 1}`,
            caption: `This scene explains concept ${j + 1} of "${topic}" through the story.`,
            asset_url: `https://picsum.photos/seed/${fakeJobId}-${i}-${j}/512/512`,
            status: 'complete' as const,
          })),
        }))

        setStory({
          story_id: fakeJobId,
          title: `The World of ${topic}`,
          synopsis: `An educational anime series that takes students on a journey through the fascinating world of ${topic}, exploring its core concepts through compelling characters and dramatic storytelling.`,
          topic,
          characters: [
            { name: 'Hana', role: 'Curious student protagonist' },
            { name: 'Professor Kai', role: 'Wise mentor' },
            { name: 'Ren', role: 'Rival turned ally' },
          ],
          episodes,
          status: 'complete',
        })
      }, 10000)
    } catch {
      setError('Failed to generate story. Please try again.')
      setLoading(false)
    }
  }

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
          placeholder="Enter a topic — e.g. Quantum Physics, The French Revolution..."
          buttonLabel="Generate Story"
        >
          {/* Episode count */}
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
          <ErrorCard message={error} />
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
