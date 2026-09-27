<!-- OVERRIDE: adds a "test" npm script only; readers are memory-bank prose notes (word match), no code reads scripts.test -->
# Contract: `package.json`

## AUDIT #1 — 2026-09-27: add `"test": "npm run build && node test/cloud-pr-list-item.mjs"`

| Reader | Verdict |
|---|---|
| `memory-bank/activeContext.yml` | n/a — notes mention package.json by name, do not read `scripts.test` |
| `memory-bank/productContext.yml` | n/a — same |

Existing scripts (`build`, `dev`, `start`, `prepublishOnly`), dependencies and `files` are unchanged.
