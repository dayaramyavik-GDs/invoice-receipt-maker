# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Development image: all deps + auto-restart on file changes
FROM base AS dev
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["node", "--watch", "src/server.js"]

# Small, non-root production image
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "src/server.js"]
