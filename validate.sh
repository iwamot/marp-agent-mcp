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
npm ci
if [[ -n "$CI" ]]; then
  npm run lint
else
  npm run lint -- --fix
  npm run format
fi
npm run typecheck
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
