# Product Requirements Document — AnimeEdu (Education Anime Generator)

## 1. Overview

**Product Name:** AnimeEdu — Education Anime Generator  
**Version:** 1.0.0  
**Status:** Active development — core pipelines functional  
**Owner:** CatchupX LMS team  
**Integration Target:** CatchupXV1 LMS (new routers/services/pages alongside existing patterns)

AnimeEdu is a full-stack AI-powered educational content generation platform. It transforms any educational topic into anime-style visual content, interactive browser simulations, 3D models, and storyified multi-episode anime series. A persistent 3D VRM anime avatar named "Bella" acts as the learning companion across the entire platform.

---

## 2. Problem Statement

Traditional LMS platforms present educational content as static text and generic stock images. Students — especially those accustomed to visual-first media — disengage quickly. There is no tool that takes a topic typed by a student and produces an immersive, visually-rich, animated learning experience within seconds without requiring local GPU infrastructure.

---

## 3. Goals and Success Metrics

| Goal | Metric |
|------|--------|
| Generate an anime scene for any educational topic | P95 job completion < 15s for image, < 60s for animation |
| Produce a runnable HTML simulation without external dependencies | Zero external URL violations; simulation renders in iframe sandbox |
| Generate a downloadable GLB 3D model | P95 job completion < 120s; valid GLB file returned |
| Produce a multi-episode educational story with visuals | Episode plan generated in < 30s; images dispatched per scene |
| Bella responds to student questions with voice | LLM reply < 3s; TTS audio < 2s |
| All generated content passes safety filter | 0 unsafe assets stored; 100% of topics pre-checked |

---

## 4. Target Users

| Persona | Description |
|---------|-------------|
| Student (primary) | Ages 11–18, visual learners, use platform to explore topics outside formal class |
| Educator | Creates learning modules; embeds generated assets into lesson plans |
| LMS Admin | Deploys platform into CatchupXV1; configures API keys and quotas |
| Developer / AI Agent | Integrates via REST API; reads this document to understand data contracts |

---

## 5. Core Features (MVP)

### 5.1 Anime Scene Generator (Scene Forge)
- Input: topic (string), style (classroom/laboratory/outdoor/fantasy), include_animation (bool)
- Output: PNG image or GIF animation with caption overlay
- Pipeline: topic → Groq prompt builder → Pollinations.ai image → Pillow caption → S3 storage
- Fallback: Pollinations.ai is the primary source (tokenless); HF Animagine XL is available as alternate

### 5.2 Interactive Simulation Engine (Lab Engine)
- Input: topic (string), category (physics/chemistry/biology/mathematics/history)
- Output: Self-contained HTML5 file with canvas animation, control panel, and learn box
- Pipeline: topic → Groq prompt builder → Groq LLaMA 3.3 70B code gen → HTML validation → S3
- Fallback: Embedded particle simulation fallback when LLM fails or produces invalid HTML

### 5.3 3D Model Generator (Holodeck)
- Input: object_name (string), category (string)
- Output: GLB file viewable in Three.js viewer
- Pipeline: object_name → Tripo AI text-to-3D API → GLB download → S3 storage
- Suggestions: On failure, suggest 5 alternative objects for the category

### 5.4 Story / Anime Series Generator (Chronicle)
- Input: topic (string), episode_count (1–6)
- Output: StoryPlan JSON (title, synopsis, characters, episodes with scenes) + per-scene anime images
- Pipeline: topic → Groq story planner → StoryPlan JSON → per-scene anime tasks dispatched to Celery
- Export: ZIP download of all story assets

### 5.5 Bella AI Assistant
- Persistent floating overlay across all pages (mounted in layout.tsx)
- LLM chat: Groq LLaMA 3.3 70B, educational persona, per-session conversation history
- TTS: edge-tts (en-US-AriaNeural), free, no key required
- STT: Groq Whisper Large v3 turbo, browser mic recording
- Visual: Live2D/VRM anime avatar with lip sync and emotional states
- Fallback: Local pattern-matched responses when GROQ_API_KEY absent

### 5.6 Asset Gallery
- Browse all generated assets filtered by type and session
- Presigned S3 URLs (24h TTL) for viewing and downloading
- Individual delete; bulk ZIP export of all assets

### 5.7 Content Safety
- Stage 1: Keyword blocklist (instant, no API call)
- Stage 2: Groq `openai/gpt-oss-safeguard-20b` semantic classifier
- Applied pre-generation (topic check) and post-generation (content check)
- Violations logged with topic, keyword, classifier output, timestamp

### 5.8 Job Queue
- All generation endpoints return `202 { job_id, status: "queued" }` immediately
- Celery 5 + Redis (Upstash Redis) workers process jobs async
- Job status polling: `GET /api/v1/jobs/{job_id}`
- WebSocket: `ws://.../api/v1/jobs/{job_id}/ws` for real-time status push
- Retry policy: 3 retries, exponential backoff (30s, 60s, 120s)

### 5.9 XP / Gamification
- `useGameProgress` hook tracks XP earned per generation
- GameHUD component displays XP in top navigation bar
- Persisted in browser localStorage via Zustand

---

## 6. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| API response time for job submission | < 500ms |
| Simulation HTML size | < 100KB |
| Storage quota | 500MB per deployment (configurable via env) |
| Rate limiting | SlowAPI per-IP; 10 req/min for generation endpoints |
| Content safety | 100% topic pre-screening; 0 unsafe assets stored |
| Accessibility | WCAG 2.1 AA; keyboard navigation; ARIA labels on all interactive elements |
| Mobile responsiveness | min 320px viewport; all pages usable on mobile |
| CORS | Only `localhost:3000/3001` + production domain allowed |

---

## 7. Out of Scope (v1.0)

- User authentication / accounts (session_id cookie only)
- Payment / subscription tiers
- Multi-language content generation (English only)
- Live collaboration / shared sessions
- Native mobile app

---

## 8. Dependencies and Constraints

| Dependency | Constraint |
|------------|------------|
| Groq API | Free tier rate limits; model availability (llama-3.3-70b-versatile required) |
| Pollinations.ai | Free, tokenless, but rate-limited; retry up to 5x with backoff |
| Tripo AI | Paid API; key required in env |
| edge-tts | Requires outbound internet to Microsoft Edge TTS servers |
| Redis | Required for Celery job queue; Upstash free tier for cloud |
| AWS S3 | Required for asset storage; boto3 credentials in env |
| SQLite | Local dev only; migrate to Supabase PostgreSQL for production |

---

## 9. Release Criteria (v1.0)

- All 5 generation pipelines produce valid output end-to-end
- Safety filter blocks 100% of blocklist keywords and known unsafe prompts
- Bella answers educational questions with TTS audio
- Job queue processes tasks with retry and WebSocket notification
- All property-based tests pass (Hypothesis, min 100 iterations per property)
- Deployed to Railway/Render (backend) + Vercel (frontend) + Upstash Redis
