---
name: audit
description: Audit uncommitted changes via code-reviewer agent. Run before committing or after implementation steps.
---

# Audit skill

Dispatch the **code-reviewer** agent to review current uncommitted changes.

## Steps

1. Run `git diff --stat` to see what changed
2. If no changes, report "nothing to audit" and stop
3. Spawn `code-reviewer` agent with prompt:

```
Review the uncommitted changes in this repo. Run `git diff` to see all changes.
Check against the full review checklist: security/RLS, database conventions,
backend patterns, frontend rules, cross-stack contracts.
Report verdict: PASS or NEEDS_FIX with specific issues.
```

4. Report the reviewer's verdict to the user
