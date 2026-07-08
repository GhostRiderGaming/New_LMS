/**
 * useModel3DCache.ts
 * ------------------
 * Custom React hook for localStorage-based 3D Model caching.
 * All reads/writes go directly to localStorage — never to React state.
 *
 * Key format:  model3d_cache_<slug>
 * Slug:        objectName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
 *
 * Each entry stores metadata and the asset_url. We do NOT store the raw .glb 
 * binary blob in localStorage to avoid hitting quota limits. 
 * The browser's network cache handles the actual .glb file caching.
 */

const CACHE_PREFIX = 'model3d_cache_'
const MAX_CACHE_BYTES = 2 * 1024 * 1024 // 2 MB limit for metadata
const EVICTION_COUNT = 3

export interface CachedModel3D {
  object_name: string
  category: string
  asset_url: string
  description: string
  createdAt: number
}

/** Normalize an object name string into a safe localStorage key slug. */
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

/** Build the full localStorage key from an object name string. */
function toKey(name: string): string {
  return `${CACHE_PREFIX}${toSlug(name)}`
}

/** Estimate total bytes used by all model3d_cache_* entries. */
function estimateCacheSize(): number {
  let total = 0
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(CACHE_PREFIX)) {
      const value = localStorage.getItem(key)
      if (value) {
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
        const parsed: CachedModel3D = JSON.parse(localStorage.getItem(key) ?? '')
        entries.push({ key, createdAt: parsed.createdAt ?? 0 })
      } catch {
        entries.push({ key, createdAt: 0 })
      }
    }
  }

  entries.sort((a, b) => a.createdAt - b.createdAt)

  const toRemove = entries.slice(0, count)
  for (const entry of toRemove) {
    localStorage.removeItem(entry.key)
  }
}

/**
 * React hook that exposes localStorage cache operations.
 */
export function useModel3DCache() {
  function getCached(name: string): CachedModel3D | null {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(toKey(name))
      if (!raw) return null
      const parsed: CachedModel3D = JSON.parse(raw)
      if (parsed.object_name && parsed.asset_url && parsed.createdAt) {
        return parsed
      }
      return null
    } catch {
      return null
    }
  }

  function setCached(entryData: Omit<CachedModel3D, 'createdAt'>): void {
    if (typeof window === 'undefined') return

    const entry: CachedModel3D = {
      ...entryData,
      createdAt: Date.now(),
    }

    const payload = JSON.stringify(entry)

    if (estimateCacheSize() + payload.length * 2 > MAX_CACHE_BYTES) {
      evictOldest(EVICTION_COUNT)
    }

    try {
      localStorage.setItem(toKey(entry.object_name), payload)
    } catch (e) {
      evictOldest(EVICTION_COUNT)
      try {
        localStorage.setItem(toKey(entry.object_name), payload)
      } catch {
        console.warn('[Model3DCache] Failed to write to localStorage after eviction', e)
      }
    }
  }

  function listAll(): CachedModel3D[] {
    if (typeof window === 'undefined') return []

    const entries: CachedModel3D[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) {
        try {
          const parsed: CachedModel3D = JSON.parse(localStorage.getItem(key) ?? '')
          if (parsed.object_name && parsed.asset_url) {
            entries.push(parsed)
          }
        } catch {
          // Skip corrupt entries
        }
      }
    }

    return entries.sort((a, b) => b.createdAt - a.createdAt)
  }

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
