# ─────────────────────────────────────────────────────────────────────────────
# Prabala Studio — Docker image
# Multi-stage: build all packages + React SPA, then run with slim Node image
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# Install Playwright OS dependencies needed to build (not run) the driver-web types
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json* ./
COPY packages/core/package.json          ./packages/core/
COPY packages/cli/package.json           ./packages/cli/
COPY packages/reporting/package.json     ./packages/reporting/
COPY packages/driver-api/package.json    ./packages/driver-api/
COPY packages/driver-web/package.json    ./packages/driver-web/
COPY packages/driver-desktop/package.json ./packages/driver-desktop/
COPY packages/driver-sap/package.json    ./packages/driver-sap/
COPY packages/object-repository/package.json ./packages/object-repository/
COPY packages/studio-server/package.json ./packages/studio-server/
COPY studio/package.json                 ./studio/

# Install all dependencies (workspaces)
RUN npm install --legacy-peer-deps

# Copy all source
COPY . .

# Build packages in dependency order
RUN npm run build -w packages/core
RUN npm run build -w packages/reporting
RUN npm run build -w packages/driver-api
RUN npm run build -w packages/object-repository
RUN npm run build -w packages/cli || true
RUN npm run build -w packages/driver-web || true
RUN npm run build -w packages/studio-server

# Build React web app (no Electron target)
RUN npm run build:web -w studio

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright Chromium runtime deps
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 \
    libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 wget xdg-utils \
    # Virtual display so recorder can open a headful browser window
    xvfb x11-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/core/dist          ./packages/core/dist
COPY --from=builder /app/packages/core/package.json  ./packages/core/package.json
COPY --from=builder /app/packages/reporting/dist         ./packages/reporting/dist
COPY --from=builder /app/packages/reporting/package.json ./packages/reporting/package.json
COPY --from=builder /app/packages/driver-api/dist         ./packages/driver-api/dist
COPY --from=builder /app/packages/driver-api/package.json ./packages/driver-api/package.json
COPY --from=builder /app/packages/driver-web/dist         ./packages/driver-web/dist
COPY --from=builder /app/packages/driver-web/package.json ./packages/driver-web/package.json
COPY --from=builder /app/packages/object-repository/dist         ./packages/object-repository/dist
COPY --from=builder /app/packages/object-repository/package.json ./packages/object-repository/package.json
COPY --from=builder /app/packages/studio-server/dist         ./packages/studio-server/dist
COPY --from=builder /app/packages/studio-server/package.json ./packages/studio-server/package.json
COPY --from=builder /app/packages/cli/dist         ./packages/cli/dist
COPY --from=builder /app/packages/cli/package.json ./packages/cli/package.json
# React SPA served by studio-server
COPY --from=builder /app/studio/dist ./studio/dist
# Recorder/spy scripts used by the server at runtime
COPY --from=builder /app/studio/electron ./studio/electron

# Install only production deps in the runtime image
RUN npm install --omit=dev --legacy-peer-deps

# Install Playwright Chromium to a shared path accessible by all users
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium && chmod -R 755 /ms-playwright

# Startup script: launch Xvfb virtual display then start server
RUN printf '#!/bin/sh\nXvfb :99 -screen 0 1280x1024x24 -ac +extension GLX &\nsleep 1\nexec node packages/studio-server/dist/index.js\n' > /app/start.sh && chmod +x /app/start.sh

# Non-root user for security
RUN useradd -m prabala

# Dedicated writable directory for user workspaces (prabala cannot write to /app which is owned by root)
RUN mkdir -p /workspaces && chown prabala:prabala /workspaces

USER prabala

ENV PORT=3000
ENV NODE_ENV=production
ENV DISPLAY=:99
# Force headless Chromium in Docker — the Studio UI streams live screenshots
# and accepts pointer/keyboard commands via WebSocket instead.
ENV PRABALA_HEADLESS=1

EXPOSE 3000

CMD ["/app/start.sh"]
