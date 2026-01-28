# Multi-stage build for OpenSkiData Processor

# Build Tippecanoe first (most expensive, least likely to change)
FROM debian:trixie-slim AS tippecanoe-builder

# Use specific commit for better caching
ENV TIPPECANOE_VERSION=2.78.0

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    build-essential \
    git \
    pkg-config \
    zlib1g-dev \
    libsqlite3-dev

RUN git clone --branch ${TIPPECANOE_VERSION} --single-branch --depth 1 \
    https://github.com/felt/tippecanoe.git /tmp/tippecanoe

WORKDIR /tmp/tippecanoe
RUN make -j$(nproc) && make install

# Base stage with common dependencies
FROM node:22-trixie AS base

# Copy Tippecanoe binaries
COPY --from=tippecanoe-builder /usr/local/bin/tippecanoe /usr/local/bin/tippecanoe
COPY --from=tippecanoe-builder /usr/local/bin/tile-join /usr/local/bin/tile-join

# Install system dependencies
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    libsqlite3-dev \
    sqlite3 \
    postgresql-17 \
    postgresql-17-postgis-3 \
    postgresql-client-17

# Set working directory
WORKDIR /app

# Development stage
FROM base AS development

# Install build dependencies for native modules and create data directory
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && mkdir -p data

# Copy PostgreSQL initialization script (done early as it rarely changes)
COPY scripts/init-postgres.sh /usr/local/bin/init-postgres.sh
RUN chmod +x /usr/local/bin/init-postgres.sh

# Install dependencies on startup and run both TypeScript watch mode and PostgreSQL
CMD ["sh", "-c", "npm install && npm run dev:all"]

# Production stage
FROM base AS production

# Set production environment
ENV NODE_ENV=production

# Create data directory and copy scripts first (rarely change)
RUN mkdir -p data
COPY scripts/init-postgres.sh /usr/local/bin/init-postgres.sh
RUN chmod +x /usr/local/bin/init-postgres.sh

# Copy package files and install dependencies (cache when package.json unchanged)
COPY package.json package-lock.json ./
# Install dev dependencies as well in order to build the application
RUN --mount=type=cache,target=/root/.npm \
    npm --production=false ci

# Copy application source and build (only invalidated when source changes)
COPY . .
RUN npm run build

# Clean up dev dependencies after build
RUN npm prune --omit=dev

# Initialize PostgreSQL as main process
CMD ["sh", "-c", "exec /usr/local/bin/init-postgres.sh"]
