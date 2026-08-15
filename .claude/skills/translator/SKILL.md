---
name: translator
description: Translate UI strings and text to English, French, and Modern Standard Arabic for Tijaru web/mobile. Use when user says "translate", "traduire", "ترجم", "i18n", "locale", "add translations", pastes strings, or edits `en.json`/`fr.json`/`ar.json` files. Auto-triggers on missing keys across locale files.
---

# Translator — en / fr / ar (MSA)

Produces parallel translations across three target locales for Tijaru:

- `en` — English (source of truth when ambiguous)
- `fr` — French (Moroccan/EU SMB primary)
- `ar` — Modern Standard Arabic (MSA, RTL)

## When to invoke

- User pastes UI copy and asks for translations.
- User edits one locale file → mirror the change into the other two.
- New feature adds keys to `en.json` → fill `fr.json` and `ar.json`.
- User says: "translate", "traduire", "ترجم", "i18n sync", "locale sync".

For anything larger than ~30 keys or a full-file sync, delegate to the `translator` agent (`Agent` tool, `subagent_type: "translator"`) so the raw JSON diff stays out of the main context.

## Workflow

1. **Detect source locale.** Look at input language or the file path (`locales/en/*.json` → source=en).
2. **Load all three locale files** if syncing a project. Preserve existing keys — never overwrite a translation that already exists unless the user asked for a rewrite.
3. **Translate only missing/changed keys.** Diff by key path, not by file. Keep unchanged translations byte-identical.
4. **Preserve structure exactly:**
   - JSON key order matches source file.
   - ICU / i18next placeholders untouched: `{name}`, `{{count}}`, `{count, plural, one {#} other {#}}`.
   - HTML tags untouched: `<b>`, `<Link>`, `<0>`.
   - Newlines, escapes, trailing punctuation preserved.
5. **Write back** with same formatting (2-space indent unless file uses different).
6. **Report** a short table of keys touched per locale. No prose recap.

## Translation rules

**French (fr)**
- European French, formal register ("vous"), Moroccan business context.
- Commerce vocab: *facture*, *dépense*, *client*, *stock*, *TVA*, *encaissement*, *bon de livraison*.
- Preserve accents. Non-breaking space before `:`, `!`, `?`, `»` (` `).
- Currency: keep `MAD` / `€` as written in source.

**Arabic (ar) — MSA**
- Modern Standard Arabic, formal. Not Darija.
- Right-to-left: do NOT add `‏` (RLM) unless the source already had it. i18n runtime handles direction.
- Punctuation: Arabic comma `،`, Arabic question mark `؟`, Arabic semicolon `؛`.
- Numbers: keep Western digits (0-9) — matches product/POS UI. Do not convert to Arabic-Indic.
- Commerce vocab: *فاتورة* (facture), *عميل* (client), *مخزون* (stock), *مصروف* (dépense), *ضريبة القيمة المضافة* (TVA).
- Placeholders wrap in LTR context automatically at runtime — leave `{name}` bare.

**Cross-locale**
- Product name **Tijaru** stays untranslated in all three (`Tijaru`, `Tijaru`, `تِجارُو` only in headings; body text keep Latin `Tijaru`).
- Buttons: imperative, short. `Save` / `Enregistrer` / `حفظ`.
- Errors: neutral tone, no blame. `Invalid email` / `Email invalide` / `البريد الإلكتروني غير صالح`.
- Never machine-transliterate brand names or SKUs.

## Output shape

When editing files: edit in place with the `Edit` tool, one call per file.

When user pastes loose text: reply with a fenced block:

```
EN: <english>
FR: <french>
AR: <arabic>
```

No commentary unless the source is ambiguous — then ask ONE clarifying question, translate the most likely reading, and flag the assumption.

## Red flags — stop and ask

- Source string contains untagged variable interpolation you can't identify (e.g. `%1$s` mixed with `{name}`).
- Legal/financial copy (invoice terms, refund policy) — confirm with user; wrong translation has liability.
- Placeholder count differs between existing translations — indicates a bug, don't paper over it.

## Anti-patterns

- Do NOT translate JSON keys, only values.
- Do NOT reorder keys.
- Do NOT reformat the whole file — minimal diff only.
- Do NOT invent keys that don't exist in the source.
- Do NOT use Google Translate style literal renderings — French and Arabic have different sentence structures; rewrite for naturalness while keeping meaning.
