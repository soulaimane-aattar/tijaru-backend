---
name: document-step
description: Use after ANY step, phase, feature, or fix in this project passes its gate (tests green, endpoint works, screen renders, migration applied) — documents the step in docs/03-progress.md and logs decisions in docs/02-decisions.md before the session moves on. Also use when the user says "document this", "log this step", or finishes a piece of work.
---

# Document Step

Every passed step gets written down **in the same session it passes**. No exceptions. Undocumented work = lost context next session.

## When this fires

- A phase/step from `IMPLEMENTATION_PLAN.md` passes its gate
- A feature, bugfix, migration, or config change is completed and verified
- A significant decision is made (library choice, schema change, API shape, naming, infra)
- User says "document this" / "log this"

## Checklist

1. **Append progress entry** to `docs/03-progress.md` under `## Log` (newest on top), using the template at the bottom of that file:
   - **Step:** what was built/changed (one line)
   - **Result:** ✅/❌ + concrete gate evidence — paste the actual proof (test summary line, curl output, migration name). Never write "works" without evidence.
   - **Decisions:** link `D-XXX` entries if any were logged
   - **Next:** immediate follow-up step
2. **Update phase table** in `docs/03-progress.md` if a plan phase changed status (⬜ → 🟡 → ✅). If touching a `retro` phase, verify its gate first, then flip to plain ✅.
3. **Log decisions** in `docs/02-decisions.md` if the step involved a significant choice:
   - New `D-XXX` (increment), date, decision, why, rejected alternatives (one line each)
4. **Update `docs/01-project-overview.md`** ONLY if the step changed architecture, modules, stack, or brand facts.
5. Keep entries terse — facts, evidence, links. No prose.

## Rules

- Document BEFORE starting the next step, not at session end (session may die).
- ❌ result entries are as valuable as ✅ — log failed gates with the error.
- Never rewrite history: append; correct earlier entries with a dated addendum line.
