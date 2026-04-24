#!/bin/bash
set -e

# mise
eval "$(mise activate bash)"
mise fmt
mise install

# TypeScript
aube install --frozen-lockfile
aube licenses
aube audit --fix --ignore-unfixable
aube exec biome migrate --write
aube run check:write
aube run typecheck
aube run test

# Shared lint tasks
mise run gha-lint
mise run docker-lint

# Check for uncommitted changes
git diff --exit-code
