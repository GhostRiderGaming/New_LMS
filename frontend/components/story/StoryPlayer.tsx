'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import type { StoryPlan, EpisodePlan, ScenePlan, CharacterPlan } from '@/app/story/page'

interface Props {
  story: StoryPlan
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Resolve a scene's image URL from its asset_id
async function resolveSceneUrl(asset_id: string): Promise<string | null> {
  try {
    const asset = await api.getAsset(asset_id)
    // For external (Wikimedia) assets, presigned_url is the external URL itself
    // For local assets, it's the presigned S3/local URL
    const url = asset.presigned_url ?? null
    if (!url) return null
    // Prefer external_url from metadata if present (more stable for Wikimedia)
    const meta = asset.metadata as Record<string, unknown>
    if (meta?.source === 'external' && meta?.external_url) {
      return meta.external_url as string
    }
    return url
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Image component with loading skeleton + error fallback (Bug 4)
// ---------------------------------------------------------------------------

function SafeImage({
  src,
  alt,
  className = '',
  fallbackIcon = '🎨',
  fallbackText = 'Image unavailable',
  badge,
  objectFit = 'object-cover',
}: {
  src: string | undefined | null
  alt: string
  className?: string
  fallbackIcon?: string
  fallbackText?: string
  badge?: string
  objectFit?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  // For Wikimedia images that fail with no-referrer, try proxying through the backend
  const [proxied, setProxied] = useState(false)

  // Reset states when src changes
  useEffect(() => {
    setLoaded(false)
    setError(false)
    setProxied(false)
  }, [src])

  // Determine effective src — if first load failed and it's a Wikimedia URL, proxy it
  const isWikimedia = src?.includes('wikimedia.org') || src?.includes('wikipedia.org')
  const effectiveSrc = error && isWikimedia && !proxied
    ? undefined // will trigger proxy retry below
    : src

  const handleError = () => {
    if (isWikimedia && !proxied) {
      // Retry via backend proxy to sidestep Wikimedia hotlink protection
      setProxied(true)
      setError(false)
      setLoaded(false)
    } else {
      setError(true)
    }
  }

  // Proxied Wikimedia src: route through backend download endpoint isn't available for external URLs,
  // so use a public CORS proxy as fallback
  const finalSrc = proxied && src
    ? `https://images.weserv.nl/?url=${encodeURIComponent(src)}&output=jpg&w=800`
    : src

  if (!finalSrc || error) {
    return (
      <div className={`flex items-center justify-center bg-bg-elevated ${className}`}>
        <div className="text-center px-4">
          <div className="text-4xl mb-2">{fallbackIcon}</div>
          <p className="text-xs text-slate-500">{fallbackText}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative bg-bg-elevated ${className}`}>
      {/* Loading skeleton */}
      {!loaded && (
        <div className="absolute inset-0 bg-bg-elevated animate-pulse flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-2 border-accent-purple/30 border-t-accent-purple animate-spin" />
        </div>
      )}
      <img
        src={finalSrc}
        alt={alt}
        className={`w-full h-full ${objectFit} transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        referrerPolicy="strict-origin-when-cross-origin"
        crossOrigin="anonymous"
        onLoad={() => setLoaded(true)}
        onError={handleError}
      />
      {/* Source badge */}
      {badge && loaded && (
        <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] text-white font-medium">
          {badge}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Portrait component with server-side resolution (Bug 3)
// ---------------------------------------------------------------------------

function CharacterPortrait({
  character,
  topic,
  className = '',
}: {
  character: CharacterPlan
  topic: string
  className?: string
}) {
  const [portrait, setPortrait] = useState<{
    url: string | null
    source: string
    label: string
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        // Fix: pass story topic as topicSummary (3rd arg), not character description.
        // character.description is long prose — it pollutes the Wikimedia search context.
        const result = await api.getCharacterPortrait(character.name, topic, topic)
        if (!cancelled) setPortrait(result)
      } catch {
        if (!cancelled) setPortrait(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [character.name, topic, character.description])

  // Restricted figure — respectful non-figurative representation
  if (portrait?.source === 'restricted') {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-bg-elevated to-bg-card ${className}`}>
        <div className="text-center px-6">
          <div className="text-5xl mb-3">☪️</div>
          <p className="text-xs text-slate-400 font-medium">{portrait.label}</p>
          <p className="text-[10px] text-slate-500 mt-1">Figurative depiction not shown<br />out of respect</p>
        </div>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div className={`flex items-center justify-center bg-bg-elevated animate-pulse ${className}`}>
        <div className="w-8 h-8 rounded-full border-2 border-accent-purple/30 border-t-accent-purple animate-spin" />
      </div>
    )
  }

  return (
    <SafeImage
      src={portrait?.url}
      alt={character.name}
      className={className}
      fallbackIcon="👤"
      fallbackText={`Portrait of ${character.name}`}
      badge={portrait?.label}
    />
  )
}


// ---------------------------------------------------------------------------
// Main StoryPlayer
// ---------------------------------------------------------------------------

export default function StoryPlayer({ story }: Props) {
  const [activeEpisode, setActiveEpisode] = useState(-1) // -1 = overview mode
  const [activeScene, setActiveScene] = useState(0)
  const [sceneUrls, setSceneUrls] = useState<Record<string, string>>({})
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [showVideo, setShowVideo] = useState(false)
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterPlan | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load scene image URLs
  // Bug 6 Round 2: Two-phase resolution — first try asset_id from plan,
  // then fall back to looking up scene images by story metadata from the asset list.
  useEffect(() => {
    const load = async () => {
      const updates: Record<string, string> = {}
      const missingScenes: { ei: number; si: number; ep_num: number; sc_num: number }[] = []

      // Phase 1: resolve via asset_id (works when backend wrote it back)
      for (let ei = 0; ei < story.episodes.length; ei++) {
        const ep = story.episodes[ei]
        for (let si = 0; si < ep.scenes.length; si++) {
          const sc = ep.scenes[si]
          const key = `${ei}-${si}`
          if (sceneUrls[key]) continue // already resolved
          if (sc.asset_id) {
            const url = await resolveSceneUrl(sc.asset_id)
            if (url) {
              updates[key] = url
              continue
            }
          }
          // No asset_id or resolution failed — track for fallback
          missingScenes.push({ ei, si, ep_num: ep.episode_number, sc_num: sc.scene_number })
        }
      }

      // Phase 2: fallback — query asset list by story metadata
      if (missingScenes.length > 0) {
        try {
          const allAssets = await api.listAssets()
          const storyImageAssets = allAssets.filter(
            (a) =>
              a.type === 'image' &&
              (a.metadata as Record<string, unknown>)?.story_id === story.story_id
          )

          for (const missing of missingScenes) {
            const key = `${missing.ei}-${missing.si}`
            if (updates[key]) continue // already resolved in phase 1

            const match = storyImageAssets.find((a) => {
              const meta = a.metadata as Record<string, unknown>
              return (
                meta?.episode_number === missing.ep_num &&
                meta?.scene_number === missing.sc_num
              )
            })
            if (match) {
              // For external (Wikimedia) images, use the external_url directly
              const meta = match.metadata as Record<string, unknown>
              if (meta?.source === 'external' && meta?.external_url) {
                updates[key] = meta.external_url as string
              } else {
                updates[key] = match.presigned_url
              }
            }
          }
        } catch (err) {
          console.warn('[StoryPlayer] Fallback asset lookup failed:', err)
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

  // Bug 7 fix: Use functional state updates to avoid stale closures
  const handleNext = useCallback(() => {
    setActiveEpisode(prevEp => {
      if (prevEp < 0) return prevEp
      const currentEpisode = story.episodes[prevEp]
      if (!currentEpisode) return prevEp

      setActiveScene(prevScene => {
        if (prevScene < currentEpisode.scenes.length - 1) {
          return prevScene + 1
        } else if (prevEp < story.episodes.length - 1) {
          // Move to next episode — setActiveEpisode runs below
          setTimeout(() => {
            setActiveEpisode(prevEp + 1)
            setActiveScene(0)
          }, 0)
          return prevScene
        }
        return prevScene
      })
      return prevEp
    })
  }, [story.episodes])

  const handlePrev = useCallback(() => {
    setActiveEpisode(prevEp => {
      if (prevEp < 0) return prevEp

      setActiveScene(prevScene => {
        if (prevScene > 0) {
          return prevScene - 1
        } else if (prevEp > 0) {
          const prevEpisode = story.episodes[prevEp - 1]
          setTimeout(() => {
            setActiveEpisode(prevEp - 1)
            setActiveScene(prevEpisode.scenes.length - 1)
          }, 0)
          return prevScene
        }
        return prevScene
      })
      return prevEp
    })
  }, [story.episodes])

  // Overview / Story Hub mode
  if (activeEpisode === -1) {
    return (
      <div className="space-y-6 animate-fadeInUp">
        {/* Cinematic Story Header */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-bg-card via-bg-elevated to-bg-card border border-accent-purple/20">
          {/* Decorative glow — pointer-events-none to prevent click interception (Bug 7) */}
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-accent-purple/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-accent-cyan/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative p-4 sm:p-8">
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
                    <button key={c.name} onClick={() => setSelectedCharacter(c)} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-elevated/60 border border-border hover:border-accent-purple/30 transition-colors group text-left">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-purple to-accent-cyan flex items-center justify-center text-sm font-black text-white shadow-lg shrink-0">
                        {c.name[0]}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white group-hover:text-accent-purple transition-colors">{c.name}</div>
                        <div className="text-[11px] text-slate-500">{c.role}</div>
                      </div>
                    </button>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md" onClick={() => setShowVideo(false)}>
            <div className="w-full max-w-4xl" onClick={e => e.stopPropagation()}>
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

        {/* Character Details Modal (Bug 3 — server-side portrait) */}
        {selectedCharacter && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setSelectedCharacter(null)}>
            <div className="w-full max-w-md bg-bg-card border border-border rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="relative aspect-square">
                <CharacterPortrait
                  character={selectedCharacter}
                  topic={story.topic}
                  className="w-full h-full"
                />
                <button onClick={() => setSelectedCharacter(null)} className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/80 transition-colors z-10">
                  ✕
                </button>
              </div>
              <div className="p-6">
                <div className="text-xs text-accent-purple font-bold uppercase tracking-wider mb-1">{selectedCharacter.role}</div>
                <h3 className="text-2xl font-black text-white mb-3">{selectedCharacter.name}</h3>
                {/* Bug 2 fix: no height constraint — allow full description to show */}
                <p className="text-slate-300 text-sm leading-relaxed">{selectedCharacter.description}</p>
                {selectedCharacter.justification && (
                  <p className="text-slate-500 text-xs mt-3 italic border-t border-border pt-3">
                    <span className="text-accent-cyan font-semibold not-italic">Why in this story: </span>
                    {selectedCharacter.justification}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Episode Grid — with thumbnails (Bug 6 fix) */}
        <div>
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <span className="text-accent-cyan">📋</span> Episode Guide
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {story.episodes.map((ep, ei) => {
              // Bug 6 fix: use first scene's image as episode thumbnail
              const thumbnailUrl = sceneUrls[`${ei}-0`]
              return (
                <button
                  key={ep.episode_number}
                  onClick={() => { setActiveEpisode(ei); setActiveScene(0); }}
                  className="group text-left relative overflow-hidden rounded-2xl bg-bg-card border border-border hover:border-accent-purple/50 transition-all hover:shadow-lg hover:shadow-purple-900/20 hover:-translate-y-1"
                >
                  {/* Episode thumbnail (Bug 6) */}
                  <div className="relative aspect-video bg-bg-elevated overflow-hidden">
                    <SafeImage
                      src={thumbnailUrl}
                      alt={ep.title}
                      className="w-full h-full"
                      fallbackIcon="🎬"
                      fallbackText={`Episode ${ep.episode_number}`}
                    />
                    {/* Episode number overlay */}
                    <div className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-xs text-white font-bold">
                      EP {String(ep.episode_number).padStart(2, '0')}
                    </div>
                  </div>

                  <div className="p-4 relative">
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
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Episode/Scene viewer mode
  const currentSceneUrl = sceneUrls[`${activeEpisode}-${activeScene}`]

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
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-accent-purple/5 rounded-full blur-2xl pointer-events-none" />
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
          <div>
            <span className="text-xs text-accent-cyan font-bold uppercase tracking-wider">Episode {episode?.episode_number}</span>
            <h3 className="text-xl font-bold text-white mt-1">{episode?.title}</h3>
            <p className="text-xs text-slate-500 mt-1">{episode?.educational_concept}</p>
          </div>
          <div className="text-4xl font-black text-accent-purple/15 pointer-events-none">
            {String(episode?.episode_number ?? 0).padStart(2, '0')}
          </div>
        </div>
      </div>

      {/* Scene Viewer */}
      <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
        {/* Scene image / placeholder (Bug 4 — SafeImage with fallback) */}
        <div className="relative aspect-video">
          <SafeImage
            src={currentSceneUrl}
            alt={scene?.description ?? ''}
            className="w-full h-full"
            fallbackIcon="🎨"
            fallbackText={scene?.description ?? 'Scene loading...'}
            objectFit="object-contain"
          />

          {/* Scene number badge */}
          <div className="absolute top-3 right-3 px-3 py-1.5 rounded-xl bg-black/70 backdrop-blur-sm text-xs text-white font-medium z-10">
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

        {/* Navigation — Bug 7: relative + z-10 ensures it stays above any overlays */}
        <div className="px-4 sm:px-5 py-4 border-t border-border flex flex-wrap sm:flex-nowrap items-center justify-center sm:justify-between gap-4 sm:gap-0 relative z-10">
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

      {/* Scene thumbnails strip (Bug 4 — SafeImage with fallback) */}
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
              <SafeImage
                src={url}
                alt={`Scene ${si + 1}`}
                className="w-full h-full"
                fallbackIcon=""
                fallbackText={`${si + 1}`}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
