'use client'

import { useState, useEffect } from 'react'
import { useSimulationCache, type CachedSimulation } from './useSimulationCache'

interface Props {
  onSelect: (concept: string, code: string) => void
  onClose: () => void
  onCleared?: () => void
}

/**
 * SimulationGallery
 * -----------------
 * Slide-over panel that displays all cached simulations as clickable cards.
 * Reads directly from localStorage via the cache hook.
 */
export default function SimulationGallery({ onSelect, onClose, onCleared }: Props) {
  const { listAll, clearCache } = useSimulationCache()
  const [entries, setEntries] = useState<CachedSimulation[]>([])
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

  const getCategoryIcon = (concept: string): string => {
    const c = concept.toLowerCase()
    if (c.includes('newton') || c.includes('force') || c.includes('motion') || c.includes('gravity'))
      return '⚛️'
    if (c.includes('wave') || c.includes('harmonic') || c.includes('oscillat'))
      return '🌊'
    if (c.includes('circuit') || c.includes('ohm') || c.includes('voltage') || c.includes('electric'))
      return '⚡'
    if (c.includes('theorem') || c.includes('pythagor') || c.includes('geometry') || c.includes('triangle'))
      return '📐'
    if (c.includes('projectile') || c.includes('trajectory') || c.includes('parabola'))
      return '🎯'
    if (c.includes('pendulum') || c.includes('spring'))
      return '🔄'
    if (c.includes('light') || c.includes('optic') || c.includes('refract') || c.includes('reflect'))
      return '🔦'
    return '🔬'
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
            <h3 className="sim-gallery__title">Simulation Gallery</h3>
            <p className="sim-gallery__count">
              {entries.length} cached simulation{entries.length !== 1 ? 's' : ''}
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
              <p className="sim-gallery__empty-text">No cached simulations yet</p>
              <p className="sim-gallery__empty-hint">
                Generate your first simulation and it will appear here
              </p>
            </div>
          ) : (
            entries.map((entry, idx) => (
              <button
                key={`${entry.concept}-${entry.createdAt}`}
                className="sim-gallery__card"
                onClick={() => onSelect(entry.concept, entry.code)}
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className="sim-gallery__card-icon">
                  {getCategoryIcon(entry.concept)}
                </div>
                <div className="sim-gallery__card-info">
                  <span className="sim-gallery__card-name">{entry.concept}</span>
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
