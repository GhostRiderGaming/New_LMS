# 🎌 AnimeEdu — AI-Powered Educational Learning Platform

Transform any topic into immersive anime scenes, interactive simulations, 3D models, and multi-episode story series — all powered by open-source AI.

---

## ✨ Features

| Module | Description | Tech Stack |
|--------|-------------|------------|
| **🎨 Scene Forge** | Generate anime-style educational images with topic-aware prompts | Groq LLaMA 3.3 → Animagine XL / Google CSE |
| **🔬 Lab Engine** | Create interactive HTML5 simulations with sliders & scenario switching | Groq LLaMA 3.3 → Canvas/JS |
| **🧊 Holodeck** | Generate 3D models of real-world objects (anatomy, chemistry, etc.) | Tripo AI / HF stable-fast-3d |
| **📖 Chronicle** | Build multi-episode educational anime stories with narrated video | Groq + Pollinations + edge-tts + moviepy |
| **🤖 Bella** | AI tutor companion with voice chat, TTS, and topic explanations | Groq LLaMA + edge-tts + Whisper STT |

---

## 🛠️ Tech Stack

**Backend:** FastAPI · Python 3.11+ · SQLAlchemy · Celery · Redis  
**Frontend:** Next.js 14 · React · TailwindCSS · TypeScript  
**AI Services:** Groq (LLaMA 3.3 70B) · Pollinations · Tripo AI · Hugging Face · edge-tts  
**Storage:** Local filesystem (dev) · Google Cloud Storage (prod)

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- Redis (optional — Celery falls back to in-process execution)

### 1. Clone & configure

```bash
git clone https://github.com/GhostRiderGaming/New_LMS.git
cd New_LMS
cp backend/.env.example backend/.env
```

Edit `backend/.env` and add your API keys (see [Environment Variables](#-environment-variables) below).

### 2. Install dependencies

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 3. Run (3 terminals)

**Terminal 1 — Backend:**
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — Celery Worker (optional):**
```bash
cd backend
celery -A app.worker worker --loglevel=info --pool=solo
```
> `--pool=solo` is required on Windows. If you skip this terminal, jobs run in-process automatically.

**Terminal 3 — Frontend:**
```bash
cd frontend
npm run dev
```

### 4. Open

| URL | Purpose |
|-----|---------|
| http://localhost:3000 | 🌐 Application |
| http://localhost:8000/health | ❤️ Health check |
| http://localhost:8000/api/v1/docs | 📖 Swagger API docs |

---

## 🔑 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ Yes | [Groq API key](https://console.groq.com) — powers LLM prompts, safety classifier, and Bella |
| `HF_API_TOKEN` | Optional | [Hugging Face token](https://huggingface.co/settings/tokens) — fallback for 3D model generation |
| `TRIPO_API_KEY` | Optional | [Tripo AI key](https://platform.tripo3d.ai/api-keys) — primary 3D model generator |
| `API_KEY` | ✅ Yes | API authentication key (default: `dev-api-key`) |
| `DATABASE_URL` | Optional | SQLAlchemy connection string (default: `sqlite:///./app.db`) |
| `UPSTASH_REDIS_URL` | Optional | Redis URL for Celery (default: `redis://localhost:6379/0`) |
| `STORAGE_BACKEND` | Optional | `local` (default) or `gcs` for Google Cloud Storage |
| `BACKEND_BASE_URL` | Optional | Base URL for asset serving (default: `http://localhost:8000`) |
| `CORS_ORIGINS` | Optional | Comma-separated allowed CORS origins for production |
| `GOOGLE_API_KEY` | Optional | Google Cloud API key for Smart Image Resolver (diagram search) |
| `GOOGLE_CSE_ID` | Optional | Google Custom Search Engine ID |
| `STORAGE_QUOTA_BYTES` | Optional | Per-session storage quota in bytes (default: 500 MB) |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Next.js Frontend                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │Scene Forge│ │Lab Engine│ │ Holodeck │ │Chronicle │    │
│  └─────┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘    │
│        │           │            │             │           │
│  ┌─────┴───────────┴────────────┴─────────────┴─────┐    │
│  │              Bella AI Tutor (floating)            │    │
│  └──────────────────────────────────────────────────┘    │
└────────────────────┬─────────────────────────────────────┘
                     │ REST API + WebSocket
┌────────────────────┼─────────────────────────────────────┐
│                FastAPI Backend                            │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Safety  │  │ Prompt  │  │  Asset   │  │  Quota   │  │
│  │ Filter  │  │ Builder │  │ Manager  │  │ Service  │  │
│  └─────────┘  └─────────┘  └──────────┘  └──────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Task Executor (Celery + in-process fallback)     │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌─────────┐ ┌──────────┐ ┌─────────┐
   │ Groq AI │ │Pollinations│ │Tripo/HF │
   │ (LLM)  │ │  (Images)  │ │  (3D)   │
   └─────────┘ └──────────┘ └─────────┘
```

---

## 📂 Project Structure

```
New_LMS/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── core/auth.py         # Authentication (API key / session)
│   │   ├── models/              # SQLAlchemy models
│   │   ├── routers/             # API endpoints
│   │   │   ├── anime.py         # Scene Forge endpoints
│   │   │   ├── simulation.py    # Lab Engine endpoints
│   │   │   ├── model3d.py       # Holodeck endpoints
│   │   │   ├── story.py         # Chronicle endpoints
│   │   │   ├── bella.py         # AI tutor endpoints
│   │   │   ├── jobs.py          # Job status + WebSocket
│   │   │   └── assets.py        # Asset CRUD + ZIP export
│   │   ├── services/            # Business logic
│   │   │   ├── anime_generator.py
│   │   │   ├── simulation_engine.py
│   │   │   ├── model3d_engine.py
│   │   │   ├── story_engine.py
│   │   │   ├── video_assembler.py
│   │   │   ├── bella_service.py
│   │   │   ├── safety.py
│   │   │   ├── prompt_builder.py
│   │   │   ├── image_resolver.py
│   │   │   └── asset_manager.py
│   │   └── worker.py            # Celery task definitions
│   ├── storage/                 # Local asset storage
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── app/                     # Next.js pages
│   ├── components/              # React components
│   ├── lib/                     # API client, utilities
│   └── package.json
├── docs/                        # Documentation & specs
├── docker-compose.yml
└── README.md
```

---

## 📋 API Reference

Full interactive documentation available at `http://localhost:8000/api/v1/docs` when the backend is running.

### Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/anime/generate` | Submit anime image generation job |
| `POST` | `/api/v1/simulation/generate` | Submit simulation generation job |
| `POST` | `/api/v1/model3d/generate` | Submit 3D model generation job |
| `POST` | `/api/v1/story/generate` | Submit story generation job |
| `GET`  | `/api/v1/jobs/{id}` | Get job status |
| `WS`   | `/api/v1/jobs/{id}/ws` | Real-time job status stream |
| `GET`  | `/api/v1/assets` | List all assets |
| `GET`  | `/api/v1/assets/export/zip` | Download all assets as ZIP |
| `POST` | `/api/v1/bella/chat` | Chat with Bella AI tutor |
| `GET`  | `/health` | Service health check |

---

## 🔐 Safety

All generation endpoints run a two-stage safety filter before creating any content:

1. **Keyword blocklist** — instant rejection with no API call
2. **LLM safety classifier** — semantic classification via Groq

Legitimate educational topics (history, science, geography) are never blocked.

---

## 📄 License

This project is for educational purposes.