import { create } from 'zustand'

export type EmotionState = 'neutral' | 'thinking' | 'happy' | 'celebrate'

export interface BellaMessage {
  id: string
  role: 'user' | 'bella'
  text: string
  timestamp: Date
}

/** Pending explanation that BellaPresence will pick up and play */
export interface PendingExplanation {
  topic: string
  text: string
  audioB64: string | null
}

interface BellaStore {
  isVisible: boolean
  isMinimized: boolean
  messages: BellaMessage[]
  emotionalState: EmotionState
  lastJobContext: string | null
  appearance: string
  pendingExplanation: PendingExplanation | null
  isExplaining: boolean
  stopSpeakingRequested: boolean

  // Actions
  show: () => void
  hide: () => void
  toggleMinimize: () => void
  addMessage: (msg: Omit<BellaMessage, 'id' | 'timestamp'>) => void
  setEmotionalState: (state: EmotionState) => void
  setLastJobContext: (ctx: string | null) => void
  setAppearance: (path: string) => void
  triggerExplanation: (explanation: PendingExplanation) => void
  clearExplanation: () => void
  setIsExplaining: (v: boolean) => void
  requestStopSpeaking: () => void
  clearStopRequest: () => void
}

export const useBellaStore = create<BellaStore>((set) => ({
  isVisible: true,
  isMinimized: false,
  messages: [],
  emotionalState: 'neutral',
  lastJobContext: null,
  appearance: '/live2d/model3/base/march 7th.model3.json',
  pendingExplanation: null,
  isExplaining: false,
  stopSpeakingRequested: false,

  show: () => set({ isVisible: true }),
  hide: () => set({ isVisible: false }),
  toggleMinimize: () => set((s) => ({ isMinimized: !s.isMinimized })),
  addMessage: (msg) =>
    set((s) => ({
      messages: [
        ...s.messages,
        { ...msg, id: crypto.randomUUID(), timestamp: new Date() },
      ],
    })),
  setEmotionalState: (emotionalState) => set({ emotionalState }),
  setLastJobContext: (lastJobContext) => set({ lastJobContext }),
  setAppearance: (appearance) => set({ appearance }),
  triggerExplanation: (pendingExplanation) => set({ pendingExplanation }),
  clearExplanation: () => set({ pendingExplanation: null }),
  setIsExplaining: (isExplaining) => set({ isExplaining }),
  requestStopSpeaking: () => set({ stopSpeakingRequested: true }),
  clearStopRequest: () => set({ stopSpeakingRequested: false }),
}))
