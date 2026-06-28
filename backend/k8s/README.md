# LinkedIn AI GTM service backend - k8s deployment

This directory contains the Kubernetes manifests for deploying the
`backend/` service to the DigitalOcean cluster mentioned in `AGENTS.md`.

## Cluster setup (one-time per workstation)

```bash
# 1. Save the cluster's kubeconfig to your local kubectl.
doctl kubernetes cluster kubeconfig save f3f8ebb0-4388-4a6f-9e36-3f3e60211c6b

# 2. Verify.
kubectl cluster-info
# Expected: Kubernetes control plane is running at
#   https://f3f8ebb0-4388-4a6f-9e36-3f3e60211c6b.k8s.ondigitalocean.com
```

## Build & push the image

```bash
# One-time per DO account: create the registry (idempotent).
doctl registry create hackathon-registry

# Build the image from the repo root.
docker build -t registry.digitalocean.com/hackathon-registry/linkedin-ai-backend:latest backend/

# Log in (one-time per workstation).
doctl registry login

# Push.
docker push registry.digitalocean.com/hackathon-registry/linkedin-ai-backend:latest
```

## Configure secrets (one-time per cluster)

The `secret.yaml` here is a template. Replace the placeholders with
real values from your environment and apply it:

```bash
# Option A: imperatively create (preferred, so values are not stored
# in a yaml file).
kubectl create secret generic linkedin-ai-secrets \
  --from-literal=mongodb-uri='mongodb+srv://USER:PASS@HOST/linkedin-ai' \
  --from-literal=gemini-api-key='AIza...' \
  --from-literal=do-inference-token='dop_v1_...'

# Option B: edit + apply.
cp backend/k8s/secret.yaml secret.local.yaml
# Edit secret.local.yaml to put real values in.
kubectl apply -f secret.local.yaml
rm secret.local.yaml
```

## Deploy

```bash
kubectl apply -f backend/k8s/deployment.yaml
kubectl apply -f backend/k8s/secret.yaml
```

## Verify

```bash
# Pods
kubectl get pods -l app=linkedin-ai-backend

# Logs
kubectl logs -l app=linkedin-ai-backend --tail=50

# Port-forward to test the API locally
kubectl port-forward svc/linkedin-ai-backend 3000:3000

# In another terminal
curl http://localhost:3000/health
# Expected:
#   {"success":true,"status":"ok","env":"production","ai":{"gemini":"gemini-1.5-pro","doInference":"..."}}
```

## Updating

```bash
# After a new image is built + pushed:
kubectl rollout restart deployment/linkedin-ai-backend
kubectl rollout status deployment/linkedin-ai-backend
```

## API contract (v1)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET    | `/health`                                 | -                                                                                  | `{ success, status, env, ai }` |
| POST   | `/api/messages`                           | `{ threadUrn, conversationName, messages: [...] }`                                | `{ success, summary, counts }` (incl. `newSinceLastScrape[]`) |
| GET    | `/api/messages?threadUrn=...`             | -                                                                                  | `{ success, threadUrn, count, messages[] }` |
| GET    | `/api/threads?limit=15`                   | -                                                                                  | `{ success, count, threads[] }` |
| GET    | `/api/threads/:urn`                       | -                                                                                  | `{ success, thread }` |
| POST   | `/api/draft`                              | `{ threadUrn, profile?, lastMessageUrn?, messages[] }`                            | `{ success, draft, model }` |
| POST   | `/api/feedback`                           | `{ threadUrn, messageUrn?, draft?, score(1-5), comment?, sentiment?, model? }`     | `{ success, feedback }` |
| GET    | `/api/feedback?threadUrn=...`             | -                                                                                  | `{ success, count, feedback[] }` |
| POST   | `/api/agent/decide` (STUB - 501)           | -                                                                                  | `{ success: false, code: 'AGENT_NOT_IMPLEMENTED' }` |
| GET    | `/api/agent/status`                       | -                                                                                  | `{ success, status }` |

## Notes

- `DO_INFERENCE_TOKEN` is optional. If empty, the service falls back to
  Gemini for message generation. Useful while you wait for the DO
  Inference workspace to be provisioned.
- The `linkedin-ai-secrets` Secret is referenced by `deployment.yaml`.
  The deployment's `imagePullPolicy: Always` ensures a fresh image on
  every rollout.
- For a real production deploy, swap the Service type from
  `ClusterIP` to `LoadBalancer` and add an `ingress` with TLS.
