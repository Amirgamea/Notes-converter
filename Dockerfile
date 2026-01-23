# ============================================
# Stage 1: Build React Frontend
# ============================================
FROM node:20-slim AS frontend-builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# ============================================
# Stage 2: Production Runtime
# ============================================
FROM pandoc/core:latest-ubuntu

WORKDIR /app

ARG DEBIAN_FRONTEND=noninteractive

# Install Node.js + LibreOffice + Fonts
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-java-common \
    fontconfig \
    fonts-liberation \
    fonts-noto \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy built frontend
COPY --from=frontend-builder /app/dist ./dist

# Copy backend
COPY package*.json server.js ./
COPY lib/ ./lib/
COPY services/ ./services/
COPY filters/ ./filters/
COPY assets/reference.docx ./assets/reference.docx

# Install custom fonts to system (no shell operators!)
RUN mkdir -p /usr/share/fonts/truetype/custom /usr/share/fonts/opentype/custom
COPY assets/fonts/ /usr/local/share/fonts/custom/
RUN fc-cache -fv

# Install production dependencies
RUN npm install --only=production && npm cache clean --force

# Create directories
RUN mkdir -p /tmp/uploads /tmp/outputs assets/emoji && \
    chmod 777 /tmp/uploads /tmp/outputs assets/emoji

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV HOME=/tmp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

EXPOSE 3000

# Override Pandoc's entrypoint
ENTRYPOINT []

CMD ["node", "server.js"]
