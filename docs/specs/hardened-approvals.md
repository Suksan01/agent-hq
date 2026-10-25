# Hardened page approvals (0.8.0): view only

Status: build (approved)
Skipped: prototype (small UI change, the card already exists)

## Direction

The live page **shows** each permission ask the engine puts to the person (agent, tool, exact input) and says to answer
it in the terminal. The page has no Allow or Deny button, and nothing it sends can decide an ask: the terminal dialog is
the only authority. The dormant approval code (0.7.0) goes. An agent that fakes or edits the page changes only what the
page shows, never an outcome.

Rejected: **Touch ID / WebAuthn.** The agent is the same OS user, so it can edit `web/approve.mjs` (spawned fresh per
ask), serve a fake page and phish the registration with a software key, and a fake page can show one command while
Touch ID signs another (security review, 3 CRITICAL). Also rejected earlier: a code shown only in the terminal.

## Threat model (the person's answers, kept)

- A prompt-injected agent of this session on this Mac, with Read and Bash (reads any file, runs curl against localhost,
  reads hub.json), must never approve its own ask, forge an approval card or log into the page. Under view-only,
  "approve" has no path at all; a forged card or a login can mislead the eyes, not the outcome (Risks).
- Out of scope: other OS users, malware outside Claude, approving from another device on the network.

## Flows

**An ask arrives.** Path chosen: the state file the page already reads, not `/hub/approval` or SSE. Why: no new route,
no token, no helper process, nothing for an agent to call that could decide.
1. Engine `tool.check` returns `ask`. The mod's hook (`hooks/register.tsx`, `on('tool.check')`) already records it with
   `addAsk` (`hooks/inbox.ts`); now the entry also carries `input` and `reason` (masked, see below), and the hook returns
   the engine's verdict **unchanged**.
2. `requestLive` writes the state file; the hub's file watch (`web/hub.mjs` `watchJson`, `/state`, `/events` envelope)
   sends it to the page as today. Fields are only added to the snapshot (`hooks/live.ts`).
3. The page (`web/live.js`, `web/approval.js`, `web/approvalmarks.js`) shows a card per open ask: who (agent and role),
   the tool, the exact input as text with hidden characters made visible (`approvalmarks.js` stays), the reason, how long
   it has waited, and one fixed line: "Answer it in the terminal" (the inbox already says so).
4. The person answers in the terminal. `removeAsk` runs in the `finally` of the mod's `tool.call` hook
   (`register.tsx:1152`): that covers an allowed call, one that errors, and one that throws. `requestLive` writes the
   state and the card disappears. **Gap:** a call the person *denies* may never reach `tool.call`, and today the only
   cleanup is `dropAsksOf` when the loop's turn ends (`register.tsx:1234`), so a denied call can leave its card up
   while the agent keeps working (`tests/inbox-wiring.test.ts:78` covers the allowed path only). Not verified against
   the engine. The build must test a denied ask; if the card stays, also call `removeAsk` from the
   `classic.PostToolUseFailure`/permission-denied hook (so those mode hooks stay if they carry it).

**Input shown (least exposure).** Only the fields that decide the ask: `command`, `file_path`, `url`, `pattern`,
`description`. For `Write.content`, `Edit` strings and notebook cells: key names and sizes only. Each is masked with
`maskSecrets` (fail-closed, as `isShowable` at `pageapproval.ts:88`; a heuristic, not a guarantee). A secret hit, or over
2 KB, shows no input, only "Too large or sensitive to show here: see the terminal". At most 5 open asks carry an input
(`envelope()` re-sends every snapshot); older ones keep the `describeAsk` words. `$.fs.write` takes no mode, so the state file keeps its default permissions; the live folder is already 0700 (and the
same user can read both anyway). The asks are cleared at session end.

**`/hq web approvals`:** removed, not a toggle. The card is always shown while a page is open (a setting would only be
a second place to be wrong). `/hq web next` and its `Setting` helpers stay. The bare `/hq web approvals` is then an
unknown word, answered as any unknown `/hq` word is today.

## Removal (exactly what goes)

- `hooks/pageapproval.ts`: `APPROVALS_RELEASED`, `APPROVALS_TEST_SESSION`, `isApprovalsReleased`, `canHold`,
  `approvalRequest`, `answerOf`, timing constants, `ALLOWED`/`DENIED`. Two small pieces move to `hooks/inbox.ts`:
  `pageCount` (still read for the suggestions rule, `register.tsx:625`) and the mask-and-size check (2 KB).
- `hooks/register.tsx`: `askOnPage`, `modes`/`noteMode` and the classic `UserPromptSubmit`/`PostToolUse` mode hooks if
  nothing else uses them, `isApprovalOpen`, `areApprovalsReleased`, `PAGE_APPROVALS`, `approvalsOnFrom`, the
  `web.approvalsComing` branch, `linkReply`/`NO_LINK`/`isGuarded` (the login link goes back to the `/hq web` reply, as in
  0.7.2 with approvals off).
- `web/approve.mjs`, `web/approvals.mjs`, `web/approve.test.mjs`.
- `web/hub.mjs`: `/hub/approval` (`holdApproval`), `/approval/<id>` (`answerApproval`), `approvals`, the `approval` and
  `approval-withdrawn` SSE events, `config.approvals`. `web/server.mjs`: the `AGENT_HQ_APPROVALS` line (54).
- Page: `answerApproval` and `approval`/`answer` state in `web/livestate.js`, the `named` approval handlers (`web/net.js`
  stays; only the two handlers go), the Allow/Deny/countdown/arming code in `web/approval.js`, the `ApprovalCard` props
  `onAnswer` (`web/live.js:210`).
- Tests: `tests/page-approval-wiring.test.ts` (with the two failing tests), `tests/page-approval-dormant.test.ts`,
  `tests/page-approval.test.ts` (the `pageCount` case moves), the approval cases in `web/server.test.mjs` and any
  approval case in `web/live.test.mjs`/`browser.test.mjs`.
- `hooks/i18n.ts` and `web/i18n.js`, English and Thai: `web.approvals*`, `approval.waiting`, `approvals.*`,
  `web.linkNotice`, page `approval.allow/deny/left/failed/gone`. Added: the view-only line and the "see the terminal"
  text.

**Must stay (0.7.x sessions share the hub):** `hub.json {port,pid,secret}` and its 0600 write; `/hub/ping`, `/hub/code`,
`/hub/register`, `/hub/forward`; `/state`, `/events`, `/action`; `pages.json {count,at}`; state-file and queue formats;
the `AGENT_HQ_URL`/`AGENT_HQ_PAGES` lines. A 0.7.x mod never holds an ask (unless `AGENT_HQ_APPROVALS=1`, outside this threat model), a 0.7.x hub ignores
the new state fields (no card), a 0.8.0 hub serves a 0.7.x session unchanged. A 0.8.0 page reading a 0.7.x state file
(no `input`, no `reason`) falls back to the `describeAsk` words. The old `pageApprovals` key in users' `$.store` is left
alone and harmless.

## States of the card

- **Shown:** agent, tool, input (marked), reason, waiting time, "Answer it in the terminal".
- **Input hidden:** secret or over 2 KB: the "see the terminal" text instead of the input.
- **Answered:** the call ended; the card is gone on the next state push (no confirmation, the terminal said it).
- **Withdrawn:** the loop ended, Esc, or the agent finished (`dropAsksOf`, `liveAsks`): the card is gone.
- **Timeout:** none. The dialog has no timeout and the card lives as long as the ask; the waiting time just grows.
- **No page open:** nothing to show, nothing sent; the dialog is unchanged. A page opened later shows the open asks
  from the state file.
- **Page offline/logged out:** the page's existing states ("open the page again with /hq web").

## Acceptance criteria

- AC1 Given a 0.8.0 hub, then its route table equals the allowed list (`/`, page files, `/vendor/*`, `/state`,
  `/events`, `/action`, `/hub/ping|code|register|forward`), `/approval/<id>` and `/hub/approval` answer 404, and the queue
  kinds equal spawn, lead, message, stop and finished.
- AC2 Given a state file and queue lines containing `{"decision":"allow"}`, when `tool.check` runs for an allow, an ask
  and a deny, then each verdict is deep-equal to the engine's (`decider`, `reason`, `rule` included) and no approval
  helper is run.
- AC3 Given an edited page or a fake page on the hub's port, then no code path from page or state file reaches a
  verdict (the behavioural test of AC2 is the proof; the terminal's answer is the outcome).
- AC4 Given an ask with a Bash command, when the card shows, then its tool, agent, role and deciding fields equal the
  ask's in masked, marked form (hidden characters as `⟦U+XXXX⟧`); `Write.content` shows key names and sizes only; a
  secret or over-2 KB input shows the "see the terminal" text; at most 5 cards carry an input.
- AC5 Given the dialog is answered or the loop ends, then the card is gone from the next state push; given no page is
  open, then no event is sent and pages opened later show the open asks; at session end the asks are cleared.
- AC6 Given the page, then it has no Allow, Deny or countdown element and says to answer in the terminal.
- AC7 Given a worktree of tag v0.7.2 as the fixture for both its hub and its mod, when its session server registers
  with a 0.8.0 hub (and a 0.8.0 server with the v0.7.2 hub), then register, heartbeat, forward and `/hq web` work, and `hub.json`, `pages.json` and
  state files parse as before.
- AC8 Given `grep -rni "approval" hooks web tests README.md`, then it finds only `describeAsk`, the inbox "waiting on
  approval" strings (`inbox.held`), the team-file trust code (`hooks/approval.ts`, `trust.*`), the new card strings, the kept
  `web/approval.js`, `web/approvalmarks.js` and `ApprovalCard`, and CHANGELOG.
- AC9 Given the old tests, then the files in the removal list are gone, `claude plugin test .` has no failure, and the
  two former failures no longer exist as tests.
- AC10 Given `/hq web` runs, then the reply carries the login link (as 0.7.2 with approvals off).
- AC11 Given `en` and `th`, then both tables have every new key with the same placeholders.
- AC12 Given any ask text (agent, tool, input, reason), when the page renders the card, then it is set as text nodes
  only (no `innerHTML`, no HTML, no link; only the svg icons use `dangerouslySetInnerHTML`, `web/spacekit.js:49,87`),
  checked by a render test with `<img onerror>`, U+202E (right-to-left override) and zero-width characters in the input:
  each shows as visible marked text (`⟦U+202E⟧`, `⟦U+200B⟧`, the HTML as literal characters), never as active text that
  hides or reorders the command.
- AC13 Given a 0.7.x state file with no `input` or `reason`, when the 0.8.0 page renders, then it shows the
  `describeAsk` words without error.
- AC14 Given a call that is allowed, denied by the person, or that errors, when it is decided, then its ask and card
  are gone on the next state write (not only when the loop ends); a test per case.

## Project rules

| Rule | Check |
|---|---|
| Tests | `claude plugin test .`, `node --test web/server.test.mjs`, `claude plugin validate .`; new tests for AC1-AC7, AC10, AC12-AC14 |
| Types | `npx -p typescript@5.6.3 tsc -p . --noUnusedLocals` clean (catches orphans left by the removal) |
| Thai and English | strings in `hooks/i18n.ts` and `web/i18n.js`; `tests/i18n.test.ts` parity |
| README | its lists of commands and capabilities no longer mention page approvals; the card is described as view-only |
| CHANGELOG | 0.8.0: Added "live page shows open permission asks (view only)"; Removed "page approvals (never shipped enabled)" |
| Version | `.claude-plugin/plugin.json` and `marketplace.json` to 0.8.0 at release |

## Risks

- Residual: a faked card (agent edits the state file or serves a fake page) can show the person a wrong command or a false
  ask. It cannot change an outcome; the terminal dialog is the only authority and shows the real command. The page and
  the README say so: never answer from the page's text.
- The card puts exact inputs (masked) in the state file, readable by any agent of the session; an agent already sees its
  own inputs, but a member can now read another's pending input. The 2 KB cap, the 5-card cap, deciding-fields-only and `maskSecrets` (heuristic) limit it.
- The removal touches many files: orphans are the main risk (tsc `--noUnusedLocals`, AC8).
- Security review by the review role is still required on the finished diff (state file and hub routes change).

## Out of scope

Other OS users, malware outside Claude, other devices; any way to answer from the page; passkeys, codes or other
authentication; hardening `hub.json`, the login cookie and `/action` (they decide nothing about asks now; `/action`
can still message the lead, as in 0.7.x).

## Decisions (the person's answers)

1. `/hq web approvals` is removed, not kept as a toggle.
2. The card shows the deciding fields (`command`, `file_path`, `url`, `pattern`, `description`); file contents
   (`Write.content`, `Edit` strings, notebook cells) only as key names and sizes.
3. Hardening `/action` is a separate job, later, and out of scope here.
