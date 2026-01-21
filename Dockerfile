# ============================================
# Stage 1: Build React Frontend
# ============================================
FROM node:20-slim AS frontend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build frontend
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npm run build

# ============================================
# Stage 2: Production Runtime
# ============================================
FROM pandoc/core:3.1-ubuntu

WORKDIR /app

# Install Node.js + LibreOffice + Font dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    gnupg \
    # LibreOffice for PDF conversion
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-java-common \
    # Font rendering libraries
    fontconfig \
    fonts-liberation \
    fonts-noto \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/dist ./dist

# Copy backend and conversion assets
COPY package*.json server.js ./
COPY lib/ ./lib/
COPY services/ ./services/

# ⚠️ CRITICAL: Copy Lua filter (NOT compile it)
COPY filters/ ./filters/

# ⚠️ CRITICAL: Copy reference template
COPY assets/reference.docx ./assets/reference.docx

# Install custom fonts to system
COPY assets/fonts/*.ttf /usr/share/fonts/truetype/custom/
COPY assets/fonts/*.otf /usr/share/fonts/opentype/custom/
RUN fc-cache -fv

# Install production dependencies
RUN npm install --only=production && npm cache clean --force

# Create working directories
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

CMD ["node", "server.js"]
