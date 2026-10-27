---
name: commit
description: Create grouped logical commits from current changes. Never `git add .` — stage by file or hunk.
---

# Commit skill

## Rules

1. `git status` + `git diff --stat` — understand ALL changes
2. Group changes into **logical commits** (one concern per commit)
3. Stage specific files — NEVER `git add .` or `git add -A`
4. Draft concise commit message: what changed + why, not how
5. No `Co-Authored-By` or `Generated with Claude Code` trailers

## Commit order

If changes span multiple concerns, commit in dependency order:
1. Database migrations first
2. Backend types/models
3. Backend services/controllers
4. Frontend changes
5. Tests
6. Docs/config

## Message format

```
<type>: <short summary>

<optional body — the WHY, not the WHAT>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`

## Checks before commit

- `npm run typecheck` passes
- `npm test` passes (or at minimum, no new failures)
- No secrets staged (.env, credentials, keys)
- No generated files that should be in .gitignore
