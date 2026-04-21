'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, AssetRecord } from '@/lib/api'
import ErrorCard from '@/components/shared/ErrorCard'

// Video preview modal
function VideoPreviewModal({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
      <div className="w-full max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-white font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg bg-bg-elevated border border-border">
            ✕ Close
          </button>
        </div>
        <video
          src={url}
          controls
          autoPlay
          className="w-full rounded-2xl border border-accent-purple/30 shadow-2xl"
        />
        <div className="flex justify-end mt-3">
          <a href={url} download className="px-4 py-2 rounded-xl bg-accent-purple/20 text-accent-purple text-xs font-medium border border-accent-purple/30 hover:bg-accent-purple/30">
            ↓ Download Video
          </a>
        </div>
      </div>
    </div>
  )
}

// Simulation preview modal
function SimulationPreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    fetch(url).then(r => r.text()).then(setHtml).catch(console.error)
  }, [url])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
      <div className="w-full max-w-5xl h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-white font-bold text-lg">Interactive Simulation</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm px-3 py-1.5 rounded-lg bg-bg-elevated border border-border">
            ✕ Close
          </button>
        </div>
        {html ? (
          <iframe
            srcDoc={html}
            className="flex-1 w-full rounded-2xl border border-cyan-500/30 shadow-2xl bg-white"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-accent-purple animate-pulse">Loading simulation...</div>
        )}
      </div>
    </div>
  )
}

type FilterType = 'all' | 'image' | 'animation' | 'simulation' | 'model3d' | 'story'

function StoryPreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    fetch(url).then(r => r.json()).then(setData).catch(console.error)
  }, [url])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="bg-bg-elevated border border-border rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-2xl relative animate-fadeInUp p-6">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white pb-2 pl-2">
          ✕ Close
        </button>
        {!data ? (
          <div className="animate-pulse text-accent-purple text-center py-20">Loading Board...</div>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-black text-white">{data.title}</h2>
              <p className="text-slate-400 mt-2">{data.synopsis}</p>
            </div>
            {data.characters && data.characters.length > 0 && (
              <div>
                <h3 className="text-xl font-bold text-accent-cyan border-b border-white/10 pb-2 mb-3">Characters</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data.characters.map((c: any, i: number) => (
                    <div key={i} className="p-3 bg-bg-card rounded-lg border border-border">
                       <strong className="text-white block">{c.name}</strong>
                       <span className="text-xs text-accent-cyan uppercase">{c.role}</span>
                       <p className="text-sm text-slate-400 mt-1">{c.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.episodes && (
              <div>
                <h3 className="text-xl font-bold text-accent-pink border-b border-white/10 pb-2 mb-3">Episodes</h3>
                <div className="space-y-4">
                  {data.episodes.map((ep: any, i: number) => (
                    <div key={i} className="p-4 bg-bg-card rounded-xl border border-border">
                       <h4 className="text-lg font-bold text-white">Ep {ep.episode_number}: {ep.title}</h4>
                       <span className="text-xs bg-accent-pink/20 text-accent-pink px-2 py-1 rounded inline-block mb-3">{ep.educational_concept}</span>
                       <div className="space-y-2">
                         {ep.scenes?.map((s: any, si: number) => (
                            <div key={si} className="pl-4 border-l-2 border-accent-purple/30">
                               <p className="text-sm text-slate-300 font-medium">Scene {s.scene_number}</p>
                               <p className="text-xs text-slate-500 italic">{s.description}</p>
                            </div>
                         ))}
                       </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const FILTERS: { value: FilterType; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: '🗂️' },
  { value: 'image', label: 'Anime', icon: '🎨' },
  { value: 'animation', label: 'Animation', icon: '🎬' },
  { value: 'simulation', label: 'Simulation', icon: '⚗️' },
  { value: 'model3d', label: '3D Model', icon: '🧊' },
  { value: 'story', label: 'Story', icon: '📖' },
]

const TYPE_COLORS: Record<string, string> = {
  image: 'text-accent-purple bg-accent-purple/10 border-accent-purple/20',
  animation: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20',
  simulation: 'text-green-400 bg-green-400/10 border-green-400/20',
  model3d: 'text-accent-pink bg-accent-pink/10 border-accent-pink/20',
  story: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
}

const TYPE_ICONS: Record<string, string> = {
  image: '🎨', animation: '🎬', simulation: '⚗️', model3d: '🧊', story: '📖',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function AssetCard({ asset, onDelete, onPreviewStory, onPreviewVideo, onPreviewSimulation }: { 
  asset: AssetRecord; 
  onDelete: (id: string) => void; 
  onPreviewStory?: (url: string) => void;
  onPreviewVideo?: (url: string, title: string) => void;
  onPreviewSimulation?: (url: string) => void;
}) {
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const isImage = asset.mime_type.startsWith('image/')
  const isVideo = asset.mime_type.startsWith('video/')
  const meta = asset.metadata as Record<string, string>

  const handleDelete = async () => {
    if (!confirm('Delete this asset? This cannot be undone.')) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await api.deleteAsset(asset.asset_id)
      onDelete(asset.asset_id)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete asset.')
      setDeleting(false)
    }
  }

  const handleDownload = async () => {
    try {
      const res = await fetch(asset.presigned_url);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Determine file extension
      let ext = 'bin';
      if (asset.mime_type === 'application/zip') ext = 'zip';
      else if (asset.mime_type === 'text/html') ext = 'html';
      else if (asset.mime_type === 'model/gltf-binary') ext = 'glb';
      else if (asset.mime_type.startsWith('image/')) ext = asset.mime_type.split('/')[1];
      else if (asset.mime_type.startsWith('video/')) ext = 'mp4';
      
      a.download = `${asset.type}_${asset.asset_id.slice(0, 8)}.${ext}`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      // Fallback
      window.open(asset.presigned_url, '_blank');
    }
  }

  return (
    <div className="card-game overflow-hidden group">
      {/* Preview */}
      <div className="relative aspect-video bg-bg-elevated flex items-center justify-center overflow-hidden">
        {isImage && (
          <img
            src={asset.presigned_url}
            alt={asset.topic}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
        {isVideo && (
          <div className="relative w-full h-full cursor-pointer" onClick={() => onPreviewVideo?.(asset.presigned_url, asset.topic)}>
            <video
              src={asset.presigned_url}
              className="w-full h-full object-cover"
              autoPlay
              loop
              muted
              playsInline
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity">
              <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <span className="text-white text-xl ml-1">▶</span>
              </div>
            </div>
          </div>
        )}
        {!isImage && !isVideo && (
          <>
              <div className="text-4xl opacity-40">{TYPE_ICONS[asset.type] ?? '📄'}</div>
              <div className="absolute inset-0 bg-black/50 backdrop-blur-sm opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity z-20">
                  {asset.type === 'story' && onPreviewStory ? (
                      <button onClick={() => onPreviewStory(asset.presigned_url)} className="px-4 py-2 bg-gradient-anime text-white text-sm font-semibold rounded-lg shadow-glow-purple">
                          Preview Storyboard
                      </button>
                  ) : asset.type === 'simulation' && onPreviewSimulation ? (
                      <button onClick={() => onPreviewSimulation(asset.presigned_url)} className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-green-500 text-white text-sm font-semibold rounded-lg">
                          ▶ Run Simulation
                      </button>
                  ) : (
                      <a href={asset.presigned_url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-gradient-anime text-white text-sm font-semibold rounded-lg shadow-glow-purple">
                          Preview {asset.type}
                      </a>
                  )}
              </div>
          </>
        )}
        {/* Type badge */}
        <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-md text-xs font-medium border z-30 ${TYPE_COLORS[asset.type] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20'}`}>
          {TYPE_ICONS[asset.type]} {asset.type}
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-white text-sm font-medium truncate mb-0.5">{asset.topic}</p>
        {meta?.caption && (
          <p className="text-slate-500 text-xs line-clamp-2 mb-2">{meta.caption}</p>
        )}
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>{formatBytes(asset.file_size_bytes)}</span>
          <span>{new Date(asset.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Delete error */}
      {deleteError && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 bg-red-950/30 border border-red-500/30 rounded-lg px-3 py-2">
            <span className="text-red-400 text-xs flex-1">{deleteError}</span>
            <button
              onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-300 font-medium shrink-0"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Actions — visible on hover */}
      <div className="px-3 pb-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleDownload}
          className="flex-1 py-1.5 rounded-lg bg-bg-elevated hover:bg-accent-purple/20 text-slate-400 hover:text-white text-xs font-medium transition-all border border-border"
        >
          ↓ Download
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-3 py-1.5 rounded-lg bg-bg-elevated hover:bg-red-500/20 text-slate-500 hover:text-red-400 text-xs transition-all border border-border disabled:opacity-40"
        >
          {deleting ? '...' : '🗑'}
        </button>
      </div>
    </div>
  )
}

export default function GalleryPage() {
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [previewStoryUrl, setPreviewStoryUrl] = useState<string | null>(null)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)
  const [previewVideoTitle, setPreviewVideoTitle] = useState('')
  const [previewSimUrl, setPreviewSimUrl] = useState<string | null>(null)

  const fetchAssets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listAssets()
      setAssets(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assets.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAssets() }, [fetchAssets])

  const handleDelete = (id: string) => setAssets((prev) => prev.filter((a) => a.asset_id !== id))

  const handleDownloadAll = async () => {
    setDownloading(true)
    try {
      const typeParam = filter !== 'all' ? `?type=${filter}` : ''
      const url = `${api.exportAllZip()}${typeParam}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'anime-assets.zip'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.')
    } finally {
      setDownloading(false)
    }
  }

  const filtered = filter === 'all' ? assets : assets.filter((a) => a.type === filter)

  const counts = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {previewStoryUrl && (
        <StoryPreviewModal url={previewStoryUrl} onClose={() => setPreviewStoryUrl(null)} />
      )}
      {previewVideoUrl && (
        <VideoPreviewModal url={previewVideoUrl} title={previewVideoTitle} onClose={() => setPreviewVideoUrl(null)} />
      )}
      {previewSimUrl && (
        <SimulationPreviewModal url={previewSimUrl} onClose={() => setPreviewSimUrl(null)} />
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-8 animate-fadeInUp">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-accent-cyan/20 flex items-center justify-center text-2xl border border-accent-cyan/20">🗂️</div>
          <div>
            <h1 className="text-2xl font-black text-white">Archive</h1>
            <p className="text-slate-400 text-sm">{assets.length} asset{assets.length !== 1 ? 's' : ''} in your session</p>
          </div>
        </div>
        {assets.length > 0 && (
          <button
            onClick={handleDownloadAll}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-anime text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all shadow-glow-purple"
          >
            {downloading ? (
              <>
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Zipping...
              </>
            ) : (
              <>↓ Download All as ZIP</>
            )}
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map(({ value, label, icon }) => {
          const count = value === 'all' ? assets.length : (counts[value] ?? 0)
          return (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === value
                  ? 'bg-accent-purple text-white shadow-glow-purple'
                  : 'bg-bg-elevated text-slate-400 hover:text-white border border-border'
              }`}
            >
              {icon} {label}
              {count > 0 && (
                <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs ${filter === value ? 'bg-white/20' : 'bg-bg-card'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6">
          <ErrorCard message={error} onRetry={fetchAssets} />
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl overflow-hidden animate-pulse">
              <div className="aspect-video bg-bg-elevated" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-bg-elevated rounded w-3/4" />
                <div className="h-2 bg-bg-elevated rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Masonry grid */}
      {!loading && filtered.length > 0 && (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
          {filtered.map((asset) => (
            <div key={asset.asset_id} className="break-inside-avoid">
              <AssetCard 
                asset={asset} 
                onDelete={handleDelete} 
                onPreviewStory={setPreviewStoryUrl}
                onPreviewVideo={(url, title) => { setPreviewVideoUrl(url); setPreviewVideoTitle(title); }}
                onPreviewSimulation={setPreviewSimUrl}
              />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && !error && (
        <div className="text-center py-24 text-slate-600">
          <div className="text-5xl mb-4">🗂️</div>
          <p className="text-sm">
            {filter === 'all'
              ? 'No assets yet — generate some content to see it here'
              : `No ${filter} assets yet`}
          </p>
          {filter !== 'all' && (
            <button
              onClick={() => setFilter('all')}
              className="mt-3 text-xs text-accent-purple hover:underline"
            >
              Show all assets
            </button>
          )}
        </div>
      )}
    </div>
  )
}
