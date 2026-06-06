# syntax=docker/dockerfile:1

# ── Builder: install everything and build the client bundle ───────────────────
FROM node:20-slim AS builder
WORKDIR /app

# Install all deps (incl. devDeps like vite) using the lockfile for reproducibility
COPY package.json package-lock.json ./
RUN npm ci

# Build the Vite client → /app/dist
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# ── Runtime: only runtime deps + server + built client ────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Runtime deps only (express, ws, nanoid). Client deps are already bundled in dist/.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server code + the built client it serves
COPY server ./server
COPY --from=builder /app/dist ./dist

EXPOSE 3001
CMD ["node", "server/index.js"]
