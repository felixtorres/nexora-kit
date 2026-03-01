# NexoraKit — Multi-stage Dockerfile
# Build: docker build -t nexora-kit .
# Run:   docker run -p 3000:3000 -v ./instance:/app/instance nexora-kit

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files first for better layer caching
COPY package.json package-lock.json turbo.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/llm/package.json packages/llm/
COPY packages/config/package.json packages/config/
COPY packages/sandbox/package.json packages/sandbox/
COPY packages/storage/package.json packages/storage/
COPY packages/plugins/package.json packages/plugins/
COPY packages/skills/package.json packages/skills/
COPY packages/commands/package.json packages/commands/
COPY packages/mcp/package.json packages/mcp/
COPY packages/tool-registry/package.json packages/tool-registry/
COPY packages/admin/package.json packages/admin/
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/testing/package.json packages/testing/

# Install dependencies
RUN npm ci --ignore-scripts

# Copy source
COPY packages/ packages/

# Build all packages
RUN npx turbo build

# --- Stage 2: Runtime ---
FROM node:20-alpine AS runtime

RUN apk add --no-cache tini

WORKDIR /app

# Copy built packages and node_modules
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages ./packages
COPY --from=builder /build/package.json ./

# Create instance directory
RUN mkdir -p /app/instance/plugins /app/instance/data

# Default config
COPY <<'EOF' /app/instance/nexora.yaml
name: nexora-kit
port: 3000
host: 0.0.0.0

auth:
  type: api-key
  keys:
    - key: ${NEXORA_API_KEY:-change-me-in-production}
      userId: admin
      teamId: default
      role: admin

storage:
  path: ./data/nexora.db

plugins:
  directory: ./plugins
EOF

EXPOSE 3000

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Start the server
CMD ["node", "packages/cli/dist/bin.js", "serve", "--config", "/app/instance/nexora.yaml"]
