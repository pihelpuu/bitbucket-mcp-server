# Contract: `src/utils/formatters.ts` (+ `src/handlers/branch-handlers.ts` Cloud PR list)

## AUDIT #1 — 2026-09-27: Cloud PR *list* objects have no `reviewers` / `participants`

**Symptom (live, 27.09):** `list_pull_requests` `workspace=adm_dev repository=invoice-checker-mcp state=MERGED` →
`Cannot read properties of undefined (reading 'map')`; the same call with `state=OPEN` returned 0 PRs and did not crash.
**Cause:** Bitbucket Cloud `GET /repositories/{ws}/{repo}/pullrequests` returns partial PR objects; `reviewers` and `participants`
are only on the single-PR endpoint. `formatCloudPRListItem` r107 called `pr.reviewers.map` ⇒ every non-empty list crashed.
`branch-handlers.ts` r305–319 (`get_branch`, open PRs of a branch) reads the same list endpoint and calls `pr.reviewers.map` /
`pr.participants.filter` ⇒ same crash for any branch with an open PR.

**Change:** reviewers → `pr.reviewers?.map(...)` (key omitted when the API did not send it); in `get_branch` Cloud,
`approval_status` is built only when both `reviewers` and `participants` are present, otherwise omitted. Omitted, not `[]`:
an empty list would claim "no reviewers" for data that was never fetched.

### Readers (gate listed 6 for formatters.ts)

| Reader | Uses the changed output? | Verdict |
|---|---|---|
| `src/handlers/pull-request-handlers.ts` r234–236 | yes — `formatCloudPRListItem` for `list_pull_requests` (Cloud) | ✅ compatible: JSON-serialised as is; `reviewers` absent instead of a crash |
| `src/handlers/branch-handlers.ts` | no — does not import `formatCloudPRListItem`; its own Cloud list mapping is fixed in the same change | ✅ updated |
| `src/handlers/search-handlers.ts` | no — other formatters only | ✅ unaffected |
| `memory-bank/.clinerules`, `activeContext.yml`, `systemPatterns.yml` | no — prose/notes (word match) | n/a (false positive) |

`grep -rn formatCloudPRListItem src/` = definition + 1 call site (`pull-request-handlers.ts:235`).

**Not done (needs live verification with credentials):** requesting the fields via Bitbucket partial responses
(`fields=+values.reviewers,+values.participants`) would restore the data in both lists; unverified tonight ⇒ left out.

**Proof:** `test/cloud-pr-list-item.mjs` (fake list-shaped PR, no network) — before: 2 FAIL with the exact live message; after: see commit.
