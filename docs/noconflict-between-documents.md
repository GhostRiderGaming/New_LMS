# No-Conflict Verification — AnimeEdu Documentation

This document resolves all terminology differences, clarifies apparent contradictions between docs, and establishes which document is authoritative on each topic.

---

## 1. Purpose

With 17 documentation files across a complex AI platform, conflicts and ambiguities can arise. This document:
1. Identifies every known terminology difference or apparent contradiction
2. Resolves each conflict with an authoritative ruling
3. Establishes a clear hierarchy of which doc wins when two docs disagree

---

## 2. Document Authority Hierarchy

When two documents appear to conflict, this priority order applies:

```
1. Source code (backend/app/, frontend/app/, etc.)
   ↑ Highest authority — code is truth
2. requirements.md
   ↑ Functional requirements; numbered for traceability to source code comments
3. prd.md
   ↑ Product intent and success metrics
4. features.md
   ↑ Detailed feature specs; aligns with code
5. architecture.md
   ↑ System design; reflects actual implementation
6. All other docs (design, ux, agents, testing, etc.)
   ↑ Informational; defer to above on conflicts
```

---

## 3. Resolved Terminology Conflicts

### 3.1 Feature Names

The four generation features have both **module names** (UI-facing) and **engine names** (technical). Both are correct in context:

| Technical Name | UI Module Name | Route | Source |
|---------------|---------------|-------|--------|
| Anime Generator | Scene Forge | `/anime` | `features.md`, `ux.md` |
| Simulation Engine | Lab Engine | `/simulation` | `features.md`, `ux.md` |
| 3D Model Generator | Holodeck | `/model3d` | `features.md`, `ux.md` |
| Story Generator | Chronicle | `/story` | `features.md`, `ux.md` |
| Bella AI Assistant | Bella | (overlay) | All docs |

**Rule:** Use module names (Scene Forge, etc.) in user-facing docs (ux.md, seo.md, user-flow.md). Use technical names in developer docs (requirements.md, architecture.md, coding-rules.md, agents.md).

---

### 3.2 Image Generation Provider

**Apparent conflict:** `prd.md` mentions "HF Animagine XL 4.0" as the primary provider. `architecture.md`, `features.md`, and `featurelogs.md` say Pollinations.ai is primary.

**Resolution:** Pollinations.ai is the **current primary provider**. HF Animagine XL is available as a fallback. `prd.md`'s reference to HF reflects the original design intent before the switch to Pollinations.ai. `featurelogs.md` documents this change. Source code in `anime_generator.py` confirms Pollinations.ai is primary.

**Authoritative source:** `featurelogs.md` (documents the change), `anime_generator.py` (implements it).

---

### 3.3 3D Model Generation Provider

**Apparent conflict:** `prd.md` says "Tripo AI (text-to-3D)". The steering files (`tech.md`) say "TripoSR / HF Inference API". `featurelogs.md` says "switched to Tripo AI".

**Resolution:** Tripo AI is the **current and authoritative** 3D model provider. The steering file `tech.md` reflects the original design before the switch. All new code and docs use Tripo AI.

**Authoritative source:** `model3d_engine.py`, `featurelogs.md`.

---

### 3.4 Safety Classifier Model Name

**Apparent conflict:** Some docs reference "LlamaGuard 3 8B" (from `tech.md` steering file). Source code and `featurelogs.md` use `openai/gpt-oss-safeguard-20b`.

**Resolution:** `openai/gpt-oss-safeguard-20b` is the **current model** in production code. LlamaGuard 3 8B was the original design. The steering file predates the fix.

**Authoritative source:** `safety.py::SafetyService.__init__()`.

---

### 3.5 TTS Provider

**Apparent conflict:** `agents.md` references edge-tts with "en-US-AriaNeural". `tech.md` steering file references "Fal.ai Kokoro TTS".

**Resolution:** edge-tts with `en-US-AriaNeural` is the **current TTS provider**. Fal.ai Kokoro was considered but not implemented. edge-tts is free with no API key, which makes it the better choice for open-source deployment.

**Authoritative source:** `bella_service.py::_synthesize_speech_with_phonemes()`.

---

### 3.6 Database: "SQLite" vs "Supabase PostgreSQL"

**Apparent conflict:** `architecture.md` says "SQLite (local dev)". `tech.md` steering file says "Supabase PostgreSQL (free tier) / SQLite for local dev". `deployment.md` mentions both Railway PostgreSQL and Supabase as options.

**Resolution:** 
- **Local development:** SQLite (`DATABASE_URL=sqlite:///./app.db`). Auto-created, no setup needed.
- **Production:** PostgreSQL. Either Railway's PostgreSQL add-on or Supabase are both valid choices. The docs correctly mention both as options.

There is no actual conflict — these are environment-specific choices.

**Authoritative source:** `backend/.env.example` for defaults; `deployment.md` §3.3 for production options.

---

### 3.7 API Key Header Name

**Apparent conflict:** Some docs say `X-API-Key`, others may refer to it as `api_key`. 

**Resolution:** The header name is `X-API-Key` (capital X, hyphenated). The query parameter fallback for WebSocket is `api_key` (lowercase, underscore). Both are valid in their respective contexts.

| Context | Identifier | Format |
|---------|-----------|--------|
| HTTP requests | `X-API-Key` | Request header |
| WebSocket URL | `api_key` | Query parameter |
| Frontend env var | `NEXT_PUBLIC_API_KEY` | Environment variable |
| Backend env var | `API_KEY` | Environment variable |

**Authoritative source:** `frontend/lib/api.ts` (header construction), `backend/app/core/auth.py` (validation).

---

### 3.8 Image Dimensions

**Apparent conflict:** `prd.md` describes "512×768 portrait". `design.md` shows similar dimensions. `architecture.md` database schema doesn't specify.

**Resolution:** `512×768` (portrait, width×height) is the standard for all generated images. This matches `anime_generator.py::_IMAGE_SIZE`. It's not stored in the database — it's a generation constant.

**Authoritative source:** `anime_generator.py::_IMAGE_SIZE = {"width": 512, "height": 768}`.

---

### 3.9 XP Values

**Apparent conflict:** `prd.md` §5.9 says "+10 XP image, +15 animation, +20 simulation, +25 model3d, +15 story episode". `ux.md` §4 toast says "+10 XP — Scene created!". `tasks.md` doesn't specify values.

**Resolution:** The values in `prd.md` §5.9 are authoritative. They should be reflected in `useGameProgress.ts`. `ux.md`'s "+10 XP" toast is specifically for image generation (scene creation) and is correct.

**Authoritative source:** `prd.md` §5.9, `frontend/lib/useGameProgress.ts` (implementation).

---

### 3.10 "Bella" Identity: VRM vs Live2D

**Apparent conflict:** The project description says "persistent 3D VRM anime assistant". `features.md` says "Live2D/VRM anime avatar". `layout.tsx` loads "Cubism 4 Core SDK" (Live2D). `architecture.md` mentions both `@pixiv/three-vrm` and `pixi-live2d-display`.

**Resolution:** Both Live2D and VRM are supported:
- **Live2D** via `pixi-live2d-display` + Cubism 4 SDK — primary rendering (currently active in layout.tsx)
- **VRM** via `@pixiv/three-vrm` + Three.js — available as alternative/fallback

The UI uses Live2D by default. VRM is available if a `.vrm` model file is provided. Both coexist in the codebase.

**Authoritative source:** `frontend/app/layout.tsx` (Cubism script), `frontend/components/bella/BellaPresence.tsx` (component implementation).

---

### 3.11 Simulation Categories

**Apparent conflict:** `requirements.md` §2.1 lists 5 categories (physics/chemistry/biology/mathematics/history). `features.md` lists the same. `prd.md` says "self-contained HTML5 canvas simulation" without specifying categories.

**Resolution:** The five categories are: `physics`, `chemistry`, `biology`, `mathematics`, `history`. This matches `simulation_engine.py::SimulationCategory` enum exactly.

**Authoritative source:** `simulation_engine.py::SimulationCategory`.

---

### 3.12 "session_id" Origin

**Apparent conflict:** Some docs imply session_id is generated by the backend; others imply the frontend generates it.

**Resolution:** The **frontend generates** `session_id` as a UUID (via Zustand/localStorage) and includes it in all request bodies. The backend reads it from the request body and uses it to tag assets and Bella history. The backend does NOT generate session_id.

**Authoritative source:** `frontend/lib/bellaStore.ts` (generation), `backend/app/core/auth.py` (consumption).

---

## 4. Terms Glossary (canonical definitions)

| Term | Definition | First defined in |
|------|-----------|-----------------|
| job_id | UUID identifying an async generation task | `requirements.md` §7 |
| asset_id | UUID identifying a stored generated file | `requirements.md` §6 |
| story_id | UUID identifying a StoryPlan | `features.md` §4 |
| session_id | UUID identifying a browser session (frontend-generated) | `project-context.md` §6.12 |
| presigned_url | Temporary S3 URL (24h TTL) for asset access | `requirements.md` §9.3 |
| file_path | S3 object key (not a URL) | `architecture.md` §4 |
| StoryPlan | Pydantic model containing episodes and scenes | `agents.md` §5 |
| SafetyResult | Dataclass: `safe: bool, reason: str, matched_keyword, classifier_output` | `agents.md` §6 |
| fail-open | When classifier API fails, classify as SAFE | `requirements.md` §8.5 |
| in-process fallback | Execute Celery task synchronously when Redis is down | `project-context.md` §7.1 |
| fallback simulation | Particle animation HTML used when LLM fails | `features.md` §2 |

---

## 5. Document Coverage Matrix

Each requirement is covered by at least one doc. This matrix confirms no requirement is orphaned:

| Domain | requirements.md | features.md | architecture.md | agents.md | testing.md |
|--------|----------------|-------------|-----------------|-----------|------------|
| Anime generation | §1 | §1 | §2 | §7 | §3 |
| Simulation | §2 | §2 | §2 | §4 | §3 |
| 3D model | §3 | §3 | §2 | §8 | §3 |
| Story | §4 | §4 | §2 | §5 | §3 |
| Bella | §5 | §5 | §2 | §2 | §3 |
| Gallery | §6 | §6 | §2 | — | §3 |
| Job queue | §7 | §8 | §2,3 | — | §3 |
| Safety | §8 | §8 | §6 | §6 | §3 |
| Storage/quota | §9 | — | §4,7 | — | §3 |
| Auth/API | §10 | — | §5,6 | — | §3 |

---

## 6. Change Protocol

When a conflict is discovered in the future:

1. Check the source code first — it is always truth
2. Update the lower-authority doc(s) to match
3. Add an entry in section 3 of this document with the resolution
4. If the conflict reflects an intentional change (e.g., new provider), add an entry in `featurelogs.md`
5. Never change source code to match docs — always the reverse
