'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Live2DViewer } from './Live2DViewer'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type EmotionState = 'neutral' | 'thinking' | 'happy'

interface Message {
  id: string
  role: 'user' | 'bella'
  text: string
  timestamp: Date
}

// ─── MAIN OVERLAY COMPONENT ──────────────────────────────────────────────────

const greetings = [
  "Hi! I'm Bella. What would you like to explore today?",
  "Hello! Ready to learn something amazing?",
]

export default function BellaOverlay() {
  const [open, setOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'bella', text: greetings[0], timestamp: new Date() }
  ])
  const [emotion, setEmotion] = useState<EmotionState>('neutral')
  const [thinking, setThinking] = useState(false)
  const [isTalking, setIsTalking] = useState(false)
  const [modelLoaded, setModelLoaded] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string>(crypto.randomUUID())

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const playTTS = useCallback(async (text: string) => {
    try {
      const { api } = await import('@/lib/api')
      const arrayBuffer = await api.bellaTTS(text)
      const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onplay = () => setIsTalking(true)
      audio.onended = () => {
        setIsTalking(false)
        setEmotion('neutral')
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        setIsTalking(true)
        setTimeout(() => { setIsTalking(false); setEmotion('neutral') }, 3000)
      }
      await audio.play()
    } catch {
      setIsTalking(true)
      setTimeout(() => { setIsTalking(false); setEmotion('neutral') }, 3000)
    }
  }, [])

  const addBellaMessage = useCallback((text: string, em: EmotionState = 'neutral') => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'bella', text, timestamp: new Date() }])
    setEmotion(em)
    playTTS(text)
  }, [playTTS])

  const handleSend = useCallback(async () => {
    if (!input.trim() || thinking) return
    const userText = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: userText, timestamp: new Date() }])
    setThinking(true)
    setEmotion('thinking')

    try {
      const { api } = await import('@/lib/api')
      const { reply } = await api.bellaChat(userText, sessionIdRef.current)
      setThinking(false)
      addBellaMessage(reply, 'happy')
    } catch {
      setThinking(false)
      setEmotion('neutral')
      addBellaMessage("Sorry, I had trouble connecting. Please try again.", 'neutral')
    }
  }, [input, thinking, addBellaMessage])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full bg-gradient-anime shadow-glow-purple flex items-center justify-center text-2xl hover:scale-110 transition-transform"
        style={{ animation: 'float 3s ease-in-out infinite' }}
        title="Open Bella"
      >
        🌸
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-end gap-3">
      {chatOpen && (
        <div className="w-72 h-[420px] bg-bg-card border border-border rounded-2xl shadow-card flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-accent-purple/20 to-accent-pink/20 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-sm font-semibold text-white">Bella</span>
            </div>
            <button onClick={() => setChatOpen(false)} className="text-slate-500 hover:text-white text-xs">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${msg.role === 'user' ? 'bg-accent-purple text-white rounded-br-sm' : 'bg-bg-elevated text-slate-300 rounded-bl-sm border border-border'}`}>
                  {msg.text}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="bg-bg-elevated border border-border px-3 py-2 rounded-xl rounded-bl-sm flex gap-1">
                  {[0, 150, 300].map((d) => <div key={d} className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 border-t border-border shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask anything..."
                className="flex-1 bg-bg-elevated border border-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-purple"
              />
              <button onClick={handleSend} disabled={thinking || !input.trim()} className="w-9 h-9 rounded-xl bg-accent-purple hover:bg-accent-purple-light disabled:opacity-40 flex items-center justify-center text-white shrink-0">↑</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-2 relative">
        <div className="relative rounded-2xl overflow-hidden border border-border shadow-card" style={{ width: 280, height: 400, background: 'radial-gradient(ellipse at bottom, #1a0a2e 0%, #0a0a0f 70%)' }}>
          {!modelLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-3">
              <span className="text-4xl animate-pulse">🌸</span>
              <span className="text-xs text-slate-400 animate-pulse">Loading Bella...</span>
            </div>
          )}

          <Live2DViewer
            emotion={emotion}
            isTalking={isTalking}
            onLoaded={() => setModelLoaded(true)}
          />
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setChatOpen(!chatOpen)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-card border border-border text-slate-400 hover:text-white hover:border-accent-purple">
            💬 Chat
          </button>
          <button onClick={() => { setOpen(false); setChatOpen(false) }} className="w-8 h-8 rounded-xl bg-bg-card border border-border text-slate-500 hover:text-white flex items-center justify-center text-xs">
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
