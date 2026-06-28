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

# Service (incl. EXTERNAL-IP from the DO LoadBalancer)
kubectl get svc linkedin-ai-backend

# Port-forward to test the API locally
kubectl port-forward svc/linkedin-ai-backend 3000:3000

# In another terminal
curl http://localhost:3000/health
# Expected:
#   {"success":true,"status":"ok","env":"production","ai":{"gemini":"gemini-3.1-pro","doInference":"..."}}
```

## Public URL (production)

The Service is exposed via a DigitalOcean `LoadBalancer`. Once the LB
finishes provisioning, `kubectl get svc linkedin-ai-backend` shows an
`EXTERNAL-IP` that the Chrome extension (and any external client) should
hit:

```bash
kubectl get svc linkedin-ai-backend -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
# -> 138.197.236.196  (production, env=production, db=linkedin-ai)

curl http://138.197.236.196/health
# Same response shape as the local /health above.
```

The Chrome extension's `extension/src/modules/api.ts` defaults to this URL
and `extension/manifest.json` lists it in `host_permissions`. Override
per-user via `chrome.storage.local.BACKEND_URL` for dev / staging.

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
- The Service is already `type: LoadBalancer` for the sfo2 sandbox
  cluster, with port 80 -> pod 3000. To put it behind a TLS-terminating
  ingress (recommended for prod), keep this manifest for the service
  and add an `nginx-ingress` + `cert-manager` `Ingress` resource that
  points at this Service on port 80. Replace the default URL in the
  extension with the resulting HTTPS host.
- The k8s pod's outbound IP (Atlas egress) is whatever the cluster's
  NAT gateway is. To allow the pod to reach the Atlas cluster, add
  that IP to the Atlas project's IP access list (Network Access UI, or
  via the Admin API).
