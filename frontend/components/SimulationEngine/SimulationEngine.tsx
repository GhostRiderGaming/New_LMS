'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useSimulationCache } from './useSimulationCache'
import { generateSimulation } from './nemotronService'
import SimulationGallery from './SimulationGallery'
import './SimulationEngine.css'

/**
 * SimulationEngine
 * ----------------
 * Main component for the Physics & Math Simulation Engine.
 *
 * Workflow:
 *   1. User enters a concept → clicks "Simulate"
 *   2. Check localStorage for cached simulation
 *   3. If cached  → render instantly with ⚡ badge
 *   4. If not     → call Nemotron API → render in sandboxed iframe → cache it
 */
export default function SimulationEngine() {
  const [concept, setConcept] = useState('')
  const [simulationCode, setSimulationCode] = useState<string | null>(null)
  const [activeConcept, setActiveConcept] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryKey, setGalleryKey] = useState(0) // Force gallery re-render on new cache writes

  const inputRef = useRef<HTMLInputElement>(null)
  const { getCached, setCached } = useSimulationCache()

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSimulate = useCallback(async (conceptOverride?: string) => {
    const target = conceptOverride ?? concept
    if (!target.trim()) return

    setError(null)
    setSimulationCode(null)
    setFromCache(false)
    setActiveConcept(target.trim())

    // 1. Check cache first
    const cached = getCached(target.trim())
    if (cached) {
      setSimulationCode(cached.code)
      setFromCache(true)
      return
    }

    // 2. No cache — generate via Nemotron
    setLoading(true)
    try {
      const html = await generateSimulation(target.trim())
      setSimulationCode(html)
      setFromCache(false)

      // 3. Cache the result
      setCached(target.trim(), html)
      setGalleryKey(prev => prev + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [concept, getCached, setCached])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleSimulate()
    }
  }

  const handleGallerySelect = (selectedConcept: string, code: string) => {
    setConcept(selectedConcept)
    setActiveConcept(selectedConcept)
    setSimulationCode(code)
    setFromCache(true)
    setError(null)
    setGalleryOpen(false)
  }

  const handleGalleryCleared = () => {
    setGalleryKey(prev => prev + 1)
  }

  // Quick-start suggestion chips
  const suggestions = [
    "Newton's First Law",
    "Pythagorean Theorem",
    "Simple Harmonic Motion",
    "Projectile Motion",
    "Wave Interference",
    "Ohm's Law Circuit",
  ]

  return (
    <div className="sim-engine">
      {/* Header */}
      <div className="sim-engine__header">
        <div className="sim-engine__title-row">
          <div className="sim-engine__icon">
            <span className="sim-engine__icon-emoji">⚡</span>
            <div className="sim-engine__icon-glow" />
          </div>
          <div>
            <h2 className="sim-engine__title">Simulation Engine</h2>
            <p className="sim-engine__subtitle">
              Type any physics or math concept to generate an interactive simulation
            </p>
          </div>
        </div>

        <button
          className="sim-engine__gallery-btn"
          onClick={() => setGalleryOpen(!galleryOpen)}
          title="View cached simulations"
        >
          <span className="sim-engine__gallery-btn-icon">📚</span>
          <span className="sim-engine__gallery-btn-label">Gallery</span>
        </button>
      </div>

      {/* Input Row */}
      <div className="sim-engine__input-row">
        <div className="sim-engine__input-wrapper">
          <input
            ref={inputRef}
            id="simulation-concept-input"
            type="text"
            className="sim-engine__input"
            placeholder={`Try "Newton's First Law" or "Pythagorean Theorem"...`}
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="sim-engine__input-glow" />
        </div>
        <button
          id="simulation-simulate-btn"
          className="sim-engine__simulate-btn"
          onClick={() => handleSimulate()}
          disabled={loading || !concept.trim()}
        >
          {loading ? (
            <>
              <span className="sim-engine__spinner" />
              Generating…
            </>
          ) : (
            <>
              <span className="sim-engine__btn-icon">🚀</span>
              Simulate
            </>
          )}
        </button>
      </div>

      {/* Suggestion Chips */}
      {!simulationCode && !loading && !error && (
        <div className="sim-engine__suggestions">
          {suggestions.map((s) => (
            <button
              key={s}
              className="sim-engine__chip"
              onClick={() => {
                setConcept(s)
                handleSimulate(s)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Cache Hit Badge */}
      {fromCache && simulationCode && (
        <div className="sim-engine__cache-badge">
          <span className="sim-engine__cache-badge-icon">⚡</span>
          <span>Loaded from cache</span>
          <span className="sim-engine__cache-badge-dot" />
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="sim-engine__loading">
          <div className="sim-engine__loading-orb">
            <div className="sim-engine__loading-ring" />
            <div className="sim-engine__loading-ring sim-engine__loading-ring--delay" />
            <span className="sim-engine__loading-icon">🧠</span>
          </div>
          <div className="sim-engine__loading-text">
            <p className="sim-engine__loading-title">Generating simulation…</p>
            <p className="sim-engine__loading-desc">
              AI is crafting an interactive visualization for <strong>{activeConcept}</strong>
            </p>
          </div>
          <div className="sim-engine__loading-bar">
            <div className="sim-engine__loading-bar-fill" />
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="sim-engine__error">
          <div className="sim-engine__error-icon">⚠️</div>
          <div className="sim-engine__error-content">
            <p className="sim-engine__error-title">Generation Failed</p>
            <p className="sim-engine__error-message">{error}</p>
          </div>
          <button
            className="sim-engine__error-retry"
            onClick={() => handleSimulate()}
          >
            ↻ Retry
          </button>
        </div>
      )}

      {/* Simulation Iframe */}
      {simulationCode && (
        <div className="sim-engine__viewport">
          <div className="sim-engine__viewport-toolbar">
            <div className="sim-engine__viewport-dots">
              <span className="sim-engine__dot sim-engine__dot--red" />
              <span className="sim-engine__dot sim-engine__dot--yellow" />
              <span className="sim-engine__dot sim-engine__dot--green" />
            </div>
            <span className="sim-engine__viewport-label">
              {activeConcept} — Interactive Simulation
            </span>
            <div className="sim-engine__viewport-actions">
              {fromCache && (
                <span className="sim-engine__viewport-cached">⚡ cached</span>
              )}
            </div>
          </div>
          <iframe
            id="simulation-iframe"
            srcDoc={simulationCode}
            sandbox="allow-scripts"
            title="Interactive Simulation"
            className="sim-engine__iframe"
          />
        </div>
      )}

      {/* Empty State */}
      {!simulationCode && !loading && !error && (
        <div className="sim-engine__empty">
          <div className="sim-engine__empty-graphic">
            <span className="sim-engine__empty-atom">⚛️</span>
            <div className="sim-engine__empty-orbit sim-engine__empty-orbit--1" />
            <div className="sim-engine__empty-orbit sim-engine__empty-orbit--2" />
            <div className="sim-engine__empty-orbit sim-engine__empty-orbit--3" />
          </div>
          <p className="sim-engine__empty-text">
            Enter a concept above to generate an interactive simulation
          </p>
          <p className="sim-engine__empty-hint">
            Works with physics laws, math theorems, geometry, waves, circuits & more
          </p>
        </div>
      )}

      {/* Gallery Sidebar */}
      {galleryOpen && (
        <SimulationGallery
          key={galleryKey}
          onSelect={handleGallerySelect}
          onClose={() => setGalleryOpen(false)}
          onCleared={handleGalleryCleared}
        />
      )}
    </div>
  )
}
