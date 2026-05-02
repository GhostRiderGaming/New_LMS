"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useBellaStore } from "@/lib/bellaStore";
import dynamic from "next/dynamic";

const Live2DViewer = dynamic(
  () => import("./Live2DViewer").then(mod => ({ default: mod.Live2DViewer as any })),
  { ssr: false }
) as any;

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key";

export function BellaPresence() {
  const [mounted, setMounted] = useState(false);
  const { isVisible, show, hide, addMessage } = useBellaStore();

  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isHappy, setIsHappy] = useState(false);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [userActivated, setUserActivated] = useState(false);

  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const intentionalStopRef = useRef(false);
  const processingRef = useRef(false); // Prevent double-trigger

  // Stop Bella completely — fully deactivates until user clicks Activate again
  const stopAll = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setIsTalking(false);
    setIsThinking(false);
    setIsHappy(false);
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
        setIsHappy(true);
        setTimeout(() => setIsHappy(false), 3000);
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

  // Play edge-tts audio via HTMLAudioElement
  const playEdgeTTS = useCallback((audioB64: string, text: string, recognition: any) => {
    const audio = new Audio("data:audio/mp3;base64," + audioB64);
    currentAudioRef.current = audio;

    audio.onended = () => {
      setIsTalking(false);
      setIsHappy(true);
      setTimeout(() => setIsHappy(false), 3000);
      currentAudioRef.current = null;
      processingRef.current = false;
      intentionalStopRef.current = false;
      try { recognition.start(); } catch (e) {}
    };

    audio.play().catch(() => {
      console.warn("[Bella] Edge-TTS playback blocked. Falling back to native.");
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
    setIsThinking(true);
    setIsTalking(false);
    setIsHappy(false);
    setLastReply(null);

    addMessage({ role: "user", text: transcript });

    try {
      const response = await fetch("http://localhost:8000/api/v1/bella/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ message: transcript, session_id: "voice-session-1" }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error("[Bella] Chat API error:", response.status, errBody);
        throw new Error(`Chat failed: ${response.status}`);
      }

      const data = await response.json();
      console.log("[Bella] Got reply:", data.reply?.substring(0, 80) + "...");

      addMessage({ role: "bella", text: data.reply });
      setLastReply(data.reply);
      setIsThinking(false);
      setIsTalking(true);

      // Try edge-tts audio first, then native fallback
      if (data.audio_b64) {
        playEdgeTTS(data.audio_b64, data.reply, recognition);
      } else {
        speakNative(data.reply, recognition);
      }
    } catch (error) {
      console.error("[Bella] Chat failed:", error);
      setIsThinking(false);
      setLastReply("Sorry, I couldn't process that. Please try again!");
      
      // Speak the error message so user knows
      speakNative("Sorry, I couldn't process that. Please try again!", recognition);
    }
  }, [show, addMessage, playEdgeTTS, speakNative]);

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

  if (!mounted) return null;

  return (
    <>
      {/* Bella 2.5D Model */}
      <div className="fixed bottom-20 right-6 z-[9999] pointer-events-auto">
        <div 
          className="relative rounded-2xl overflow-hidden shadow-2xl transition-all duration-700 border border-slate-800" 
          style={{ width: 220, height: 320, background: 'radial-gradient(ellipse at bottom, #1a0a2e 0%, #0a0a0f 70%)' }}
        >
          <Live2DViewer
            emotion={isHappy ? 'happy' : (isThinking ? 'thinking' : 'neutral')}
            isTalking={isTalking}
            onLoaded={() => console.log('Bella Live2D Loaded')}
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
              isThinking
                ? "bg-yellow-500/20 border-yellow-500/40 text-yellow-300"
                : isTalking
                ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                : isVoiceActive
                ? "bg-green-500/20 border-green-500/40 text-green-300"
                : "bg-slate-800/60 border-slate-600/40 text-slate-400"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${
              isThinking ? "bg-yellow-400 animate-pulse" :
              isTalking ? "bg-cyan-400 animate-pulse" :
              isVoiceActive ? "bg-green-400 animate-pulse" :
              "bg-slate-500"
            }`} />
            {isThinking ? "Thinking..." : isTalking ? "Speaking..." : isVoiceActive ? "Listening..." : "Offline"}
          </button>
        </div>
      )}

      {/* Chat Bubble */}
      {lastReply && (
        <div className="fixed bottom-[420px] right-6 z-[10000] max-w-sm pointer-events-auto animate-fadeInUp">
          <div className="bg-slate-900/90 backdrop-blur-xl border border-purple-500/30 rounded-2xl p-4 shadow-2xl shadow-purple-900/30">
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0">💬</span>
              <p className="text-sm text-slate-200 leading-relaxed">{lastReply}</p>
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
