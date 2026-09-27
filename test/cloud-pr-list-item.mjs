// Regression: Bitbucket Cloud GET /repositories/{ws}/{repo}/pullrequests returns partial PR objects without `reviewers`
// (only the single-PR endpoint has them). On 2026-09-27 list_pull_requests state=MERGED crashed with
// "Cannot read properties of undefined (reading 'map')". Run: `npm test` (builds first) or `node test/cloud-pr-list-item.mjs [build/utils/formatters.js]`.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const modPath = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build", "utils", "formatters.js");
const { formatCloudPRListItem, formatCloudBranchOpenPR } = await import(pathToFileURL(modPath).href);

const listShaped = {
  id: 7, title: "T47 B3", state: "MERGED",
  author: { display_name: "Riho" },
  source: { branch: { name: "feature/b3" } }, destination: { branch: { name: "main" } },
  updated_on: "2026-09-25T10:00:00+00:00", links: { html: { href: "https://bitbucket.org/x/y/pull-requests/7" } },
};
let fail = 0;
const check = (name, fn) => {
  let ok = false, why = "";
  try { ok = fn(); } catch (e) { why = ` (threw: ${e.message})`; }
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${why}`);
  if (!ok) fail++;
};
check("list-shaped PR without reviewers does not throw", () => { formatCloudPRListItem(listShaped); return true; });
check("missing reviewers are omitted, not reported as an empty list", () => !("reviewers" in JSON.parse(JSON.stringify(formatCloudPRListItem(listShaped)))));
check("reviewers present are mapped to display names", () =>
  JSON.stringify(formatCloudPRListItem({ ...listShaped, reviewers: [{ display_name: "A" }, { display_name: "B" }] }).reviewers) === '["A","B"]');
check("empty reviewers stay an empty list", () =>
  JSON.stringify(formatCloudPRListItem({ ...listShaped, reviewers: [] }).reviewers) === "[]");

// get_branch (Cloud) reads the same list endpoint for a branch's open PRs.
const branchPR = { ...listShaped, state: "OPEN", created_on: "2026-09-24T09:00:00+00:00" };
check("get_branch: PR without reviewers/participants does not throw", () => { formatCloudBranchOpenPR(branchPR); return true; });
check("get_branch: approval_status and reviewers omitted when the list gave no data", () => {
  const out = JSON.parse(JSON.stringify(formatCloudBranchOpenPR(branchPR)));
  return !("approval_status" in out) && !("reviewers" in out);
});
check("get_branch: approval_status computed when reviewers and participants are present", () => {
  const out = formatCloudBranchOpenPR({
    ...branchPR,
    reviewers: [{ display_name: "A", account_id: "a" }, { display_name: "B", account_id: "b" }],
    participants: [{ approved: true, user: { display_name: "A", account_id: "a" } }, { approved: false, user: { display_name: "B", account_id: "b" } }],
  });
  return JSON.stringify(out.reviewers) === '["A","B"]'
    && JSON.stringify(out.approval_status.approved_by) === '["A"]'
    && JSON.stringify(out.approval_status.pending) === '["B"]';
});
process.exit(fail ? 1 : 0);
