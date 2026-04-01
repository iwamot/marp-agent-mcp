# Marp Agent MCP Server
# マルチステージビルド: クライアントUI → Marp CLI → Python依存関係 → サーバー
# ECR Public Galleryを使用（Docker Hubのレート制限を回避）

# ============================================
# Stage 1: クライアントUIビルド
# ============================================
FROM public.ecr.aws/docker/library/node:24.14.1-trixie-slim AS client-builder

WORKDIR /client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
# テーマCSSをコピー（Viteビルド前に必要）
COPY themes/ ./src/themes/
RUN npm run build

# ============================================
# Stage 2: Marp CLIビルド
# ============================================
FROM public.ecr.aws/docker/library/node:24.14.1-trixie-slim AS marp-builder

RUN npm install -g @marp-team/marp-cli@4.3.1

# ============================================
# Stage 3: Python依存関係ビルド
# ============================================
FROM public.ecr.aws/docker/library/python:3.14.3-slim-trixie@sha256:fb83750094b46fd6b8adaa80f66e2302ecbe45d513f6cece637a841e1025b4ca AS python-builder

WORKDIR /app

# uvをコピー
COPY --from=ghcr.io/astral-sh/uv:0.10.12 /uv /usr/local/bin/uv

# Python依存関係をインストール
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --no-dev

# ============================================
# Stage 4: サーバー（最終イメージ）
# ============================================
FROM public.ecr.aws/docker/library/python:3.14.3-slim-trixie@sha256:fb83750094b46fd6b8adaa80f66e2302ecbe45d513f6cece637a841e1025b4ca

# Pythonの出力をバッファリングしない（ログ即時出力）
ENV PYTHONUNBUFFERED=1
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Chromium、日本語フォント、LibreOffice Impressをインストール
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    libreoffice-impress \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -fv

# Node.js と Marp CLI をコピー（Stage 2から）
COPY --from=marp-builder /usr/local/bin/node /usr/local/bin/
COPY --from=marp-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/@marp-team/marp-cli/marp-cli.js /usr/local/bin/marp

# Puppeteer の Chromium パス設定
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Python依存関係をコピー（Stage 3から）
COPY --from=python-builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# サーバーコードをコピー
COPY server/ ./
# テーマCSSをコピー
COPY themes/ ./themes/

# ビルド済みUIをコピー（Stage 1から）
COPY --from=client-builder /client/dist/ ./ui/

# SKILL.mdをコピーし、zipも作成
COPY skills/marp-agent-mcp/SKILL.md ./SKILL.md
RUN python -m zipfile -c skill.zip SKILL.md

# ポート8000を公開
EXPOSE 8000

# MCP サーバーを起動
CMD ["python", "main.py"]
