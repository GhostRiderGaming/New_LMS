# Implementation Plan: Bella VRM Avatar

## Overview

Implement the full Bella VRM avatar feature: backend router + service, frontend VRM rendering pipeline, animation system, chat panel UI, and all tests. The existing `BellaOverlay.tsx` skeleton is already in place — tasks refine and complete it to production spec.

## Tasks

- [x] 1. Backend Pydantic models and router skeleton
  - [x] 1.1 Define Pydantic v2 models in `backend/app/routers/bella.py`
    - `ChatRequest(message: str, session_id: str = "")`, `ChatResponse(reply: str)`
    - `TTSRequest(text: str)`, `TranscribeResponse(transcript: str)`
    - `HistoryMessage(role: str, text: str, timestamp: str)`, `HistoryResponse(messages: list[HistoryMessage])`
    - _Requirements: 7.2, 8.2, 9.3, 7.4_
  - [x] 1.2 Scaffold FastAPI router with all four endpoints returning stub responses
    - `POST /bella/chat`, `POST /bella/tts`, `POST /bella/transcribe`, `GET /bella/history`
    - Include `request_id` in all error responses per project conventions
    - Register router in `backend/app/main.py` under prefix `/bella`
    - _Requirements: 7.2, 8.2, 9.3, 7.4_

- [x] 2. Backend BellaService implementation
  - [x] 2.1 Implement `BellaService.chat()` in `backend/app/services/bella_service.py`
    - Groq LLaMA 3.3 70B with educational assistant system prompt
    - Append user message and Bella reply to `_history[session_id]` with ISO timestamp
    - _Requirements: 7.3, 7.2_
  - [x] 2.2 Implement `BellaService.synthesize_speech()` 
    - POST to Fal.ai Kokoro TTS v1.0; return raw audio bytes
    - _Requirements: 8.2_
  - [x] 2.3 Implement `BellaService.transcribe_audio()`
    - POST audio bytes to Groq Whisper Large v3; return transcript string
    - _Requirements: 9.3_
  - [x] 2.4 Implement `BellaService.get_history()`
    - Return `_history[session_id]` as list of dicts; return `[]` for unknown sessions
    - _Requirements: 7.4_
  - [x] 2.5 Wire router endpoints to BellaService
    - `/bella/chat` → `service.chat()` → `ChatResponse`
    - `/bella/tts` → `service.synthesize_speech()` → `Response(content=bytes, media_type="audio/mpeg")`
    - `/bella/transcribe` → `service.transcribe_audio()` → `TranscribeResponse`
    - `/bella/history` → `service.get_history()` → `HistoryResponse`
    - _Requirements: 7.2, 8.2, 9.3, 7.4_

- [x] 3. Checkpoint — Backend
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 4. Frontend lib/api.ts — Bella typed wrappers
  - [x] 4.1 Add/update Bella API wrappers in `frontend/lib/api.ts`
    - `bellaChat(message, session_id)` → `POST /bella/chat` → `{ reply: string }`
    - `bellaTTS(text)` → `POST /bella/tts` → `ArrayBuffer` (audio bytes)
    - `bellaTranscribe(blob)` → `POST /bella/transcribe` multipart → `{ transcript: string }`
    - `bellaHistory(session_id)` → `GET /bella/history` → `{ messages: HistoryMessage[] }`
    - Export `HistoryMessage` type
    - _Requirements: 7.1, 8.1, 9.2, 7.4_

- [x] 5. VRMViewer component — scene setup and model loading
  - [x] 5.1 Refine `VRMViewer` in `BellaOverlay.tsx` — scene, camera, lighting, controls
    - `PerspectiveCamera` FOV 30°, position `(0, 1.4, 2.2)`, lookAt `(0, 1.2, 0)`
    - Ambient `0xffffff 0.8`, directional `0xffffff 1.2` at `(1,2,2)`, rim `0x9d5cf6 0.6` at `(-2,1,-1)`
    - `OrbitControls`: pan/zoom disabled, azimuth ±30°, polar 60–90°
    - Pixel ratio capped at 2; resize handler updates renderer size + camera aspect
    - _Requirements: 1.3, 1.4, 1.5, 1.8_
  - [x] 5.2 Implement VRM load via `GLTFLoader` + `VRMLoaderPlugin`
    - On success: add `vrm.scene` to scene, rotate `Math.PI`, call `onLoaded()`
    - On error: call `onLoaded()` so shimmer clears; log error
    - On unmount: `cancelAnimationFrame`, `renderer.dispose()`, remove VRM from scene
    - _Requirements: 1.1, 1.2, 1.6, 1.7_
  - [x] 5.3 Add `emotionRef` and `isTalkingRef` mirrors inside `VRMViewer`
    - Sync refs from props via `useEffect` so rAF loop reads current values without stale closures
    - _Requirements: 4.1, 5.1_

- [x] 6. Idle animation
  - [x] 6.1 Implement sinusoidal bone rotations in the rAF loop
    - Spine Z: `sin(t*0.8)*0.02`, Spine X: `sin(t*0.5)*0.01`
    - Head Y: `sin(t*0.4)*0.08`, Head X: `sin(t*0.3)*0.04`
    - LeftUpperArm Z: `0.6 + sin(t*0.6)*0.03`, RightUpperArm Z: `-(0.6 + sin(t*0.6+1)*0.03)`
    - Call `vrm.update(delta)` every frame
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 6.2 Write property test for idle bone rotation formula (Property 1)
    - **Property 1: Idle bone rotation follows sinusoidal formula**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Extract pure formula functions (`computeSpineZ`, `computeHeadY`, etc.) from component for testability
    - Test in `frontend/components/bella/BellaOverlay.pbt.test.tsx` with `fc.float({ min: 0, max: 1000 })`, 100 runs

- [x] 7. Auto-blink state machine
  - [x] 7.1 Implement three-state blink machine in rAF loop
    - `open → closing` after `rand(3,5)s`; `closing → opening` when `blinkTimer/0.07 ≥ 1`; `opening → open` when value reaches 0
    - `closing`: `v = clamp(blinkTimer/0.07, 0, 1)` → set BlinkLeft + BlinkRight
    - `opening`: `v = 1 - clamp(blinkTimer/0.07, 0, 1)` → set BlinkLeft + BlinkRight
    - Call `em.update()` every frame after all expression writes
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x] 7.2 Write property test for blink interpolation (Property 2)
    - **Property 2: Blink expression interpolation is correct**
    - **Validates: Requirements 3.3, 3.4**
    - `fc.float({ min: 0, max: 1 })` for timer, test both closing and opening directions, 100 runs
  - [x] 7.3 Write property test for blink state transitions (Property 3)
    - **Property 3: Blink state transitions respect timing thresholds**
    - **Validates: Requirements 3.1, 3.2**
    - `fc.float({ min: 0, max: 10 })` for timer value; assert state invariants, 100 runs

- [x] 8. Lip sync
  - [x] 8.1 Implement lip sync toggle in rAF loop
    - When `isTalkingRef.current`: every 100ms toggle `Aa` between `rand(0.4, 0.8)` and `0`
    - When `isTalkingRef.current` is false: set `Aa` to `0` immediately
    - _Requirements: 4.1, 4.2, 4.3_
  - [x] 8.2 Write property test for lip sync Aa range (Property 5)
    - **Property 5: Lip sync Aa value is always in valid range**
    - **Validates: Requirements 4.1, 4.2**
    - `fc.boolean()` for lipOpen, `fc.float({ min: 0, max: 1 })` for random seed; assert value ∈ {0} ∪ [0.4, 0.8], 100 runs

- [x] 9. Emotion expressions
  - [x] 9.1 Implement `useEffect` on `emotion` prop in `VRMViewer`
    - `neutral` → Happy=0, Surprised=0, Relaxed=0
    - `thinking` → Relaxed=0.5, Happy=0, Surprised=0
    - `happy`/`celebrate` → Happy=1, Relaxed=0, Surprised=0
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 9.2 Write property test for emotion expression mapping (Property 4)
    - **Property 4: Emotion state maps to correct expression values**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - `fc.constantFrom('neutral', 'thinking', 'happy', 'celebrate')`, assert exact expression values, 100 runs

- [x] 10. BellaOverlay state management and handlers
  - [x] 10.1 Add `isRecording` state and `sessionId` ref to `BellaOverlay`
    - `isRecording: boolean` for mic button visual state
    - `sessionIdRef` initialised to `crypto.randomUUID()` on mount
    - _Requirements: 9.1, 9.6, 10.5_
  - [x] 10.2 Implement `playTTS(text: string)` handler
    - POST to `api.bellaTTS(text)` → receive `ArrayBuffer` → `new Blob([bytes], { type: 'audio/mpeg' })` → `URL.createObjectURL`
    - `audio.onplay` → `setIsTalking(true)`, `audio.onended` → `setIsTalking(false)`, `setEmotion('neutral')`
    - On TTS failure: fallback `duration = clamp(text.length * 40, 1500, 6000)` ms timer
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6_
  - [x] 10.3 Implement `handleSend()` wired to real backend
    - POST via `api.bellaChat(input, sessionId)` → `addBellaMessage(reply, 'happy')`
    - Set `emotion('thinking')` before request; on error append fallback message, `setEmotion('neutral')`
    - _Requirements: 7.1, 7.5, 5.4, 5.5, 5.6_
  - [x] 10.4 Implement `addBellaMessage(text, emotion)` calling `playTTS`
    - Append bella message to thread, call `playTTS(text)`, set emotion
    - _Requirements: 8.1, 6.3_
  - [x] 10.5 Implement `handleMicToggle()` with `MediaRecorder`
    - First click: `getUserMedia({ audio: true })` → `MediaRecorder.start()`, `setIsRecording(true)`
    - Second click: `recorder.stop()` → `ondataavailable` → `api.bellaTranscribe(blob)` → `setInput(transcript)` → `handleSend()`
    - On permission denied or transcribe failure: show inline error, restore mic to idle
    - _Requirements: 9.1, 9.2, 9.4, 9.5_
  - [x] 10.6 Write property test for TTS fallback duration clamping (Property 9)
    - **Property 9: TTS fallback duration is clamped correctly**
    - **Validates: Requirements 8.6**
    - `fc.string()` for text; assert `clamp(text.length * 40, 1500, 6000)`, 100 runs
  - [x] 10.7 Write property test for message history append-only (Property 8)
    - **Property 8: Message history is append-only and preserved**
    - **Validates: Requirements 10.5**
    - `fc.array(fc.record({ role: fc.constantFrom('user','bella'), text: fc.string() }))`, assert order preserved, 100 runs

- [x] 11. ChatPanel UI
  - [x] 11.1 Extract `ChatPanel` as inline component within `BellaOverlay.tsx`
    - Scrollable message thread: user messages right-aligned, bella messages left-aligned
    - Auto-scroll to bottom on new message via `messagesEndRef`
    - Animated three-dot typing indicator when `thinking`
    - _Requirements: 6.2, 6.3, 6.4_
  - [x] 11.2 Add mic button to ChatPanel input row
    - Mic button with recording indicator (pulsing red dot) when `isRecording`
    - Send button disabled when `thinking || !input.trim()`
    - Status line in header: `thinking...` / `speaking...` / `online`
    - _Requirements: 6.5, 6.6, 6.7, 9.1, 9.6_
  - [x] 11.3 Write property test for send button disabled logic (Property 6)
    - **Property 6: Send button disabled when input empty or thinking**
    - **Validates: Requirements 6.6**
    - `fc.record({ thinking: fc.boolean(), input: fc.string() })`, assert disabled iff `thinking || !input.trim()`, 100 runs
  - [x] 11.4 Write property test for message alignment (Property 7)
    - **Property 7: Message alignment matches role**
    - **Validates: Requirements 6.2**
    - `fc.array(fc.record({ role: fc.constantFrom('user','bella'), text: fc.string() }))`, assert CSS class per role, 100 runs

- [x] 12. Loading shimmer state
  - [x] 12.1 Ensure shimmer renders while `!vrmLoaded` and hides on `onLoaded` callback
    - Shimmer bar, floating 🌸 emoji, "Loading Bella..." label inside canvas area
    - Emotion badge and talking waveform only rendered when `vrmLoaded`
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 13. Checkpoint — Frontend
  - Ensure all frontend tests pass, ask the user if questions arise.

- [x] 14. Backend unit tests
  - [x] 14.1 Write `backend/tests/test_bella.py`
    - `POST /bella/chat` returns `{ "reply": str }` with mocked BellaService
    - `GET /bella/history` returns messages in insertion order
    - `POST /bella/transcribe` returns `{ "transcript": str }`
    - Error responses include `request_id` field
    - Chat failure returns `{ "error": "chat_failed", "request_id": ... }`
    - _Requirements: 7.2, 7.4, 9.3_

- [x] 15. Backend property-based tests
  - [x] 15.1 Write property test for chat history round-trip order (Property 10)
    - **Property 10: Chat history round-trip preserves order**
    - **Validates: Requirements 7.4**
    - `@given(st.lists(st.text(min_size=1), min_size=1, max_size=20))` with `@settings(max_examples=100)`
    - Send N messages to same session_id, assert history returns all in order with correct roles
    - File: `backend/tests/test_properties_bella.py`
  - [x] 15.2 Write property test for emotion expression mapping backend-side (Property 4)
    - **Property 4: Emotion state maps to correct expression values**
    - **Validates: Requirements 5.1, 5.2, 5.3**
    - `@given(st.sampled_from(['neutral', 'thinking', 'happy', 'celebrate']))` with `@settings(max_examples=100)`
    - Assert mapping function returns correct dict of expression values

- [x] 16. Frontend unit tests
  - [x] 16.1 Write `frontend/components/bella/BellaOverlay.test.tsx`
    - Floating button renders when overlay closed; expands on click
    - Chat panel toggles open/closed
    - Send button disabled when input empty; disabled when `thinking=true`
    - Typing indicator shown when `thinking=true`
    - Error message appended on chat failure
    - Loading shimmer shown before VRM loaded; hidden after `onLoaded`
    - Emotion badge and waveform only shown after VRM loaded
    - TTS fallback: `clamp(0*40, 1500, 6000) = 1500`, `clamp(200*40, 1500, 6000) = 6000`
    - _Requirements: 6.1, 6.4, 6.6, 7.5, 11.1, 11.2, 11.3, 8.6_

- [x] 17. Final checkpoint — Ensure all tests pass
  - Run `npx vitest --run` (frontend) and `pytest --tb=short` (backend).
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Pure formula functions (idle bone rotations, blink interpolation, TTS clamp) should be extracted to module-level so PBT can import them without mounting the component
- `emotionRef` and `isTalkingRef` inside `VRMViewer` prevent stale closure bugs in the rAF loop
- Backend `_history` dict is in-memory only — no persistence across server restarts required
- All property tests tagged `// Feature: bella-vrm-avatar, Property N: <text>` (frontend) and `# Feature: bella-vrm-avatar, Property N: <text>` (backend)
