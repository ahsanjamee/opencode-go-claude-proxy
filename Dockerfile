# ─────────────────────────────────────────────────────────────────
# Stage 1 – Build
# ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer-cached)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─────────────────────────────────────────────────────────────────
# Stage 2 – Runtime (minimal image)
# ─────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# Only install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy built output
COPY --from=builder /app/dist ./dist

# Copy example config (users mount their own config.json at runtime)
COPY config/ ./config/

# Expose default port
EXPOSE 3456

# Non-root user for security
RUN addgroup -S proxy && adduser -S proxy -G proxy
USER proxy

# Health-check: hit /health every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3456/health || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD []
