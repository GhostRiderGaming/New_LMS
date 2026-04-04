'use client'
/**
 * BellaChatUI — scrollable message list + text input + microphone button.
 * Requirements: 10.3
 *
 * - Chat bubble display (scrollable message list)
 * - Microphone button using MediaRecorder → POST /bella/transcribe
 * - Text input fallback (always visible)
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import { isSendDisabled, messageAlignClass, messageBubbleClass } from './BellaOverlay'
import type { BellaMessage } from '@/lib/bellaStore'

export interface BellaChatUIProps {
  messages: BellaMessage[]
  thinking: boolean
  isTalking: boolean
  onSend: (text: string) => void
  onClose?: () => void
}

export default function BellaChatUI({
  messages,
  thinking,
  isTalking,
  onSend,
  onClose,
}: BellaChatUIProps) {
  const [input, setInput] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    onSend(text)
  }, [input, thinking, onSend])

  const handleMicToggle = useCallback(async () => {
    setMicError(null)
    if (!isRecording) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const recorder = new MediaRecorder(stream)
        const chunks: BlobPart[] = []
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop())
          const blob = new Blob(chunks, { type: 'audio/webm' })
          try {
            const { api } = await import('@/lib/api')
            const { transcript } = await api.bellaTranscribe(blob)
            if (transcript.trim()) onSend(transcript.trim())
          } catch {
            setMicError('Transcription failed. Please try again.')
          }
          setIsRecording(false)
        }
        recorder.start()
        recorderRef.current = recorder
        setIsRecording(true)
      } catch {
        setMicError('Microphone access denied.')
      }
    } else {
      recorderRef.current?.stop()
      recorderRef.current = null
      setIsRecording(false)
    }
  }, [isRecording, onSend])

  const statusLabel = thinking ? '· thinking...' : isTalking ? '· speaking...' : '· online'

  return (
    <div className="w-72 h-[420px] bg-bg-card border border-border rounded-2xl shadow-card flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-accent-purple/20 to-accent-pink/20 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-sm font-semibold text-white">Bella</span>
          <span className="text-xs text-slate-400">{statusLabel}</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white text-xs transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${messageAlignClass(msg.role as 'user' | 'bella')}`}>
            <div
              className={`max-w-[85%] px-3 py-2 rounded-xl text-xs leading-relaxed ${messageBubbleClass(msg.role as 'user' | 'bella')}`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="bg-bg-elevated border border-border px-3 py-2 rounded-xl rounded-bl-sm">
              <div className="flex gap-1">
                {[0, 150, 300].map((d) => (
                  <div
                    key={d}
                    className="w-1.5 h-1.5 rounded-full bg-accent-purple animate-bounce"
                    style={{ animationDelay: `${d}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border shrink-0">
        {micError && <p className="text-xs text-red-400 mb-2 px-1">{micError}</p>}
        <div className="flex gap-2">
          {/* Mic button */}
          <button
            onClick={handleMicToggle}
            disabled={thinking}
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm transition-colors shrink-0 relative ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-bg-elevated border border-border text-slate-400 hover:text-white hover:border-accent-purple disabled:opacity-40'
            }`}
            title={isRecording ? 'Stop recording' : 'Start recording'}
          >
            🎤
            {isRecording && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" />
            )}
          </button>

          {/* Text input */}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask Bella anything..."
            className="flex-1 bg-bg-elevated border border-border rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-accent-purple transition-colors"
          />

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={isSendDisabled(thinking, input)}
            className="w-9 h-9 rounded-xl bg-accent-purple hover:bg-accent-purple-light disabled:opacity-40 flex items-center justify-center text-white text-sm transition-colors shrink-0"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
