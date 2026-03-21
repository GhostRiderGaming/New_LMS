'use client'
import { useState } from 'react'
import Image from 'next/image'
import type { StoryPlan, Episode, Scene } from '@/app/story/page'

interface Props {
  story: StoryPlan
}

export default function StoryPlayer({ story }: Props) {
  const [activeEpisode, setActiveEpisode] = useState(0)
  const [activeScene, setActiveScene] = useState(0)
  const [imgError, setImgError] = useState(false)

  const episode = story.episodes[activeEpisode]
  const scene = episode?.scenes[activeScene]
  const totalScenes = story.episodes.reduce((s, e) => s + e.scenes.length, 0)

  const handlePrev = () => {
    if (activeScene > 0) { setActiveScene(activeScene - 1); setImgError(false) }
    else if (activeEpisode > 0) {
      const prevEp = story.episodes[activeEpisode - 1]
      setActiveEpisode(activeEpisode - 1)
      setActiveScene(prevEp.scenes.length - 1)
      setImgError(false)
    }
  }

  const handleNext = () => {
    if (activeScene < episode.scenes.length - 1) { setActiveScene(activeScene + 1); setImgError(false) }
    else if (activeEpisode < story.episodes.length - 1) {
      setActiveEpisode(activeEpisode + 1)
      setActiveScene(0)
      setImgError(false)
    }
  }

  const handleDownloadZip = () => {
    // Real impl: call api.downloadStoryZip(story.story_id)
    alert('ZIP export — connect to backend /api/v1/story/' + story.story_id + '/export')
  }

  const isFirst = activeEpisode === 0 && activeScene === 0
  const isLast = activeEpisode === story.episodes.length - 1 && activeScene === episode.scenes.length - 1

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
            onClick={handleDownloadZip}
            className="shrink-0 px-4 py-2 rounded-xl bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple-light text-xs font-medium transition-colors border border-accent-purple/30"
          >
            ↓ Export ZIP
          </button>
        </div>

        {/* Characters */}
        <div className="flex flex-wrap gap-2 mt-4">
          {story.characters.map((c) => (
            <div key={c.name} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated border border-border">
              <div className="w-6 h-6 rounded-full bg-gradient-anime flex items-center justify-center text-xs font-bold">
                {c.name[0]}
              </div>
              <div>
                <span className="text-xs font-medium text-white">{c.name}</span>
                <span className="text-xs text-slate-500 ml-1">· {c.role}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="flex gap-4 mt-3 text-xs text-slate-500">
          <span>{story.episodes.length} episodes</span>
          <span>{totalScenes} scenes</span>
          <span className="text-accent-purple capitalize">{story.status}</span>
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
            {story.episodes.map((ep, ei) => (
              <button
                key={ep.episode_number}
                onClick={() => { setActiveEpisode(ei); setActiveScene(0); setImgError(false) }}
                className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors ${
                  activeEpisode === ei ? 'bg-accent-purple/10 border-l-2 border-l-accent-purple' : 'hover:bg-bg-elevated'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-slate-500">EP {ep.episode_number}</span>
                  <div className="flex gap-0.5">
                    {ep.scenes.map((s, si) => (
                      <div
                        key={si}
                        className={`w-1.5 h-1.5 rounded-full ${
                          s.status === 'complete' ? 'bg-green-500' :
                          s.status === 'failed' ? 'bg-red-500' : 'bg-slate-600'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <p className="text-xs font-medium text-white truncate">{ep.title}</p>
                <p className="text-xs text-slate-500 truncate mt-0.5">{ep.educational_concept}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Scene viewer */}
        <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
          {/* Episode title bar */}
          <div className="px-4 py-3 border-b border-border bg-bg-secondary flex items-center justify-between">
            <div>
              <span className="text-xs text-slate-500">EP {episode.episode_number} · Scene {activeScene + 1}/{episode.scenes.length}</span>
              <p className="text-sm font-semibold text-white">{episode.title}</p>
            </div>
            <span className="text-xs text-slate-500">{episode.educational_concept}</span>
          </div>

          {/* Scene image */}
          <div className="relative aspect-video bg-bg-elevated">
            {scene?.asset_url && !imgError ? (
              <Image
                src={scene.asset_url}
                alt={scene.description}
                fill
                className="object-cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-600">
                <div className="text-center">
                  <div className="text-5xl mb-2">🎨</div>
                  <p className="text-xs">Scene {activeScene + 1}</p>
                </div>
              </div>
            )}

            {/* Scene number badge */}
            <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-xs text-white">
              {activeScene + 1} / {episode.scenes.length}
            </div>
          </div>

          {/* Caption */}
          <div className="px-4 py-3 border-t border-border bg-bg-secondary/50">
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
                  className={`w-2 h-2 rounded-full transition-all ${si === activeScene ? 'bg-accent-purple w-4' : 'bg-slate-600 hover:bg-slate-400'}`}
                />
              ))}
            </div>
            <button
              onClick={handleNext}
              disabled={isLast}
              className="px-4 py-2 rounded-lg bg-accent-purple hover:bg-accent-purple-light text-white text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
