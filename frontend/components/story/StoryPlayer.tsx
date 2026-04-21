'use client'
import { useState, useEffect, useRef } from 'react'
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

export default function StoryPlayer({ story }: Props) {
  const [activeEpisode, setActiveEpisode] = useState(-1) // -1 = overview mode
  const [activeScene, setActiveScene] = useState(0)
  const [sceneUrls, setSceneUrls] = useState<Record<string, string>>({})
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [showVideo, setShowVideo] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load scene image URLs
  useEffect(() => {
    const load = async () => {
      const updates: Record<string, string> = {}
      for (let ei = 0; ei < story.episodes.length; ei++) {
        const ep = story.episodes[ei]
        for (let si = 0; si < ep.scenes.length; si++) {
          const sc = ep.scenes[si]
          if (sc.asset_id) {
            const key = `${ei}-${si}`
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

  // Check for generated video
  useEffect(() => {
    const checkVideo = async () => {
      try {
        const assets = await api.listAssets()
        const video = assets.find(a => 
          a.type === 'animation' && 
          a.mime_type === 'video/mp4' &&
          (a.metadata as any)?.story_id === story.story_id
        )
        if (video) {
          setVideoUrl(video.presigned_url)
        }
      } catch {}
    }
    checkVideo()
  }, [story.story_id])

  const episode = activeEpisode >= 0 ? story.episodes[activeEpisode] : null
  const scene = episode?.scenes[activeScene]
  const totalScenes = story.episodes.reduce((s, e) => s + e.scenes.length, 0)

  const handleNext = () => {
    if (!episode) return
    if (activeScene < episode.scenes.length - 1) {
      setActiveScene(activeScene + 1)
    } else if (activeEpisode < story.episodes.length - 1) {
      setActiveEpisode(activeEpisode + 1)
      setActiveScene(0)
    }
  }

  const handlePrev = () => {
    if (!episode) return
    if (activeScene > 0) {
      setActiveScene(activeScene - 1)
    } else if (activeEpisode > 0) {
      const prevEp = story.episodes[activeEpisode - 1]
      setActiveEpisode(activeEpisode - 1)
      setActiveScene(prevEp.scenes.length - 1)
    }
  }

  // Overview / Story Hub mode
  if (activeEpisode === -1) {
    return (
      <div className="space-y-6 animate-fadeInUp">
        {/* Cinematic Story Header */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-bg-card via-bg-elevated to-bg-card border border-accent-purple/20">
          {/* Decorative glow */}
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-accent-purple/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-accent-cyan/10 rounded-full blur-3xl" />
          
          <div className="relative p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-accent-purple/20 text-accent-purple text-[10px] font-bold uppercase tracking-wider">Story Mode</span>
                  <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px] font-bold">{story.status}</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-black text-white leading-tight">{story.title}</h2>
                <p className="text-slate-400 text-sm sm:text-base leading-relaxed max-w-2xl">{story.synopsis}</p>
              </div>
            </div>

            {/* Stats bar */}
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-elevated/50 border border-border">
                <span className="text-accent-purple">📖</span>
                <span className="text-slate-300 font-medium">{story.episodes.length} Episodes</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-elevated/50 border border-border">
                <span className="text-accent-cyan">🎬</span>
                <span className="text-slate-300 font-medium">{totalScenes} Scenes</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-elevated/50 border border-border">
                <span className="text-accent-pink">👥</span>
                <span className="text-slate-300 font-medium">{story.characters.length} Characters</span>
              </div>
            </div>

            {/* Characters */}
            {story.characters.length > 0 && (
              <div className="mt-6">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Cast</h3>
                <div className="flex flex-wrap gap-3">
                  {story.characters.map((c) => (
                    <div key={c.name} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-elevated/60 border border-border hover:border-accent-purple/30 transition-colors group">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-purple to-accent-cyan flex items-center justify-center text-sm font-black text-white shadow-lg">
                        {c.name[0]}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white group-hover:text-accent-purple transition-colors">{c.name}</div>
                        <div className="text-[11px] text-slate-500">{c.role}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Watch Video Button */}
            {videoUrl && (
              <button
                onClick={() => setShowVideo(true)}
                className="mt-6 flex items-center gap-3 px-6 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-bold text-sm hover:scale-105 transition-transform shadow-lg shadow-purple-500/30"
              >
                <span className="text-xl">▶️</span>
                Watch Anime Video
              </button>
            )}
          </div>
        </div>

        {/* Video Player Modal */}
        {showVideo && videoUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <div className="w-full max-w-4xl">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-white font-bold text-lg">{story.title}</h3>
                <button onClick={() => setShowVideo(false)} className="text-slate-400 hover:text-white text-sm px-3 py-1 rounded-lg bg-bg-elevated border border-border">
                  ✕ Close
                </button>
              </div>
              <video
                src={videoUrl}
                controls
                autoPlay
                className="w-full rounded-2xl border border-accent-purple/30 shadow-2xl shadow-purple-900/50"
              />
            </div>
          </div>
        )}

        {/* Episode Grid — Game Level Select */}
        <div>
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span className="text-accent-cyan">📋</span> Episode Guide
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {story.episodes.map((ep, ei) => (
              <button
                key={ep.episode_number}
                onClick={() => { setActiveEpisode(ei); setActiveScene(0); }}
                className="group text-left relative overflow-hidden rounded-2xl bg-bg-card border border-border hover:border-accent-purple/50 transition-all hover:shadow-lg hover:shadow-purple-900/20 hover:-translate-y-1"
              >
                {/* Episode number accent */}
                <div className="absolute top-0 right-0 w-20 h-20 bg-accent-purple/5 rounded-bl-[80px]" />
                <div className="absolute top-3 right-4 text-3xl font-black text-accent-purple/20 group-hover:text-accent-purple/40 transition-colors">
                  {String(ep.episode_number).padStart(2, '0')}
                </div>
                
                <div className="p-5 relative">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold text-accent-cyan uppercase tracking-wider">Episode {ep.episode_number}</span>
                    <div className="flex gap-0.5">
                      {ep.scenes.map((s, si) => (
                        <div key={si} className={`w-1.5 h-1.5 rounded-full ${
                          s.status === 'complete' ? 'bg-green-500' : s.status === 'failed' ? 'bg-red-500' : 'bg-slate-600'
                        }`} />
                      ))}
                    </div>
                  </div>
                  <h4 className="text-sm font-bold text-white group-hover:text-accent-purple transition-colors mb-1">{ep.title}</h4>
                  <p className="text-xs text-slate-500 line-clamp-2">{ep.educational_concept}</p>
                  <div className="mt-3 flex items-center gap-1 text-[10px] text-slate-600">
                    <span>🎬 {ep.scenes.length} scenes</span>
                  </div>
                </div>

                {/* Bottom progress bar */}
                <div className="h-1 bg-bg-elevated">
                  <div
                    className="h-full bg-gradient-to-r from-accent-purple to-accent-cyan transition-all"
                    style={{ width: `${(ep.scenes.filter(s => s.status === 'complete').length / ep.scenes.length) * 100}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Episode/Scene viewer mode
  const currentSceneUrl = scene?.asset_id
    ? sceneUrls[`${activeEpisode}-${activeScene}`]
    : undefined

  const isFirst = activeEpisode === 0 && activeScene === 0
  const isLast = activeEpisode === story.episodes.length - 1 && activeScene === (episode?.scenes.length ?? 1) - 1

  return (
    <div className="space-y-4 animate-fadeInUp">
      {/* Back to overview */}
      <button
        onClick={() => { setActiveEpisode(-1); setActiveScene(0); }}
        className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
      >
        ← Back to Story Hub
      </button>

      {/* Episode Title Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-bg-card to-bg-elevated border border-accent-purple/20 p-5">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-accent-purple/5 rounded-full blur-2xl" />
        <div className="relative flex items-center justify-between">
          <div>
            <span className="text-xs text-accent-cyan font-bold uppercase tracking-wider">Episode {episode?.episode_number}</span>
            <h3 className="text-xl font-bold text-white mt-1">{episode?.title}</h3>
            <p className="text-xs text-slate-500 mt-1">{episode?.educational_concept}</p>
          </div>
          <div className="text-4xl font-black text-accent-purple/15">
            {String(episode?.episode_number ?? 0).padStart(2, '0')}
          </div>
        </div>
      </div>

      {/* Scene Viewer */}
      <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
        {/* Scene image / placeholder */}
        <div className="relative aspect-video bg-bg-elevated">
          {currentSceneUrl ? (
            <img
              src={currentSceneUrl}
              alt={scene?.description ?? ''}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center px-6">
                <div className="text-5xl mb-3 animate-pulse">🎨</div>
                <p className="text-sm text-slate-500">{scene?.description}</p>
              </div>
            </div>
          )}

          {/* Scene number badge */}
          <div className="absolute top-3 right-3 px-3 py-1.5 rounded-xl bg-black/70 backdrop-blur-sm text-xs text-white font-medium">
            Scene {activeScene + 1} / {episode?.scenes.length}
          </div>
        </div>

        {/* Caption */}
        <div className="px-5 py-4 border-t border-border bg-bg-elevated/30">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-purple to-accent-pink flex items-center justify-center text-sm shrink-0 mt-0.5">📝</div>
            <p className="text-slate-300 text-sm leading-relaxed">{scene?.caption}</p>
          </div>
        </div>

        {/* Navigation */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between">
          <button
            onClick={handlePrev}
            disabled={isFirst}
            className="px-5 py-2.5 rounded-xl bg-bg-elevated hover:bg-border text-slate-300 text-xs font-medium transition-colors disabled:opacity-30 border border-border"
          >
            ← Previous
          </button>

          {/* Scene dots */}
          <div className="flex gap-1.5">
            {episode?.scenes.map((_, si) => (
              <button
                key={si}
                onClick={() => setActiveScene(si)}
                className={`h-2.5 rounded-full transition-all ${
                  si === activeScene ? 'bg-accent-purple w-6 shadow-glow-purple' : 'bg-slate-600 hover:bg-slate-400 w-2.5'
                }`}
              />
            ))}
          </div>

          <button
            onClick={handleNext}
            disabled={isLast}
            className="px-5 py-2.5 rounded-xl bg-accent-purple hover:opacity-90 text-white text-xs font-bold transition-colors disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Scene thumbnails strip */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {episode?.scenes.map((s, si) => {
          const url = sceneUrls[`${activeEpisode}-${si}`]
          return (
            <button
              key={si}
              onClick={() => setActiveScene(si)}
              className={`shrink-0 w-24 h-16 rounded-xl overflow-hidden border-2 transition-all ${
                si === activeScene ? 'border-accent-purple shadow-glow-purple' : 'border-transparent hover:border-border'
              }`}
            >
              {url ? (
                <img src={url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-bg-elevated flex items-center justify-center text-xs text-slate-600">
                  {si + 1}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
