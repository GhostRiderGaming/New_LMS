'use client'
import { useState } from 'react'
import Image from 'next/image'

type AssetType = 'all' | 'anime' | 'simulation' | 'model3d' | 'story'

interface Asset {
  asset_id: string
  type: 'anime' | 'simulation' | 'model3d' | 'story'
  topic: string
  asset_url: string
  created_at: string
  file_size_bytes: number
}

const typeIcons: Record<string, string> = {
  anime: '🎨',
  simulation: '🔬',
  model3d: '🧊',
  story: '📖',
}

const typeColors: Record<string, string> = {
  anime: 'text-accent-purple bg-accent-purple/10',
  simulation: 'text-accent-cyan bg-accent-cyan/10',
  model3d: 'text-accent-pink bg-accent-pink/10',
  story: 'text-yellow-400 bg-yellow-400/10',
}

// Mock assets for UI preview
const mockAssets: Asset[] = [
  { asset_id: '1', type: 'anime', topic: 'Photosynthesis', asset_url: 'https://picsum.photos/seed/a1/400/400', created_at: new Date().toISOString(), file_size_bytes: 245000 },
  { asset_id: '2', type: 'simulation', topic: 'Newton\'s Laws', asset_url: 'https://picsum.photos/seed/a2/400/400', created_at: new Date().toISOString(), file_size_bytes: 18000 },
  { asset_id: '3', type: 'model3d', topic: 'Human Heart', asset_url: 'https://picsum.photos/seed/a3/400/400', created_at: new Date().toISOString(), file_size_bytes: 1200000 },
  { asset_id: '4', type: 'story', topic: 'World War II', asset_url: 'https://picsum.photos/seed/a4/400/400', created_at: new Date().toISOString(), file_size_bytes: 3400000 },
  { asset_id: '5', type: 'anime', topic: 'DNA Replication', asset_url: 'https://picsum.photos/seed/a5/400/400', created_at: new Date().toISOString(), file_size_bytes: 312000 },
  { asset_id: '6', type: 'simulation', topic: 'Pendulum Motion', asset_url: 'https://picsum.photos/seed/a6/400/400', created_at: new Date().toISOString(), file_size_bytes: 22000 },
]

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function GalleryPage() {
  const [filter, setFilter] = useState<AssetType>('all')
  const [assets] = useState<Asset[]>(mockAssets)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const filtered = filter === 'all' ? assets : assets.filter((a) => a.type === filter)

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    // Real impl: await api.deleteAsset(id)
    await new Promise((r) => setTimeout(r, 800))
    setDeletingId(null)
  }

  const handleDownloadAll = () => {
    // Real impl: call api.downloadAllZip()
    alert('Download all as ZIP — connect to backend /api/v1/assets/export')
  }

  const totalSize = assets.reduce((s, a) => s + a.file_size_bytes, 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-accent-cyan/20 flex items-center justify-center text-xl">🗂️</div>
            <div>
              <h1 className="text-2xl font-bold text-white">Asset Gallery</h1>
              <p className="text-slate-400 text-sm">All generated assets for this session</p>
            </div>
          </div>
          <div className="flex gap-4 text-xs text-slate-500 mt-2">
            <span>{assets.length} assets</span>
            <span>{formatBytes(totalSize)} total</span>
          </div>
        </div>
        <button
          onClick={handleDownloadAll}
          className="px-4 py-2 rounded-xl bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple-light text-sm font-medium transition-colors border border-accent-purple/30"
        >
          ↓ Download All ZIP
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(['all', 'anime', 'simulation', 'model3d', 'story'] as AssetType[]).map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium transition-all capitalize ${
              filter === t
                ? 'bg-accent-purple text-white shadow-glow-purple'
                : 'bg-bg-card text-slate-400 hover:text-white border border-border'
            }`}
          >
            {t !== 'all' && typeIcons[t]} {t === 'model3d' ? '3D Model' : t}
            <span className="ml-1 px-1.5 py-0.5 rounded bg-white/10 text-xs">
              {t === 'all' ? assets.length : assets.filter((a) => a.type === t).length}
            </span>
          </button>
        ))}
      </div>

      {/* Masonry grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {filtered.map((asset) => (
            <div key={asset.asset_id} className="bg-bg-card border border-border rounded-2xl overflow-hidden card-hover group">
              {/* Thumbnail */}
              <div className="relative aspect-square bg-bg-elevated overflow-hidden">
                <Image
                  src={asset.asset_url}
                  alt={asset.topic}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {/* Type badge */}
                <div className="absolute top-2 left-2">
                  <span className={`px-2 py-1 rounded-lg text-xs font-medium capitalize ${typeColors[asset.type]}`}>
                    {typeIcons[asset.type]} {asset.type === 'model3d' ? '3D' : asset.type}
                  </span>
                </div>
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <a
                    href={asset.asset_url}
                    download
                    className="px-3 py-1.5 rounded-lg bg-accent-purple text-white text-xs font-medium"
                  >
                    ↓ Download
                  </a>
                  <button
                    onClick={() => handleDelete(asset.asset_id)}
                    disabled={deletingId === asset.asset_id}
                    className="px-3 py-1.5 rounded-lg bg-red-500/80 text-white text-xs font-medium disabled:opacity-50"
                  >
                    {deletingId === asset.asset_id ? '...' : '🗑️'}
                  </button>
                </div>
              </div>
              {/* Info */}
              <div className="p-3">
                <p className="text-sm font-medium text-white truncate">{asset.topic}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-slate-500">{formatBytes(asset.file_size_bytes)}</span>
                  <span className="text-xs text-slate-600">{new Date(asset.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">🗂️</div>
          <p className="text-sm">No {filter === 'all' ? '' : filter} assets yet</p>
          <p className="text-xs mt-2 text-slate-700">Generate content from any page to see it here</p>
        </div>
      )}
    </div>
  )
}
