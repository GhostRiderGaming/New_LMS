'use client'
import { useState, useEffect } from 'react'
import Image from 'next/image'
import { api } from '@/lib/api'
import type { StoryPlan, EpisodePlan, ScenePlan } from '@/app/story/page'

interface Props {
  story: StoryPlan
}

// Resolve a scene's image URL from its asset_id
async function resolveSceneUrl(asset_id: string): Promise<string | null> {
  try {
    const asset = await api.getAsset(asset_id)
    return asset.presigned_url ?? null
  } catch {
    return null
  }
}

function episodeStatus(ep: EpisodePlan): 'pending' | 'generating' | 'complete' | 'failed' {
  const statuses = ep.scenes.map((s) => s.status)
  if (statuses.every((s) => s === 'complete')) return 'complete'
  if (statuses.some((s) => s === 'failed') && statuses.every((s) => s !== 'pending')) return 'failed'
  if (statuses.some((s) => s === 'complete')) return 'generating'
  return 'pending'
}

function EpisodeStatusDot({ status }: { status: ReturnType<typeof episodeStatus> }) {
  const cls = {
    pending: 'bg-slate-600',
    generating: 'bg-accent-purple animate-pulse',
    complete: 'bg-green-500',
    failed: 'bg-red-500',
  }[status]
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />
}

export default function StoryPlayer({ story }: Props) {
  const [activeEpisode, setActiveEpisode] = useState(0)
  const [activeScene, setActiveScene] = useState(0)
  const [imgError, setImgError] = useState(false)
  const [sceneUrls, setSceneUrls] = useState<Record<string, string>>({})
  const [exportLoading, setExportLoading] = useState(false)

  const episode = story.episodes[activeEpisode]
  const scene = episode?.scenes[activeScene]

  // Build a stable key for a scene
  const sceneKey = (epIdx: number, scIdx: number) => `${epIdx}-${scIdx}`

  // Load scene image URLs for all scenes that have asset_ids
  useEffect(() => {
    const load = async () => {
      const updates: Record<string, string> = {}
      for (let ei = 0; ei < story.episodes.length; ei++) {
        const ep = story.episodes[ei]
        for (let si = 0; si < ep.scenes.length; si++) {
          const sc = ep.scenes[si]
          if (sc.asset_id) {
            const key = sceneKey(ei, si)
            if (!sceneUrls[key]) {
              const url = await resolveSceneUrl(sc.asset_id)
              if (url) updates[key] = url
            }
          }
        }
      }
      if (Object.keys(updates).length > 0) {
        setSceneUrls((prev) => ({ ...prev, ...updates }))
      }
    }
    load()
  }, [story])

  const currentSceneUrl = scene?.asset_id
    ? sceneUrls[sceneKey(activeEpisode, activeScene)]
    : undefined

  const handlePrev = () => {
    setImgError(false)
    if (activeScene > 0) {
      setActiveScene(activeScene - 1)
    } else if (activeEpisode > 0) {
      const prevEp = story.episodes[activeEpisode - 1]
      setActiveEpisode(activeEpisode - 1)
      setActiveScene(prevEp.scenes.length - 1)
    }
  }

  const handleNext = () => {
    setImgError(false)
    if (activeScene < episode.scenes.length - 1) {
      setActiveScene(activeScene + 1)
    } else if (activeEpisode < story.episodes.length - 1) {
      setActiveEpisode(activeEpisode + 1)
      setActiveScene(0)
    }
  }

  const handleExportZip = async () => {
    setExportLoading(true)
    try {
      const url = api.exportStoryZip(story.story_id)
      window.open(url, '_blank')
    } finally {
      setExportLoading(false)
    }
  }

  const isFirst = activeEpisode === 0 && activeScene === 0
  const isLast =
    activeEpisode === story.episodes.length - 1 &&
    activeScene === episode.scenes.length - 1

  const totalScenes = story.episodes.reduce((s, e) => s + e.scenes.length, 0)

  return (
    <div className="space-y-4">
      {/* Story header */}
      <div className="bg-bg-card border border-border rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white mb-1">{story.title}</h2>
            <p className="text-slate-400 text-sm leading-relaxed max-w-2xl">{story.synopsis}</p>
          </div>
          <button
            onClick={handleExportZip}
            disabled={exportLoading}
            className="shrink-0 px-4 py-2 rounded-xl bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple text-xs font-medium transition-colors border border-accent-purple/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportLoading ? '...' : '↓ Export ZIP'}
          </button>
        </div>

        {/* Characters */}
        {story.characters.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {story.characters.map((c) => (
              <div key={c.name} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated border border-border">
                <div className="w-6 h-6 rounded-full bg-gradient-anime flex items-center justify-center text-xs font-bold text-white">
                  {c.name[0]}
                </div>
                <div>
                  <span className="text-xs font-medium text-white">{c.name}</span>
                  <span className="text-xs text-slate-500 ml-1">· {c.role}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex gap-4 mt-3 text-xs text-slate-500">
          <span>{story.episodes.length} episodes</span>
          <span>{totalScenes} scenes</span>
          <span className={story.status === 'complete' ? 'text-green-400' : 'text-accent-purple capitalize'}>
            {story.status}
          </span>
        </div>
      </div>

      {/* Player layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Episode list sidebar */}
        <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Episodes</span>
          </div>
          <div className="overflow-y-auto max-h-[480px]">
            {story.episodes.map((ep, ei) => {
              const epStatus = episodeStatus(ep)
              return (
                <button
                  key={ep.episode_number}
                  onClick={() => { setActiveEpisode(ei); setActiveScene(0); setImgError(false) }}
                  className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors ${
                    activeEpisode === ei
                      ? 'bg-accent-purple/10 border-l-2 border-l-accent-purple'
                      : 'hover:bg-bg-elevated'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-slate-500">EP {ep.episode_number}</span>
                    <EpisodeStatusDot status={epStatus} />
                    {/* Per-scene dots */}
                    <div className="flex gap-0.5 ml-1">
                      {ep.scenes.map((s, si) => (
                        <div
                          key={si}
                          className={`w-1.5 h-1.5 rounded-full ${
                            s.status === 'complete'
                              ? 'bg-green-500'
                              : s.status === 'failed'
                              ? 'bg-red-500'
                              : 'bg-slate-600'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="text-xs font-medium text-white truncate">{ep.title}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{ep.educational_concept}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Scene viewer */}
        <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
          {/* Episode title bar */}
          <div className="px-4 py-3 border-b border-border bg-bg-elevated flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500">
                EP {episode.episode_number} · Scene {activeScene + 1}/{episode.scenes.length}
              </span>
              <p className="text-sm font-semibold text-white">{episode.title}</p>
            </div>
            <span className="text-xs text-slate-500 hidden sm:block">{episode.educational_concept}</span>
          </div>

          {/* Scene image */}
          <div className="relative aspect-video bg-bg-elevated">
            {currentSceneUrl && !imgError ? (
              <Image
                src={currentSceneUrl}
                alt={scene?.description ?? ''}
                fill
                className="object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-600">
                <div className="text-center px-6">
                  {scene?.status === 'failed' ? (
                    <>
                      <div className="text-4xl mb-2">⚠️</div>
                      <p className="text-xs text-red-400">Scene generation failed</p>
                    </>
                  ) : scene?.status === 'pending' || !scene?.asset_id ? (
                    <>
                      <div className="text-4xl mb-2 animate-pulse">🎨</div>
                      <p className="text-xs text-slate-500">Generating scene...</p>
                    </>
                  ) : (
                    <>
                      <div className="text-4xl mb-2">🎨</div>
                      <p className="text-xs">Scene {activeScene + 1}</p>
                    </>
                  )}
                  {scene?.description && (
                    <p className="text-xs text-slate-600 mt-2 max-w-xs">{scene.description}</p>
                  )}
                </div>
              </div>
            )}

            {/* Scene number badge */}
            <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-xs text-white">
              {activeScene + 1} / {episode.scenes.length}
            </div>

            {/* Status badge */}
            {scene?.status && scene.status !== 'complete' && (
              <div className={`absolute top-3 left-3 px-2 py-1 rounded-lg backdrop-blur-sm text-xs font-medium ${
                scene.status === 'failed'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-accent-purple/20 text-accent-purple'
              }`}>
                {scene.status === 'failed' ? 'Failed' : 'Pending'}
              </div>
            )}
          </div>

          {/* Caption */}
          <div className="px-4 py-3 border-t border-border bg-bg-elevated/50">
            <p className="text-slate-300 text-sm leading-relaxed">{scene?.caption}</p>
          </div>

          {/* Navigation */}
          <div className="px-4 py-3 border-t border-border flex items-center justify-between">
            <button
              onClick={handlePrev}
              disabled={isFirst}
              className="px-4 py-2 rounded-lg bg-bg-elevated hover:bg-border text-slate-300 text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed border border-border"
            >
              ← Previous
            </button>
            <div className="flex gap-1">
              {episode.scenes.map((_, si) => (
                <button
                  key={si}
                  onClick={() => { setActiveScene(si); setImgError(false) }}
                  className={`h-2 rounded-full transition-all ${
                    si === activeScene ? 'bg-accent-purple w-4' : 'bg-slate-600 hover:bg-slate-400 w-2'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={handleNext}
              disabled={isLast}
              className="px-4 py-2 rounded-lg bg-accent-purple hover:opacity-90 text-white text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
