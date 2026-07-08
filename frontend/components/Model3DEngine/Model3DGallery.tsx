'use client'

import { useState, useEffect } from 'react'
import { useModel3DCache, type CachedModel3D } from './useModel3DCache'
import './Model3DEngine.css'

interface Props {
  onSelect: (entry: CachedModel3D) => void
  onClose: () => void
  onCleared?: () => void
}

const categoryIcons: Record<string, string> = {
  anatomy: '🫀',
  chemistry: '⚗️',
  astronomy: '🔭',
  historical: '🏺',
  mechanical: '⚙️',
}

/**
 * Model3DGallery
 * -----------------
 * Slide-over panel that displays all cached 3D models as clickable cards.
 * Reads directly from localStorage via the cache hook.
 */
export default function Model3DGallery({ onSelect, onClose, onCleared }: Props) {
  const { listAll, clearCache } = useModel3DCache()
  const [entries, setEntries] = useState<CachedModel3D[]>([])
  const [confirmClear, setConfirmClear] = useState(false)

  // Read from localStorage on mount
  useEffect(() => {
    setEntries(listAll())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    clearCache()
    setEntries([])
    setConfirmClear(false)
    onCleared?.()
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const getCategoryIcon = (category: string): string => {
    return categoryIcons[category] || '🧊'
  }

  return (
    <>
      {/* Backdrop */}
      <div className="sim-gallery__backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="sim-gallery">
        {/* Header */}
        <div className="sim-gallery__header">
          <div>
            <h3 className="sim-gallery__title">Holodeck Gallery</h3>
            <p className="sim-gallery__count">
              {entries.length} cached model{entries.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            className="sim-gallery__close"
            onClick={onClose}
            title="Close gallery"
          >
            ✕
          </button>
        </div>

        {/* Cards */}
        <div className="sim-gallery__list">
          {entries.length === 0 ? (
            <div className="sim-gallery__empty">
              <span className="sim-gallery__empty-icon">📭</span>
              <p className="sim-gallery__empty-text">No cached models yet</p>
              <p className="sim-gallery__empty-hint">
                Generate your first 3D model and it will appear here
              </p>
            </div>
          ) : (
            entries.map((entry, idx) => (
              <button
                key={`${entry.object_name}-${entry.createdAt}`}
                className="sim-gallery__card"
                onClick={() => onSelect(entry)}
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className="sim-gallery__card-icon">
                  {getCategoryIcon(entry.category)}
                </div>
                <div className="sim-gallery__card-info">
                  <span className="sim-gallery__card-name capitalize">{entry.object_name}</span>
                  <span className="sim-gallery__card-date">
                    {formatDate(entry.createdAt)}
                  </span>
                </div>
                <div className="sim-gallery__card-arrow">→</div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        {entries.length > 0 && (
          <div className="sim-gallery__footer">
            <button
              className={`sim-gallery__clear-btn ${confirmClear ? 'sim-gallery__clear-btn--confirm' : ''}`}
              onClick={handleClear}
            >
              {confirmClear ? '⚠ Confirm Clear All' : '🗑 Clear Cache'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
