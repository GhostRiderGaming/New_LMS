"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { useBellaStore } from "@/lib/bellaStore";
import { api } from "@/lib/api";
import dynamic from "next/dynamic";

const Live2DViewer = dynamic(
  () => import("./Live2DViewer").then(mod => ({ default: mod.Live2DViewer as any })),
  { ssr: false }
) as any;

export type EmotionState = 'neutral' | 'thinking' | 'happy' | 'angry' | 'scared' | 'blush' | 'celebrate';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "dev-api-key";

// Pre-computed mote positions — stable across renders
const MOTE_CONFIG = Array.from({ length: 18 }, (_, i) => ({
  bottom: 6  + (i * 13 % 45),
  left:   72 + (i * 17 % 56),
  size:   i % 4 === 0 ? 3 : 2,
  pink:   i % 6 === 0,
  dur:    2.0 + (i * 0.23 % 2.2),
  delay:  (i * 0.31 % 2.8),
  tx:     -12 + (i * 7 % 25),
}));

// Calculate safe position when Bella is expanded so character is never cut off by screen borders
function getSafeExpandedPosition(
  currentPos: { x: number; y: number },
  currentScale: number
): { x: number; y: number } {
  if (typeof window === 'undefined') return currentPos;

  const MARGIN = 16; // Minimum padding from viewport border (px)

  // Unscaled Bella geometry relative to bottom-right origin of container:
  // - Bella is 280px wide, centered over 100px orb
  // - Bella extends 90px to the right of container right edge
  // - Bella extends 190px to the left of container right edge
  // - Bella top edge is 515px above container bottom (including close button)
  // - Orb bottom is at container bottom (0px)
  const BELLA_RIGHT_OFFSET = 90;
  const BELLA_LEFT_OFFSET = 190;
  const BELLA_TOP_OFFSET = 515;

  // Max X: keeps Bella right edge within (window.innerWidth - MARGIN)
  const maxX = 16 - MARGIN - Math.round(BELLA_RIGHT_OFFSET * currentScale);

  // Min X: keeps Bella left edge within MARGIN
  const minX = MARGIN + 16 + Math.round(BELLA_LEFT_OFFSET * currentScale) - window.innerWidth;

  // Max Y: keeps orb bottom within (window.innerHeight - MARGIN)
  const maxY = 16 - MARGIN;

  // Min Y: keeps Bella top within MARGIN
  const minY = MARGIN + 16 + Math.round(BELLA_TOP_OFFSET * currentScale) - window.innerHeight;

  let targetX = currentPos.x;
  let targetY = currentPos.y;

  if (minX > maxX) {
    targetX = Math.round((minX + maxX) / 2);
  } else {
    targetX = Math.max(minX, Math.min(maxX, currentPos.x));
  }

  if (minY > maxY) {
    targetY = maxY;
  } else {
    targetY = Math.max(minY, Math.min(maxY, currentPos.y));
  }

  return { x: targetX, y: targetY };
}

// ─── Educational Client-side Fallback (guarantees Bella always answers warmly) ─
function generateClientFallback(query: string, lang?: string): string {
  const q = query.toLowerCase().trim();
  if (lang === 'hindi' || lang === 'hinglish') {
    if (q.includes('naam') || q.includes('who are you') || q.includes('kaun') || q.includes('name')) {
      return "Mera naam Bella hai! Main aapki AI learning tutor hoon. Hum science, math aur anime creations saath mein explore kar sakte hain!";
    }
    if (q.includes('hello') || q.includes('hi') || q.includes('namaste') || q.includes('hey')) {
      return "Namaste! Main Bella hoon, aapki learning companion. Aaj aap kaunsa topic seekhna chahte hain?";
    }
    if (q.includes('kya') || q.includes('kaise') || q.includes('batao') || q.includes('help')) {
      return `Aapne "${query}" ke baare mein poochha hai. Chaliye ise aasaani se step by step samajhte hain! Main aapko explain karti hoon.`;
    }
  }

  if (q.includes('who are you') || q.includes('your name') || q.includes('what are you') || q.includes('who r u')) {
    return "I am Bella, your anime educational companion and tutor! I'm here to explore ideas, explain difficult concepts, and make learning feel exciting and clear. What would you like to discover today?";
  }
  if (q.includes('hello') || q.includes('hi') || q.includes('hey') || q.includes('sup') || q.includes('morning') || q.includes('evening')) {
    return "Hello there! I'm Bella, and I'm really glad you're here. We can dive into science, math, code, or creative stories whenever you're ready. What are you curious about today?";
  }
  if (q.includes('how are you') || q.includes("how's it going") || q.includes('how r u')) {
    return "I'm doing wonderful, thank you for asking! I'm excited to help you learn something new today. What concept should we explore together?";
  }
  if (q.includes('help') || q.includes('what can you do') || q.includes('capabilities')) {
    return "I'm here as your learning mentor. Together we can create anime concept art in Scene Forge, test interactive simulations in Lab Engine, inspect 3D models in Holodeck, or read visual stories in Chronicle.";
  }
  if (q.includes('photo') || q.includes('plant') || q.includes('chlorophyll') || q.includes('tree')) {
    return "Photosynthesis is truly wonderful! Plants take gentle sunlight, water from the soil, and carbon dioxide from the air, transforming them into glucose for energy and fresh oxygen for us.";
  }
  if (q.includes('gravity') || q.includes('physics') || q.includes('force') || q.includes('newton') || q.includes('motion')) {
    return "Newton's Laws of Motion describe how everything moves in our universe. From objects staying in motion to forces causing acceleration, every action creates an equal and opposite reaction.";
  }
  if (q.includes('math') || q.includes('calculus') || q.includes('algebra') || q.includes('equation') || q.includes('geometry')) {
    return "Mathematics is like a beautiful language that reveals patterns all around us. Whether it is solving equations or understanding geometry, we can take it one gentle step at a time together.";
  }
  if (q.includes('ai') || q.includes('robot') || q.includes('code') || q.includes('programming') || q.includes('computer')) {
    return "Computer science and artificial intelligence allow us to build systems that solve real-world problems. We can explore algorithms, data structures, and machine learning models step by step!";
  }
  const cleanQ = query.length > 40 ? query.substring(0, 40) + '...' : query;
  return `That's a fascinating question about "${cleanQ}". Let's explore it together! What specific part would you like to dive into first?`;
}

// ─── Responsive scale hook ─────────────────────────────────────────
// Returns a scale factor based on viewport width & height.
function useResponsiveScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (w <= 380 || h <= 540)      setScale(0.58);
      else if (w <= 480 || h <= 640) setScale(0.68);
      else if (w <= 768 || h <= 720) setScale(0.80);
      else if (w <= 1024)            setScale(0.90);
      else                           setScale(1.0);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return scale;
}

const SUGGESTIONS = [
  "🧬 How does DNA replication work?",
  "🌌 What happens inside a black hole?",
  "⚡ Can you explain Newton's 3 Laws?",
  "✨ Tell me an amazing science fact!",
];

export function BellaPresence() {
  const [mounted, setMounted] = useState(false);
  const { isVisible, show, hide, addMessage, messages, appearance, pendingExplanation, clearExplanation, setIsExplaining, stopSpeakingRequested, clearStopRequest, language } = useBellaStore();
  const scale = useResponsiveScale();

  // Derived sizes — everything flows from scale
  const ORB   = Math.round(100 * scale);    // orb diameter px
  const LIVE_W = Math.round(280 * scale);   // Live2D canvas width
  const LIVE_H = Math.round(400 * scale);   // Live2D canvas height
  const CONE_H = Math.round(400 * scale);   // cone SVG height
  const CONE_W = Math.round(320 * scale);   // cone SVG width
  // Chat panel width: at most 320px, at least 260px
  const CHAT_W = Math.max(260, Math.round(320 * scale));

  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<EmotionState>('neutral');
  const previousQuestionsRef = useRef<Set<string>>(new Set());
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [userActivated, setUserActivated] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [isReplyExpanded, setIsReplyExpanded] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0);

  // ─── DRAG & ORB STATE ──────────────────────────────────────────────
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const dragStartMousePos = useRef({ x: 0, y: 0 });
  const [isOrbTap, setIsOrbTap] = useState(false);
  const preOpenPosition = useRef<{ x: number; y: number } | null>(null);
  const hasDraggedRef = useRef(false);

  const [portalOpen, setPortalOpen] = useState(false);
  const [bellaMenuOpen, setBellaMenuOpen] = useState(false);
  const [chatButtonVisible, setChatButtonVisible] = useState(false); // High-visibility action button on tap
  const [chatOpen, setChatOpen] = useState(false);           // inline chat panel
  const [isEmerging, setIsEmerging] = useState(false);
  const [isSubmerging, setIsSubmerging] = useState(false);

  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const intentionalStopRef = useRef(false);
  const processingRef = useRef(false); // Prevent double-trigger

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, chatOpen, currentEmotion]);

  useEffect(() => {
    if (textInput.trim().length > 0 && !isTalking && currentEmotion !== 'blush' && currentEmotion !== 'thinking') {
      setCurrentEmotion('blush');
    } else if (textInput.trim().length === 0 && currentEmotion === 'blush') {
      setCurrentEmotion('neutral');
    }
  }, [textInput, isTalking]);

  // ─── DRAG LOGIC ────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    hasDraggedRef.current = false;
    if (portalOpen) return; // Don't drag when expanded
    e.preventDefault();
    setIsDragging(true);
    dragStartPos.current = { ...position };
    dragStartMousePos.current = { x: e.clientX, y: e.clientY };
  }, [position, portalOpen]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartMousePos.current.x;
    const dy = e.clientY - dragStartMousePos.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      hasDraggedRef.current = true;
    }
    // Clamp so the orb can move completely from screen right edge to screen left edge
    // Container anchors bottom-right at (right: 16px, bottom: 16px)
    // Negative X moves left, negative Y moves up
    const w = window.innerWidth;
    const h = window.innerHeight;
    const currentScale = w <= 380 || h <= 540 ? 0.58 :
      w <= 480 || h <= 640 ? 0.68 :
      w <= 768 || h <= 720 ? 0.80 :
      w <= 1024 ? 0.90 : 1.0;
    const orbSize = Math.round(100 * currentScale);
    
    // Exact screen edge limits:
    // Left edge: when position.x = -(w - 16 - orbSize), orb's left border is at 0px (touching left screen edge)
    const minX = -(w - 16 - orbSize);
    const maxX = 16; // allows touching right screen edge
    const minY = -(h - 16 - orbSize); // allows touching top screen edge
    const maxY = 16; // allows touching bottom screen edge
    setPosition({
      x: Math.max(minX, Math.min(maxX, dragStartPos.current.x + dx)),
      y: Math.max(minY, Math.min(maxY, dragStartPos.current.y + dy)),
    });
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    } else {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    }
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, handlePointerMove, handlePointerUp]);

  // ─── ORB EXPAND / COLLAPSE ─────────────────────────────────────────
  const openPortal = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (portalOpen || isEmerging || isDragging) return;

    // Check if Bella would get cut off by screen border and smoothly move orb
    preOpenPosition.current = { ...position };
    const safePos = getSafeExpandedPosition(position, scale);
    if (safePos.x !== position.x || safePos.y !== position.y) {
      setPosition(safePos);
    }

    setIsOrbTap(true);
    setTimeout(() => setIsOrbTap(false), 600);
    setIsEmerging(true);
    setPortalOpen(true);
    setChatOpen(true); // Open chat immediately so user can converse right away
    setTimeout(() => setIsEmerging(false), 1200);
  }, [portalOpen, isEmerging, isDragging, position, scale]);

  const closePortal = useCallback(() => {
    if (!portalOpen || isSubmerging) return;

    // Stop all audio/voice immediately
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setIsTalking(false);
    setAudioVolume(0);
    setCurrentEmotion('neutral');
    processingRef.current = false;
    setIsProcessing(false);
    intentionalStopRef.current = true;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }
    setIsVoiceActive(false);
    setUserActivated(false);
    setBellaMenuOpen(false);
    setIsChatExpanded(false);
    setChatButtonVisible(false);
    setChatOpen(false);
    setLastReply(null);

    // Play synchronized submerge animation
    setIsSubmerging(true);

    // Synchronized glide: as Bella descends into the orb (at ~160ms),
    // glide the orb back to its pre-expanded corner location
    const savedPrePos = preOpenPosition.current;
    preOpenPosition.current = null;
    if (savedPrePos) {
      setTimeout(() => {
        setPosition(savedPrePos);
      }, 160);
    }

    // Complete transition after 500ms
    setTimeout(() => {
      setPortalOpen(false);
      setIsSubmerging(false);
    }, 500);
  }, [portalOpen, isSubmerging]);

  // Keep Bella fully in view on window resize if open
  useEffect(() => {
    if (!portalOpen) return;
    const handleResize = () => {
      setPosition(prev => getSafeExpandedPosition(prev, scale));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [portalOpen, scale]);

  // Click on Bella character → toggle chat box
  const handleBellaClick = useCallback((e?: React.SyntheticEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (isEmerging || isSubmerging) return;
    setChatOpen(prev => !prev);
  }, [isEmerging, isSubmerging]);

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
    setLastReply(null);
    processingRef.current = false;
    setIsProcessing(false);
    intentionalStopRef.current = true;
    // Stop recognition and deactivate entirely
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch(e) {}
    }
    setIsVoiceActive(false);
    // Fully deactivate — user must click Activate again
    setUserActivated(false);
  }, []);

  // Play Kokoro / Edge-TTS audio via HTMLAudioElement with real-time lip sync
  const playEdgeTTS = useCallback((audioB64: string, text: string, recognition: any) => {
    const mimeType = audioB64.startsWith("UklGR") ? "audio/wav" : "audio/mp3";
    const audioSrc = audioB64.startsWith("data:") ? audioB64 : `data:${mimeType};base64,${audioB64}`;
    const audio = new Audio(audioSrc);
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
      setIsProcessing(false);
      intentionalStopRef.current = false;
      if (reqId) cancelAnimationFrame(reqId);
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      try { recognition?.start?.(); } catch (e) {}
    };

    audio.onerror = (err) => {
      console.warn("[Bella] Audio playback failed:", err);
      if (reqId) cancelAnimationFrame(reqId);
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      currentAudioRef.current = null;
      setIsTalking(false);
      processingRef.current = false;
      setIsProcessing(false);
    };

    audio.play().catch((err) => {
      console.warn("[Bella] Audio autoplay blocked:", err);
      if (reqId) cancelAnimationFrame(reqId);
      setIsTalking(false);
      processingRef.current = false;
      setIsProcessing(false);
    });
  }, []);

  // Process a final transcript
  const processTranscript = useCallback(async (transcript: string, recognition: any) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    // Stop listening during processing
    try { recognition?.stop?.(); } catch (e) {}
    intentionalStopRef.current = true;

    show();
    if (!portalOpen) {
      preOpenPosition.current = { ...position };
      const safePos = getSafeExpandedPosition(position, scale);
      if (safePos.x !== position.x || safePos.y !== position.y) {
        setPosition(safePos);
      }
      setPortalOpen(true);
      setChatOpen(true);
      setIsEmerging(true);
      setTimeout(() => setIsEmerging(false), 1200);
    }
    setIsTalking(false);
    setLastReply(null);

    // Safety watchdog: clear processing lock after 30 seconds max
    const watchdog = setTimeout(() => {
      if (processingRef.current) {
        console.warn("[Bella] Watchdog: resetting processing lock after timeout");
        processingRef.current = false;
        setIsProcessing(false);
        setCurrentEmotion('neutral');
      }
    }, 30000);

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
      // Step 1: Get text reply instantly (no TTS blocking)
      const data = await api.bellaChat(transcript, "voice-session-1", language);
      clearTimeout(watchdog);
      console.log("[Bella] Got reply:", data.reply?.substring(0, 80) + "...");

      const finalReply = data.reply || generateClientFallback(transcript, language);
      addMessage({ role: "bella", text: finalReply });
      setLastReply(finalReply);
      setIsReplyExpanded(false);

      // Map backend emotion to Bella Live2D model expression
      if (data.emotion) {
        const emo = data.emotion.toLowerCase();
        if (["happy", "joyful", "delighted", "cheerful", "excited", "welcoming", "warm", "friendly"].some(e => emo.includes(e))) {
          setCurrentEmotion('happy');
        } else if (["celebrate", "proud", "enthusiastic", "wonder", "passionate"].some(e => emo.includes(e))) {
          setCurrentEmotion('celebrate');
        } else if (["curious", "thinking", "intrigued", "fascinated", "exploring"].some(e => emo.includes(e))) {
          setCurrentEmotion('thinking');
        } else {
          setCurrentEmotion('neutral');
        }
      }

      // Step 2: Fetch TTS audio in background, play when ready
      setIsTalking(true);
      api.bellaTTS(finalReply, { language: language || undefined, category: data.category || undefined, emotion: data.emotion || undefined })
        .then((audioBuffer) => {
          const blob = new Blob([audioBuffer], { type: "audio/wav" });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(",")[1];
            if (base64) {
              playEdgeTTS(base64, finalReply, recognition);
            } else {
              setIsTalking(false);
            }
          };
          reader.readAsDataURL(blob);
        })
        .catch((ttsErr) => {
          console.warn("[Bella] Background TTS failed:", ttsErr);
          setIsTalking(false);
        });
    } catch (error) {
      clearTimeout(watchdog);
      console.error("[Bella] Backend request error, using friendly client response:", error);
      setCurrentEmotion('neutral');
      processingRef.current = false;
      setIsProcessing(false);
      
      const fallbackReply = generateClientFallback(transcript, language);
      addMessage({ role: "bella", text: fallbackReply });
      setLastReply(fallbackReply);
      setIsTalking(true);
      
      api.bellaTTS(fallbackReply, { language: language || undefined })
        .then((audioBuffer) => {
          const blob = new Blob([audioBuffer], { type: "audio/wav" });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(",")[1];
            if (base64) {
              playEdgeTTS(base64, fallbackReply, recognition);
            } else {
              setIsTalking(false);
            }
          };
          reader.readAsDataURL(blob);
        })
        .catch(() => setIsTalking(false));
    }
  }, [show, addMessage, playEdgeTTS, portalOpen, position, scale, language]);

  const handleTextSubmit = (e?: React.FormEvent, customText?: string) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const query = (customText ?? textInput).trim();
    if (!query || processingRef.current) return;
    setTextInput("");
    setChatOpen(true);
    
    // Stop any ongoing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setIsTalking(false);
    
    // Process the question
    const dummyRecognition = recognitionRef.current || { start: () => {}, stop: () => {} };
    processTranscript(query, dummyRecognition);
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

    // Auto-open portal if needed
    if (!portalOpen) {
      preOpenPosition.current = { ...position };
      const safePos = getSafeExpandedPosition(position, scale);
      if (safePos.x !== position.x || safePos.y !== position.y) {
        setPosition(safePos);
      }
      setPortalOpen(true);
      setIsEmerging(true);
      setTimeout(() => setIsEmerging(false), 1200);
    }

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
      const mimeType = audioB64.startsWith("UklGR") ? "audio/wav" : "audio/mp3";
      const audioSrc = audioB64.startsWith("data:") ? audioB64 : `data:${mimeType};base64,${audioB64}`;
      const audio = new Audio(audioSrc);
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
        setIsTalking(false);
      });
    } else {
      // No audio — fetch via Kokoro
      const dummyRecognition = recognitionRef.current || { start: () => {} };
      api.bellaTTS(text, { language: 'en' })
        .then((audioBuffer) => {
          const blob = new Blob([audioBuffer], { type: "audio/wav" });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(",")[1];
            if (base64) {
              playEdgeTTS(base64, text, dummyRecognition);
            } else {
              setIsTalking(false);
            }
          };
          reader.readAsDataURL(blob);
        })
        .catch(() => setIsTalking(false));
    }
  }, [pendingExplanation, clearExplanation, show, addMessage, playEdgeTTS, userActivated, setIsExplaining, portalOpen, position, scale]);

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

  // Toggle: first click opens, second click closes
  const handleOrbClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // Ignore if was a drag action
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }
    if (portalOpen) {
      closePortal();
    } else {
      openPortal(e);
    }
  }, [portalOpen, openPortal, closePortal]);

  if (!mounted) return null;

  // ── Layout strategy ────────────────────────────────────────────────
  // All children are authored at their natural desktop size (100px orb,
  // 280px Live2D, 320px cone). A single CSS scale() on the root container
  // shrinks everything uniformly from the bottom-right anchor.
  // No per-element arithmetic needed — geometry is always correct.

  // Base (unscaled) dimensions
  const BASE_ORB    = 100;
  const BASE_LIVE_W = 280;
  const BASE_LIVE_H = 400;
  const BASE_CONE_W = 320;
  const BASE_CONE_H = 400;
  const BASE_CONE_BOT = 95;   // orb top to cone apex offset
  // Bella is centred over the 100px orb:
  // right offset = -(280-100)/2 = -90  (extends left of orb)
  const BASE_BELLA_RIGHT = -Math.round((BASE_LIVE_W - BASE_ORB) / 2); // -90
  // chat panel width clamp
  const CHAT_W_S = Math.max(240, Math.round(300 * scale));

  // ─── Responsive Positioning Helpers ────────────────────────────────
  const getChatPositionStyle = (): React.CSSProperties => {
    const isMobileOrShort = typeof window !== 'undefined' && (window.innerWidth < 640 || window.innerHeight < 600);
    const chatWidth = isMobileOrShort
      ? (typeof window !== 'undefined' ? Math.min(window.innerWidth - 24, 420) : 340)
      : Math.min(380, Math.max(300, Math.round(360 * scale)));

    if (isMobileOrShort) {
      return {
        bottom: 12,
        left: 12,
        right: 12,
        width: 'calc(100vw - 24px)',
        maxWidth: 420,
        margin: '0 auto',
        maxHeight: 'min(78dvh, calc(100vh - 24px), 520px)',
      };
    }

    // Smart Left/Right side anchor:
    // If Bella is on the left half of the screen, open chat to the RIGHT of Bella
    // If Bella is on the right half, open chat to the LEFT of Bella
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const bellaCenterFromRight = 16 - position.x + Math.round(50 * scale);
    const isBellaOnLeftHalf = bellaCenterFromRight > vw / 2;

    let finalRight: number;
    if (isBellaOnLeftHalf) {
      // Position to the right of Bella:
      const bellaRightEdgeFromRight = 16 - position.x - Math.round(90 * scale);
      finalRight = Math.max(16, bellaRightEdgeFromRight - chatWidth - 16);
    } else {
      // Position to the left of Bella:
      const bellaLeftEdgeFromRight = 16 - position.x + Math.round(190 * scale);
      finalRight = Math.min(vw - chatWidth - 16, Math.max(16, bellaLeftEdgeFromRight + 14));
    }

    const finalBottom = Math.max(16, Math.min(vh - 340, 16 - position.y));

    return {
      bottom: finalBottom,
      right: finalRight,
      width: chatWidth,
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'min(580px, calc(100vh - 48px), 85dvh)',
    };
  };

  const getActionCardPositionStyle = (): React.CSSProperties => {
    const isMobileOrShort = typeof window !== 'undefined' && (window.innerWidth < 640 || window.innerHeight < 600);
    const cardWidth = isMobileOrShort
      ? (typeof window !== 'undefined' ? Math.min(window.innerWidth - 24, 380) : 340)
      : 340;

    if (isMobileOrShort) {
      return {
        bottom: Math.max(12, 16 + Math.round(100 * scale) + 12 - position.y),
        left: 12,
        right: 12,
        width: 'calc(100vw - 24px)',
        maxWidth: 380,
        margin: '0 auto',
        maxHeight: 'min(70dvh, 420px)',
      };
    }

    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const bellaCenterFromRight = 16 - position.x + Math.round(50 * scale);
    const isBellaOnLeftHalf = bellaCenterFromRight > vw / 2;

    let finalRight: number;
    if (isBellaOnLeftHalf) {
      const bellaRightEdgeFromRight = 16 - position.x - Math.round(90 * scale);
      finalRight = Math.max(16, bellaRightEdgeFromRight - cardWidth - 16);
    } else {
      const bellaLeftEdgeFromRight = 16 - position.x + Math.round(190 * scale);
      finalRight = Math.min(vw - cardWidth - 16, Math.max(16, bellaLeftEdgeFromRight + 14));
    }

    const finalBottom = Math.max(16, Math.min(vh - 280, 16 - position.y + 30));

    return {
      bottom: finalBottom,
      right: finalRight,
      width: cardWidth,
      maxWidth: 'calc(100vw - 32px)',
    };
  };

  const getReplyBubblePositionStyle = (): React.CSSProperties => {
    const isMobileOrShort = typeof window !== 'undefined' && (window.innerWidth < 640 || window.innerHeight < 600);
    const bubbleWidth = isMobileOrShort
      ? (typeof window !== 'undefined' ? Math.min(window.innerWidth - 24, 360) : 320)
      : 320;

    if (isMobileOrShort) {
      return {
        bottom: 16,
        left: 12,
        right: 12,
        width: 'calc(100vw - 24px)',
        maxWidth: 360,
        margin: '0 auto',
      };
    }

    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const bellaCenterFromRight = 16 - position.x + Math.round(50 * scale);
    const isBellaOnLeftHalf = bellaCenterFromRight > vw / 2;

    let finalRight: number;
    if (isBellaOnLeftHalf) {
      const bellaRightEdgeFromRight = 16 - position.x - Math.round(90 * scale);
      finalRight = Math.max(16, bellaRightEdgeFromRight - bubbleWidth - 16);
    } else {
      const bellaLeftEdgeFromRight = 16 - position.x + Math.round(190 * scale);
      finalRight = Math.min(vw - bubbleWidth - 16, Math.max(16, bellaLeftEdgeFromRight + 12));
    }

    return {
      bottom: Math.max(16, 16 - position.y),
      right: finalRight,
      width: bubbleWidth,
      maxWidth: 'calc(100vw - 32px)',
    };
  };

  // ─── RENDER ────────────────────────────────────────────────────────
  return (
    <>
      {/* ══ ROOT — fixed bottom-right, scaled from that corner ════════
          transform-origin: bottom right keeps the orb glued to the
          corner while everything else shrinks inward on small screens.
         ══════════════════════════════════════════════════════════════ */}
      <div
        className="fixed z-[9999]"
        style={{
          bottom: 16,
          right: 16,
          // translate by drag offset BEFORE scaling so drag feels 1:1
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transformOrigin: 'bottom right',
          width:  BASE_LIVE_W,
          height: (portalOpen || isSubmerging) ? (BASE_CONE_BOT + BASE_LIVE_H + 20) : BASE_ORB,
          pointerEvents: 'none',
          transition: isDragging
            ? 'none'
            : 'transform 0.5s cubic-bezier(0.16,1,0.3,1), height 0.4s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        {/* ══ ORB — bottom-right of container ═════════════════════════ */}
        <div
          className={`absolute bottom-0 right-0 flex items-center justify-center cursor-pointer pointer-events-auto group ${isOrbTap ? 'bella-orb-tap' : ''}`}
          style={{ width: BASE_ORB, height: BASE_ORB, touchAction: 'none', zIndex: 20 }}
          onPointerDown={handlePointerDown}
          onClick={handleOrbClick}
        >
          <div className="absolute inset-0 rounded-full overflow-hidden border border-fuchsia-400/40"
            style={{ boxShadow: '0 0 20px rgba(236,72,153,0.5),inset 0 0 15px rgba(34,211,238,0.4)' }}>
            <img src="/bella-orb.png" alt="Bella Orb"
              className="absolute inset-0 w-full h-full object-cover opacity-85 group-hover:scale-[1.85] transition-transform duration-300"
              style={{ transform: 'scale(1.8)' }} draggable={false} />
          </div>
          <div className="absolute inset-0 rounded-full pointer-events-none" style={{
            boxShadow: isSubmerging
              ? '0 0 26px 8px rgba(34,211,238,0.6), 0 0 45px 16px rgba(236,72,153,0.4)'
              : portalOpen
              ? '0 0 18px 6px rgba(34,211,238,0.25), 0 0 36px 14px rgba(139,92,246,0.12)'
              : '0 0 0 0 transparent',
            transition: 'box-shadow 0.4s ease',
          }} />
          {/* Pulse dot */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-[6px] h-[6px] rounded-full bg-white animate-pulse"
            style={{ boxShadow: '0 0 8px 2px rgba(255,255,255,0.9)' }} />
          {/* Touch hint — idle */}
          {!portalOpen && !isSubmerging && (
            <div className="absolute bottom-2 right-2 text-pink-300 opacity-75 group-hover:opacity-100 transition-opacity">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.21 0-.69-.47-1.28-1.12-1.47z"/>
              </svg>
            </div>
          )}
          {/* Tap-to-close label */}
          {portalOpen && !isEmerging && !isSubmerging && (
            <div className="absolute bottom-[-18px] left-1/2 -translate-x-1/2 text-[8px] text-cyan-400/55 whitespace-nowrap pointer-events-none select-none tracking-widest">
              TAP TO CLOSE
            </div>
          )}
        </div>

        {/* ══ CONE — apex at orb centre-top ═══════════════════════════ */}
        {/* Orb centre-x from container right = BASE_ORB/2 = 50px      */}
        <div className="absolute pointer-events-none"
          style={{ bottom: BASE_CONE_BOT, right: BASE_ORB / 2, width: 0, height: 0, overflow: 'visible', zIndex: 10 }}>
          <svg width={BASE_CONE_W} height={BASE_CONE_H} viewBox="0 0 320 400"
            style={{
              position: 'absolute',
              bottom: 0,
              left: '50%',
              transformOrigin: 'bottom center',
              transform: (portalOpen && !isSubmerging) ? 'translateX(-50%) scaleY(1) scaleX(1)' : 'translateX(-50%) scaleY(0.2) scaleX(0.35)',
              opacity: (portalOpen && !isSubmerging) ? 1 : 0,
              transition: isSubmerging
                ? 'opacity 0.36s cubic-bezier(0.4, 0, 0.2, 1), transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                : 'opacity 0.5s ease 0.05s, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
              overflow: 'visible',
            }}>
            <defs>
              <linearGradient id="cone-blush" x1="160" y1="400" x2="160" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%"  stopColor="#ec4899" stopOpacity="0.28"/><stop offset="40%" stopColor="#7c3aed" stopOpacity="0.12"/><stop offset="100%" stopColor="#7c3aed" stopOpacity="0"/>
              </linearGradient>
              <linearGradient id="cone-outer" x1="160" y1="400" x2="160" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%"  stopColor="#7de8ff" stopOpacity="0.60"/><stop offset="40%" stopColor="#22d3ee" stopOpacity="0.28"/><stop offset="100%" stopColor="#22d3ee" stopOpacity="0"/>
              </linearGradient>
              <linearGradient id="cone-mid" x1="160" y1="400" x2="160" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%"  stopColor="#c8f4ff" stopOpacity="0.85"/><stop offset="30%" stopColor="#80d4ff" stopOpacity="0.55"/><stop offset="70%" stopColor="#5ab8ff" stopOpacity="0.18"/><stop offset="100%" stopColor="#5ab8ff" stopOpacity="0"/>
              </linearGradient>
              <linearGradient id="cone-core" x1="160" y1="400" x2="160" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0%"  stopColor="#ffffff"  stopOpacity="1"/><stop offset="15%" stopColor="#e8f8ff" stopOpacity="0.95"/><stop offset="50%" stopColor="#a0dcff" stopOpacity="0.45"/><stop offset="100%" stopColor="#a0dcff" stopOpacity="0"/>
              </linearGradient>
              <filter id="fb" x="-80%" y="-10%" width="260%" height="130%"><feGaussianBlur stdDeviation="18"/></filter>
              <filter id="fo" x="-60%" y="-8%"  width="220%" height="124%"><feGaussianBlur stdDeviation="11"/></filter>
              <filter id="fm" x="-35%" y="-5%"  width="170%" height="116%"><feGaussianBlur stdDeviation="5"/></filter>
              <filter id="fc" x="-18%" y="-3%"  width="136%" height="110%"><feGaussianBlur stdDeviation="1.8"/></filter>
            </defs>
            <polygon points="160,400 -10,0 330,0"  fill="url(#cone-blush)" filter="url(#fb)"/>
            <polygon points="160,400  20,0 300,0"  fill="url(#cone-outer)" filter="url(#fo)"/>
            <polygon points="160,400  70,0 250,0"  fill="url(#cone-mid)"   filter="url(#fm)"/>
            <polygon points="160,400 112,0 208,0"  fill="url(#cone-core)"  filter="url(#fc)"/>
          </svg>
          {/* Lens flare */}
          <div style={{
            position: 'absolute', bottom: -3, left: '50%', transform: 'translateX(-50%)',
            width: isSubmerging ? 54 : 44,
            height: isSubmerging ? 15 : 11,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse,rgba(255,255,255,1) 0%,rgba(180,240,255,0.65) 55%,transparent 100%)',
            filter: 'blur(2.5px)',
            opacity: (portalOpen && !isSubmerging) ? 1 : isSubmerging ? 0.8 : 0,
            transition: isSubmerging ? 'opacity 0.3s ease, width 0.3s ease' : 'opacity 0.3s ease',
          }}/>
          {/* Motes */}
          <div style={{
            position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)',
            width: 200, height: BASE_CONE_H,
            opacity: (portalOpen && !isSubmerging) ? 1 : 0,
            transition: 'opacity 0.25s ease',
          }}>
            {portalOpen && MOTE_CONFIG.map((m, i) => (
              <div key={i} style={{
                position: 'absolute', bottom: m.bottom, left: m.left,
                width: m.size, height: m.size, borderRadius: '50%',
                background: m.pink ? 'rgba(236,72,153,0.95)' : 'rgba(255,255,255,0.98)',
                boxShadow: m.pink ? '0 0 5px 2px rgba(236,72,153,0.5)' : '0 0 5px 2px rgba(160,230,255,0.75)',
                animationName: 'coneMoteDrift', animationDuration: `${m.dur}s`, animationDelay: `${m.delay}s`,
                animationTimingFunction: 'ease-out', animationIterationCount: 'infinite',
                ['--tx' as any]: `${m.tx}px`,
              }}/>
            ))}
          </div>
        </div>

        {/* ══ BELLA — centred over orb using BASE_BELLA_RIGHT ══════════ */}
        {/* BASE_BELLA_RIGHT = -90: extends 90px to the left of orb     */}
        <div
          className="absolute pointer-events-none"
          style={{
            bottom: BASE_CONE_BOT,
            right: BASE_BELLA_RIGHT,
            width: BASE_LIVE_W,
            height: BASE_LIVE_H,
            opacity: (portalOpen && !isSubmerging) ? 1 : 0,
            pointerEvents: (portalOpen && !isSubmerging) ? 'auto' : 'none',
            transformOrigin: 'bottom center',
            transform: portalOpen && !isSubmerging
              ? 'translateY(0) scale(1)'
              : isSubmerging
              ? 'translateY(85px) scale(0.6)'
              : 'translateY(90px) scale(0.7)',
            filter: isSubmerging ? 'brightness(1.8) blur(3px)' : 'brightness(1) blur(0px)',
            transition: isSubmerging
              ? 'opacity 0.38s cubic-bezier(0.4, 0, 0.2, 1), transform 0.42s cubic-bezier(0.4, 0, 0.2, 1), filter 0.38s ease'
              : 'opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s, transform 0.65s cubic-bezier(0.16, 1, 0.3, 1) 0.1s, filter 0.5s ease',
            zIndex: 15,
          }}
        >
          {/* Click overlay on Bella character → toggle chat */}
          <div
            onClick={handleBellaClick}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            className="absolute inset-0 z-30 cursor-pointer pointer-events-auto select-none"
            style={{ width: '100%', height: '100%', touchAction: 'auto' }}
            title="Click Bella to chat"
          />

          {/* Live2D */}
          <div style={{
            width: BASE_LIVE_W, height: BASE_LIVE_H,
            position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
            maskImage: 'linear-gradient(to bottom, black 0%, black 62%, rgba(0,0,0,0.35) 80%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 62%, rgba(0,0,0,0.35) 80%, transparent 100%)',
            contain: 'layout style paint',
            filter: 'drop-shadow(0 0 8px rgba(120,210,255,0.25))',
            pointerEvents: 'none',
          }}>
            <Live2DViewer key={appearance} modelPath={appearance} emotion={currentEmotion} isTalking={isTalking} audioVolume={audioVolume} />
          </div>
        </div>
      </div>

      {/* ══ HIGH-VISIBILITY CHAT ACTION BUTTON — only appears when user taps Bella ══════ */}
      {portalOpen && chatButtonVisible && !chatOpen && (
        <div
          className="fixed z-[10001] pointer-events-auto bella-action-button flex flex-col"
          style={getActionCardPositionStyle()}
        >
          <div
            className="rounded-3xl p-4 shadow-[0_0_40px_rgba(139,92,246,0.7),0_0_80px_rgba(34,211,238,0.5)] border-2 border-cyan-400/90 backdrop-blur-2xl relative overflow-hidden group"
            style={{
              background: 'radial-gradient(ellipse at top left, rgba(28, 12, 60, 0.97) 0%, rgba(8, 4, 24, 0.98) 100%)',
            }}
          >
            {/* Holographic glowing backdrops */}
            <div className="absolute -top-10 -right-10 w-28 h-28 bg-cyan-400/25 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 w-28 h-28 bg-fuchsia-500/25 rounded-full blur-2xl pointer-events-none" />

            {/* Top Bar */}
            <div className="flex items-center justify-between relative z-10 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-fuchsia-500 to-cyan-400 p-[1.5px] shadow-[0_0_15px_rgba(236,72,153,0.5)] shrink-0">
                  <div className="w-full h-full rounded-2xl bg-slate-950 flex items-center justify-center text-base">
                    ✨
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white tracking-wide drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
                    Ask Bella
                  </h3>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="font-semibold text-cyan-300">AI Educational Companion</span>
                  </div>
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setChatButtonVisible(false);
                }}
                className="w-7 h-7 rounded-xl text-xs flex items-center justify-center text-slate-300 hover:text-white bg-white/10 hover:bg-white/20 transition-all"
                title="Dismiss"
              >
                ✕
              </button>
            </div>

            {/* Primary High-Visibility Chat Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setChatButtonVisible(false);
                setChatOpen(true);
              }}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500 hover:from-violet-500 hover:via-fuchsia-500 hover:to-cyan-400 text-white font-bold text-xs shadow-[0_0_25px_rgba(139,92,246,0.7)] hover:shadow-[0_0_35px_rgba(34,211,238,0.9)] border-2 border-white/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 group/btn relative z-10"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-lg group-hover/btn:scale-110 transition-transform">💬</span>
                <span className="tracking-wide text-white drop-shadow font-extrabold">Open Chat & Ask Anything</span>
              </div>
              <span className="text-base font-black text-white group-hover/btn:translate-x-1 transition-transform">➔</span>
            </button>

            {/* Quick Question Chips */}
            <div className="mt-3 pt-2.5 border-t border-white/10 relative z-10 space-y-1.5">
              <span className="text-[9px] font-bold text-purple-300 uppercase tracking-wider px-1">Quick Questions:</span>
              <div className="grid grid-cols-1 gap-1.5">
                {SUGGESTIONS.slice(0, 2).map((s, idx) => (
                  <button
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      setChatButtonVisible(false);
                      setChatOpen(true);
                      handleTextSubmit(undefined, s);
                    }}
                    className="text-left px-3 py-1.5 rounded-xl text-[11px] text-cyan-200 bg-white/[0.06] hover:bg-cyan-500/20 border border-white/10 hover:border-cyan-400/60 transition-all flex items-center justify-between group/chip"
                  >
                    <span className="truncate font-medium">{s}</span>
                    <span className="text-[10px] text-cyan-300 opacity-70 group-hover/chip:opacity-100 ml-1">↗</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ CHAT PANEL — slides in when Bella character is clicked ══════ */}
      {portalOpen && chatOpen && (
        <div
          className="fixed z-[10001] pointer-events-auto animate-fadeInUp flex flex-col"
          style={getChatPositionStyle()}
        >
          <div
            className="flex flex-col h-full rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(139,92,246,0.6),0_0_100px_rgba(34,211,238,0.4)] border-2 border-cyan-400/80 backdrop-blur-2xl"
            style={{ background: 'radial-gradient(ellipse at top left, rgba(28, 12, 60, 0.98) 0%, rgba(8, 4, 24, 0.99) 100%)' }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0 bg-white/[0.03]"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-fuchsia-600 to-cyan-400 p-[1.5px] shrink-0 shadow-[0_0_12px_rgba(236,72,153,0.4)]">
                  <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center text-sm">
                    ✨
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white tracking-wide">Bella</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 font-medium tracking-wide">AI TUTOR</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      isTalking ? 'bg-cyan-400 animate-pulse shadow-[0_0_6px_#22d3ee]' :
                      currentEmotion === 'thinking' ? 'bg-amber-400 animate-pulse shadow-[0_0_6px_#fbbf24]' :
                      isVoiceActive ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]' : 'bg-purple-400/70'
                    }`} />
                    <span className="text-slate-400">
                      {isTalking ? 'Speaking…' : currentEmotion === 'thinking' ? 'Thinking…' : isVoiceActive ? 'Listening…' : 'Ready'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Voice toggle button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isTalking) {
                      stopAll();
                    } else if (!userActivated) {
                      setUserActivated(true);
                    } else {
                      stopAll();
                    }
                  }}
                  title={isTalking ? 'Stop speech' : userActivated ? 'Deactivate voice' : 'Enable voice'}
                  className="w-7 h-7 rounded-lg text-xs flex items-center justify-center text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  {isTalking ? '🔇' : userActivated ? '🎙️' : '🎤'}
                </button>

                {/* Close button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setChatOpen(false);
                    setChatButtonVisible(false);
                  }}
                  className="w-7 h-7 rounded-lg text-xs flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Close chat"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Conversation Messages Container */}
            <div className="flex-1 min-h-[140px] max-h-[min(380px,calc(100dvh-220px))] overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-purple-500/20 overscroll-contain">
              {messages.length === 0 ? (
                <div className="py-3 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500/20 to-cyan-500/20 border border-cyan-400/30 flex items-center justify-center mx-auto text-xl shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                    🎓
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">Hi! I&apos;m Bella ✨</h4>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-[260px] mx-auto leading-relaxed">
                      Ask me custom questions about science, math, physics, coding, or any concept you want to learn!
                    </p>
                  </div>

                  {/* Suggestion Chips */}
                  <div className="pt-2 text-left space-y-1.5">
                    <p className="text-[10px] font-semibold text-purple-300/70 uppercase tracking-wider px-1">Suggested Questions</p>
                    {SUGGESTIONS.map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleTextSubmit(undefined, suggestion)}
                        className="w-full text-left px-3 py-2 rounded-xl text-[11px] text-cyan-200/90 bg-cyan-950/30 hover:bg-cyan-900/40 border border-cyan-500/20 hover:border-cyan-400/40 transition-all duration-200 flex items-center justify-between group"
                      >
                        <span className="truncate">{suggestion}</span>
                        <span className="text-cyan-400/50 group-hover:text-cyan-300 text-xs ml-1">↗</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed max-w-[88%] shadow-md ${
                          msg.role === 'user'
                            ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white rounded-br-sm'
                            : 'bg-white/[0.07] border border-cyan-400/20 text-slate-100 rounded-bl-sm backdrop-blur-md'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{msg.text}</p>
                        {msg.role === 'bella' && (
                          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-white/10 text-[10px] text-cyan-300/70 gap-2">
                            <span>Bella</span>
                            <button
                              onClick={() => {
                                const dummyRecognition = recognitionRef.current || { start: () => {}, stop: () => {} };
                                setIsTalking(true);
                                api.bellaTTS(msg.text, { language: language || undefined })
                                  .then((audioBuffer) => {
                                    const blob = new Blob([audioBuffer], { type: "audio/wav" });
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                      const base64 = (reader.result as string).split(",")[1];
                                      if (base64) {
                                        playEdgeTTS(base64, msg.text, dummyRecognition);
                                      } else {
                                        setIsTalking(false);
                                      }
                                    };
                                    reader.readAsDataURL(blob);
                                  })
                                  .catch((ttsErr) => {
                                    console.warn("[Bella] Replay TTS failed:", ttsErr);
                                    setIsTalking(false);
                                  });
                              }}
                              className="hover:text-cyan-200 flex items-center gap-1 transition-colors shrink-0"
                              title="Replay voice"
                            >
                              🔊 Listen
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Thinking indicator */}
                  {currentEmotion === 'thinking' && (
                    <div className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white/[0.06] border border-cyan-400/20 w-fit">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input Footer */}
            <form
              onSubmit={(e) => handleTextSubmit(e)}
              onClick={(e) => e.stopPropagation()}
              className="p-3 shrink-0 bg-white/[0.02] border-t border-white/[0.07] flex items-center gap-2"
            >
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Ask Bella any question…"
                autoComplete="off"
                enterKeyHint="send"
                inputMode="text"
                className="flex-1 min-w-0 rounded-xl px-3.5 py-2 text-xs text-white placeholder-white/30 outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(139,92,246,0.25)',
                }}
                onFocus={(e) => (e.target.style.borderColor = 'rgba(34,211,238,0.6)')}
                onBlur={(e) => (e.target.style.borderColor = 'rgba(139,92,246,0.25)')}
              />
              <button
                type="submit"
                disabled={!textInput.trim() || isProcessing}
                className="h-8 px-3.5 rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 text-white flex items-center justify-center text-xs font-semibold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-[0_0_10px_rgba(139,92,246,0.3)] shrink-0"
              >
                {isProcessing ? 'Thinking…' : 'Send ↗'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ══ FLOATING QUICK CHAT PILL (when Bella is emerged but chat is closed) ══ */}
      {portalOpen && !isSubmerging && !chatOpen && !chatButtonVisible && !lastReply && (
        <div
          className="fixed z-[10000] pointer-events-auto animate-fadeInUp cursor-pointer"
          onClick={() => setChatOpen(true)}
          style={getReplyBubblePositionStyle()}
        >
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-slate-950/95 hover:bg-slate-900 border-2 border-cyan-400/80 hover:border-cyan-300 text-white shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all hover:scale-105 active:scale-95 group backdrop-blur-xl">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
            <span className="text-xs font-extrabold text-cyan-200 group-hover:text-white">💬 Chat with Bella</span>
            <span className="text-xs text-fuchsia-400">✨</span>
          </div>
        </div>
      )}

      {/* ══ COMPACT REPLY BUBBLE (when chat is closed but Bella has a reply) ══ */}
      {portalOpen && !chatOpen && lastReply && (
        <div
          className="fixed z-[10000] pointer-events-auto animate-fadeInUp cursor-pointer"
          onClick={() => setChatOpen(true)}
          style={getReplyBubblePositionStyle()}
        >
          <div
            className="rounded-2xl p-3 shadow-xl relative group hover:border-cyan-400/40 transition-colors"
            style={{ background: 'rgba(10,5,26,0.90)', backdropFilter: 'blur(18px)', border: '1px solid rgba(139,92,246,0.25)' }}
          >
            <div className="flex items-start gap-2">
              <span className="text-base shrink-0">✨</span>
              <p className="text-xs text-slate-200 leading-relaxed line-clamp-3 flex-1">{lastReply}</p>
            </div>
            <div className="flex items-center justify-between mt-2 pt-1 border-t border-white/10 text-[10px] text-cyan-400/80">
              <span>💬 Click to open chat</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLastReply(null);
                }}
                className="text-slate-400 hover:text-white transition-colors"
              >
                Dismiss ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
