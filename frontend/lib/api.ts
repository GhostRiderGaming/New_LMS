const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown' }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

async function requestRaw(path: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'unknown' }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res
}

// --- Job types ---
export type JobStatus = 'queued' | 'processing' | 'complete' | 'failed'
export interface Job { job_id: string; status: JobStatus; asset_id?: string; asset_url?: string; error_message?: string }

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

  // --- Assets ---
  getAsset: (asset_id: string) => request<{ asset_id: string; asset_url: string; metadata: Record<string, unknown> }>(`/api/v1/assets/${asset_id}`),
  listAssets: () => request<AssetRecord[]>('/api/v1/assets'),
  deleteAsset: (asset_id: string) => request<void>(`/api/v1/assets/${asset_id}`, { method: 'DELETE' }),
  downloadAsset: (asset_id: string) => `${BASE}/api/v1/assets/${asset_id}/download`,
  exportAllZip: () => `${BASE}/api/v1/assets/export/zip`,

  // --- Bella ---
  bellaChat: (message: string, session_id: string) =>
    request<{ reply: string }>('/bella/chat', { method: 'POST', body: JSON.stringify({ message, session_id }) }),
  bellaTTS: async (text: string): Promise<ArrayBuffer> => {
    const res = await requestRaw('/bella/tts', { method: 'POST', body: JSON.stringify({ text }), headers: { 'Content-Type': 'application/json' } })
    return res.arrayBuffer()
  },
  bellaTranscribe: (audioBlob: Blob) => {
    const form = new FormData(); form.append('audio', audioBlob)
    return request<{ transcript: string }>('/bella/transcribe', { method: 'POST', body: form, headers: {} })
  },
  bellaHistory: (session_id: string) =>
    request<{ messages: HistoryMessage[] }>(`/bella/history?session_id=${session_id}`),

  // --- Story ---
  getStory: (story_id: string) => request<{ story_id: string; status: string; episodes: unknown[] }>(`/api/v1/story/${story_id}`),
  exportStoryZip: (story_id: string) => `${BASE}/api/v1/story/${story_id}/export`,
}
