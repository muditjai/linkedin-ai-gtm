# Project Spec — LinkedIn AI GTM

## Code Guidelines

### Modular code & test cases
- Always read the code first before making any changes.
- Stop adding any bugs as they waste a lot of time — reason properly
  and deeply about the potential errors before making changes.
- After making any significant change, always commit and push.
- Keep code modular — split large files into smaller, focused modules.
- Don't create super long files — if a file exceeds ~500 lines, consider
  splitting it.
- Write test cases for new functionality where appropriate.
- Use descriptive naming conventions aligned with the existing codebase.
- When implementing features, ensure they are properly validated.
- Always prefer typed languages (e.g. TS over JS) and Python type
  annotations wherever available and possible.
- "Submit the code" / "push" always means `git commit && git push`.

## Problem Statement

Build a Chrome extension with AI-powered outreach capabilities for
LinkedIn. The product should help users automate and optimize LinkedIn
messaging by scraping conversations, analyzing message quality, and
orchestrating outreach campaigns through a visual sequencer.

---

## Architecture and Infrastructure

### Core stack
- **Frontend** — Chrome extension. Opens as a full page, not a popup
  (see `extension/`).
- **Service backend** — Containerised Express + TypeScript + MongoDB
  service layer for frontend requests and business logic
  (see `backend/`). Provides CRUD for messages / threads / feedback,
  AI-suggested reply drafting, and a stub for the agent endpoint.
- **Agent backend** — Separate LangGraph-based agent backend (to be
  deployed independently). The service backend currently returns 501 on
  `/api/agent/decide` and exposes a `/api/agent/status` endpoint.
- **Hosting** — DigitalOcean (Kubernetes + container registry).
- **Database** — MongoDB (DigitalOcean managed cluster — see
  "Configuration and Secrets").

### AI services
- **Gemini 3.1 Pro** — message reflection, analysis, contextual
  understanding (default model: `gemini-1.5-pro`).
- **Message generation model** — LLM from the DigitalOcean model list,
  default `gpt-oss-20b` (overridable via env). When the DO token is
  absent the service falls back to Gemini.

---

## Repository layout

```
linkedin-ai-gtm/
├── extension/      # Chrome extension (Phase 1)
├── backend/        # Express + TypeScript + MongoDB service (Phase 2)
├── AGENTS.md       # this file
└── .gitignore
```

---

## Feature Roadmap

### Phase 1: Core frontend UI (DONE)
1. **Home Dashboard** — landing experience with an overview summary
   (messages to reply to, sent, replies received, positive / negative
   outcomes, follow-ups, scraping status).
2. **Messages Tab** — inbox-style view with left-side contact list and
   right-side conversation thread view.
3. **Sequencer Tab** — canvas for delays / fixed messages / AI-generated
   personalized messages.
4. **Scraping functionality** — reads the LinkedIn messages page and
   loads conversations into the service backend incrementally to
   reduce the risk of account bans.

### Phase 2: Service backend (DONE)
- CRUD endpoints for messages, threads, sequencer data
  (see `backend/src/routes/`).
- Storage / retrieval of conversations, sequencer definitions, and
  related metadata (MongoDB).
- Draft generation endpoint (DO Inference -> Gemini fallback).
- Feedback capture endpoint.
- Containerised, deployed to the DigitalOcean k8s cluster.

### Phase 3: AI integration
1. **AI Self-Reflection** — analyse outbound and inbound messages and
   present insights in the Messages tab. Implemented via
   `POST /api/draft` (Gemini + DO Inference) and reflected in the
   side panel.
2. **User Feedback System** — capture feedback (score 1-5 + free-text
   comment) via `POST /api/feedback`.
3. **Model Fine-Tuning** — feedback is persisted to MongoDB
   (per "Feedback Storage" below) and used as few-shot examples in
   future `POST /api/draft` calls.

### Context Data Integration (per recipient)
1. LinkedIn Profile — public profile details + professional background.
2. Company Information — current company name + context.
3. Email Conversations — prior email history.
4. Common Connections — shared connections between user and recipient.
5. Social Posts — LinkedIn / Facebook posts revealing interests.
6. Interest Filtering — prioritise known connections.
7. Context Editing — let the user review / edit / approve context.
8. **Feedback Storage** — save context feedback into MongoDB for future
   model training (per AGENTS.md original spec). Implemented as the
   `feedback` collection in the backend.

---

## Service Backend (Phase 2)

`backend/` is the Express + TypeScript + MongoDB service that the
extension talks to.

### Stack
- Express + TypeScript (strict mode, ~500 lines/file)
- Mongoose 8 (`strict: 'throw'` schemas)
- zod for request-body validation
- @google/generative-ai (Gemini 1.5 Pro, configurable model)
- openai SDK pointed at DO Inference (optional fast-path)
- helmet + compression + cors + express-rate-limit

### Endpoints
| Method | Path                                                | Purpose                                                  |
| ------ | --------------------------------------------------- | -------------------------------------------------------- |
| GET    | `/health`                                            | readiness probe                                          |
| POST   | `/api/messages`                                      | bulk upsert; returns `newSinceLastScrape[]`             |
| GET    | `/api/messages?threadUrn=...`                        | persisted messages for one thread                         |
| GET    | `/api/threads?limit=15`                              | top-N most-recently-updated threads                       |
| GET    | `/api/threads/:urn`                                  | one thread                                                |
| POST   | `/api/draft`                                         | generate a draft reply (DO Inference -> Gemini fallback)  |
| POST   | `/api/feedback`                                      | save user feedback (1-5 + comment)                        |
| GET    | `/api/feedback?threadUrn=...`                        | list prior feedback for a thread                          |
| POST   | `/api/agent/decide`                                  | STUB - returns 501; will be replaced by LangGraph deploy |
| GET    | `/api/agent/status`                                  | status of the agent backend                              |

### Local dev workflow
```bash
cd backend
cp .env.example .env.local      # fill in MONGODB_URI + GEMINI_API_KEY
npm install
npm run dev                     # ts-node-dev with hot reload
# In another shell:
curl http://localhost:3000/health
```

### MongoDB collections
- `messages`  - one doc per LinkedIn message; natural key
  `(threadUrn, messageUrn)`. Compound unique index for idempotent
  upserts.
- `threads`   - one doc per LinkedIn thread (URN); aggregate of the
  most-recent message + inbound/outbound counts.
- `feedback`  - one doc per user rating of a draft; indexed by
  `threadUrn` for few-shot lookup in future `POST /api/draft` calls.

---

## AI Side Panel (extension UX)

The extension's right-hand side panel is the UI for the AI features of
Phase 2/3. It uses the backend's `/api/threads`, `/api/messages`,
`/api/draft`, and `/api/feedback` endpoints. The flow is:

1. **Top-15 thread list** — `GET /api/threads?limit=15` renders the most
   recently updated conversations in the side panel.
2. **Thread context** — selecting a thread calls
   `GET /api/messages?threadUrn=...` and shows the last 10 inbound
   messages as the model's context window.
3. **Draft reply** — the "Draft reply" button calls `POST /api/draft`
   (DO Inference -> Gemini fallback) and populates a `<textarea>` with
   the result + sentiment + tips.
4. **Feedback** — thumbs up/down + free-text comment POSTs to
   `/api/feedback` for future model fine-tuning.
5. **NEW pill** — after each Scrape All, the extension POSTs the
   scraped messages to `/api/messages` and reads back
   `newSinceLastScrape[]` to mark new messages with a "New" pill in the
   message list.

The LangGraph / DigitalOcean ADK agent backend is a separate
deployment. For now `/api/agent/decide` returns 501.

---

## Configuration and Secrets

### Secrets storage
- Store all secrets in a local gitignored file such as
  `backend/.env.local` (NEVER commit it). The repo ships
  `backend/.env.example` with all the keys but no values.
- Keep secrets out of the repository and out of any committed config
  files. `backend/k8s/secret.yaml` is a template with placeholders
  only; create the real Secret imperatively with
  `kubectl create secret`.
- Use environment variables for API keys and service credentials.
- The backend reads ALL env values through one validated loader
  (`backend/src/config/env.ts`) so missing/malformed values crash the
  process at startup, not at request time.

### Required env values (backend)
| Key                  | Required | Purpose                                                    |
| -------------------- | -------- | ---------------------------------------------------------- |
| `MONGODB_URI`        | yes      | MongoDB connection string                                  |
| `GEMINI_API_KEY`     | yes      | Gemini 1.5 Pro API key                                      |
| `GEMINI_MODEL`       | no       | default `gemini-1.5-pro`                                     |
| `DO_INFERENCE_TOKEN` | no       | DO Inference token; if empty, falls back to Gemini          |
| `DO_INFERENCE_MODEL` | no       | default `gpt-oss-20b`                                       |
| `DO_INFERENCE_BASE_URL` | no    | default `https://inference.digitalocean.com/v1`             |
| `PORT`               | no       | default `3000`                                              |
| `NODE_ENV`           | no       | default `development`                                       |
| `ALLOWED_ORIGINS`    | no       | comma-separated CORS origins, default `*`                   |
| `MONGODB_DB_NAME`    | no       | default `linkedin-ai`                                        |
| `RATE_LIMIT_WINDOW_MS` | no     | default `60000`                                              |
| `RATE_LIMIT_MAX`     | no       | default `120`                                                |

### DigitalOcean k8s + MongoDB + container registry
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
#    service-account connection string - rotate the password before
#    sharing the repo.
```

### Full deploy flow (Phase 2)
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
#   {"success":true,"status":"ok","env":"production","ai":{"gemini":"gemini-1.5-pro","doInference":"..."}}
```

### Rollout / update
```bash
# After rebuilding + pushing a new image:
kubectl --context do-fra1-linkedin-ai rollout restart deployment/linkedin-ai-backend
kubectl --context do-fra1-linkedin-ai rollout status deployment/linkedin-ai-backend
```

### Service-account credentials (NOT for the repo)
The DigitalOcean managed MongoDB service-account is operator-side
material. It MUST stay out of the repository — fill it into
`backend/.env.local` and into the k8s `Secret` from your password
manager / DO control panel. See `backend/k8s/README.md` for the
`kubectl create secret` snippet.
