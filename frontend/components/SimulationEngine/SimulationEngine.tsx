'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useSimulationCache } from './useSimulationCache'
import { generateSimulation } from './nemotronService'
import SimulationGallery from './SimulationGallery'
import SimShell from './SimShell'
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

/** Derive a category icon from concept text */
function getConceptIcon(concept: string): string {
  const c = concept.toLowerCase()
  if (c.includes('newton') || c.includes('force') || c.includes('motion') || c.includes('gravity'))
    return '⚛️'
  if (c.includes('wave') || c.includes('harmonic') || c.includes('oscillat') || c.includes('sound'))
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
  if (c.includes('magnet') || c.includes('field'))
    return '🧲'
  if (c.includes('thermo') || c.includes('heat') || c.includes('temperature'))
    return '🌡️'
  return '🔬'
}

export default function SimulationEngine() {
  const [concept, setConcept] = useState('')
  const [simulationCode, setSimulationCode] = useState<string | null>(null)
  const [activeConcept, setActiveConcept] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryKey, setGalleryKey] = useState(0)

  const [fullscreen, setFullscreen] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [iframeError, setIframeError] = useState(false)
  const [loadingPhase, setLoadingPhase] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const { getCached, setCached } = useSimulationCache()

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Escape key exits fullscreen
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreen) setFullscreen(false)
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [fullscreen])

  // Cycle loading phase messages
  useEffect(() => {
    if (!loading) { setLoadingPhase(0); return }
    const interval = setInterval(() => {
      setLoadingPhase(prev => (prev + 1) % 5)
    }, 3000)
    return () => clearInterval(interval)
  }, [loading])

  const handleSimulate = useCallback(async (conceptOverride?: string) => {
    const target = conceptOverride ?? concept
    if (!target.trim()) return

    setError(null)
    setSimulationCode(null)
    setFromCache(false)
    setActiveConcept(target.trim())
    setFullscreen(false)

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



  const handleRegenerate = () => {
    if (activeConcept) {
      // Clear from cache so it regenerates fresh
      setFromCache(false)
      setSimulationCode(null)
      setLoading(true)
      setError(null)

      generateSimulation(activeConcept).then(html => {
        setSimulationCode(html)
        setCached(activeConcept, html)
        setGalleryKey(prev => prev + 1)
      }).catch(err => {
        setError(err instanceof Error ? err.message : 'Regeneration failed. Please try again.')
      }).finally(() => {
        setLoading(false)
      })
    }
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
            <div className="sim-engine__loading-ring sim-engine__loading-ring--outer" />
            <div className="sim-engine__loading-ring" />
            <div className="sim-engine__loading-ring sim-engine__loading-ring--delay" />
            <span className="sim-engine__loading-icon">🧠</span>
          </div>
          <div className="sim-engine__loading-text">
            <p className="sim-engine__loading-title">
              {[
                'Analyzing concept…',
                'Building simulation layout…',
                'Rendering canvas physics…',
                'Wiring interactive controls…',
                'Finalizing simulation…',
              ][loadingPhase]}
            </p>
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

      {/* Concept Info Header — shown above viewport when simulation is active */}
      {simulationCode && activeConcept && (
        <div className="sim-engine__concept-info">
          <div className="sim-engine__concept-icon">
            {getConceptIcon(activeConcept)}
          </div>
          <div className="sim-engine__concept-details">
            <p className="sim-engine__concept-label">Active Simulation</p>
            <p className="sim-engine__concept-name">{activeConcept}</p>
          </div>
          <div className="sim-engine__concept-badges">
            <span className="sim-engine__concept-badge sim-engine__concept-badge--interactive">
              🎮 Interactive
            </span>
            {fromCache && (
              <span className="sim-engine__concept-badge sim-engine__concept-badge--cached">
                ⚡ Cached
              </span>
            )}
          </div>
        </div>
      )}

      {/* Simulation Shell (PhET-style Architecture) */}
      {simulationCode && activeConcept && (
        <SimShell
          concept={activeConcept}
          simulationCode={simulationCode}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen(!fullscreen)}
          onRegenerate={handleRegenerate}
          onIframeLoad={() => { setIframeLoaded(true); setIframeError(false); }}
          onIframeError={() => { setIframeError(true); setIframeLoaded(false); }}
        />
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
            Type any concept to generate a stunning interactive simulation
          </p>
          <p className="sim-engine__empty-hint">
            Works with physics laws, math theorems, geometry, waves, circuits & more.
            Each simulation features a premium two-column layout with live measurements,
            custom sliders, and real-time canvas visualizations with glow effects.
          </p>

          {/* How it works steps */}
          <div className="sim-engine__how-it-works">
            <div className="sim-engine__step">
              <div className="sim-engine__step-num">1</div>
              <span className="sim-engine__step-label">Type a concept like "Projectile Motion"</span>
            </div>
            <div className="sim-engine__step">
              <div className="sim-engine__step-num">2</div>
              <span className="sim-engine__step-label">AI generates a full interactive simulation</span>
            </div>
            <div className="sim-engine__step">
              <div className="sim-engine__step-num">3</div>
              <span className="sim-engine__step-label">Interact with sliders, buttons & visuals</span>
            </div>
          </div>
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
