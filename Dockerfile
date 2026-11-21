# INDIAN BATTLE FIELDS - game server + 3D client in one image.
# Build from the repository root (Render: Root Directory empty,
# Dockerfile Path ./Dockerfile). The server serves the game from
# ../frontend at /play/3d.html.
FROM node:22-alpine

WORKDIR /app/backend
ENV NODE_ENV=production

# Production dependencies first (cached layer).
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY frontend/ /app/frontend/

# Run as the unprivileged "node" user.
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-5000}/api/health" > /dev/null || exit 1

CMD ["node", "server.js"]
