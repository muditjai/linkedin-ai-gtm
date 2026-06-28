# LinkedIn AI GTM — Project Spec

> Chrome extension + service backend for AI-powered LinkedIn outreach.

---

## Table of Contents

1. [Code Guidelines](#code-guidelines)
2. [Problem Statement](#problem-statement)
3. [Architecture & Infrastructure](#architecture--infrastructure)
4. [Repository Layout](#repository-layout)
5. [Feature Roadmap](#feature-roadmap)
6. [Service Backend (Phase 2)](#service-backend-phase-2)
7. [AI Side Panel (Extension UX)](#ai-side-panel-extension-ux)
8. [Configuration & Secrets](#configuration--secrets)

---

## Code Guidelines

### Modular Code & Test Cases

- **Read before you write.** Always read the existing code before making any changes.
- **Reason carefully about edge cases.** Stop adding bugs — think deeply about potential errors before changing code.
- **Commit and push after significant changes.** "Submit" / "push" always means `git commit && git push`.
- **Keep code modular.** Split large files into smaller, focused modules.
- **Cap file length.** If a file exceeds ~500 lines, consider splitting it.
- **Write tests** for new functionality where appropriate.
- **Use descriptive names** aligned with the existing codebase.
- **Validate inputs** when implementing features.
- **Prefer typed languages** (e.g. TypeScript over JavaScript) and Python type annotations wherever available.

---

## Problem Statement

Build a Chrome extension with AI-powered outreach capabilities for LinkedIn. The product helps users automate and optimize LinkedIn messaging by:

- Scraping conversations
- Analyzing message quality
- Orchestrating outreach campaigns through a visual sequencer

---

## Architecture & Infrastructure

### Core Stack

- **Frontend** — Chrome extension that opens as a full page (not a popup). See `extension/`.
- **Service backend** — Containerised Express + TypeScript + MongoDB service. CRUD for messages / threads / feedback, AI-suggested reply drafting, agent stub. See `backend/`.
- **Agent backend** — Separate LangGraph-based agent backend (deployed independently). Service currently returns `501` on `/api/agent/decide`; `/api/agent/status` is live.
- **Hosting** — DigitalOcean (Kubernetes + container registry).
- **Database** — MongoDB (DigitalOcean managed cluster). See [Configuration & Secrets](#configuration--secrets).

### AI Services

- **Gemini 3.1 Pro** — Message reflection, analysis, contextual understanding. Default model: `gemini-3.1-pro`.
- **DigitalOcean Inference model** — Message generation. Falls back to Gemini when the DO token is absent. Default model: `gpt-oss-20b`.

---

## Repository Layout

```
linkedin-ai-gtm/
├── extension/      # Chrome extension (Phase 1)
├── backend/        # Express + TypeScript + MongoDB service (Phase 2)
├── AGENTS.md       # This file
└── .gitignore
```

---

## Feature Roadmap

### Phase 1 — Core Frontend UI (DONE)

1. **Home Dashboard** — Landing experience with an overview summary: messages to reply to, sent, replies received, positive / negative outcomes, follow-ups, scraping status.
2. **Messages Tab** — Inbox-style view with a left-side contact list and right-side conversation thread view.
3. **Sequencer Tab** — Canvas for delays, fixed messages, and AI-generated personalized messages.
4. **Scraping functionality** — Reads the LinkedIn messages page and incrementally loads conversations into the service backend to reduce the risk of account bans.

### Phase 2 — Service Backend (DONE)

- CRUD endpoints for messages, threads, sequencer data (see `backend/src/routes/`).
- Storage / retrieval of conversations, sequencer definitions, and related metadata (MongoDB).
- Draft generation endpoint (`POST /api/draft`, DO Inference → Gemini fallback).
- Feedback capture endpoint (`POST /api/feedback`).
- Containerised, deployed to the DigitalOcean k8s cluster.

### Phase 3 — AI Integration

1. **AI Self-Reflection** — Analyse outbound and inbound messages and present insights in the Messages tab. Implemented via `POST /api/draft` (Gemini + DO Inference) and reflected in the side panel.
2. **User Feedback System** — Capture feedback (score 1–5 + free-text comment) via `POST /api/feedback`.
3. **Model Fine-Tuning** — Feedback is persisted to MongoDB and used as few-shot examples in future `POST /api/draft` calls.

### Context Data Integration (per recipient)

1. **LinkedIn Profile** — Public profile details + professional background.
2. **Company Information** — Current company name + context.
3. **Email Conversations** — Prior email history.
4. **Common Connections** — Shared connections between user and recipient.
5. **Social Posts** — LinkedIn / Facebook posts revealing interests.
6. **Interest Filtering** — Prioritise known connections.
7. **Context Editing** — Let the user review / edit / approve context.
8. **Feedback Storage** — Save context feedback into MongoDB for future model training. Implemented as the `feedback` collection in the backend.

---

## Service Backend (Phase 2)

`backend/` is the Express + TypeScript + MongoDB service that the extension talks to.

### Stack

- Express + TypeScript (strict mode, ~500 lines per file)
- Mongoose 8 (`strict: 'throw'` schemas)
- zod for request-body validation
- `@google/generative-ai` (Gemini 3.1 Pro, configurable model)
- `openai` SDK pointed at DO Inference (optional fast-path)
- `helmet` + `compression` + `cors` + `express-rate-limit`

### Endpoints

- `GET /health` — Readiness probe.
- `POST /api/messages` — Bulk upsert; returns `newSinceLastScrape[]`.
- `GET /api/messages?threadUrn=...` — Persisted messages for one thread.
- `GET /api/threads?limit=15` — Top-N most-recently-updated threads.
- `GET /api/threads/:urn` — One thread.
- `POST /api/draft` — Generate a draft reply (DO Inference → Gemini fallback).
- `POST /api/feedback` — Save user feedback (1–5 + comment).
- `GET /api/feedback?threadUrn=...` — List prior feedback for a thread.
- `POST /api/agent/decide` — **Stub** — returns 501; will be replaced by LangGraph.
- `GET /api/agent/status` — Status of the agent backend.

### Local Dev Workflow

```bash
cd backend
cp .env.example .env.local      # fill in MONGODB_URI + GEMINI_API_KEY
npm install
npm run dev                     # ts-node-dev with hot reload

# In another shell:
curl http://localhost:3000/health
```

### MongoDB Collections

- `messages` — One doc per LinkedIn message; natural key `(threadUrn, messageUrn)`. Compound unique index for idempotent upserts.
- `threads` — One doc per LinkedIn thread (URN); aggregate of the most-recent message + inbound/outbound counts.
- `feedback` — One doc per user rating of a draft; indexed by `threadUrn` for few-shot lookup in future `POST /api/draft` calls.

---

## AI Side Panel (Extension UX)

The extension's right-hand side panel is the UI for the AI features of Phase 2/3. It uses the backend's `/api/threads`, `/api/messages`, `/api/draft`, and `/api/feedback` endpoints.

### Flow

1. **Top-15 thread list** — `GET /api/threads?limit=15` renders the most recently updated conversations in the side panel.
2. **Thread context** — Selecting a thread calls `GET /api/messages?threadUrn=...` and shows the last 10 inbound messages as the model's context window.
3. **Draft reply** — The "Draft reply" button calls `POST /api/draft` (DO Inference → Gemini fallback) and populates a `<textarea>` with the result + sentiment + tips.
4. **Feedback** — Thumbs up/down + free-text comment POSTs to `/api/feedback` for future model fine-tuning.
5. **NEW pill** — After each "Scrape All", the extension POSTs the scraped messages to `/api/messages` and reads back `newSinceLastScrape[]` to mark new messages with a "New" pill in the message list.

> The LangGraph / DigitalOcean ADK agent backend is a separate deployment. For now `/api/agent/decide` returns 501.

---

## Configuration & Secrets

### Secrets Storage

- **Local-only secrets.** Store all secrets in a local gitignored file such as `backend/.env.local` (never commit it). The repo ships `backend/.env.example` with all the keys but no values.
- **No committed credentials.** Keep secrets out of the repository and out of any committed config files. `backend/k8s/secret.yaml` is a template with placeholders only; create the real Secret imperatively with `kubectl create secret`.
- **Environment variables** for API keys and service credentials.
- **Validated loader.** The backend reads ALL env values through one validated loader (`backend/src/config/env.ts`) so missing/malformed values crash the process at startup, not at request time.

### Required Environment Variables (backend)

- `MONGODB_URI` — **Required.** MongoDB connection string.
- `GEMINI_API_KEY` — **Required.** Gemini 3.1 Pro API key.
- `GEMINI_MODEL` — Optional; default `gemini-3.1-pro`.
- `DO_INFERENCE_TOKEN` — Optional. DO Inference token; if empty, falls back to Gemini.
- `DO_INFERENCE_MODEL` — Optional; default `gpt-oss-20b`.
- `DO_INFERENCE_BASE_URL` — Optional; default `https://inference.digitalocean.com/v1`.
- `PORT` — Optional; default `3000`.
- `NODE_ENV` — Optional; default `development`.
- `ALLOWED_ORIGINS` — Optional; comma-separated CORS origins, default `*`.
- `MONGODB_DB_NAME` — Optional; default `linkedin-ai`.
- `RATE_LIMIT_WINDOW_MS` — Optional; default `60000`.
- `RATE_LIMIT_MAX` — Optional; default `120`.

### DigitalOcean k8s + MongoDB + Container Registry

```bash
# 1. Save the cluster's kubeconfig.
doctl kubernetes cluster kubeconfig save f3f8ebb0-4388-4a6f-9e36-3f3e60211c6b
kubectl cluster-info
# Expected:
#   Kubernetes control plane is running at
#     https://f3f8ebb0-4388-4a6f-9e36-3f3e60211c6b.k8s.ondigitalocean.com
#   CoreDNS is running at
#     https://f3f8ebb0-4388-4a6f-9e36-3f3e60211c6b.k8s.ondigitalocean.com/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy

# 2. Create the container registry (idempotent).
doctl registry create hackathon-registry
# Container registry to use:
#   registry.digitalocean.com/hackathon-registry

# 3. Create the MongoDB-managed cluster (DO control panel) and copy its
#    connection string into MONGODB_URI in backend/.env.local.
#    The default .env.example ships with a placeholder + the working
#    service-account connection string — rotate the password before
#    sharing the repo.
```

### Full Deploy Flow (Phase 2)

```bash
# 1. Build + push the image.
cd backend
docker build -t registry.digitalocean.com/hackathon-registry/linkedin-ai-backend:latest .
doctl registry login
docker push registry.digitalocean.com/hackathon-registry/linkedin-ai-backend:latest

# 2. Create the Secret (one-time, with real values).
kubectl --context do-fra1-linkedin-ai create secret generic linkedin-ai-secrets \
  --from-literal=mongodb-uri='<your-mongodb-uri>' \
  --from-literal=gemini-api-key='<your-gemini-key>' \
  --from-literal=do-inference-token='<your-do-token>'

# 3. Apply the manifest.
kubectl --context do-fra1-linkedin-ai apply -f backend/k8s/deployment.yaml

# 4. Verify.
kubectl --context do-fra1-linkedin-ai get pods -l app=linkedin-ai-backend
kubectl --context do-fra1-linkedin-ai port-forward svc/linkedin-ai-backend 3000:3000
curl http://localhost:3000/health
# Expected:
#   {"success":true,"status":"ok","env":"production","ai":{"gemini":"gemini-3.1-pro","doInference":"..."}}
```

### Rollout / Update

```bash
# After rebuilding + pushing a new image:
kubectl --context do-fra1-linkedin-ai rollout restart deployment/linkedin-ai-backend
kubectl --context do-fra1-linkedin-ai rollout status deployment/linkedin-ai-backend
```

### Service-Account Credentials (NOT for the repo)

The DigitalOcean managed MongoDB service-account is operator-side material. It MUST stay out of the repository — fill it into `backend/.env.local` and into the k8s `Secret` from your password manager / DO control panel. See `backend/k8s/README.md` for the `kubectl create secret` snippet.