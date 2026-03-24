# Implementation Plan: Education Anime Generator

## Overview

Build the Education Anime Generator as a standalone full-stack application (FastAPI backend + Next.js 14 frontend) that mirrors CatchupXV1's patterns for easy future integration. All AI inference runs via cloud APIs (Groq, Fal.ai) — no local GPU required.

---

## Tasks

- [x] 1. Project scaffolding and configuration
  - Create monorepo structure: `backend/` (FastAPI) and `frontend/` (Next.js 14)
  - Set up `backend/` with FastAPI, SQLAlchemy, Pydantic, Celery, Redis, fal-client, boto3
  - Set up `frontend/` with Next.js 14, TypeScript, TailwindCSS, @react-three/fiber, @pixiv/three-vrm, d3, matter-js, zustand
  - Create `.env.example` files for both backend and frontend with all required keys (FAL_API_KEY, GROQ_API_KEY, CLOUDFLARE_R2_*, DATABASE_URL, UPSTASH_REDIS_URL)
  - Set up Docker Compose for local development (backend + Redis)
  - _Requirements: 4.1, 4.6_

- [x] 2. Backend: Core infrastructure
  - [x] 2.1 Set up FastAPI app with CORS, rate limiting, and health endpoint
    - Mirror CatchupXV1's `main.py` pattern with SlowAPI rate limiter
    - Configure CORS for localhost:3000 and production domain
    - _Requirements: 4.1_

  - [x] 2.2 Set up SQLAlchemy database with Job and Asset models
    - Create `app/models/anime_assets.py` with Job and Asset SQLAlchemy models
    - Job fields: job_id (UUID), type, status, topic, parameters (JSON), asset_id, error_message, retry_count, created_at, updated_at, session_id
    - Asset fields: asset_id (UUID), job_id, type, topic, file_path, file_size_bytes, mime_type, metadata (JSON), created_at, expires_at, session_id
    - Auto-create tables on startup
    - _Requirements: 7.2, 6.2_

  - [x] 2.3 Set up Cloudflare R2 asset storage service
    - Create `app/services/asset_manager.py` using boto3 S3-compatible client
    - Implement: upload_file(data, key, content_type), get_presigned_url(key, expires=86400), delete_file(key)
    - _Requirements: 6.1, 6.3, 6.4_

  - [x] 2.4 Write property test for asset round trip (Property 3)

    - **Property 3: Asset retrieval round trip**
    - **Validates: Requirements 6.1, 6.3**
    - Use Hypothesis to generate random binary blobs, upload, retrieve, verify byte equality

  - [x] 2.5 Set up Celery with Upstash Redis broker
    - Create `app/worker.py` with Celery app configured for Upstash Redis
    - Configure task retry policy: max_retries=3, exponential backoff
    - _Requirements: 7.1, 7.3_

  - [x] 2.6 Write property test for retry count bounded (Property 9)

    - **Property 9: Retry count bounded**
    - **Validates: Requirements 7.3**

- [ ] 3. Backend: API key auth and content safety
  - [ ] 3.1 Implement API key authentication middleware
    - Create `app/core/auth.py` with `get_current_session` dependency
    - Support both session_id (cookie) and X-API-Key header
    - Return 401 for missing/invalid credentials
    - _Requirements: 4.7_

  - [ ] 3.2 Write property test for unauthenticated requests rejected (Property 18)

    - **Property 18: Unauthenticated requests are rejected**
    - **Validates: Requirements 4.7**

  - [ ] 3.3 Implement content safety filter service
    - Create `app/services/safety.py` using Groq API with LlamaGuard 3
    - Implement: check_topic(topic: str) → SafetyResult, check_content(text: str) → SafetyResult
    - Maintain keyword blocklist for pre-generation fast rejection
    - _Requirements: 8.1, 8.2, 8.4_

  - [ ] 3.4 Write property test for safety filter blocks unsafe topics (Property 5)

    - **Property 5: Safety filter blocks unsafe topics pre-generation**
    - **Validates: Requirements 8.4**

- [ ] 4. Backend: Job management API
  - [ ] 4.1 Implement job submission and status endpoints
    - Create `app/routers/jobs.py` with POST /jobs (submit), GET /jobs/{job_id} (status), GET /jobs (list last 50)
    - Job submission returns 202 with job_id within 500ms (enqueue only, no blocking)
    - Status returns one of: queued, processing, complete, failed
    - _Requirements: 4.2, 4.5, 7.2, 7.6_

  - [ ] 4.2 Write property test for job ID uniqueness (Property 1)

    - **Property 1: Job ID uniqueness**
    - **Validates: Requirements 4.2, 7.2**

  - [ ] 4.3 Write property test for job status monotonic progression (Property 2)

    - **Property 2: Job status progression is monotonic**
    - **Validates: Requirements 4.5, 7.2**

  - [ ] 4.4 Write property test for API job submission response time (Property 12)

    - **Property 12: API job submission response time**
    - **Validates: Requirements 4.2**
    - Use pytest-benchmark to assert p99 < 500ms

  - [ ] 4.5 Implement webhook registration and delivery
    - Add POST /webhooks/register endpoint
    - Implement async webhook delivery task in Celery (fires on job complete/failed)
    - _Requirements: 4.8_

  - [ ] 4.6 Write property test for webhook delivery on completion (Property 13)

    - **Property 13: Webhook delivery on job completion**
    - **Validates: Requirements 4.8**

- [ ] 5. Backend: Asset management API
  - [ ] 5.1 Implement asset CRUD endpoints
    - Create `app/routers/assets.py` with GET /assets/{id}, DELETE /assets/{id}, GET /assets/{id}/download
    - GET returns asset metadata + presigned URL; DELETE removes from R2 and DB; returns 404 for missing
    - _Requirements: 6.3, 6.4, 6.5_

  - [ ] 5.2 Write property test for asset deletion permanence (Property 4)

    - **Property 4: Asset deletion is permanent**
    - **Validates: Requirements 6.4, 6.5**

  - [ ] 5.3 Implement storage quota enforcement
    - Add quota check in job submission: sum asset sizes per session, reject with 429 if over limit
    - Configurable limit via env var STORAGE_QUOTA_BYTES (default 500MB per session)
    - _Requirements: 6.6, 6.7_

  - [ ] 5.4 Write property test for storage quota enforcement (Property 10)

    - **Property 10: Storage quota enforcement**
    - **Validates: Requirements 6.6, 6.7**

  - [ ] 5.5 Implement asset metadata completeness validation
    - Add Pydantic validator ensuring all assets have required metadata fields before storage
    - _Requirements: 6.2_

  - [ ] 5.6 Write property test for asset metadata completeness (Property 14)

    - **Property 14: Asset metadata completeness**
    - **Validates: Requirements 1.3, 3.4, 6.2**

  - [ ] 5.7 Implement asset availability window enforcement
    - Set expires_at = created_at + 24h minimum on all asset creation
    - _Requirements: 4.3_

  - [ ] 5.8 Write property test for asset availability window (Property 15)

    - **Property 15: Asset availability window**
    - **Validates: Requirements 4.3**

- [ ] 6. Checkpoint — Ensure all backend infrastructure tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Backend: Prompt builder service
  - [ ] 7.1 Implement prompt builder using Groq API (LLaMA 3.3 70B)
    - Create `app/services/prompt_builder.py`
    - Implement: build_anime_prompt(topic, style) → str, build_story_prompt(topic, episode_count) → str, build_simulation_prompt(topic, category) → str, build_3d_prompt(object_name, category) → str
    - Each function calls Groq API and returns a structured prompt string
    - _Requirements: 1.2_

  - [ ] 7.2 Write property test for prompt builder output (Property 19)

    - **Property 19: Prompt builder produces non-empty structured output**
    - **Validates: Requirements 1.2**

- [ ] 8. Backend: Anime generation pipeline
  - [ ] 8.1 Implement anime image generation service
    - Create `app/services/anime_generator.py`
    - Call Fal.ai API with Animagine XL 4.0 model using fal-client
    - Add caption overlay to generated image using Pillow
    - Upload result to Cloudflare R2, return asset record
    - _Requirements: 1.1, 1.3, 1.6_

  - [ ] 8.2 Implement anime animation generation
    - Generate N frames with slight prompt variation, assemble into WebM using FFmpeg subprocess
    - _Requirements: 1.7_

  - [ ] 8.3 Create anime router and Celery task
    - Create `app/routers/anime.py` with POST /anime/generate
    - Create Celery task `generate_anime_task` that calls anime_generator service
    - Support style parameter: classroom, laboratory, outdoor, fantasy
    - _Requirements: 1.6, 1.8_

  - [ ] 8.4 Write property test for malformed request returns 400 (Property 16)

    - **Property 16: Malformed request returns structured 400**
    - **Validates: Requirements 4.9**

- [ ] 9. Backend: Simulation generation pipeline
  - [ ] 9.1 Implement simulation code generation service
    - Create `app/services/simulation_engine.py`
    - Call Groq API (LLaMA 3.3 70B) with simulation prompt for the given topic + category
    - Validate returned HTML syntax using html.parser
    - Package as self-contained HTML (inline all JS, no external URLs)
    - Upload to Cloudflare R2
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [ ] 9.2 Create simulation router and Celery task
    - Create `app/routers/simulation.py` with POST /simulation/generate
    - Create Celery task `generate_simulation_task`
    - _Requirements: 2.6_

  - [ ] 9.3 Write property test for simulation self-containment (Property 7)

    - **Property 7: Simulation self-containment**
    - **Validates: Requirements 2.8**
    - Parse generated HTML with BeautifulSoup, assert no external src/href attributes

- [ ] 10. Backend: 3D model generation pipeline
  - [ ] 10.1 Implement 3D model generation service
    - Create `app/services/model3d_engine.py`
    - Call Fal.ai API with Hunyuan3D-2.1 model
    - Download GLTF result, upload to Cloudflare R2
    - Attach metadata: object_name, description, scale_reference, category
    - _Requirements: 3.1, 3.4, 3.7_

  - [ ] 10.2 Create 3D model router and Celery task
    - Create `app/routers/model3d.py` with POST /model3d/generate
    - Create Celery task `generate_model3d_task`
    - Handle unsupported objects: return error with suggestions list
    - _Requirements: 3.5_

  - [ ] 10.3 Write property test for 3D model GLTF validity (Property 9)

    - **Property 9: 3D model GLTF validity and texture completeness**
    - **Validates: Requirements 3.1, 3.6**
    - Parse GLTF JSON, verify all texture URIs are data: URIs or embedded buffers

- [ ] 11. Backend: Storyification pipeline
  - [ ] 11.1 Implement story plan generator
    - Create `app/services/story_engine.py`
    - Call Groq API (LLaMA 3.3 70B) with story planning prompt → parse JSON StoryPlan
    - Validate: title, synopsis, characters list, episodes list (min 3 episodes, min 3 scenes each)
    - _Requirements: 9.1, 9.3, 9.11_

  - [ ] 11.2 Implement story scene orchestrator
    - For each scene in each episode: dispatch anime_generator Celery task
    - Track scene completion status, update StoryPlan status
    - Handle failed scenes: substitute placeholder, continue remaining scenes
    - _Requirements: 9.2, 9.10_

  - [ ] 11.3 Implement story ZIP export
    - Assemble all scene assets + JSON manifest into ZIP archive
    - Manifest must include: title, synopsis, episode list, scene asset references
    - Upload ZIP to Cloudflare R2
    - _Requirements: 9.8_

  - [ ] 11.4 Create story router and Celery task
    - Create `app/routers/story.py` with POST /story/generate, GET /story/{story_id}
    - Create Celery task `generate_story_task`
    - _Requirements: 9.5, 9.6_

  - [ ] 11.5 Write property test for story plan scene count invariant (Property 6)

    - **Property 6: Story plan scene count invariant**
    - **Validates: Requirements 9.2, 9.5**

  - [ ] 11.6 Write property test for story ZIP manifest completeness (Property 17)

    - **Property 17: Story ZIP manifest completeness**
    - **Validates: Requirements 9.8**

- [ ] 12. Backend: Bella assistant pipeline
  - [ ] 12.1 Implement Bella chat service
    - Create `app/services/bella_service.py`
    - Call Groq API (LLaMA 3.3 70B) with Bella system prompt (educational assistant persona)
    - Persist conversation history in SQLite per session_id
    - _Requirements: 10.3, 10.11_

  - [ ] 12.2 Implement Bella TTS service
    - Call Fal.ai Kokoro TTS v1.0 API with Bella's response text
    - Return audio buffer (base64 WAV) + phoneme timestamps for lip sync
    - Graceful fallback: if TTS fails, return text-only response with tts_available: false
    - _Requirements: 10.4, 10.5, 10.12_

  - [ ] 12.3 Implement Bella STT endpoint
    - Accept audio blob via POST /bella/transcribe
    - Call Groq Whisper Large v3 API, return transcript
    - _Requirements: 10.3_

  - [ ] 12.4 Create Bella router
    - Create `app/routers/bella.py` with POST /bella/chat, POST /bella/transcribe, GET /bella/history
    - _Requirements: 10.3, 10.11_

  - [ ] 12.5 Write property test for Bella conversation history persistence (Property 20)

    - **Property 20: Bella conversation history persistence**
    - **Validates: Requirements 10.11**

  - [ ] 12.6 Write property test for Bella TTS fallback (Property 21)

    - **Property 21: Bella TTS fallback on failure**
    - **Validates: Requirements 10.12**

- [ ] 13. Checkpoint — Ensure all backend pipeline tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Frontend: Project setup and shared components
  - [ ] 14.1 Set up Next.js 14 app with TailwindCSS dark anime theme
    - Configure globals.css with dark theme (background #0a0a0f, accent purple #7c3aed, cyan #06b6d4, pink #ec4899)
    - Set up shared layout with navigation sidebar
    - Create `lib/api.ts` with typed fetch wrappers for all backend endpoints
    - _Requirements: 5.1, 5.7_

  - [ ] 14.2 Create JobProgressBar component
    - WebSocket or polling-based real-time job status display
    - Shows status text: "Generating story plan...", "Rendering scene 2 of 9..."
    - _Requirements: 5.2_

  - [ ] 14.3 Create TopicInput component
    - Large centered input with generation type tabs: Anime / Simulation / 3D Model / Story
    - Validate non-empty input before submission
    - _Requirements: 5.1_

- [ ] 15. Frontend: Anime generator page
  - [ ] 15.1 Create `/anime` page with topic input and style selector
    - Style tabs: classroom, laboratory, outdoor, fantasy
    - Submit → dispatch job → show JobProgressBar
    - _Requirements: 1.6, 5.2_

  - [ ] 15.2 Create AnimeSceneCard component
    - Display generated image with caption overlay
    - Download button, "Add to Story" action
    - _Requirements: 1.3, 5.3_

  - [ ] 15.3 Wire anime page to display results inline on job completion
    - Poll job status, render AnimeSceneCard when complete
    - Show error message + retry button on failure
    - _Requirements: 5.3, 5.8_

- [ ] 16. Frontend: Simulation page
  - [ ] 16.1 Create `/simulation` page with topic input and category selector
    - Category tabs: physics, chemistry, biology, mathematics, history
    - _Requirements: 2.4_

  - [ ] 16.2 Create SimulationFrame component
    - Sandboxed iframe rendering the simulation HTML bundle
    - Fullscreen toggle, "Download HTML" button, shareable URL copy
    - _Requirements: 5.6, 2.6_

  - [ ] 16.3 Wire simulation page to display results inline
    - _Requirements: 5.3_

- [ ] 17. Frontend: 3D model page
  - [ ] 17.1 Create `/model3d` page with object name input and category selector
    - _Requirements: 3.7_

  - [ ] 17.2 Create ModelViewer3D component
    - `@react-three/fiber` canvas with GLTFLoader
    - Orbit controls (rotate, zoom, pan) via `@react-three/drei`
    - "Download GLTF" button
    - _Requirements: 3.2, 5.5_

  - [ ] 17.3 Wire 3D model page to display results inline
    - _Requirements: 5.3_

- [ ] 18. Frontend: Story player page
  - [ ] 18.1 Create `/story` page with topic input and episode count selector (1-10)
    - _Requirements: 9.5_

  - [ ] 18.2 Create StoryPlayer component
    - Left sidebar: episode list with status indicators (pending/complete/failed)
    - Main area: scene viewer with Previous/Next navigation
    - Caption display below each scene
    - _Requirements: 9.6, 9.7_

  - [ ] 18.3 Implement story generation progress tracking
    - Show per-episode and per-scene progress as scenes are generated
    - _Requirements: 5.2, 9.2_

  - [ ] 18.4 Implement story ZIP export button
    - Download all series assets as ZIP archive
    - _Requirements: 9.8, 5.9_

- [ ] 19. Frontend: Asset gallery and export
  - [ ] 19.1 Create `/gallery` page with masonry grid of all session assets
    - Filter by type: anime, simulation, 3D model, story
    - _Requirements: 5.4_

  - [ ] 19.2 Implement "Download All as ZIP" functionality
    - Call backend ZIP export endpoint, trigger browser download
    - _Requirements: 5.9_

- [ ] 20. Frontend: Bella 3D assistant overlay
  - [ ] 20.1 Set up @pixiv/three-vrm VRM rendering in a React component
    - Load open-source VRM model (CC0 license from VRoid Hub)
    - Implement idle animation loop (breathing, eye blink)
    - _Requirements: 10.1, 10.2_

  - [ ] 20.2 Implement Bella emotional state animations
    - Neutral: idle breathing
    - Thinking: head tilt + finger-to-chin BlendShape
    - Happy: smile BlendShape + small wave bone animation
    - Celebrate: jump + clap animation
    - _Requirements: 10.8, 10.9_

  - [ ] 20.3 Implement Bella chat UI
    - Chat bubble for text responses
    - Microphone button for voice input (Web Speech API → POST /bella/transcribe)
    - Text input fallback
    - _Requirements: 10.3_

  - [ ] 20.4 Implement Bella lip sync
    - Receive phoneme timestamps from TTS response
    - Map phonemes to VRM BlendShape viseme targets
    - Animate BlendShapes synchronized to audio playback
    - _Requirements: 10.4_

  - [ ] 20.5 Implement Bella proactive hints and contextual explanations
    - 60-second idle timer → trigger hint message
    - On job completion → send generated content context to Bella for explanation
    - _Requirements: 10.6, 10.7_

  - [ ] 20.6 Add Bella overlay to root layout
    - Add BellaOverlay component to `app/layout.tsx` (persists across all pages)
    - Minimize/hide toggle with session context preservation
    - _Requirements: 10.2, 10.10_

- [ ] 21. Checkpoint — Ensure all frontend components render correctly and all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 22. Integration wiring and end-to-end flows
  - [ ] 22.1 Wire all frontend pages to backend API with proper error handling
    - All API errors display human-readable messages + retry buttons
    - _Requirements: 5.8_

  - [ ] 22.2 Implement WebSocket connection for real-time job progress
    - Backend: add WebSocket endpoint that pushes job status updates
    - Frontend: connect JobProgressBar to WebSocket
    - _Requirements: 5.2_

  - [ ] 22.3 Add OpenAPI documentation endpoint
    - FastAPI auto-generates /openapi.json — verify it's accessible and complete
    - _Requirements: 4.4_

  - [ ] 22.4 Wire content safety filter into all generation endpoints
    - Pre-generation: check topic before enqueuing job
    - Post-generation: check generated content before storing asset
    - _Requirements: 8.1, 8.2, 8.4_

  - [ ] 22.5 Write property test for post-generation safety enforcement (Property 6)

    - **Property 6: Post-generation safety enforcement**
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [ ] 23. CatchupXV1 integration preparation
  - [ ] 23.1 Document integration steps in INTEGRATION.md
    - List all new files to copy into CatchupXV1 backend/frontend
    - List router registration lines to add to main.py
    - List new env vars to add to .env
    - List npm/pip packages to install
    - _Requirements: 4.1, 4.6_

  - [ ] 23.2 Create integration test suite
    - Tests that verify the module works when mounted under CatchupXV1's auth and database
    - _Requirements: 4.7_

- [ ] 24. Final checkpoint — Full end-to-end test
  - Ensure all tests pass, ask the user if questions arise.
  - Verify: anime generation → simulation → 3D model → story → Bella all work end-to-end
  - Verify: asset storage, retrieval, deletion, quota enforcement all work
  - Verify: OpenAPI spec is accessible at /openapi.json

---

## Notes

- All tasks are required — comprehensive test coverage from the start
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties (run with Hypothesis, min 100 iterations each)
- Unit tests validate specific examples and edge cases
- All AI inference uses cloud APIs — no local GPU required
- Backend mirrors CatchupXV1's FastAPI patterns for easy future merge
- Frontend mirrors CatchupXV1's Next.js 14 + TailwindCSS patterns

