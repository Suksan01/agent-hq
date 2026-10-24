# Task sidebar

Status: spec (draft)

## Request

> when the plan and task is approved i want to shown all the task in a sidebar with status and who is working on and
> whos done it. and also shown how many min it took, and task cost.

UI, in the person's words: "make it as table should look better with a checkmakr when done and current working animated".

## Goal and who it is for

The person running a feature with the team sees, at a glance, every task of the approved plan: its status, who is on it
now, who finished it, how many working minutes it took and roughly what it cost. The lead uses the same list to see
what is left.

## Direction (chosen in the brainstorm): plan + task number

- When a plan passes its gate in `/agent-hq:feature`, the checklist in `docs/plans/<feature>.md` becomes a saved task
  list; every task starts as waiting.
- `hq_assign` and `hq_review` take a plan task number that links the member's work to a task.
- Each `turn.complete` adds that member's working time and tokens to the task it is linked to.
- Status moves waiting → working → review → done; done records who finished it.

Rejected: a lead-run `hq_task` tool (accuracy depends on the lead), extending the engine's built-in task board (no
member link, not kept across sessions).

## Brainstorm answers

- **Where**: both. A compact table in the terminal sidebar; the full detail on the live web page.
- **Which tasks**: the approved plan's tasks plus the assignments linked to them; waiting tasks are listed too.
- **Cost**: estimated dollars plus tokens, marked `≈`, from tokens × the model's list price in one price table.
  On a subscription it reads as API-equivalent cost, not the bill.
- **Counting**: everyone's work on the task (QA, developer, reviewer, every fix round), working time only (waiting
  between turns left out), with a per-person breakdown on the live page.
- **Lifetime**: saved in the project, reloaded in a new session, a total row, kept until the next plan is approved.

## User flows

### F1. Plan approved → list appears
1. The person passes the plan gate in `/agent-hq:feature`.
2. The lead calls the new tool `hq_plan` with the plan's path (`docs/plans/<feature>.md`).
3. `hq_plan` reads the plan's checklist lines (`- [ ] 3. Title …` / `- [x] 3. …`) and saves the task list to
   `.claude/agent-hq/tasks.json`, replacing any earlier list (the brainstorm's "kept until the next plan is approved").
4. The sidebar and the live page show every task as waiting (○), or done (✓) when its box is already ticked.

### F2. A member starts on a task
1. The lead calls `hq_assign` with `plan_task: 3` (QA writing failing tests, or the developer building it).
2. Task 3 shows working, with an animated spinner and the member's name in Who.
3. Every turn that member finishes adds its working time and tokens to task 3, under that member.
4. A member reused with SendMessage (a fix round) stays linked to the task it was assigned to.

### F3. Review
1. The lead calls `hq_review` for a member linked to task 3.
2. Task 3 shows review (◑), Who shows the reviewer; the reviewer's turns count on task 3. A reviewer already running
   and messaged for another task moves its link to the new task from then on.
3. Changes requested → the member's next turns count on task 3 again and the status returns to working.

### F4. Done
1. The lead ticks the task in the plan (`- [x] 3.`), as the feature skill already says.
2. On its next read of the plan (after any write to it, and on `hq_plan`), the task shows ✓ with "done by" the last
   member linked to it who is not the review role or the QA role (the builder); when there is none, the last member
   linked.
3. The task's minutes and cost stop growing unless a member linked to it works again.

### F5. New session
1. The person opens a new session in the same project.
2. The sidebar and live page show the saved list from `tasks.json`, with every total kept. Members of the old session
   show by their saved names; nobody shows as working until a new turn says so.

### F6. Re-plan
1. The plan changes after approval and the lead calls `hq_plan` again.
2. Tasks keep their usage by number; a task whose number disappeared is dropped from the list (its usage is still in
   the total row, as "removed tasks"); new numbers start waiting.

## Screens

### Terminal sidebar (`hooks/view.tsx`)

A table under the team, in place of the single Tasks track when a plan list exists:

```
   #  Task          Who     Min  ≈ $
 ✓ 1  Data model    dev-1    12  0.42
 ⠹ 2  Sidebar list  dev-2     5  0.21
 ◑ 3  Live panel    rev-1     2  0.08
 ○ 4  Tests         —         —     —
 ─────────────────────────────────────
   Total 2/4                 19  0.71
```

- Status glyphs: ✓ done, an animated spinner on working (the sidebar's existing animation tick, no new timer), ◑
  review, ○ waiting.
- Who: the member on it now; for a done task, who finished it. Names shortened the way the sidebar shortens them now.
- Min: working minutes, rounded; under 1 minute shows `<1`. ≈ $: two decimals; `—` when nothing is counted yet.
- Columns fit the sidebar's width: the Task column shrinks first (cut with `…`, wide Thai text measured by display
  width), then Who; Min and ≈ $ are never cut.
- More tasks than fit: working and review rows first, then waiting, then done, with a `+N more` line; the total row
  always shows.

### Live page (`web/`)

- A Tasks panel: the same table with full titles and names, the same ✓ and an animated spinner (CSS, stopped under
  `prefers-reduced-motion`).
- A click (or Enter on the focused row) opens the row: one line per member (name, role, step: tests / build / review /
  fix, minutes, tokens, ≈ $) and a short timeline (first started, each review, done).
- A footnote under the total: "≈ estimate from list prices, not your bill".

### States (both screens)

- **No list** (no plan approved yet): sidebar shows today's Tasks track as it does now; the live page panel is hidden.
- **Empty list** (plan has no checklist lines): `hq_plan` refuses with the reason and the line format it reads; nothing
  saved.
- **Loading**: the live page shows the panel's header with "Loading tasks…" until the first snapshot.
- **Error**: `tasks.json` unreadable or invalid → the list is not shown, the lead's debug log says why, and the next
  `hq_plan` rewrites it. Never a crash, never a half-drawn table.
- **Offline** (live page lost its connection): the table stays as last seen, under the live page's existing offline
  notice; spinners stop.
- **Unknown model price**: tokens show, ≈ $ shows `—` for that member, and the total is marked partial (`≈ 0.71+`).
- **Partial**: a task with usage but no member left on it (members gone after a new session) still shows its totals.

## Data

### New: `.claude/agent-hq/tasks.json` (in the project)

```json
{
  "version": 1,
  "plan": "docs/plans/task-sidebar.md",
  "approvedAt": 1761300000000,
  "tasks": [
    {
      "n": 3, "title": "Live panel", "status": "review", "doneBy": null,
      "startedAt": 1761300100000, "doneAt": null,
      "work": { "senior-dev-2": { "role": "senior-dev", "step": "build", "workMs": 300000, "inputTokens": 0,
                "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "model": "claude-sonnet-5-5" } },
      "events": [{ "at": 1761300100000, "kind": "start", "who": "senior-dev-2" }]
    }
  ],
  "removed": { "workMs": 0, "costUsd": 0 }
}
```

- Keyed by member name (the team's names, stable within a session), not the engine's agent id.
- Written by the lead's hooks only. The guard treats it like `team.json`: no member may change it.
- Titles come from the plan file and are untrusted text: cut to a fixed length, masked for secrets like other shown
  text, and escaped on the live page.
- Atomic write (temp file + rename) so a crash never leaves half a file.
- `.claude/agent-hq/` is the team's scratch, already outside git for reports; `tasks.json` is not committed.

### New: price table (`hooks/prices.ts`)

- One list: model id prefix → USD per million tokens for input, output, cache read and cache write, with the date the
  prices were taken from Anthropic's pricing page. Taken with the `claude-api` skill, never from memory.
- Cost = Σ tokens × price per kind. A model not in the table counts no cost (see "Unknown model price").

### Changed

- `hooks/usage.ts`: keep `cachedTokens` as it is for what reads it today; the task record keeps cache read and cache
  write apart (prices differ), read from the same `turn.complete` fields. The header comment's "no cost figure" line
  is updated to point to the estimate.
- `hq_assign` and `hq_review` (`hooks/tools.ts`): a new optional `plan_task` (integer). `task` already means the brief
  text, so the number is `plan_task`. Without it they behave exactly as today. A number not in the list is refused
  with the list's numbers.
- `hq_review` with no `plan_task` uses the reviewed member's linked task.
- New tool `hq_plan` (`{ plan: string }`): reads the plan, saves the list, answers with the count. A path outside the
  project or not a `.md` file is refused.
- `skills/feature/SKILL.md`: phase 4's gate calls `hq_plan`; phase 5's hq_assign and hq_review pass `plan_task`.
- Live snapshot (`hooks/live.ts`): a `tasks` field; the web page reads it.

### Must not break

- The current Tasks track, the board tasks `linkBoardTask` creates, `usage` per agent and the cards that show it.
- Sessions with no team, no plan, or an older `tasks.json` version (an unknown `version` is ignored, not migrated).

## Acceptance criteria

- **AC1** Given a plan with checklist lines `- [ ] 1. A`, `- [x] 2. B`, `- [ ] 3. C`, when the lead calls `hq_plan`
  with its path, then `tasks.json` holds tasks 1–3 with statuses waiting, done, waiting and the answer says 3 tasks.
- **AC2** Given a plan with no checklist lines, when the lead calls `hq_plan`, then it is refused with the line format
  it reads and `tasks.json` is unchanged.
- **AC3** Given an earlier list, when `hq_plan` is called with a new plan, then the list is replaced; tasks with the
  same number keep their work; dropped tasks' time and cost move to `removed`.
- **AC4** Given a list, when the lead calls `hq_assign` with `plan_task: 2`, then task 2 is working with that member
  in Who and a `start` event.
- **AC5** Given `hq_assign` with `plan_task: 9` and no task 9, then the call is refused, naming the task numbers, and
  no member starts.
- **AC6** Given a member linked to task 2, when one of its turns completes with 60 000 ms and token counts, then task
  2's work for that member grows by exactly those numbers; the lead's own turns count on no task.
- **AC7** Given a member linked to task 2, when `hq_review` is called for it, then task 2 is review, the reviewer is
  linked to task 2 and its turns count there.
- **AC8** Given task 2 in review, when the reviewed member works again, then task 2 is working again.
- **AC9** Given task 2 with QA, developer and reviewer work, when the plan line becomes `- [x] 2.`, then task 2 is
  done, `doneBy` is the developer and `doneAt` is set.
- **AC10** Given usage with a known model, the cost is tokens × the table's prices to the cent; given an unknown model,
  that member's cost is `—` and the total shows `+`.
- **AC11** Given a saved `tasks.json`, when a new session starts in that project, then the sidebar and live page show
  the same tasks and totals with no task working.
- **AC12** Given an unreadable or invalid `tasks.json`, then no list is shown, nothing throws, and the debug log has
  the reason.
- **AC13** Given a member, when it writes or deletes `tasks.json` (Write, Edit or a shell command), then the guard
  refuses it.
- **AC14** Given a working task, the sidebar row shows a spinner frame that changes with the existing animation tick;
  a done row shows ✓, review ◑, waiting ○.
- **AC15** Given sidebar widths 40, 60 and 100 columns and Thai titles, then no row is wider than the sidebar, Min and
  ≈ $ are whole, and the Task column is cut with `…`.
- **AC16** Given more tasks than fit, then working and review rows show first, a `+N more` line follows and the total
  row always shows.
- **AC17** Given the live page, when a row is clicked or Enter pressed on it, then its per-member breakdown and
  timeline open; a title holding `<script>` shows as text.
- **AC18** Given `prefers-reduced-motion`, then the live page spinner does not animate.
- **AC19** Given no `tasks.json`, then the sidebar and live page look exactly as they do today.
- **AC20** Given `hq_assign` or `hq_review` without `plan_task` and no list, they behave as today (existing tests
  pass unchanged).

## Project rules

- **Every shown string in `en` and `th`** (`hooks/i18n.ts`, `web/i18n.js`): checked by `tests/i18n.test.ts` and
  `web/i18n.test.mjs`, and on the review checklist.
- **Tests pass before each commit**: the pre-commit hook runs `claude plugin test .`; nobody commits with
  `--no-verify`.
- **Team templates keep their lead on opus**: `scripts/check-templates.mjs` (pre-commit); this feature changes no
  template.
- **Changelog**: an entry under `## Unreleased` in `CHANGELOG.md`, in its style (bold lead sentence, then detail).
- **No version bump**: only when the person asks to publish.
- **Code style**: match the surrounding code (short why-comments, small functions, immutable updates as in
  `addTurn`); files stay under 800 lines, so the table goes in its own module, not into `view.tsx` (already large).
- **Code graph**: run `graphify explain` before changing a symbol; on the review checklist.

## Risks

- **No real money, auth or personal data.** The cost is a labelled estimate. No risk review by the money audit is
  needed.
- **Untrusted text on the live page**: plan titles and member names are escaped (AC17). Security pass by the review
  role on the web panel and on `hq_plan`'s path handling (inside the project only, `.md` only).
- **Guard**: members must not write `tasks.json` (AC13), or a member could fake its own task's status.
- **Price drift**: list prices change; the table carries its date and the footnote says it is an estimate.

## Out of scope

Editing tasks from the UI, budgets or cost alerts, history across features, cost for the lead's own turns.

## Open questions

None open. Decided by the lead while writing the spec (the person may change any at the gate):
- The list is created by an explicit `hq_plan` call at the plan gate, not by watching the plan file's `Status:` line.
- Done comes from the plan's ticked box, so the plan stays the one source of truth.
- "Done by" is the builder: the last linked member who is neither the review nor the QA role.

## Notes

- Built on `fix/run-findings` (11 commits not yet on `main` that touch `hooks/assign.ts` and `hooks/tools.ts`), so
  the feature lands after that fix.
