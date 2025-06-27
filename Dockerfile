# Multi-stage build for OpenSkiData Processor

# Build Tippecanoe first (most expensive, least likely to change)
FROM node:22-bookworm AS tippecanoe-builder
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    pkg-config \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --branch 2.78.0 --single-branch https://github.com/felt/tippecanoe.git /tmp/tippecanoe
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

# Install build dependencies for native modules
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Create data directory
RUN mkdir -p data

# Copy PostgreSQL initialization script
COPY scripts/init-postgres.sh /usr/local/bin/init-postgres.sh
RUN chmod +x /usr/local/bin/init-postgres.sh

# Install dependencies on startup and initialize PostgreSQL as main process
CMD ["sh", "-c", "npm install && exec /usr/local/bin/init-postgres.sh"]

# Production stage
FROM base AS production

# Set production environment
ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy application source
COPY . .

# Build the application
RUN npm run build

# Clean up dev dependencies after build
RUN npm prune --omit=dev

# Create data directory
RUN mkdir -p data

# Copy PostgreSQL initialization script
COPY scripts/init-postgres.sh /usr/local/bin/init-postgres.sh
RUN chmod +x /usr/local/bin/init-postgres.sh

# Initialize PostgreSQL as main process
CMD ["sh", "-c", "exec /usr/local/bin/init-postgres.sh"]