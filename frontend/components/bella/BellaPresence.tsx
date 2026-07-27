"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useBellaStore } from "@/lib/bellaStore";
import { api } from "@/lib/api";
import dynamic from "next/dynamic";

const Live2DViewer = dynamic(
  () => import("./Live2DViewer").then(mod => ({ default: mod.Live2DViewer as any })),
  { ssr: false }
) as any;

export type EmotionState = 'neutral' | 'thinking' | 'happy' | 'angry' | 'scared' | 'blush';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key";

export function BellaPresence() {
  const [mounted, setMounted] = useState(false);
  const { isVisible, show, hide, addMessage, appearance, pendingExplanation, clearExplanation, setIsExplaining, stopSpeakingRequested, clearStopRequest, language } = useBellaStore();

  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<EmotionState>('neutral');
  const previousQuestionsRef = useRef<Set<string>>(new Set());
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [userActivated, setUserActivated] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isReplyExpanded, setIsReplyExpanded] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0);

  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const intentionalStopRef = useRef(false);
  const processingRef = useRef(false); // Prevent double-trigger

  // ─── DRAGGING (pure DOM, zero React re-renders) ─────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      dragState.current.dragging = true;
      dragState.current.startX = e.clientX - dragState.current.offsetX;
      dragState.current.startY = e.clientY - dragState.current.offsetY;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragState.current.dragging) return;
      dragState.current.offsetX = e.clientX - dragState.current.startX;
      dragState.current.offsetY = e.clientY - dragState.current.startY;
      el.style.transform = `translate(${dragState.current.offsetX}px, ${dragState.current.offsetY}px)`;
    };
    const onPointerUp = (e: PointerEvent) => {
      dragState.current.dragging = false;
      el.releasePointerCapture(e.pointerId);
      el.style.cursor = 'grab';
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  useEffect(() => {
    if (textInput.trim().length > 0 && !isTalking && currentEmotion !== 'blush' && currentEmotion !== 'thinking') {
      setCurrentEmotion('blush');
    } else if (textInput.trim().length === 0 && currentEmotion === 'blush') {
      setCurrentEmotion('neutral');
    }
  }, [textInput, isTalking]);

  // Stop Bella completely — fully deactivates until user clicks Activate again
  const stopAll = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setIsTalking(false);
    setAudioVolume(0);
    setCurrentEmotion('neutral');
    setLastReply("Okay, I'll be quiet! Click 'Activate Bella' when you need me again.");
    processingRef.current = false;
    intentionalStopRef.current = true;
    // Stop recognition and deactivate entirely
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }
    setIsVoiceActive(false);
    // Fully deactivate — user must click Activate again
    setUserActivated(false);
  }, []);

  // Speak using browser native TTS as reliable fallback
  const speakNative = useCallback((text: string, recognition: any) => {
    const msg = new SpeechSynthesisUtterance(text);
    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      msg.voice = voices.find((v: any) =>
        v.name.includes("Zira") || v.name.includes("Female") || v.name.includes("Samantha")
      ) || voices[0];
      msg.rate = 0.95;
      msg.pitch = 1.1;
      msg.onstart = () => setIsTalking(true);
      msg.onend = () => {
        setIsTalking(false);
        setCurrentEmotion('happy');
        setTimeout(() => setCurrentEmotion(prev => prev === 'happy' ? 'neutral' : prev), 3000);
        processingRef.current = false;
        intentionalStopRef.current = false;
        try { recognition.start(); } catch (e) {}
      };
      window.speechSynthesis.speak(msg);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = doSpeak;
    } else {
      doSpeak();
    }
  }, []);

  // Play edge-tts audio via HTMLAudioElement with real-time lip sync
  const playEdgeTTS = useCallback((audioB64: string, text: string, recognition: any) => {
    const audio = new Audio("data:audio/mp3;base64," + audioB64);
    currentAudioRef.current = audio;

    // Web Audio API for real-time lip sync
    let audioCtx: AudioContext | null = null;
    let reqId = 0;

    const setupLipSync = () => {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        audioCtx = new AudioContextClass();
        const source = audioCtx.createMediaElementSource(audio);
        const analyser = audioCtx.createAnalyser();
        analyser.smoothingTimeConstant = 0.5;
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLipSync = () => {
          if (!currentAudioRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const average = sum / dataArray.length;
          const volume = Math.min(1, average / 60); 
          setAudioVolume(volume);
          reqId = requestAnimationFrame(updateLipSync);
        };
        updateLipSync();
      } catch (e) {
        console.warn("[Bella] Lip sync setup failed:", e);
      }
    };

    audio.onplay = () => {
      if (!audioCtx) setupLipSync();
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    };

    audio.onended = () => {
      setIsTalking(false);
      setAudioVolume(0);
      setCurrentEmotion('happy');
      setTimeout(() => setCurrentEmotion(prev => prev === 'happy' ? 'neutral' : prev), 3000);
      currentAudioRef.current = null;
      processingRef.current = false;
      intentionalStopRef.current = false;
      if (reqId) cancelAnimationFrame(reqId);
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      try { recognition.start(); } catch (e) {}
    };

    audio.play().catch(() => {
      console.warn("[Bella] Edge-TTS playback blocked. Falling back to native.");
      if (reqId) cancelAnimationFrame(reqId);
      speakNative(text, recognition);
    });
  }, [speakNative]);

  // Process a final transcript
  const processTranscript = useCallback(async (transcript: string, recognition: any) => {
    if (processingRef.current) return;
    processingRef.current = true;

    // Stop listening during processing
    try { recognition.stop(); } catch (e) {}
    intentionalStopRef.current = true;

    show();
    setIsTalking(false);
    setLastReply(null);

    const q = transcript.trim().toLowerCase();
    let nextEmotion: EmotionState = 'thinking';
    if (previousQuestionsRef.current.has(q)) {
      nextEmotion = Math.random() > 0.5 ? 'angry' : 'scared';
    } else {
      previousQuestionsRef.current.add(q);
    }
    setCurrentEmotion(nextEmotion);

    addMessage({ role: "user", text: transcript });

    try {
      const data = await api.bellaChat(transcript, "voice-session-1", language);
      console.log("[Bella] Got reply:", data.reply?.substring(0, 80) + "...");

      addMessage({ role: "bella", text: data.reply });
      setLastReply(data.reply);
      setIsReplyExpanded(false);
      setIsTalking(true);

      // Try edge-tts audio first, then native fallback
      if (data.audio_b64) {
        playEdgeTTS(data.audio_b64, data.reply, recognition);
      } else {
        speakNative(data.reply, recognition);
      }
    } catch (error) {
      console.error("[Bella] Chat failed:", error);
      setCurrentEmotion('neutral');
      setLastReply("Sorry, I couldn't process that. Please try again!");
      
      // Speak the error message so user knows
      speakNative("Sorry, I couldn't process that. Please try again!", recognition);
    }
  }, [show, addMessage, playEdgeTTS, speakNative]);

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || processingRef.current) return;
    const text = textInput.trim();
    setTextInput("");
    setIsChatExpanded(false);
    
    // Stop any ongoing speech
    stopAll();
    // processTranscript expects a recognition object with start/stop, we can mock it if needed
    const dummyRecognition = recognitionRef.current || { start: () => {}, stop: () => {} };
    processTranscript(text, dummyRecognition);
  };

  // --- WAKE WORD LOOP ---
  useEffect(() => {
    setMounted(true);
    if (!userActivated) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("[Bella] Speech Recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = true;
    recognition.interimResults = false; // CRITICAL FIX: Only fire on final results
    recognition.lang = "en-US";

    recognition.onstart = () => {
      console.log("[Bella] 🎙️ Mic active — listening for wake word...");
      setIsVoiceActive(true);
    };

    recognition.onresult = (event: any) => {
      // Only process final results
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue; // Skip interim

        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        console.log("[Bella] Final transcript:", transcript);

        // Killswitch — check BEFORE wake word ("stop bella" contains "bella")
        if (
          transcript.includes("stop bella") ||
          transcript.includes("quiet bella") ||
          transcript.includes("shut up bella") ||
          transcript.includes("bella stop") ||
          transcript.includes("bella quiet")
        ) {
          console.log("[Bella] 🛑 Stop command detected. Deactivating.");
          stopAll();
          return;
        }

        // Wake word — trigger only on final, complete transcripts
        if (transcript.includes("bella") && !intentionalStopRef.current && !processingRef.current) {
          processTranscript(transcript, recognition);
          return;
        }
      }
    };

    // Auto-restart loop
    recognition.onend = () => {
      setIsVoiceActive(false);
      if (!intentionalStopRef.current) {
        setTimeout(() => {
          try { recognition.start(); } catch (e) {}
        }, 500);
      }
    };

    recognition.onerror = (e: any) => {
      console.warn("[Bella] Recognition error:", e.error);
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setTimeout(() => {
          try { recognition.start(); } catch (e) {}
        }, 1000);
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error("[Bella] Failed to start recognition:", e);
    }

    return () => {
      intentionalStopRef.current = true;
      try { recognition.stop(); } catch (e) {}
    };
  }, [userActivated, stopAll, processTranscript]);

  // ─── EXPLANATION TRIGGER (from Scene Forge / other pages) ──────────
  useEffect(() => {
    if (!pendingExplanation) return;
    const { text, audioB64 } = pendingExplanation;

    // Clear immediately so it doesn't re-trigger
    clearExplanation();

    // Stop any current speech/recognition
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    intentionalStopRef.current = true;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }

    // Show Bella and set talking state
    show();
    setLastReply(text);
    setIsReplyExpanded(false);
    addMessage({ role: 'bella', text });
    setIsTalking(true);
    setIsExplaining(true);

    // Play audio
    if (audioB64) {
      const audio = new Audio("data:audio/mp3;base64," + audioB64);
      currentAudioRef.current = audio;

      audio.onended = () => {
        setIsTalking(false);
        setIsExplaining(false);
        setCurrentEmotion('happy');
        setTimeout(() => setCurrentEmotion(prev => prev === 'happy' ? 'neutral' : prev), 3000);
        currentAudioRef.current = null;
        processingRef.current = false;
        intentionalStopRef.current = false;
        // Resume recognition if activated
        if (userActivated && recognitionRef.current) {
          try { recognitionRef.current.start(); } catch(e) {}
        }
      };

      audio.play().catch(() => {
        // Fallback to native TTS
        const dummyRecognition = recognitionRef.current || { start: () => {} };
        speakNative(text, dummyRecognition);
      });
    } else {
      // No audio — use native TTS
      const dummyRecognition = recognitionRef.current || { start: () => {} };
      speakNative(text, dummyRecognition);
    }
  }, [pendingExplanation, clearExplanation, show, addMessage, speakNative, userActivated, setIsExplaining]);

  // ─── STOP SPEAKING REQUEST (from Scene Forge stop button) ──────────
  useEffect(() => {
    if (!stopSpeakingRequested) return;
    clearStopRequest();

    // Stop audio playback
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();

    // Reset state
    setIsTalking(false);
    setIsExplaining(false);
    setCurrentEmotion('neutral');
    processingRef.current = false;
    intentionalStopRef.current = false;

    // Resume recognition if activated
    if (userActivated && recognitionRef.current) {
      try { recognitionRef.current.start(); } catch(e) {}
    }
  }, [stopSpeakingRequested, clearStopRequest, userActivated, setIsExplaining]);

  if (!mounted) return null;

  return (
    <>
      {/* Bella 2.5D Model — pure DOM drag (no React re-renders) */}
      <div
        ref={containerRef}
        className="fixed bottom-20 right-2 z-[9999] pointer-events-auto cursor-grab touch-none"
        style={{ willChange: 'transform' }}
      >
        <div
          style={{ width: 280, height: 400, contain: 'layout style paint' }}
          className="relative bella-float"
        >
          <Live2DViewer
            key={appearance}
            modelPath={appearance}
            emotion={currentEmotion}
            isTalking={isTalking}
            audioVolume={audioVolume}
            onLoaded={() => console.log('Bella Live2D Loaded:', appearance)}
          />
        </div>
      </div>

      {/* Activation Button — Required for browser autoplay policies */}
      {!userActivated && (
        <button
          onClick={() => setUserActivated(true)}
          className="fixed bottom-6 right-6 z-[10000] flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white text-sm font-bold shadow-lg shadow-purple-500/30 hover:scale-105 transition-transform animate-bounce pointer-events-auto"
        >
          <span className="text-lg">🎙️</span>
          Activate Bella
        </button>
      )}

      {/* Mic Status Indicator */}
      {userActivated && (
        <div className="fixed bottom-6 right-6 z-[10000] pointer-events-auto">
          <button
            onClick={stopAll}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium transition-all backdrop-blur-md border ${
              currentEmotion === 'thinking' || currentEmotion === 'angry' || currentEmotion === 'scared'
                ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300"
                : isTalking
                ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                : isVoiceActive
                ? "bg-green-500/20 border-green-500/40 text-green-300"
                : "bg-slate-800/60 border-slate-600/40 text-slate-400"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${
              currentEmotion === 'thinking' || currentEmotion === 'angry' || currentEmotion === 'scared' ? "bg-yellow-400 animate-pulse" :
              isTalking ? "bg-cyan-400 animate-pulse" :
              isVoiceActive ? "bg-green-400 animate-pulse" :
              "bg-slate-500"
            }`} />
            {currentEmotion === 'thinking' || currentEmotion === 'angry' || currentEmotion === 'scared' ? "Processing..." : isTalking ? "Speaking..." : isVoiceActive ? "Listening..." : "Offline"}
          </button>
        </div>
      )}

      {/* Text Chat Input */}
      {userActivated && (
        <div className="fixed bottom-20 right-6 z-[10000] pointer-events-auto flex flex-col items-end gap-2">
          {isChatExpanded ? (
            <form 
              onSubmit={handleTextSubmit}
              className="bg-slate-900/95 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-2 shadow-2xl flex items-center gap-2 animate-fadeInUp min-w-[300px]"
            >
              <input 
                type="text" 
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Ask Bella a question..."
                className="bg-transparent border-none outline-none text-sm text-white px-3 py-1 flex-1 min-w-0"
                autoFocus
              />
              <button 
                type="submit"
                disabled={!textInput.trim() || processingRef.current}
                className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center hover:bg-purple-500/40 disabled:opacity-50 transition-colors shrink-0"
              >
                ↗
              </button>
              <button 
                type="button"
                onClick={() => setIsChatExpanded(false)}
                className="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 flex items-center justify-center hover:text-white transition-colors shrink-0"
              >
                ✕
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsChatExpanded(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium bg-purple-500/20 border border-purple-500/40 text-purple-300 backdrop-blur-md hover:bg-purple-500/30 transition-all shadow-lg shadow-purple-900/20"
            >
              <span>⌨️</span> Type to Bella
            </button>
          )}
        </div>
      )}

      {/* Chat Bubble */}
      {lastReply && (
        <div className="fixed bottom-[420px] right-6 z-[10000] max-w-sm pointer-events-auto animate-fadeInUp">
          <div className="bg-slate-900/90 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-4 shadow-2xl shadow-purple-900/30 relative">
            <div className={`flex items-start gap-2 ${isReplyExpanded ? 'max-h-64 overflow-y-auto custom-scrollbar' : ''} pr-2`}>
              <span className="text-lg shrink-0">💬</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm text-slate-200 leading-relaxed ${!isReplyExpanded ? 'line-clamp-3' : ''}`}>
                  {lastReply}
                </p>
                {lastReply.length > 100 && (
                  <button
                    onClick={() => setIsReplyExpanded(!isReplyExpanded)}
                    className="text-purple-400 text-xs hover:text-purple-300 mt-1"
                  >
                    {isReplyExpanded ? "Show less" : "Read more"}
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={() => setLastReply(null)}
              className="absolute top-2 right-3 text-slate-500 hover:text-white text-xs"
            >✕</button>
          </div>
        </div>
      )}
    </>
  );
}
