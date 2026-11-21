# INDIAN BATTLE FIELDS - backend image
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Install production dependencies only (cached layer).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Run as the unprivileged "node" user.
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-5000}/api/health" > /dev/null || exit 1

CMD ["node", "server.js"]
