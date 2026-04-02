#!/bin/bash
set -e

eval "$(mise activate bash)"
mise install

# Server (Python)
cd server
uv sync
if [[ -n "$CI" ]]; then
  ruff check
  ruff format --check
else
  ruff check --fix
  ruff format
fi
ty check
cd ..

# Client (TypeScript)
cd client
pnpm install --frozen-lockfile
pnpm exec biome migrate --write
if [[ -n "$CI" ]]; then
  git diff --exit-code biome.json
  pnpm run lint
else
  pnpm run lint --fix
  pnpm run format
fi
pnpm run typecheck
cd ..

# Dockerfile
hadolint Dockerfile

# GitHub Actions
actionlint
ghalint run
if [[ -n "$CI" ]]; then
  zizmor .github/workflows/
  pinact run --check
else
  zizmor --fix .github/workflows/
  pinact run
fi
