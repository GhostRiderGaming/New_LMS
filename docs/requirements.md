# Functional Requirements — AnimeEdu

Numbering matches references in source code comments (e.g., `# Requirements: 1.1, 1.3`).

---

## 1. Anime Image & Animation Generation

**1.1** The system SHALL accept a `topic` string and `style` enum (classroom/laboratory/outdoor/fantasy) and return a queued job ID within 500ms.

**1.2** The system SHALL build an anime-optimised image prompt using the Groq LLM prompt builder before calling the image provider.

**1.3** The system SHALL generate a 512×768 portrait PNG image using Pollinations.ai as primary provider with seed randomisation.

**1.4** The system SHALL render a semi-transparent caption overlay bar on the bottom of every generated image using Pillow.

**1.5** The system SHALL generate a multi-frame GIF animation (default 4 frames) using sequential Pollinations.ai calls assembled via Pillow when `include_animation=true`.

**1.6** The system SHALL upload all generated image/animation files to the configured S3 bucket under the `anime/{job_id}/` key prefix.

**1.7** The system SHALL persist an `Asset` database record for each generated file with type, topic, file_path, file_size_bytes, mime_type, metadata, created_at, session_id.

**1.8** The system SHALL update job status to `processing`, then `complete` (with asset_id) or `failed` (with error_message) via the Celery task lifecycle.

---

## 2. Interactive Simulation Engine

**2.1** The system SHALL accept a `topic` string and `category` enum (physics/chemistry/biology/mathematics/history) and return a queued job ID within 500ms.

**2.2** The system SHALL generate a complete, self-contained HTML5 file with all CSS and JavaScript inline (zero external URLs).

**2.3** The system SHALL use Groq LLaMA 3.3 70B (`llama-3.3-70b-versatile`) with a structured system prompt targeting 6th-grade comprehension level.

**2.4** The generated simulation HTML MUST use an HTML5 `<canvas>` element with a `requestAnimationFrame()` loop for smooth continuous animation.

**2.5** The generated simulation MUST include a control panel with at least 2 interactive elements (sliders, buttons, or toggles) that modify the simulation in real time.

**2.6** The system SHALL validate the generated HTML for external URL references; if found, it SHALL inline or remove them. If the HTML is invalid or empty, it SHALL substitute a particle-animation fallback simulation.

**2.7** The system SHALL store the simulation HTML as `text/html; charset=utf-8` under `simulation/{job_id}/` in S3.

---

## 3. 3D Model Generation

**3.1** The system SHALL accept an `object_name` string and `category` string and return a queued job ID within 500ms.

**3.2** The system SHALL call the Tripo AI text-to-3D API to generate a GLB model file.

**3.3** The system SHALL download the GLB binary and upload it to S3 under `model3d/{job_id}/`.

**3.4** The system SHALL persist an `Asset` record with `type="model3d"` and `mime_type="model/gltf-binary"`.

**3.5** On generation failure after 3 retries, the system SHALL include a list of 5 suggested alternative objects for the same category in the job error_message.

**3.6** The frontend SHALL render the GLB file in a Three.js viewer (`@react-three/fiber` + `@react-three/drei` `useGLTF`) with orbit controls and auto-rotate.

**3.7** The frontend 3D viewer SHALL support download of the GLB file directly from the presigned S3 URL.

---

## 4. Story / Anime Series Generation

**4.1** The system SHALL accept a `topic` string and `episode_count` integer (1–6) and return a queued job ID within 500ms.

**4.2** The system SHALL generate a `StoryPlan` JSON object containing: title, synopsis, characters list, and per-episode scenes via Groq LLaMA 3.3 70B.

**4.3** Each episode SHALL contain a `title`, `episode_number`, and a list of `scenes`, each with `scene_number`, `description`, `caption`, and `prompt`.

**4.4** For each scene, the system SHALL dispatch a `generate_anime_task` Celery job to produce a scene image.

**4.5** On scene image dispatch failure, the system SHALL substitute a placeholder scene image rather than failing the entire story job.

**4.6** The system SHALL persist the full StoryPlan to the database and return a `story_id` for retrieval.

**4.7** The frontend StoryPlayer SHALL display episodes and scenes with navigation controls, scene images, and captions.

**4.8** The system SHALL deliver a webhook POST notification to registered webhook URLs on job completion (via `deliver_webhook` Celery task).

**4.9** The system SHALL provide a ZIP export endpoint (`GET /api/v1/story/{story_id}/export`) that bundles all story assets.

---

## 5. Bella AI Assistant

**5.1** Bella SHALL be mounted as a floating overlay in the root layout, persisting across all page navigations without re-initialisation.

**5.2** Bella SHALL accept text chat messages and return LLM replies using Groq LLaMA 3.3 70B with an educational assistant persona.

**5.3** Bella SHALL maintain per-session conversation history in memory, including all prior turns in each Groq API call.

**5.4** Bella SHALL synthesize TTS audio for every reply using edge-tts (`en-US-AriaNeural` voice), returning MP3 bytes as base64.

**5.5** Bella SHALL fall back gracefully (tts_available=false) when edge-tts fails, without blocking the text reply.

**5.6** Bella SHALL provide STT transcription via `POST /api/v1/bella/transcribe` using Groq Whisper Large v3 turbo.

**5.7** Bella SHALL return pattern-matched offline responses when `GROQ_API_KEY` is not configured.

**5.8** Bella's Live2D/VRM avatar SHALL animate with lip sync driven by TTS audio amplitude.

---

## 6. Asset Gallery

**6.1** The gallery SHALL list all `Asset` records for the current session with type, topic, created_at, and presigned S3 URL.

**6.2** The gallery SHALL support filtering by asset type (image/animation/simulation/model3d/story).

**6.3** Each asset card SHALL provide a direct download link via the presigned URL.

**6.4** Each asset SHALL be individually deletable via `DELETE /api/v1/assets/{asset_id}`.

**6.5** The gallery SHALL provide a bulk ZIP export via `GET /api/v1/assets/export/zip`.

---

## 7. Job Queue

**7.1** All generation endpoints SHALL return HTTP 202 with `{ job_id, status: "queued" }` synchronously.

**7.2** The system SHALL support in-process fallback execution when the Celery broker (Redis) is unreachable.

**7.3** Job status polling SHALL be available via `GET /api/v1/jobs/{job_id}` returning `{ job_id, status, asset_id?, error_message?, progress?, step? }`.

**7.4** Real-time job status updates SHALL be delivered via WebSocket at `ws://.../api/v1/jobs/{job_id}/ws`.

**7.5** All Celery tasks SHALL retry up to 3 times with exponential backoff (30s, 60s, 120s) on failure.

---

## 8. Content Safety

**8.1** Every generation endpoint SHALL run `safety.check_topic()` before enqueuing the job; if unsafe, return HTTP 422 with `safety_violation` error.

**8.2** Every Celery generation task SHALL run `safety.check_content()` on the generated output before storing; if unsafe, delete the asset and mark the job failed.

**8.3** All safety violations SHALL be logged with: topic snippet, matched keyword, classifier output, reason, timestamp.

**8.4** The keyword blocklist SHALL cover: pornographic content, hate speech, specific weapon/drug synthesis instructions, and self-harm method content.

**8.5** The Groq safety classifier SHALL be `openai/gpt-oss-safeguard-20b`; the system SHALL fail open (classify as safe) on classifier API errors.

**8.6** Historical, scientific, and standard academic topics SHALL be classified as SAFE even if they involve historical violence or political upheaval.

---

## 9. Storage and Quotas

**9.1** The system SHALL track cumulative storage usage per deployment in the `quota` service.

**9.2** The system SHALL reject generation requests when storage usage exceeds `STORAGE_QUOTA_BYTES` (default 500MB).

**9.3** All S3 presigned URLs SHALL have a minimum TTL of 24 hours.

**9.4** The S3 bucket key structure SHALL be: `{asset_type}/{job_id}/{uuid}.{ext}`.

---

## 10. API and Auth

**10.1** All API endpoints SHALL require an `X-API-Key` header matching the configured API key.

**10.2** Session identity SHALL be carried via a `session_id` field in request bodies or a session cookie.

**10.3** The API SHALL expose OpenAPI docs at `/api/v1/docs` and `/api/v1/redoc`.

**10.4** Rate limiting SHALL be applied per-IP using SlowAPI; generation endpoints limited to 10 requests/minute.

**10.5** CORS SHALL allow `http://localhost:3000`, `http://localhost:3001`, and the configured production domain only.

**10.6** All error responses SHALL use `{ "error": "<code>", "detail": "<message>" }` structure.

**10.7** HTTP 500 errors SHALL still include CORS headers via a global exception handler.

**10.8** Frontend API calls SHALL all route through `lib/api.ts` typed wrappers; raw `fetch` is prohibited in components.

**10.9** Per-endpoint client-side timeouts: default 30s, simulation 90s, model3d 120s, story 30s (submission only), bella 15s.

**10.10** Client-side AbortController SHALL cancel requests that exceed the per-endpoint timeout.

**10.11** Bella session history SHALL persist in-memory on the backend for the lifetime of the server process.

**10.12** TTS failure SHALL be non-fatal; the chat endpoint SHALL still return the text reply with `tts_available: false`.
