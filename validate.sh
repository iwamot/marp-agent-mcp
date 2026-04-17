#!/bin/bash
set -e

# mise
eval "$(mise activate bash)"
mise fmt
mise install

# TypeScript
pnpm install --frozen-lockfile
pnpm licenses ls
pnpm audit --fix update --ignore-unfixable
pnpm exec biome migrate --write
pnpm run check:write
pnpm run typecheck
pnpm run test

# Shared lint tasks
mise run gha-lint
mise run docker-lint

# Check for uncommitted changes
git diff --exit-code
