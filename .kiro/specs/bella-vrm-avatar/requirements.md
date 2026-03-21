# Requirements Document

## Introduction

Bella is a persistent 3D VRM anime girl assistant rendered directly in the browser using Three.js and @pixiv/three-vrm. She is mounted globally in `app/layout.tsx` and appears on every page as a floating overlay. This feature specifies the full requirements for her VRM rendering pipeline, animation system (idle sway, auto-blink, lip sync), emotion expression system, chat panel UI, TTS voice via Fal.ai Kokoro, and STT via Groq Whisper — all wired to the existing `bella.py` backend router.

## Glossary

- **BellaOverlay**: The top-level React component mounted in `app/layout.tsx` that contains the VRM canvas, chat panel, and all controls.
- **VRMViewer**: The inner canvas component responsible for Three.js scene setup, VRM model loading, and the animation loop.
- **VRM_Model**: The `.vrm` file loaded via `GLTFLoader` + `VRMLoaderPlugin` representing Bella's 3D character.
- **ExpressionManager**: The `@pixiv/three-vrm` subsystem that controls facial blend shapes (blink, lip, emotion).
- **EmotionState**: One of four named states — `neutral`, `thinking`, `happy`, `celebrate` — that map to VRM expression presets.
- **LipSync**: The animation technique of toggling the `Aa` VRM expression in rhythm with speech to simulate mouth movement.
- **AutoBlink**: A timer-driven state machine that periodically closes and reopens the VRM's eyelid expressions.
- **IdleAnimation**: Continuous sinusoidal bone rotations applied to the spine, head, and arms to give Bella a natural resting motion.
- **ChatPanel**: The slide-in message thread UI alongside the VRM canvas where users type and read messages.
- **TTS**: Text-to-speech synthesis — Bella's responses are converted to audio via Fal.ai Kokoro v1.0.
- **STT**: Speech-to-text transcription — user microphone input is transcribed via Groq Whisper Large v3.
- **BellaService**: The backend service at `backend/app/services/bella_service.py` handling LLM chat, TTS, and history.
- **BellaRouter**: The FastAPI router at `backend/app/routers/bella.py` exposing `/bella/chat`, `/bella/tts`, and `/bella/transcribe`.
- **OrbitControls**: Three.js camera controls allowing limited user-driven look-around of the VRM scene.

---

## Requirements

### Requirement 1: VRM Model Rendering

**User Story:** As a student, I want to see Bella as a real 3D anime character, so that the learning experience feels immersive and engaging.

#### Acceptance Criteria

1. THE VRMViewer SHALL load a `.vrm` file using `GLTFLoader` with `VRMLoaderPlugin` registered.
2. WHEN the VRM_Model finishes loading, THE VRMViewer SHALL add the model to the Three.js scene and invoke the `onLoaded` callback.
3. THE VRMViewer SHALL configure a `PerspectiveCamera` framed on Bella's upper body with a field of view of 30 degrees, positioned to show head and torso.
4. THE VRMViewer SHALL set up ambient, directional, and rim lighting to render Bella with a stylised anime aesthetic consistent with the dark theme (`#0a0a0f` background, purple rim light `#9d5cf6`).
5. THE VRMViewer SHALL enable `OrbitControls` restricted to horizontal azimuth ±30 degrees and polar angle between 60 and 90 degrees, with pan and zoom disabled.
6. IF the VRM_Model fails to load, THEN THE VRMViewer SHALL invoke the `onLoaded` callback so the loading state is cleared and the UI remains usable.
7. WHEN the VRMViewer component unmounts, THE VRMViewer SHALL cancel the animation frame loop, dispose the WebGLRenderer, and remove the VRM_Model from the scene to prevent memory leaks.
8. THE VRMViewer SHALL render at a pixel ratio capped at 2 and resize the renderer and camera aspect ratio when the browser window resizes.

---

### Requirement 2: Idle Animation

**User Story:** As a student, I want Bella to move naturally while idle, so that she feels alive rather than a static image.

#### Acceptance Criteria

1. WHILE the animation loop is running, THE VRMViewer SHALL apply a sinusoidal rotation to the `Spine` bone on the Z and X axes to produce a gentle body sway.
2. WHILE the animation loop is running, THE VRMViewer SHALL apply a sinusoidal rotation to the `Head` bone on the Y and X axes to produce a subtle look-around motion.
3. WHILE the animation loop is running, THE VRMViewer SHALL apply a sinusoidal rotation to the `LeftUpperArm` and `RightUpperArm` bones to produce a gentle floating arm motion.
4. THE VRMViewer SHALL call `vrm.update(delta)` every animation frame to advance the VRM internal update cycle.

---

### Requirement 3: Auto-Blink

**User Story:** As a student, I want Bella to blink naturally, so that she looks like a real character rather than a frozen model.

#### Acceptance Criteria

1. WHILE the animation loop is running, THE VRMViewer SHALL drive a three-state blink machine with states `open`, `closing`, and `opening`.
2. WHILE in the `open` state, THE VRMViewer SHALL transition to `closing` after a random interval between 3 and 5 seconds.
3. WHILE in the `closing` state, THE VRMViewer SHALL linearly increase `BlinkLeft` and `BlinkRight` expression values from 0 to 1 over 70 milliseconds, then transition to `opening`.
4. WHILE in the `opening` state, THE VRMViewer SHALL linearly decrease `BlinkLeft` and `BlinkRight` expression values from 1 to 0 over 70 milliseconds, then transition to `open`.
5. THE ExpressionManager SHALL call `em.update()` every animation frame after all expression values have been set.

---

### Requirement 4: Lip Sync

**User Story:** As a student, I want Bella's mouth to move when she speaks, so that the TTS audio feels synchronised with her character.

#### Acceptance Criteria

1. WHEN `isTalking` is `true`, THE VRMViewer SHALL toggle the `Aa` expression value every 100 milliseconds between a random value in the range [0.4, 0.8] and 0 to simulate mouth movement.
2. WHEN `isTalking` transitions to `false`, THE VRMViewer SHALL immediately set the `Aa` expression value to 0.
3. THE VRMViewer SHALL NOT modify the `Aa` expression during blink state transitions to avoid conflicting expression updates.

---

### Requirement 5: Emotion Expressions

**User Story:** As a student, I want Bella's face to reflect her emotional state, so that her reactions feel contextually appropriate.

#### Acceptance Criteria

1. WHEN the `emotion` prop changes to `happy` or `celebrate`, THE VRMViewer SHALL set the `Happy` expression to 1 and reset `Surprised` and `Relaxed` to 0.
2. WHEN the `emotion` prop changes to `thinking`, THE VRMViewer SHALL set the `Relaxed` expression to 0.5 and reset `Happy` and `Surprised` to 0.
3. WHEN the `emotion` prop changes to `neutral`, THE VRMViewer SHALL reset `Happy`, `Surprised`, and `Relaxed` expressions to 0.
4. THE BellaOverlay SHALL set `emotion` to `thinking` while awaiting a chat response from the backend.
5. THE BellaOverlay SHALL set `emotion` to `happy` when a successful chat response is received.
6. THE BellaOverlay SHALL set `emotion` to `neutral` after the talking duration has elapsed.

---

### Requirement 6: Chat Panel

**User Story:** As a student, I want to type messages to Bella and read her replies in a chat panel, so that I can have a conversation about what I'm learning.

#### Acceptance Criteria

1. THE BellaOverlay SHALL render a toggle button that opens and closes the ChatPanel without closing the VRM view.
2. WHEN the ChatPanel is open, THE BellaOverlay SHALL display a scrollable message thread showing all messages with `user` messages right-aligned and `bella` messages left-aligned.
3. WHEN a new message is added, THE ChatPanel SHALL scroll to the bottom of the message thread.
4. WHEN `thinking` is `true`, THE ChatPanel SHALL display an animated three-dot typing indicator in place of a Bella message.
5. THE ChatPanel SHALL include a text input and a send button; pressing Enter or clicking the send button SHALL submit the message.
6. WHILE `thinking` is `true` or the input is empty, THE ChatPanel SHALL disable the send button.
7. THE BellaOverlay SHALL display Bella's current status (`thinking...`, `speaking...`, or `online`) in the ChatPanel header.

---

### Requirement 7: Backend Chat Integration

**User Story:** As a student, I want Bella's replies to come from an LLM, so that her answers are contextually relevant to my questions.

#### Acceptance Criteria

1. WHEN the user submits a message, THE BellaOverlay SHALL POST the message to `/bella/chat` via the `lib/api.ts` typed wrapper and display the response as a Bella message.
2. THE BellaRouter SHALL accept a `POST /bella/chat` request with a `message` string and optional `session_id`, and return a `reply` string from the LLM.
3. THE BellaService SHALL use Groq LLaMA 3.3 70B to generate Bella's reply with an educational assistant system prompt.
4. THE BellaRouter SHALL accept a `GET /bella/history` request with a `session_id` and return the ordered list of prior messages for that session.
5. IF the `/bella/chat` request fails, THEN THE BellaOverlay SHALL display a fallback error message in the chat thread and set `emotion` to `neutral`.

---

### Requirement 8: TTS Voice

**User Story:** As a student, I want to hear Bella speak her replies aloud, so that the interaction feels more natural and accessible.

#### Acceptance Criteria

1. WHEN a Bella reply is received, THE BellaOverlay SHALL POST the reply text to `/bella/tts` and play the returned audio in the browser.
2. THE BellaRouter SHALL accept a `POST /bella/tts` request with a `text` string and return audio data synthesised by Fal.ai Kokoro TTS v1.0.
3. WHILE TTS audio is playing, THE BellaOverlay SHALL set `isTalking` to `true` to drive lip sync.
4. WHEN TTS audio playback ends, THE BellaOverlay SHALL set `isTalking` to `false`.
5. IF the `/bella/tts` request fails, THEN THE BellaOverlay SHALL fall back to the timer-based talking duration and SHALL NOT block the chat response from being displayed.
6. WHERE TTS is unavailable or disabled, THE BellaOverlay SHALL estimate talking duration as `clamp(text.length * 40ms, 1500ms, 6000ms)` and use that to drive `isTalking`.

---

### Requirement 9: STT Voice Input

**User Story:** As a student, I want to speak to Bella using my microphone, so that I can ask questions hands-free.

#### Acceptance Criteria

1. THE ChatPanel SHALL include a microphone button that, when clicked, requests browser microphone permission and begins recording audio.
2. WHEN the microphone button is clicked while recording, THE BellaOverlay SHALL stop recording and POST the audio blob to `/bella/transcribe`.
3. THE BellaRouter SHALL accept a `POST /bella/transcribe` request with an audio file and return a `transcript` string produced by Groq Whisper Large v3.
4. WHEN a transcript is returned, THE BellaOverlay SHALL populate the chat input field with the transcript text and submit it as a user message.
5. IF the `/bella/transcribe` request fails, THEN THE BellaOverlay SHALL display an inline error in the ChatPanel and restore the microphone button to its idle state.
6. WHILE recording is active, THE ChatPanel SHALL display a visual recording indicator on the microphone button.

---

### Requirement 10: Overlay Lifecycle and Persistence

**User Story:** As a student, I want Bella to remain visible as I navigate between pages, so that I don't lose my conversation context.

#### Acceptance Criteria

1. THE BellaOverlay SHALL be mounted once in `app/layout.tsx` and SHALL persist across all client-side page navigations without remounting.
2. THE BellaOverlay SHALL render a floating action button when collapsed, positioned at the bottom-right of the viewport with a fixed z-index above all page content.
3. WHEN the floating action button is clicked, THE BellaOverlay SHALL expand to show the VRM canvas and controls.
4. WHEN the close button is clicked, THE BellaOverlay SHALL collapse to the floating action button and close the ChatPanel.
5. THE BellaOverlay SHALL preserve the full message history in component state for the duration of the browser session.
6. THE VRMViewer SHALL NOT reload the VRM_Model when the ChatPanel is toggled open or closed.

---

### Requirement 11: Loading State

**User Story:** As a student, I want to see a loading indicator while Bella's 3D model loads, so that I know the app is working.

#### Acceptance Criteria

1. WHILE the VRM_Model has not yet loaded, THE BellaOverlay SHALL display a shimmer loading indicator with a floating emoji and "Loading Bella..." label inside the VRM canvas area.
2. WHEN the VRM_Model finishes loading (or fails), THE BellaOverlay SHALL hide the loading indicator and show the rendered canvas.
3. THE BellaOverlay SHALL display an emotion badge and talking waveform indicator only after the VRM_Model has loaded.
