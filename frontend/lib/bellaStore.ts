import { create } from 'zustand'

export type EmotionState = 'neutral' | 'thinking' | 'happy' | 'celebrate'

export interface BellaMessage {
  id: string
  role: 'user' | 'bella'
  text: string
  timestamp: Date
}

interface BellaStore {
  isVisible: boolean
  isMinimized: boolean
  messages: BellaMessage[]
  emotionalState: EmotionState
  lastJobContext: string | null

  // Actions
  show: () => void
  hide: () => void
  toggleMinimize: () => void
  addMessage: (msg: Omit<BellaMessage, 'id' | 'timestamp'>) => void
  setEmotionalState: (state: EmotionState) => void
  setLastJobContext: (ctx: string | null) => void
}

export const useBellaStore = create<BellaStore>((set) => ({
  isVisible: true,
  isMinimized: false,
  messages: [],
  emotionalState: 'neutral',
  lastJobContext: null,

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
}))
