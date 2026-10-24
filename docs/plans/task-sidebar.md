# Task sidebar: build plan

Spec: `docs/specs/task-sidebar.md` (approved, variant A "Ledger"). Branch: `feature/task-sidebar` (on `fix/run-findings`).
Repo: `/Users/freshyboyz/agent-hq`. Test command: `claude plugin test .` (the pre-commit hook runs it).

Each task: QA (qa-1) writes the failing tests first in the test files named, commits them; then the owner builds;
then the review role reviews and QA runs the tests. One commit per accepted task.

## Tasks

- [x] 1. **Task list store** - owner: senior-dev
  - Files: `hooks/tasklist.ts` (new). Tests (QA): `tests/tasklist.test.ts`.
  - Meets: AC1, AC2, AC3, AC12. Types for the list (spec "Data"), `parsePlan(text)` (the `- [ ] N. Title` and
    `- [x] N. Title` lines; titles cut and masked with `maskSecrets`), `mergeList(old, parsed)` (re-plan: work kept by
    number, dropped tasks' time and cost into `removed`), `readList`/`writeList` (validate on read, unknown `version`
    ignored). The engine's `$.fs` has no rename, so the list is written in one call; a half-written file reads as no
    list (AC12) and the next `hq_plan` rewrites it. Pure functions take no engine; file I/O takes `$`. Signatures as
    QA's tests fix them (`.claude/agent-hq/reports/qa/qa-1.md`).
  - Done: tests pass; invalid or missing file reads as "no list" with a reason, never throws.
  - Depends on: none.

- [x] 2. **Price table and cost** - owner: senior-dev
  - Files: `hooks/prices.ts` (new). Tests (QA): `tests/prices.test.ts`.
  - Meets: AC10. Prices per model id prefix (input, output, cache read, cache write, USD per million tokens) with the
    date taken; taken with the `claude-api` skill, never from memory. `costOf(work)` returns dollars or null for an
    unknown model.
  - Done: tests pass for each listed model and for an unknown one.
  - Depends on: none. Parallel with 1 and 3.

- [x] 3. **Guard tasks.json** - owner: senior-dev
  - Files: `hooks/guard.ts`, `hooks/command.ts`. Tests (QA): `tests/guard-tasklist.test.ts`.
  - Meets: AC13, AC21 (the approved plan file, path passed in by task 5). A member's (or any sub-agent's) Write, Edit, NotebookEdit or shell command that changes
    `.claude/agent-hq/tasks.json` is refused, as `team.json` is now; the lead is not.
  - Done: tests pass; existing guard tests unchanged and passing.
  - Depends on: none. Parallel with 1 and 2.

- [x] 4. **hq_plan and plan_task** - owner: senior-dev
  - Files: `hooks/tools.ts`, `hooks/assign.ts`. Tests (QA): `tests/plan-tools.test.ts`.
  - Meets: AC1, AC2, AC4, AC5, AC7, AC20. New tool `hq_plan { plan }` (path inside the project, `.md` only, else
    refused); `plan_task` (integer) on `hq_assign` and `hq_review`; a number not in the list is refused before any
    member starts, naming the list's numbers; `hq_review` without it uses the reviewed member's task. Links are kept
    as `{ member → task number, step }` in the list (task 1's types). The lead's tool deps get `readList`/`writeList`
    the way they get `recordAssignment` now.
  - Done: tests pass; every existing `tests/assign.test.ts` and `tests/tools.test.ts` test passes unchanged.
  - Depends on: 1.

- [x] 5. **Wiring: turns, plan ticks and data** - owner: senior-dev
  - Files: `hooks/register.tsx`, `hooks/taskwork.ts` (new), `hooks/usage.ts` (header comment only). Tests (QA):
    `tests/taskwork.test.ts`, `tests/taskwork-wiring.test.ts`.
  - Meets: AC6, AC8, AC9, AC11, AC21 (passes the list's plan path to the guard). `turn.complete` adds the member's time and tokens (cache read and cache write apart)
    to its linked task; the lead counts on none; a linked member working again moves review back to working. After a
    Write or Edit of the list's plan file, the plan is re-read: newly ticked tasks become done, `doneBy` the last
    linked member that is neither the review nor the QA role. `readData` and the live snapshot input get the list.
    Registers `hq_plan` with the lead's tools.
  - Done: tests pass; the existing usage and wiring tests pass unchanged.
  - Depends on: 1, 2, 4 (owns `register.tsx`: never at the same time as 4, 6 or 7).

- [x] 6. **Sidebar table** - owner: senior-dev
  - Files: `hooks/tasktable.tsx` (new), `hooks/view.tsx`, `hooks/cells.ts`, `hooks/i18n.ts`. Tests (QA):
    `tests/tasktable.test.ts`.
  - Meets: AC14, AC15, AC16, AC19. Variant A as built in `hooks/proto/tasks-a.tsx` (reference, do not import it),
    with the spec's "Notes for the real build": the working spinner is a Raster drawn in `sidebarRasters` so the
    125 ms tick animates it; names shortened as the sidebar does; the table's glyphs added to the safe set in
    `hooks/cells.ts`; every string in `en` and `th`. Shown in place of the Tasks section when a list exists; no list
    looks exactly as today.
  - Done: tests pass at widths 40, 60 and 100 with Thai titles; `tests/sidebar.test.ts` unchanged and passing.
  - Depends on: 1, 2, 5. Parallel with 7.

- [x] 7. **Live page tasks panel** - owner: senior-dev
  - Files: `hooks/live.ts`, `web/tasks.js` (new), `web/live.js`, `web/livemap.js`, `web/i18n.js`, `web/space.css`.
    Tests (QA): `web/tasks.test.mjs`, `tests/live-tasks.test.ts`.
  - Meets: AC11, AC17, AC18, AC19. Snapshot `taskList` field; panel as in `web/proto/tasks-a.js` (reference), a real
    `<button>` per row title for expand (click and Enter), loading, empty, error and offline states, footnote, every
    string in `en` and `th`, all text as text, spinner off under `prefers-reduced-motion`, no sideways scroll at
    375 px.
  - Done: tests pass; `node --test web/*.test.mjs` passes; checked in a browser by QA at 1280 and 375.
  - Depends on: 1, 2, 5. Parallel with 6.

- [x] 8. **Feature skill and docs** - owner: senior-dev
  - Files: `skills/feature/SKILL.md`, `README.md`, `CHANGELOG.md`. Tests: the existing skill tests.
  - Meets: project rules. Phase 4's gate calls `hq_plan` after approval; phase 5's `hq_assign` and `hq_review` pass
    `plan_task`; the README says what the table shows and that the cost is an estimate; a `## Unreleased` changelog
    entry in its style.
  - Done: skill tests pass.
  - Depends on: 4.

- [ ] 9. **Full test run and browser check** - owner: qa
  - Files: none changed.
  - Meets: all ACs. `claude plugin test .`, `node --test web/*.test.mjs`, `claude plugin validate .`; a real session
    with the mod from the repo (`claude --plugin-dir /Users/freshyboyz/agent-hq`), an approved test plan, one member
    through working, review and done; the sidebar and the live page at 1280 and 375 compared with variant A.
  - Done: every check green, every AC walked, differences listed.
  - Depends on: 1-8.

The prototype files (`hooks/proto/`, `web/proto/`, `tests/proto-*.test.ts`, the `ProtoTable` and `proto` wiring) stay
until phase 6, which compares the build with them and then removes them.

## Order and parallel runs

- Wave 1: 1, 2, 3 in parallel (no shared files).
- Wave 2: 4, then 5 (5 owns `register.tsx`).
- Wave 3: 6 and 7 in parallel (no shared files), and 8.
- Wave 4: 9.

At most 3 members build at once, plus QA writing tests ahead of them.

## Review checklist (every task)

- The spec's states for the screens it touches; `en` and `th` strings; no file over 800 lines; `graphify explain`
  before changing a symbol; immutable updates; untrusted titles masked and shown as text; no new dependency.

## Rollout

- No feature flag: nothing changes until `hq_plan` is called (AC19 covers the "no list" look).
- No migration: `tasks.json` is new, `version: 1`; an unknown version is ignored.
- Rollback: revert the feature's commits; delete `.claude/agent-hq/tasks.json` in a project to clear a list.
- No version bump (only when the person asks to publish).

## Follow-ups (not in this build)

- `hooks/view.tsx` is over the 800-line ceiling (831 with the table wiring, 809 before): split the tree and band
  drawing into their own modules (reviewer-1).
- A working task's spinner shows a still frame while no agent is working (frames run only with live agents);
  acceptable, say so in the README if people ask (reviewer-1).
- Plan-file guard (AC21) does not catch a glob over the plan's name (`rm docs/plans/task-*.md`); reuse the glob
  branch of `namesAgentFile` (reviewer-1, minor).
- Plan-file guard allows a proper suffix of the plan path after an earlier `cd` (`plans/task-sidebar.md` after
  `cd docs`); match a suffix in either direction (reviewer-1, minor).
- The reviewer role cannot write its report file (no Write tool): a team setup change via `/agent-hq:team`.
