# Build plan: view-only page approvals (0.8.0)

Spec: `docs/specs/hardened-approvals.md` (approved). Roles: SD = senior-dev (3 on the team), QA = qa (1), RV = reviewer (1).
QA writes each test file first and SD does not edit it; SD makes it pass. Every task ends with the tests it names green.
Commands: `claude plugin test .`, `node --test web/<file>`, `npx -p typescript@5.6.3 tsc -p . --noUnusedLocals`.
Interface agreed by tasks 4 and 5: each open ask in the state file's inbox may carry `card`
`{ tool, fields: [{ key, text }], isHidden, reason }` (additive; absent on a 0.7.x state file), built by one pure helper
`cardOf(tool, input, reason)` in `hooks/inbox.ts`. Task 4 fixes the exact shape in its tests; task 5 follows it.

## Tasks

- [ ] 1. **QA** hub routes and leftovers tests. Files: `web/hub-routes.test.mjs` (new), `web/leftovers.test.mjs` (new).
  ACs: 1, 8. Done: both fail on main for the right reason (routes exist, words found). Deps: none.
- [ ] 2. **SD-a** remove the mod's decide path. Files: `hooks/pageapproval.ts` (delete), `hooks/register.tsx`,
  `hooks/inbox.ts` (only: receive `pageCount`), `hooks/i18n.ts` (drop `web.approvals*`, `approval.waiting`,
  `approvals.*`, `web.linkNotice`, en and th), delete `tests/page-approval-wiring.test.ts`,
  `tests/page-approval-dormant.test.ts`, `tests/page-approval.test.ts` (keep the `pageCount` case in
  `tests/inbox.test.ts`). Remove `askOnPage`, mode tracking (unless the denied-call hook in task 5 needs it), the setting
  `PAGE_APPROVALS`, `linkReply`; `/hq web` reply carries the link. ACs: 2 (verdict unchanged), 9, 10.
  Done: tsc clean, `claude plugin test .` green, no `process.run` of an approval helper left. Deps: none.
  Parallel with 1 (disjoint files).
- [ ] 3. **SD-b** remove the hub's decide path. Files: `web/hub.mjs`, `web/server.mjs`, delete `web/approve.mjs`,
  `web/approvals.mjs`, `web/approve.test.mjs`; remove approval cases from `web/server.test.mjs`. ACs: 1, 7 (hub side), 8.
  Done: `node --test web/hub-routes.test.mjs web/server.test.mjs` green. Deps: 1. Parallel with 2.
- [ ] 4. **QA** card data tests. Files: `tests/ask-card.test.ts` (new). ACs: 2 (state file and queue with
  `{"decision":"allow"}`, tool.check allow/ask/deny unchanged), 4 (deciding fields only, key names and sizes for
  Write/Edit/notebook, mask, 2 KB cap, 5-card cap), 5 (answered, loop ends, no page, session-end clear), 14 (allowed,
  denied, errored each clear the card). Done: fails on main only for the missing card. Deps: 1 (QA is one person).
  Parallel with 2 and 3.
- [ ] 5. **SD-a** the card data. Files: `hooks/inbox.ts` (`cardOf`, caps, mask via `maskSecrets`), `hooks/register.tsx`
  (record the card in the `tool.check` hook, session-end clear, `removeAsk` from the denied-call hook if the test shows
  `tool.call` is not reached, state written 0600 where `$.fs.write` allows), `hooks/live.ts` (additive snapshot field),
  `types/index.d.ts` if the snapshot type is there. ACs: 2, 4, 5, 14. Done: `tests/ask-card.test.ts` green, tsc clean.
  Deps: 2, 4.
- [ ] 6. **QA** page tests. Files: `web/approval.test.mjs` (new). ACs: 6 (no Allow/Deny/countdown, terminal line),
  12 (`<img onerror>`, U+202E, zero-width: text nodes, marked), 13 (0.7.x state with no card falls back to `describeAsk`
  words), 4 (page side: fields as given), 11 (page en/th key parity via `web/i18n.test.mjs`). Done: fails on main.
  Deps: 4.
- [ ] 7. **SD-b** the page card. Files: `web/approval.js` (view-only), `web/approvalmarks.js` (unchanged), `web/livestate.js`
  (drop `answerApproval` and the approval SSE state), `web/live.js` (render cards from the snapshot), `web/net.js` (drop
  the two handlers), `web/i18n.js` (en and th: view-only line, "too large or sensitive: see the terminal"; remove the
  old keys). ACs: 6, 11, 12, 13. Done: `node --test web/approval.test.mjs web/i18n.test.mjs web/live.test.mjs` green.
  Deps: 3, 5, 6.
- [ ] 8. **QA** cross-version fixture. Files: `web/compat.test.mjs` (new; uses `git worktree add <scratch> v0.7.2` and
  removes it after). AC: 7 (v0.7.2 server registers with the 0.8.0 hub and the reverse; register, heartbeat, forward,
  `/hq web`; `hub.json`, `pages.json`, state files parse). Done: green against the finished hub. Deps: 3. Parallel
  with 5-7 (QA is one person: after 6).
- [ ] 9. **SD-c** docs. Files: `README.md` (lists of commands and capabilities: no page approvals, the card is view-only
  and says "answer in the terminal"), `CHANGELOG.md` (0.8.0: Added the card, Removed page approvals "never shipped
  enabled", the `$.store` key `pageApprovals` left alone). Version bump is the lead's at release. Done: AC8 grep passes.
  Deps: 7.
- [ ] 10. **RV** security review of the finished diff, with the checklist: no route or queue kind can decide (AC1/AC2);
  text nodes only (AC12); masked and capped input (AC4); en and th complete (AC11); CHANGELOG and README true; tsc
  clean; no orphans (AC8); state-file permissions; denied-call path tested (AC14). Output: APPROVED or findings.
  Deps: 7, 8, 9.
- [ ] 11. **QA** the full run (last). `claude plugin test .`, `node --test web/*.test.mjs` including `compat.test.mjs`
  (the v0.7.2 fixture), `claude plugin validate .`, the tsc command, the AC8 grep, and a look at the page with a real
  ask (card shown, answered in the terminal, card gone). Report pass/fail per AC1-AC14. Deps: 10 fixes applied.

## Parallel waves (disjoint files, one QA)

1. Tasks 1 and 2. 2. Tasks 3 and 4. 3. Task 5 and task 6 (SD-a, QA). 4. Tasks 7 and 8 (SD-b, QA). 5. Task 9 (SD-c) with
the review of 7 begun. 6. Tasks 10, then 11. Parallel runs run only their own test files; the whole suite runs at
each wave's join, since `register.tsx` and `web/live.js` are shared by later tasks.

## Rollout and rollback

No feature flag. The card has no authority: it only reads the state file and cannot change a verdict, so a flag would
guard nothing and be one more place to be wrong. The removed code was dormant since 0.7.0. Rollback: revert the 0.8.0
commit(s) or reinstall 0.7.2. The state file's extra `card` field and the unused `pageApprovals` store key are
harmless to 0.7.2; hub and mod versions mix safely (AC7).

## Estimate

11 tasks; at most 3 agents at once (two SDs and QA, or an SD, QA and RV); about 3 to 4 hours of wall time over 6 waves,
assuming 15 to 40 minutes per task and one review round. The unverified risk is the denied-call path (task 5): if
`tool.call` is not reached, add its hook and one more test.
