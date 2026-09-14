#!/bin/bash
set -e

# mise
eval "$(mise activate bash)"
mise fmt
mise install

# TypeScript
aube install --frozen-lockfile
# Licenses that may ship alongside MIT code: permissive ones, plus MPL-2.0,
# whose terms stay with its own files. Matching is exact, so a license string
# not listed here, including a new SPDX expression, fails for a human to read.
aube licenses --json --long | node -e '
  const { existsSync } = require("node:fs");
  let raw = "";
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    const allowed = new Set([
      // SPDX identifiers
      "0BSD",
      "Apache-2.0",
      "BlueOak-1.0.0",
      "BSD-2-Clause",
      "BSD-3-Clause",
      "CC0-1.0",
      "CNRI-Python",
      "ISC",
      "MIT",
      "MIT-0",
      "MIT-CMU",
      "MPL-2.0",
      "PSF-2.0",
      "Python-2.0",
      "Zlib",
      // SPDX expressions and free-form license fields
      "(AFL-2.1 OR BSD-3-Clause)",
      "(BSD-2-Clause OR MIT OR Apache-2.0)",
      "MIT OR Apache",
    ]);
    // Optional dependencies for other platforms are listed but not installed,
    // so aube has no package.json to read their license from.
    const rejected = JSON.parse(raw).filter(
      (pkg) => !allowed.has(pkg.license) && existsSync(pkg.path),
    );
    for (const pkg of rejected) {
      console.error(pkg.name + "@" + pkg.version + ": " + pkg.license);
    }
    if (rejected.length > 0) {
      process.exit(1);
    }
  });
'
aube audit --fix update --ignore-unfixable
aube run prune
aube run check:write
aube run typecheck
aube run test

# Shared lint tasks
mise run gha-lint
mise run shell-lint
mise run docker-lint

# Check for uncommitted changes
git diff --exit-code
