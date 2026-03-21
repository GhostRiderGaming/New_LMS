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

// --- Job types ---
export type JobStatus = 'queued' | 'processing' | 'complete' | 'failed'
export interface Job { job_id: string; status: JobStatus; asset_id?: string; asset_url?: string; error_message?: string }

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
  deleteAsset: (asset_id: string) => request<void>(`/api/v1/assets/${asset_id}`, { method: 'DELETE' }),
  downloadAsset: (asset_id: string) => `${BASE}/api/v1/assets/${asset_id}/download`,

  // --- Bella ---
  bellaChat: (message: string, session_id: string) =>
    request<{ text: string; audio_b64?: string; phonemes?: unknown[] }>('/api/v1/bella/chat', { method: 'POST', body: JSON.stringify({ message, session_id }) }),
  bellaTranscribe: (audioBlob: Blob) => {
    const form = new FormData(); form.append('audio', audioBlob)
    return request<{ transcript: string }>('/api/v1/bella/transcribe', { method: 'POST', body: form, headers: {} })
  },
  bellaHistory: (session_id: string) =>
    request<{ messages: { role: string; text: string }[] }>(`/api/v1/bella/history?session_id=${session_id}`),

  // --- Story ---
  getStory: (story_id: string) => request<{ story_id: string; status: string; episodes: unknown[] }>(`/api/v1/story/${story_id}`),
  exportStoryZip: (story_id: string) => `${BASE}/api/v1/story/${story_id}/export`,
}
