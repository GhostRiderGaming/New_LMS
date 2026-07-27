/**
 * useSimulationCache.ts
 * ---------------------
 * Custom React hook for localStorage-based simulation caching.
 * All reads/writes go directly to localStorage — never to React state.
 *
 * Key format:  sim_cache_<slug>
 * Slug:        concept.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
 *
 * Each entry stores: { concept, code, createdAt, version }
 * Cache size guard: if total localStorage usage > 4MB, evict the oldest 3 entries.
 */

const CACHE_PREFIX = 'sim_cache_'
const MAX_CACHE_BYTES = 4 * 1024 * 1024 // 4 MB
const EVICTION_COUNT = 3

export interface CachedSimulation {
  concept: string
  code: string
  createdAt: number
  version: number
}

/** Normalize a concept string into a safe localStorage key slug. */
export function toSlug(concept: string): string {
  return concept
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

/** Build the full localStorage key from a concept string. */
function toKey(concept: string): string {
  return `${CACHE_PREFIX}${toSlug(concept)}`
}

/** Estimate total bytes used by all sim_cache_* entries. */
function estimateCacheSize(): number {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(CACHE_PREFIX)) {
      const value = localStorage.getItem(key)
      if (value) {
        // Rough byte estimate: key + value character length × 2 (UTF-16)
        total += (key.length + value.length) * 2
      }
    }
  }
  return total
}

/** Evict the oldest N cache entries to free space. */
function evictOldest(count: number): void {
  const entries: { key: string; createdAt: number }[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(CACHE_PREFIX)) {
      try {
        const parsed: CachedSimulation = JSON.parse(localStorage.getItem(key) ?? '')
        entries.push({ key, createdAt: parsed.createdAt ?? 0 })
      } catch {
        // Corrupt entry — mark for removal with oldest timestamp
        entries.push({ key, createdAt: 0 })
      }
    }
  }

  // Sort oldest first
  entries.sort((a, b) => a.createdAt - b.createdAt)

  const toRemove = entries.slice(0, count)
  for (const entry of toRemove) {
    localStorage.removeItem(entry.key)
  }
}

/**
 * React hook that exposes localStorage cache operations.
 * All functions are pure side-effectful helpers — no React state is stored.
 */
export function useSimulationCache() {
  /** Retrieve a cached simulation by concept name. Returns null if not found. */
  function getCached(concept: string): CachedSimulation | null {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(toKey(concept))
      if (!raw) return null
      const parsed: CachedSimulation = JSON.parse(raw)
      // Basic shape validation
      if (parsed.code && parsed.concept && parsed.createdAt && parsed.version >= 2) {
        return parsed
      }
      return null
    } catch {
      return null
    }
  }

  /** Store a simulation in the cache. Evicts old entries if storage exceeds 4 MB. */
  function setCached(concept: string, code: string): void {
    if (typeof window === 'undefined') return

    const entry: CachedSimulation = {
      concept,
      code,
      createdAt: Date.now(),
      version: 2,
    }

    const payload = JSON.stringify(entry)

    // Check if we need to evict before writing
    if (estimateCacheSize() + payload.length * 2 > MAX_CACHE_BYTES) {
      evictOldest(EVICTION_COUNT)
    }

    try {
      localStorage.setItem(toKey(concept), payload)
    } catch (e) {
      // QuotaExceededError — aggressively evict and retry once
      evictOldest(EVICTION_COUNT)
      try {
        localStorage.setItem(toKey(concept), payload)
      } catch {
        console.warn('[SimulationCache] Failed to write to localStorage after eviction', e)
      }
    }
  }

  /** List all cached simulations sorted by most recent first. */
  function listAll(): CachedSimulation[] {
    if (typeof window === 'undefined') return []

    const entries: CachedSimulation[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) {
        try {
          const parsed: CachedSimulation = JSON.parse(localStorage.getItem(key) ?? '')
          if (parsed.code && parsed.concept) {
            entries.push(parsed)
          }
        } catch {
          // Skip corrupt entries
        }
      }
    }

    return entries.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Remove all sim_cache_* entries from localStorage. */
  function clearCache(): void {
    if (typeof window === 'undefined') return

    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
    }
  }

  return { getCached, setCached, listAll, clearCache }
}
