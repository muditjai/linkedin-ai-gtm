# Multi-stage Dockerfile for the LinkedIn AI GTM service backend.
# Build:
#   docker build -t linkedin-ai-backend:latest backend/
#   docker run --rm -p 3000:3000 --env-file backend/.env.local linkedin-ai-backend:latest

# ---------- Stage 1: deps + build ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install ALL deps (dev + prod) so `tsc` is available for the build.
# We prune dev deps after `npm run build` to keep the runtime image small.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Copy source and build to dist/.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime

# Run as a non-root user (per AGENTS.md).
RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
USER app

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps"

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# Tini-style init isn't strictly required for node:20, but a sane PID 1
# is nice. Just exec node directly.
CMD ["node", "dist/index.js"]
