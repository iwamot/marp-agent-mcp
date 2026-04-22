# Marp Agent MCP Server
# Multi-stage build: App build -> Marp CLI -> Skill zip -> Final image
# Uses ECR Public Gallery to avoid Docker Hub rate limits

# ============================================
# Stage 1: App build (client + server)
# ============================================
FROM public.ecr.aws/docker/library/node:24.15.0-trixie-slim@sha256:e912bcfe2f7e129a76d8a6f6df8ab466ce5cd1de59835bc1eeead306611217ad AS app-builder

WORKDIR /app

# Install pnpm and bun
# renovate: datasource=npm depName=bun
ARG BUN_VERSION=1.3.13
RUN corepack enable && corepack use pnpm && npm install -g bun@${BUN_VERSION}

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy source code
COPY src/ ./src/
COPY themes/ ./themes/
COPY constants.ts server.ts main.ts mcp-app.html tsconfig.json tsconfig.server.json vite.config.ts ./

# Build client and server
RUN pnpm run build

# ============================================
# Stage 2: Marp CLI build
# ============================================
FROM public.ecr.aws/docker/library/node:24.15.0-trixie-slim@sha256:e912bcfe2f7e129a76d8a6f6df8ab466ce5cd1de59835bc1eeead306611217ad AS marp-builder

# renovate: datasource=npm depName=@marp-team/marp-cli
ARG MARP_CLI_VERSION=4.3.1
RUN npm install -g @marp-team/marp-cli@${MARP_CLI_VERSION}

# ============================================
# Stage 3: Skill zip build
# ============================================
FROM public.ecr.aws/docker/library/node:24.15.0-trixie-slim@sha256:e912bcfe2f7e129a76d8a6f6df8ab466ce5cd1de59835bc1eeead306611217ad AS skill-builder

RUN apt-get update && apt-get install -y --no-install-recommends zip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /skill
COPY skills/marp-agent-mcp/SKILL.md ./SKILL.md
RUN zip -q skill.zip SKILL.md

# ============================================
# Stage 4: Final image
# ============================================
FROM public.ecr.aws/docker/library/node:24.15.0-trixie-slim@sha256:e912bcfe2f7e129a76d8a6f6df8ab466ce5cd1de59835bc1eeead306611217ad

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install Chromium, Japanese fonts, and LibreOffice Impress
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    libreoffice-impress \
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

# Copy skill zip from Stage 3
COPY --from=skill-builder /skill/skill.zip ./skill.zip

# Expose default port
EXPOSE 3001

# Start MCP server
CMD ["node", "dist/index.js"]
