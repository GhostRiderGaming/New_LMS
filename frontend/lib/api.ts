const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? 'dev-api-key'
const REQUEST_TIMEOUT = 30000 // 30 second timeout

/** Map HTTP status codes to human-readable messages when no server message is available. */
function httpStatusMessage(status: number): string {
  switch (status) {
    case 400: return 'Invalid request. Please check your input and try again.'
    case 401: return 'Authentication required. Please refresh the page.'
    case 403: return 'You do not have permission to perform this action.'
    case 404: return 'The requested resource was not found.'
    case 422: return 'Your request was rejected — it may contain unsafe or invalid content.'
    case 429: return 'Rate limit exceeded. Please wait a moment and try again.'
    case 500: return 'The server encountered an error. Please try again in a moment.'
    case 502: return 'The server is temporarily unavailable. Please try again shortly.'
    case 503: return 'The service is currently unavailable. Please try again later.'
    default: return `Unexpected error (HTTP ${status}). Please try again.`
  }
}

/** Extract a human-readable message from a FastAPI error response body. */
function extractErrorMessage(body: unknown, status: number): string {
  if (!body || typeof body !== 'object') return httpStatusMessage(status)
  const b = body as Record<string, unknown>

  // FastAPI validation errors: { detail: [ { msg: "..." }, ... ] }
  if (Array.isArray(b.detail)) {
    const msgs = (b.detail as Array<Record<string, unknown>>)
      .map((d) => d.msg ?? d.message)
      .filter(Boolean)
    if (msgs.length > 0) return `Validation error: ${msgs.join('; ')}`
  }

  // FastAPI HTTPException with structured detail
  if (b.detail && typeof b.detail === 'object') {
    const d = b.detail as Record<string, unknown>
    if (d.reason) return String(d.reason)
    if (d.error) return humanizeErrorCode(String(d.error))
  }

  if (typeof b.detail === 'string') return b.detail
  if (typeof b.error === 'string') return humanizeErrorCode(b.error)

  return httpStatusMessage(status)
}

/** Convert snake_case error codes to readable sentences. */
function humanizeErrorCode(code: string): string {
  const map: Record<string, string> = {
    not_found: 'The requested resource was not found.',
    unauthorized: 'Authentication required. Please refresh the page.',
    safety_violation: 'Your request was rejected due to content safety policy.',
    quota_exceeded: 'Storage quota exceeded. Please delete some assets before generating more.',
    validation_error: 'Invalid request. Please check your input and try again.',
    timeout: 'The generation timed out. Please try again.',
    model_unavailable: 'The AI model is temporarily unavailable. Please try again shortly.',
    unknown: 'An unexpected error occurred. Please try again.',
  }
  return map[code] ?? code.replace(/_/g, ' ')
}

/** Create an AbortController with timeout */
function createTimeoutController(timeoutMs: number = REQUEST_TIMEOUT): { controller: AbortController; clear: () => void } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, clear: () => clearTimeout(timeoutId) }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const { controller, clear } = createTimeoutController()
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY, ...options?.headers },
      signal: controller.signal,
      ...options,
    })
  } catch (err) {
    clear()
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. The server may be busy — please try again.')
    }
    throw new Error('Unable to reach the server. Please check your connection and try again.')
  }
  clear()
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(extractErrorMessage(body, res.status))
  }
  return res.json()
}

async function requestRaw(path: string, options?: RequestInit): Promise<Response> {
  const { controller, clear } = createTimeoutController()
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { 'X-API-Key': API_KEY, ...options?.headers },
      signal: controller.signal,
    })
  } catch (err) {
    clear()
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Request timed out. The server may be busy — please try again.')
    }
    throw new Error('Unable to reach the server. Please check your connection and try again.')
  }
  clear()
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(extractErrorMessage(body, res.status))
  }
  return res
}

// --- Job types ---
export type JobStatus = 'queued' | 'processing' | 'complete' | 'failed'
export interface Job { job_id: string; status: JobStatus; asset_id?: string; asset_url?: string; error_message?: string; progress?: number; step?: string }

/** Returns the WebSocket URL for streaming job status updates. */
export function getJobWsUrl(job_id: string): string {
  const wsBase = BASE.replace(/^http/, 'ws')
  return `${wsBase}/api/v1/jobs/${job_id}/ws?api_key=${encodeURIComponent(API_KEY)}`
}

// --- Asset types ---
export interface AssetRecord {
  asset_id: string
  job_id: string
  type: 'image' | 'animation' | 'simulation' | 'model3d' | 'story'
  topic: string
  file_path: string
  file_size_bytes: number
  mime_type: string
  metadata: Record<string, unknown>
  created_at: string
  expires_at: string
  session_id: string
  presigned_url: string
}

// --- Bella types ---
export interface HistoryMessage { role: string; text: string; timestamp: string }

// --- Generation ---
export const api = {
  generateAnime: (topic: string, style: string, include_animation = false) =>
    request<Job>('/api/v1/anime/generate', { method: 'POST', body: JSON.stringify({ topic, style, include_animation }) }),

  generateSimulation: (topic: string, category: string) =>
    request<Job>('/api/v1/simulation/generate', { method: 'POST', body: JSON.stringify({ topic, category }) }),

  generateModel3D: (object_name: string, category: string) =>
    request<Job>('/api/v1/model3d/generate', { method: 'POST', body: JSON.stringify({ object_name, category }) }),

  generateStory: (topic: string, episode_count: number) =>
    request<Job>('/api/v1/story/generate', { method: 'POST', body: JSON.stringify({ topic, episode_count }) }),

  // --- Jobs ---
  getJob: (job_id: string) => request<Job>(`/api/v1/jobs/${job_id}`),
  listJobs: () => request<Job[]>('/api/v1/jobs'),
  getJobWsUrl: (job_id: string) => {
    const wsBase = BASE.replace(/^http/, 'ws')
    return `${wsBase}/api/v1/jobs/${job_id}/ws`
  },

  // --- Assets ---
  getAsset: (asset_id: string) => request<AssetRecord>(`/api/v1/assets/${asset_id}`),
  listAssets: () => request<AssetRecord[]>('/api/v1/assets'),
  deleteAsset: (asset_id: string) => request<void>(`/api/v1/assets/${asset_id}`, { method: 'DELETE' }),
  downloadAsset: (asset_id: string) => `${BASE}/api/v1/assets/${asset_id}/download`,
  exportAllZip: () => `${BASE}/api/v1/assets/export/zip`,

  // --- Bella ---
  bellaChat: (message: string, session_id: string) =>
    request<{ reply: string; audio_b64?: string; phonemes?: { phoneme: string; time: number }[]; tts_available: boolean }>(
      '/api/v1/bella/chat', { method: 'POST', body: JSON.stringify({ message, session_id }) }
    ),
  bellaTTS: async (text: string): Promise<ArrayBuffer> => {
    const res = await requestRaw('/api/v1/bella/tts', { method: 'POST', body: JSON.stringify({ text }), headers: { 'Content-Type': 'application/json' } })
    return res.arrayBuffer()
  },
  bellaTranscribe: (audioBlob: Blob) => {
    const form = new FormData(); form.append('audio', audioBlob)
    return request<{ transcript: string }>('/api/v1/bella/transcribe', { method: 'POST', body: form, headers: {} })
  },
  bellaHistory: (session_id: string) =>
    request<{ messages: HistoryMessage[] }>(`/api/v1/bella/history?session_id=${session_id}`),

  // --- Story ---
  getStory: (story_id: string) => request<{ story_id: string; status: string; episodes: unknown[] }>(`/api/v1/story/${story_id}`),
  exportStoryZip: (story_id: string) => `${BASE}/api/v1/story/${story_id}/export`,
}
