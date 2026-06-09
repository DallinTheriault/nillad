# syntax=docker/dockerfile:1
# Nillad dashboard — Next.js 15 + better-sqlite3, containerized to match the
# rest of the stack (OWUI / n8n). Runs as root and mounts the shared vault so
# it reads/writes the same /vault/nillad.db that n8n uses.

# --- deps: install node_modules (build tools present in case better-sqlite3
#     has no prebuilt binary for this platform) ---
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: produce the Next production build ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- runner: minimal runtime image ---
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.mjs ./next.config.mjs
EXPOSE 3100
# package.json start = "next start -p 3100"
CMD ["npm", "run", "start"]
