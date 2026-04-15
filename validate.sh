#!/bin/bash
set -e

# mise
eval "$(mise activate bash)"
mise fmt
mise install

# TypeScript
pnpm install --frozen-lockfile
pnpm licenses ls
pnpm audit --fix --ignore-unfixable --ignore-registry-errors
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
git diff --exit-code
