#!/bin/bash
set -e

eval "$(mise activate bash)"
mise install

# TypeScript (Biome lint/format + tsc type check + tests)
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
pnpm run test

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
