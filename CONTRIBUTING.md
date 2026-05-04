# Contributing

We welcome contributions! Please follow these guidelines when submitting pull requests.

## Recommended setup

After cloning, enable the git hooks:

```bash
mise run enable-git-hooks
```

This wires `./validate.sh` to `pre-commit` and a DCO check to `commit-msg`, so the two requirements below run automatically on each commit.

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
