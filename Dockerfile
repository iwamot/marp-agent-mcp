# Marp Agent MCP Server
# Multi-stage build: App build -> Marp CLI -> Final image
# Uses ECR Public Gallery to avoid Docker Hub rate limits

# ============================================
# Stage 1: App build (client + server)
# ============================================
FROM public.ecr.aws/docker/library/node:24.14.1-trixie-slim@sha256:c319bb4fac67c01ced508b67193a0397e02d37555d8f9b72958649efd302b7f8 AS app-builder

WORKDIR /app

# Install pnpm and bun
RUN corepack enable && corepack use pnpm && npm install -g bun@1.2.19

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source code
COPY src/ ./src/
COPY themes/ ./themes/
COPY constants.ts server.ts main.ts mcp-app.html tsconfig.json tsconfig.server.json vite.config.ts ./

# Build client and server
RUN pnpm run build

# ============================================
# Stage 2: Marp CLI build
# ============================================
FROM public.ecr.aws/docker/library/node:24.14.1-trixie-slim@sha256:c319bb4fac67c01ced508b67193a0397e02d37555d8f9b72958649efd302b7f8 AS marp-builder

COPY .npmrc /root/.npmrc
RUN npm install -g @marp-team/marp-cli@4.3.1

# ============================================
# Stage 3: Final image
# ============================================
FROM public.ecr.aws/docker/library/node:24.14.1-trixie-slim@sha256:c319bb4fac67c01ced508b67193a0397e02d37555d8f9b72958649efd302b7f8

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install Chromium, Japanese fonts, LibreOffice Impress, and zip
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    libreoffice-impress \
    zip \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Copy Marp CLI from Stage 2
COPY --from=marp-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/@marp-team/marp-cli/marp-cli.js /usr/local/bin/marp

# Configure Puppeteer to use system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy built files from Stage 1
COPY --from=app-builder /app/dist ./dist

# Copy theme CSS files
COPY themes/ ./themes/

# Copy SKILL.md and create zip
COPY skills/marp-agent-mcp/SKILL.md ./SKILL.md
RUN zip -q skill.zip SKILL.md

# Expose default port
EXPOSE 3001

# Start MCP server
CMD ["node", "dist/index.js"]
