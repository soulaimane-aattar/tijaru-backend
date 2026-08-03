# Tijaru — Documentation

> Central documentation for the **Tijaru** project (formerly "Stock") — all-in-one commerce platform for Moroccan & European SMBs: inventory, POS, clients, invoicing, expenses.

## Index

| Doc | Purpose |
|-----|---------|
| [01-project-overview.md](01-project-overview.md) | What Tijaru is — brand, product, personas, stack |
| [02-decisions.md](02-decisions.md) | Decision log (ADR-style) — every significant choice + why |
| [03-progress.md](03-progress.md) | Step-by-step build log — updated after **every passed step** |
| [../Stock-build-spec.md](../Stock-build-spec.md) | Full build specification (screens, data model, roles, i18n) |
| [../IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) | Phase map and build order |

## Rules

1. **Every passed step gets documented.** When a phase/step from the implementation plan passes its gate, append an entry to `03-progress.md` **in the same session** (see skill `.claude/skills/document-step`).
2. **Every significant decision gets logged** in `02-decisions.md` — one-liner minimum: what, why, alternatives rejected.
3. Docs are terse. Facts, not prose.
