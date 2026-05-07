# API Status Report

This document outlines all the APIs and external services required by the project, their current status, and recommendations for free alternatives.

## 1. Groq API (`GROQ_API_KEY`)
*   **Required?**: **Yes**. Powers all core LLM functionality including Bella companion chat, story generation, prompt building, and safety checks.
*   **Provided?**: Yes, in `.env`.
*   **Working?**: ✅ **Yes**. Successfully authenticated and returns responses.
*   **Free Alternative**: None needed. Groq's free tier is incredibly fast and generous. (Backup: Google Gemini API free tier).

## 2. Hugging Face Inference API (`HF_API_TOKEN`)
*   **Required?**: **Yes**. Specifically used in `model3d_engine.py` to generate 3D models using `openai/shap-e`.
*   **Provided?**: Yes, in `.env`.
*   **Working?**: ❌ **No**. Returns a `401 Unauthorized` error. The current token is invalid or expired.
*   **Action Required**: Log in to Hugging Face, generate a new free Access Token, and update `HF_API_TOKEN` in the `.env` file.

## 3. Pollinations.ai 
*   **Required?**: **Yes**. Hardcoded into `anime_generator.py` for anime images and animation frames.
*   **Provided?**: N/A (Token-less service).
*   **Working?**: ✅ **Yes**. Works out of the box via standard HTTP requests.
*   **Free Alternative**: Already completely free and doesn't require authentication.

## 4. AWS S3 (`AWS_ACCESS_KEY_ID` & `AWS_SECRET_ACCESS_KEY`)
*   **Required?**: **No**. The system falls back to local storage if AWS credentials are removed, but since they are provided, S3 is used.
*   **Provided?**: Yes, in `.env`.
*   **Working?**: ✅ **Yes**. Successfully authenticated with AWS via `boto3`.
*   **Free Alternative**: **Cloudflare R2**. AWS provides 5GB free for 12 months. Cloudflare R2 provides 10GB/month forever with no egress fees. Uses the same S3 code by changing the endpoint URL.

## 5. Redis Broker (`UPSTASH_REDIS_URL`)
*   **Required?**: **Yes**. Celery requires a broker for background tasks (simulations, 3D generation, webhooks).
*   **Provided?**: Yes, currently set to `redis://localhost:6379/0`.
*   **Working?**: ❌ **No**. Redis is not installed or running locally on your Windows machine, causing Celery background tasks to fail.
*   **Action Required**: Sign up for **Upstash Redis** (free serverless Redis instance with 10k commands/day). Replace the `localhost` URL with the real Upstash connection string.
