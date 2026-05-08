# Contributing

We welcome contributions! Please follow these guidelines when submitting pull requests.

## Recommended setup

After cloning, enable the git hooks:

```bash
mise run enable-git-hooks
```

This wires `./validate.sh` to `pre-commit`, plus DCO and Conventional Commits checks to `commit-msg`, so the requirements below run automatically on each commit.

## Before Submitting a PR

### 1. Run Validation

```bash
./validate.sh
```

Runs the project's validation pipeline.

### 2. Sign Commits with DCO

All commits must be signed with DCO. Use `git commit -s` to sign your commits.

- Use your real name (no pseudonyms)
- All commits in a PR must be signed
- If the DCO check fails, see the check details page for instructions on fixing unsigned commits

For more about DCO: https://developercertificate.org/

### 3. Follow Conventional Commits

Commit subjects (first line) must follow `<type>(<scope>)?!?: <description>`. Allowed types: `feat`, `fix`, `chore`, `docs`. Append `!` for breaking changes.

```
feat: add dark-mode toggle
fix(auth): handle expired token
chore: bump dependencies
feat!: drop legacy API
```

Other types (`refactor`, `ci`, `test`, etc.) are intentionally rejected — use `chore:` instead.

For more about Conventional Commits: https://www.conventionalcommits.org/
