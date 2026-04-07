#!/bin/bash
set -e

# mise
eval "$(mise activate bash)"
mise install

# TypeScript
pnpm install --frozen-lockfile
pnpm audit --fix --ignore-unfixable
pnpm exec biome migrate --write
pnpm run check:write
pnpm run typecheck
pnpm run test

# Dockerfile
hadolint Dockerfile

# GitHub Actions
pinact run
zizmor --fix .github/workflows/
actionlint
ghalint run

# Check for uncommitted changes
git diff --exit-code -- . ':!.npmrc'
