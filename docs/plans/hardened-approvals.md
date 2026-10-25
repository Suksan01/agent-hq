# Build plan: view-only page approvals (0.8.0)

Spec: `docs/specs/hardened-approvals.md` (approved). Roles: SD = senior-dev (3 on the team), RV = reviewer (1).
The person's ruling at the plan gate: no new tests ("too much test, skip all test"). Developers delete the tests of the
code they remove so the existing suite stays green; the lead runs the existing suite once at the end. The spec's ACs
are checked by the review (task 5) and that run, not by new test files.
Commands: `claude plugin test .`, `node --test web/*.test.mjs`, `npx -p typescript@5.6.3 tsc -p . --noUnusedLocals`.
Card shape: each open ask in the state file's inbox may carry `card` `{ tool, fields: [{ key, text }], isHidden, reason }`
(additive; absent on a 0.7.x state file), built by one pure helper `cardOf(tool, input, reason)` in `hooks/inbox.ts`.

## Tasks

- [x] 1. **SD-a** remove the mod's decide path. Files: `hooks/pageapproval.ts` (delete), `hooks/register.tsx`,
  `hooks/inbox.ts` (only: receive `pageCount`), `hooks/i18n.ts` (drop `web.approvals*`, `approval.waiting`,
  `approvals.*`, `web.linkNotice`, en and th), delete `tests/page-approval-wiring.test.ts`,
  `tests/page-approval-dormant.test.ts`, `tests/page-approval.test.ts` (keep the `pageCount` case in
  `tests/inbox.test.ts`). Remove `askOnPage`, mode tracking (unless task 3's denied-call hook needs it), the setting
  `PAGE_APPROVALS`, `linkReply`; `/hq web` reply carries the link. ACs: 2, 9, 10.
  Done: tsc clean, `claude plugin test .` green. Deps: none. Parallel with 2 (disjoint files).
- [x] 2. **SD-b** remove the hub's decide path. Files: `web/hub.mjs`, `web/server.mjs`, delete `web/approve.mjs`,
  `web/approvals.mjs`, `web/approve.test.mjs`; remove approval cases from `web/server.test.mjs`. ACs: 1, 7 (hub side), 8.
  Done: `node --test web/*.test.mjs` green. Deps: none. Parallel with 1.
- [x] 3. **SD-a** the card data. Files: `hooks/inbox.ts` (`cardOf`, deciding fields only, key names and sizes for
  Write/Edit/notebook, mask via `maskSecrets`, 2 KB and 5-card caps), `hooks/register.tsx` (record the card in the
  `tool.check` hook, session-end clear, `removeAsk` on a denied call if `tool.call` is not reached; no 0600:
  `$.fs.write` takes no mode and the live folder is already 0700), `hooks/live.ts` (additive snapshot field). ACs: 2, 4, 5, 14. Done: tsc clean, suite green.
  Deps: 1.
- [x] 4. **SD-b** the page card. Files: `web/approval.js` (view-only, text nodes only), `web/livestate.js` (drop
  `answerApproval` and the approval SSE state), `web/live.js` (render cards from the snapshot, fall back to
  `describeAsk` words without `card`), `web/net.js` (drop the two handlers), `web/i18n.js` (en and th: view-only line,
  "too large or sensitive: see the terminal"; remove the old keys). ACs: 6, 11, 12, 13. Done: suite green.
  Deps: 2, 3.
- [ ] 5. **RV** security review of the finished diff (tasks 1-4 and 6), checklist: no route or queue kind can decide
  (AC1/AC2); text nodes only, U+202E and zero-width shown marked (AC12); masked and capped input (AC4); en and th
  complete (AC11); no orphans (AC8 grep); state-file permissions; denied-call path handled (AC14); CHANGELOG and README
  true; tsc clean. Output: APPROVED or findings.
- [x] 6. **SD-c** docs. Files: `README.md` (commands and capabilities: no page approvals, the card is view-only and
  says "answer in the terminal"), `CHANGELOG.md` (Unreleased: Added the card, Removed page approvals "never shipped
  enabled", the `$.store` key `pageApprovals` left alone). Version bump is the lead's at release. Deps: 4.
- [ ] 7. **Lead** one run of the existing suite, tsc and `claude plugin validate .`, then a look at the page with a real
  ask (card shown, answered in the terminal, card gone). Deps: 5 fixes applied.

## Waves

1. Tasks 1 and 2 (two SDs, disjoint files). 2. Task 3. 3. Task 4. 4. Task 6, then task 5. 5. Task 7.
`hq_assign` runs members in the lead's checkout's guard root, so parallel tasks use `worktree: true` without `files`,
or run one after another.

## Rollout and rollback

No feature flag: the card has no authority (it only reads the state file and cannot change a verdict), so a flag would
guard nothing. The removed code was dormant since 0.7.0. Rollback: revert the 0.8.0 commits or reinstall 0.7.2. The
extra `card` field and the unused `pageApprovals` store key are harmless to 0.7.2.

## Estimate

7 tasks; at most 2 agents at once; about 1.5 to 2 hours over 5 waves. Unverified: the denied-call path (task 3).

Follow-up (not in 0.8.0): the card does not show how long the ask has waited yet.
