#!/bin/bash
set -e

eval "$(mise activate bash)"
mise install

# Server (Python)
cd server
uv sync
ruff check --fix
ruff format
ty check
cd ..

# Client (TypeScript)
cd client
npm ci
npm run lint -- --fix
npm run format
npm run typecheck
