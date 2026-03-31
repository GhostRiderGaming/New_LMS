'use client'
import { useState, useEffect, useCallback } from 'react'
import { api, AssetRecord } from '@/lib/api'
import ErrorCard from '@/components/shared/ErrorCard'

type FilterType = 'all' | 'image' | 'animation' | 'simulation' | 'model3d' | 'story'

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

function AssetCard({ asset, onDelete }: { asset: AssetRecord; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false)
  const isImage = asset.mime_type.startsWith('image/')
  const isVideo = asset.mime_type.startsWith('video/')
  const meta = asset.metadata as Record<string, string>

  const handleDelete = async () => {
    if (!confirm('Delete this asset? This cannot be undone.')) return
    setDeleting(true)
    try {
      await api.deleteAsset(asset.asset_id)
      onDelete(asset.asset_id)
    } catch {
      setDeleting(false)
    }
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = api.downloadAsset(asset.asset_id)
    a.download = `${asset.type}-${asset.asset_id.slice(0, 8)}`
    a.click()
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden group hover:border-accent-purple/40 transition-all">
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
          <video
            src={asset.presigned_url}
            className="w-full h-full object-cover"
            autoPlay
            loop
            muted
            playsInline
          />
        )}
        {!isImage && !isVideo && (
          <div className="text-4xl opacity-40">{TYPE_ICONS[asset.type] ?? '📄'}</div>
        )}
        {/* Type badge */}
        <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-md text-xs font-medium border ${TYPE_COLORS[asset.type] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20'}`}>
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
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-cyan/20 flex items-center justify-center text-xl">🗂️</div>
          <div>
            <h1 className="text-2xl font-bold text-white">Asset Gallery</h1>
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
              <AssetCard asset={asset} onDelete={handleDelete} />
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
