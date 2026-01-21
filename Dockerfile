# ============================================
# Stage 1: Build Haskell Filter
# ============================================
FROM haskell:9.2-slim AS haskell-builder

WORKDIR /build

# Install system dependencies for Haskell build
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libgmp-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Update Cabal and install pandoc-unicode-math
RUN cabal update && \
    cabal install pandoc-unicode-math --install-method=copy --installdir=/build/bin

# Verify binary exists
RUN ls -lh /build/bin/pandoc-unicode-math

# ============================================
# Stage 2: Build React Frontend
# ============================================
FROM node:20-slim AS frontend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies for build)
RUN npm install

# Copy source code
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY lib/ ./lib/
COPY components/ ./components/
COPY services/ ./services/
COPY filters/ ./filters/
COPY public/ ./public/
COPY assets/ ./assets/

# Build the frontend
RUN npm run build

# Verify build output
RUN ls -lh /app/dist

# ============================================
# Stage 3: Final Production Image
# ============================================
FROM pandoc/core:latest-ubuntu

WORKDIR /app

# Install Node.js + LibreOffice + Fonts
RUN apt-get update && apt-get install -y \
    curl \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-java-common \
    fonts-liberation \
    fontconfig \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy Haskell binary from Stage 1
COPY --from=haskell-builder /build/bin/pandoc-unicode-math /usr/local/bin/
RUN chmod +x /usr/local/bin/pandoc-unicode-math

# Copy built frontend from Stage 2
COPY --from=frontend-builder /app/dist ./dist

# Copy backend code and configs
COPY package*.json ./
COPY server.js ./
COPY lib/ ./lib/
COPY filters/ ./filters/
COPY assets/ ./assets/

# Install ONLY production dependencies
RUN npm ci --only=production && npm cache clean --force

# Install custom BearSansUI fonts to system
COPY assets/fonts /usr/share/fonts/truetype/bearsansui
RUN fc-cache -f -v

# Create necessary directories with proper permissions
RUN mkdir -p /tmp/uploads /tmp/outputs assets/emoji && \
    chmod 777 /tmp/uploads /tmp/outputs assets/emoji

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=400"
ENV HOME=/tmp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
