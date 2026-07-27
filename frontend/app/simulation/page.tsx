'use client'
import { useState, useEffect, useRef, useMemo, Suspense } from 'react'
import { api } from '@/lib/api'
import type { SimulationItem, SimulationCategory } from '@/lib/api'
import { useBellaStore } from '@/lib/bellaStore'

/* ───────────────────────────────────────────────────────────────────────── */
/*  Simulation Library Page                                                 */
/*  Browse pre-built simulations by category, search, and open in a modal  */
/* ───────────────────────────────────────────────────────────────────────── */

export default function SimulationPage() {
  return (
    <Suspense fallback={
      <div className="p-6 max-w-7xl mx-auto text-center py-20 text-slate-600">
        <div className="text-5xl mb-4 animate-pulse">🔬</div>
        <p className="text-sm">Loading Simulation Library...</p>
      </div>
    }>
      <SimulationLibrary />
    </Suspense>
  )
}

/* ── Category sub-topic detection ────────────────────────────────────── */

interface SubTopic {
  label: string
  icon: string
  keywords: string[]
}

const scienceSubTopics: SubTopic[] = [
  { label: 'Physics', icon: '⚛️', keywords: ['newton', 'motion', 'force', 'gravity', 'momentum', 'velocity', 'acceleration', 'friction', 'projectile', 'free fall', 'buoyancy', 'archimedes', 'weight', 'work', 'energy', 'power', 'kinetic', 'potential', 'conservation', 'pendulum'] },
  { label: 'Optics', icon: '🔦', keywords: ['mirror', 'lens', 'refraction', 'reflection', 'optic', 'prism', 'dispersion', 'rainbow', 'ray', 'image formation', 'accommodation', 'nearsighted', 'farsighted', 'eye'] },
  { label: 'Electricity & Magnetism', icon: '⚡', keywords: ['ohm', 'circuit', 'resistance', 'current', 'voltage', 'series', 'parallel', 'heating effect', 'magnetic', 'fleming', 'electromagnet', 'motor', 'induction', 'electric'] },
  { label: 'Sound & Waves', icon: '🌊', keywords: ['sound', 'wave', 'amplitude', 'frequency', 'pitch', 'loudness', 'echo', 'acoustic'] },
  { label: 'Chemistry', icon: '🧪', keywords: ['acid', 'base', 'ph', 'reaction', 'chemical', 'equation', 'displacement', 'metal', 'carbon', 'ionic', 'bond', 'molecular', 'soap', 'detergent', 'homologous', 'atom', 'molecule', 'mole', 'formula', 'bohr', 'isotope', 'electron', 'quantum', 'crystallization', 'chromatography', 'solubility', 'solution', 'colloid', 'suspension'] },
  { label: 'Biology', icon: '🧬', keywords: ['cell', 'tissue', 'organ', 'blood', 'heart', 'digest', 'skeleton', 'lung', 'gas exchange', 'nephron', 'urine', 'transpiration', 'neuron', 'tropism', 'reproductive', 'pollination', 'menstrual', 'mendel', 'genetics', 'reproduction', 'trait', 'punnett', 'dominant', 'recessive', 'osmosis', 'diffusion', 'plant cell', 'animal cell'] },
  { label: 'Ecology & Environment', icon: '🌍', keywords: ['ecosystem', 'food chain', 'food web', 'biodegradable', 'biomagnification', 'renewable', 'non-renewable', 'wind turbine', 'hydroelectric', 'thermal power', 'solar power', 'energy efficiency'] },
  { label: 'Matter & States', icon: '🌡️', keywords: ['particle', 'states of matter', 'heating', 'cooling', 'evaporation', 'diffusion'] },
  { label: 'Astronomy', icon: '🪐', keywords: ['solar system', 'planet', 'orbit', 'cosmos', 'gravitas'] },
  { label: 'Agriculture', icon: '🌾', keywords: ['irrigation', 'crop', 'fertilizer', 'manure', 'farming'] },
]

const mathsSubTopics: SubTopic[] = [
  { label: 'Geometry', icon: '📐', keywords: ['angle', 'triangle', 'circle', 'quadrilateral', 'congruent', 'similar', 'midpoint theorem', 'thales', 'proportionality', 'euclid', 'symmetry', 'segment', 'sector', 'arc'] },
  { label: 'Mensuration', icon: '📏', keywords: ['area', 'perimeter', 'volume', 'surface area', 'heron', 'mensuration', 'curved surface'] },
  { label: 'Algebra', icon: '🔢', keywords: ['polynomial', 'zeroes', 'linear equation', 'quadratic', 'algebraic', 'exponential', 'arithmetic progression', 'fraction', 'fundamental theorem'] },
  { label: 'Trigonometry', icon: '📊', keywords: ['trigonometry', 'trigonometric', 'pythagoras', 'right-angled', 'unit circle', 'line of sight', 'sin', 'cos', 'tan'] },
  { label: 'Coordinate Geometry', icon: '📍', keywords: ['distance formula', 'midpoint formula', 'section formula', 'coordinate', 'graph', 'four quadrant', 'lines'] },
  { label: 'Statistics & Probability', icon: '🎲', keywords: ['data', 'probability', 'graph', 'representation'] },
  { label: '3D Visualization', icon: '🧊', keywords: ['3d visualization'] },
]

function detectSubTopic(title: string, subTopics: SubTopic[]): SubTopic | null {
  const lower = title.toLowerCase()
  for (const st of subTopics) {
    if (st.keywords.some(kw => lower.includes(kw))) return st
  }
  return null
}

function getDeterministicColors(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 60) % 360;
  return [`hsl(${hue1}, 80%, 25%)`, `hsl(${hue2}, 80%, 15%)`];
}

function generateSvgPlaceholder(seed: string, icon: string) {
  const [color1, color2] = getDeterministicColors(seed);
  const safeId = seed.replace(/[^a-zA-Z0-9]/g, '');
  const svg = `<svg width="400" height="225" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad_${safeId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grad_${safeId})" />
      <text x="50%" y="55%" font-size="120" font-family="system-ui, sans-serif" text-anchor="middle" dominant-baseline="middle" opacity="0.3">${icon}</text>
    </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/* ── Simulation Card Component ───────────────────────────────────────── */

function SimulationCard({ sim, category, onOpen }: { sim: SimulationItem, category: SimulationCategory, onOpen: (sim: SimulationItem) => void }) {
  const [isHovered, setIsHovered] = useState(false)
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(34,211,238,0.4)';
    (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(34,211,238,0.1), inset 0 1px 0 rgba(255,255,255,0.04)';
    hoverTimeout.current = setTimeout(() => setIsHovered(true), 350)
  }

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(139,92,246,0.12)';
    (e.currentTarget as HTMLElement).style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.02)';
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
    setIsHovered(false)
  }

  useEffect(() => {
    return () => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }
  }, [])

  const subTopics = category.name === 'Maths' ? mathsSubTopics : scienceSubTopics
  const subTopic = detectSubTopic(sim.title, subTopics)

  return (
    <button
      onClick={() => onOpen(sim)}
      className="group text-left rounded-xl border transition-all duration-300 hover:-translate-y-0.5 overflow-hidden"
      style={{
        background: 'rgba(15,15,35,0.6)',
        borderColor: 'rgba(139,92,246,0.12)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Gradient top line */}
      <div className="h-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10 relative" style={{ background: 'linear-gradient(90deg, #8b5cf6, #22d3ee)' }} />

      {/* Thumbnail Area */}
      <div className="relative w-full h-32 bg-slate-800/50 overflow-hidden">
        {/* Placeholder SVG */}
        <img 
          src={generateSvgPlaceholder(subTopic?.label || category.name, subTopic?.icon || category.icon || '🔬')}
          alt={sim.title} 
          className={`w-full h-full object-cover transition-all duration-700 ${isHovered ? 'opacity-0 scale-110' : 'opacity-80 scale-100'}`}
        />
        
        {/* Live Preview Iframe (loads on hover) */}
        {isHovered && (
          <div className="absolute inset-0 origin-top-left pointer-events-none" style={{ width: '200%', height: '200%', transform: 'scale(0.5)' }}>
            <iframe 
              src={api.getSimulationFileUrl(category.name, sim.filename)}
              className="w-full h-full border-none opacity-0 animate-[fadeIn_0.5s_ease-out_forwards]" 
              sandbox="allow-scripts allow-same-origin"
              tabIndex={-1}
            />
          </div>
        )}
        
        {/* Gradient overlay to blend into the card background */}
        <div className="absolute inset-0 bg-gradient-to-t from-[rgba(15,15,35,1)] via-[rgba(15,15,35,0.4)] to-transparent" />
      </div>

      <div className="p-4 pt-2 relative z-10">
        {/* Sub-topic badge */}
        {subTopic && (
          <div className="flex items-center gap-1 mb-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: 'rgba(139,92,246,0.1)', color: 'rgba(167,139,250,0.9)' }}>
              {subTopic.icon} {subTopic.label}
            </span>
          </div>
        )}

        {/* Title */}
        <h3 className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors line-clamp-2 mb-2">
          {sim.title}
        </h3>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-600 font-medium">
            🎮 Interactive
          </span>
          <span className="text-[10px] text-accent-cyan opacity-0 group-hover:opacity-100 transition-opacity font-medium">
            Click to open →
          </span>
        </div>
      </div>
    </button>
  )
}

/* ── Main Library Component ──────────────────────────────────────────── */

function SimulationLibrary() {
  const [categories, setCategories] = useState<SimulationCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')
  const [activeSubTopic, setActiveSubTopic] = useState<string>('all')
  const [total, setTotal] = useState(0)
  const { triggerExplanation, isExplaining, requestStopSpeaking } = useBellaStore()

  // Modal state
  const [modalSim, setModalSim] = useState<SimulationItem | null>(null)
  const [modalFullscreen, setModalFullscreen] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Fetch simulations on mount
  useEffect(() => {
    api.listSimulations()
      .then((data) => {
        setCategories(data.categories)
        setTotal(data.total)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Filter simulations
  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim()
    const results: { category: SimulationCategory; sims: SimulationItem[] }[] = []

    for (const cat of categories) {
      if (activeCategory !== 'all' && cat.name !== activeCategory) continue

      const sims = cat.simulations.filter((s) => {
        if (query && !s.title.toLowerCase().includes(query)) return false
        if (activeSubTopic !== 'all') {
          const subTopics = cat.name === 'Maths' ? mathsSubTopics : scienceSubTopics
          const st = detectSubTopic(s.title, subTopics)
          if (!st || st.label !== activeSubTopic) return false
        }
        return true
      })

      if (sims.length > 0) {
        results.push({ category: cat, sims })
      }
    }
    return results
  }, [categories, search, activeCategory, activeSubTopic])

  // Get available subtopics for active category
  const availableSubTopics = useMemo(() => {
    if (activeCategory === 'all') return []
    return activeCategory === 'Maths' ? mathsSubTopics : scienceSubTopics
  }, [activeCategory])

  // Open modal
  const openSimulation = (sim: SimulationItem) => {
    setModalSim(sim)
    setIframeLoaded(false)
    setModalFullscreen(false)

    api.bellaExplain(sim.title, { section: 'simulation', language: useBellaStore.getState().language })
      .then((data) => {
        triggerExplanation({
          topic: sim.title,
          text: data.explanation,
          audioB64: data.audio_b64 ?? null,
        })
      })
      .catch((err) => {
        console.warn('[Simulation] Bella explain failed:', err)
      })
  }

  // Close modal
  const closeModal = () => {
    setModalSim(null)
    setModalFullscreen(false)
    setIframeLoaded(false)
  }

  // Escape key closes modal
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modalFullscreen) setModalFullscreen(false)
        else if (modalSim) closeModal()
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [modalSim, modalFullscreen])

  // Get iframe URL for a simulation
  const getSimUrl = (sim: SimulationItem) =>
    api.getSimulationFileUrl(sim.category, sim.filename)

  const totalFiltered = filtered.reduce((sum, g) => sum + g.sims.length, 0)

  // Loading state
  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-center py-20">
        <div className="text-5xl mb-4 animate-pulse">🔬</div>
        <p className="text-sm text-slate-400">Loading simulation library...</p>
        <div className="mt-4 w-48 h-1 mx-auto rounded-full overflow-hidden" style={{ background: 'rgba(139,92,246,0.1)' }}>
          <div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, #8b5cf6, #22d3ee)', animation: 'simLoadBar 1.5s ease-in-out infinite', width: '60%' }} />
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto text-center py-20">
        <div className="text-5xl mb-4">⚠️</div>
        <p className="text-sm text-red-400 mb-4">{error}</p>
        <button
          onClick={() => { setError(null); setLoading(true); api.listSimulations().then(d => { setCategories(d.categories); setTotal(d.total) }).catch(e => setError(e.message)).finally(() => setLoading(false)) }}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-purple/20 text-accent-purple border border-accent-purple/30 hover:bg-accent-purple/30 transition-all"
        >
          ↻ Retry
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="mb-8 animate-fadeInUp">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl border"
            style={{ background: 'rgba(34,211,238,0.1)', borderColor: 'rgba(34,211,238,0.2)' }}>
            🔬
          </div>
          <div>
            <h1 className="text-2xl font-black text-white">Simulation Library</h1>
            <p className="text-slate-400 text-sm">
              {total} interactive simulations across Maths & Science
            </p>
          </div>
        </div>
      </div>

      {/* ── Search & Filters ──────────────────────────────────────────── */}
      <div className="mb-6 space-y-3 animate-fadeInUp" style={{ animationDelay: '0.05s' }}>
        {/* Search */}
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search simulations by topic..."
            className="w-full bg-bg-elevated/80 border border-border rounded-xl px-10 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-accent-cyan focus:shadow-[0_0_20px_rgba(34,211,238,0.15)] transition-all"
            id="simulation-search"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs transition-colors"
            >✕</button>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setActiveCategory('all'); setActiveSubTopic('all') }}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeCategory === 'all'
                ? 'bg-accent-cyan text-bg-primary shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                : 'bg-bg-elevated text-slate-400 hover:text-white border border-border'
            }`}
          >
            🌐 All ({total})
          </button>
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => { setActiveCategory(cat.name); setActiveSubTopic('all') }}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeCategory === cat.name
                  ? 'bg-accent-cyan text-bg-primary shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                  : 'bg-bg-elevated text-slate-400 hover:text-white border border-border'
              }`}
            >
              {cat.icon} {cat.name} ({cat.simulations.length})
            </button>
          ))}
        </div>

        {/* Sub-topic filters */}
        {availableSubTopics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveSubTopic('all')}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                activeSubTopic === 'all'
                  ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
                  : 'bg-bg-secondary text-slate-500 hover:text-slate-300 border border-transparent'
              }`}
            >
              All Topics
            </button>
            {availableSubTopics.map((st) => (
              <button
                key={st.label}
                onClick={() => setActiveSubTopic(st.label)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                  activeSubTopic === st.label
                    ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
                    : 'bg-bg-secondary text-slate-500 hover:text-slate-300 border border-transparent'
                }`}
              >
                {st.icon} {st.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Results Count ─────────────────────────────────────────────── */}
      {search && (
        <p className="text-xs text-slate-500 mb-4">
          {totalFiltered} simulation{totalFiltered !== 1 ? 's' : ''} found
          {search && <> for &quot;<span className="text-accent-cyan">{search}</span>&quot;</>}
        </p>
      )}

      {/* ── Simulation Grid ───────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-600">
          <div className="text-5xl mb-4">🔍</div>
          <p className="text-sm">No simulations found matching your search</p>
          <button onClick={() => { setSearch(''); setActiveCategory('all'); setActiveSubTopic('all') }} className="mt-3 text-xs text-accent-cyan hover:underline">
            Clear filters
          </button>
        </div>
      ) : (
        filtered.map(({ category, sims }) => (
          <div key={category.name} className="mb-10 animate-fadeInUp">
            {/* Category header */}
            {(activeCategory === 'all' || filtered.length > 1) && (
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">{category.icon}</span>
                <h2 className="text-lg font-bold text-white">{category.name}</h2>
                <span className="text-xs text-slate-500 ml-1">({sims.length})</span>
                <div className="flex-1 h-px ml-3" style={{ background: 'linear-gradient(90deg, rgba(139,92,246,0.3), transparent)' }} />
              </div>
            )}

            {/* Cards grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {sims.map((sim) => (
                <SimulationCard key={sim.id} sim={sim} category={category} onOpen={openSimulation} />
              ))}
            </div>
          </div>
        ))
      )}

      {/* ── Simulation Modal (Overlay) ────────────────────────────────── */}
      {modalSim && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div
            className={`relative flex flex-col ${
              modalFullscreen
                ? 'w-full h-full rounded-none'
                : 'w-[95vw] h-[90vh] max-w-6xl rounded-2xl'
            }`}
            style={{
              background: '#0d0d22',
              border: modalFullscreen ? 'none' : '1.5px solid rgba(139, 92, 246, 0.2)',
              boxShadow: modalFullscreen ? 'none' : '0 8px 40px rgba(0,0,0,0.5), 0 0 80px rgba(139,92,246,0.06)',
            }}
          >
            {/* Gradient top accent */}
            <div
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
                background: 'linear-gradient(90deg, #8b5cf6, #22d3ee, #f472b6, #8b5cf6)',
                backgroundSize: '300% 100%',
                animation: 'simGradientShift 4s ease-in-out infinite',
                zIndex: 10, opacity: 0.7, borderRadius: modalFullscreen ? '0' : '1rem 1rem 0 0',
              }}
            />

            {/* Toolbar */}
            <div
              className="flex items-center justify-between px-4 py-2.5 gap-2 shrink-0"
              style={{
                background: 'linear-gradient(180deg, rgba(10,10,32,0.98), rgba(12,12,36,0.98))',
                borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
                borderRadius: modalFullscreen ? '0' : '1rem 1rem 0 0',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                {/* macOS dots */}
                {['#ef4444', '#eab308', '#22c55e'].map((color, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: color, cursor: i === 0 ? 'pointer' : 'default' }}
                    onClick={i === 0 ? closeModal : undefined}
                    title={i === 0 ? 'Close' : undefined}
                  />
                ))}
                <span className="ml-3 text-xs text-slate-400 font-medium truncate">
                  {modalSim.title}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isExplaining && (
                  <button
                    onClick={requestStopSpeaking}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-all"
                  >
                    <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                    🔇 Stop Bella
                  </button>
                )}
                <button
                  onClick={() => setModalFullscreen(!modalFullscreen)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:-translate-y-px"
                  style={{
                    background: modalFullscreen ? 'rgba(239, 68, 68, 0.08)' : 'rgba(34, 211, 238, 0.08)',
                    color: modalFullscreen ? '#f87171' : '#22d3ee',
                    border: `1px solid ${modalFullscreen ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 211, 238, 0.15)'}`,
                  }}
                >
                  {modalFullscreen ? '✕ Exit Fullscreen' : '⊞ Fullscreen'}
                </button>
                <button
                  onClick={closeModal}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:-translate-y-px"
                  style={{
                    background: 'rgba(239, 68, 68, 0.08)',
                    color: '#f87171',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                  }}
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Loading overlay */}
            {!iframeLoaded && (
              <div
                className="absolute inset-0 z-[5] flex items-center justify-center"
                style={{ top: '42px', background: '#0f172a' }}
              >
                <div className="flex flex-col items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{
                      background: 'rgba(139, 92, 246, 0.12)',
                      border: '2px solid rgba(139, 92, 246, 0.25)',
                      animation: 'spin 1.5s linear infinite',
                    }}
                  >
                    <span className="text-lg" style={{ animation: 'pulse 2s ease-in-out infinite' }}>🔬</span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium">Loading simulation…</p>
                </div>
              </div>
            )}

            {/* Iframe */}
            <iframe
              ref={iframeRef}
              src={getSimUrl(modalSim)}
              sandbox="allow-scripts allow-same-origin"
              className={`flex-1 w-full border-0 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
              style={{
                background: '#0f172a',
                borderRadius: modalFullscreen ? '0' : '0 0 1rem 1rem',
                transform: 'translateZ(0)',
                willChange: 'auto',
              }}
              title={`${modalSim.title} simulation`}
              onLoad={() => setIframeLoaded(true)}
            />

            {/* Status indicator */}
            {iframeLoaded && (
              <div
                className="flex items-center justify-center gap-2 py-1.5 text-xs shrink-0"
                style={{
                  background: 'rgba(34, 211, 238, 0.04)',
                  borderTop: '1px solid rgba(34, 211, 238, 0.08)',
                  color: '#22c55e',
                  borderRadius: modalFullscreen ? '0' : '0 0 1rem 1rem',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: '#22c55e', boxShadow: '0 0 6px #22c55e', animation: 'pulse 2s ease-in-out infinite' }}
                />
                Simulation loaded successfully
              </div>
            )}
          </div>
        </div>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes simGradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes simLoadBar {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(60%); }
          100% { transform: translateX(200%); }
        }
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  )
}
