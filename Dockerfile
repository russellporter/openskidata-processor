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
    libsqlite3-mod-spatialite \
    sqlite3 \
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

# Install dependencies on startup and keep container running
CMD ["sh", "-c", "npm install && exec sleep infinity"]

# Production stage
FROM base AS production

# Copy package files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Build the application
RUN npm run build

# Create data directory
RUN mkdir -p data

# Default command for production
CMD ["./run.sh"]