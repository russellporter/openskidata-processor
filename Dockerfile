# Multi-stage build for OpenSkiData Processor

# Build Tippecanoe first (most expensive, least likely to change)
FROM debian:bookworm-slim AS tippecanoe-builder
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    pkg-config \
    zlib1g-dev \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Use specific commit for better caching
ENV TIPPECANOE_VERSION=2.78.0
RUN if [ ! -d "/tmp/tippecanoe" ]; then \
        git clone --branch ${TIPPECANOE_VERSION} --single-branch --depth 1 \
        https://github.com/felt/tippecanoe.git /tmp/tippecanoe; \
    fi

WORKDIR /tmp/tippecanoe
RUN make -j$(nproc) && make install

# Base stage with common dependencies
FROM node:22-bookworm AS base

# Copy Tippecanoe binaries
COPY --from=tippecanoe-builder /usr/local/bin/tippecanoe /usr/local/bin/tippecanoe
COPY --from=tippecanoe-builder /usr/local/bin/tile-join /usr/local/bin/tile-join

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libsqlite3-dev \
    sqlite3 \
    postgresql-15 \
    postgresql-15-postgis-3 \
    postgresql-client-15 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Development stage
FROM base AS development

# Install build dependencies for native modules and create data directory
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p data

# Copy PostgreSQL initialization script (done early as it rarely changes)
COPY scripts/init-postgres.sh /usr/local/bin/init-postgres.sh
RUN chmod +x /usr/local/bin/init-postgres.sh

# Install dependencies on startup and initialize PostgreSQL as main process
CMD ["sh", "-c", "npm install && exec /usr/local/bin/init-postgres.sh"]

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
RUN npm --production=false  ci

# Copy application source and build (only invalidated when source changes)
COPY . .
RUN npm run build

# Clean up dev dependencies after build
RUN npm prune --omit=dev

# Initialize PostgreSQL as main process
CMD ["sh", "-c", "exec /usr/local/bin/init-postgres.sh"]