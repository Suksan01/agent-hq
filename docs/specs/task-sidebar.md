# Task sidebar

Status: brainstorm (approved)

## Request

> when the plan and task is approved i want to shown all the task in a sidebar with status and who is working on and
> whos done it. and also shown how many min it took, and task cost.

UI, in the person's words: "make it as table should look better with a checkmakr when done and current working animated".

## Direction (chosen): plan + task number

- When a plan passes its gate in `/agent-hq:feature`, the checklist in `docs/plans/<feature>.md` becomes a saved task
  list; every task starts as waiting.
- `hq_assign` and `hq_review` take a `task` number that links the member's work to a task.
- Each `turn.complete` adds that member's working time and tokens to the task it is linked to.
- Status moves waiting → working → review → done; done records who finished it.

Rejected: a lead-run `hq_task` tool (accuracy depends on the lead), extending the engine's built-in task board (no
member link, not kept across sessions).

## Answers

- **Where**: both. A compact table in the terminal sidebar; the full detail on the live web page.
- **Which tasks**: the approved plan's tasks plus the assignments linked to them; waiting tasks are listed too.
- **Cost**: estimated dollars plus tokens, marked `≈`, from tokens × the model's list price in one price table file.
  On a subscription it reads as API-equivalent cost, not the bill. (Today `hooks/usage.ts` has no cost on purpose;
  this feature adds the estimate, labelled as one.)
- **Counting**: everyone's work on the task (QA, developer, reviewer, every fix round), working time only (waiting
  between turns left out), with a per-person breakdown on the live page.
- **Lifetime**: saved in the project, reloaded in a new session, a total row, kept until the next plan is approved.

## UI

- **Terminal sidebar**: a table. Columns: status, #, task, who, min, ≈ $. A ✓ when done, an animated spinner on the
  task being worked, ◑ in review, ○ waiting. Long titles cut with `…`. A total row (done/total, minutes, ≈ $).

```
   #  Task          Who     Min  ≈ $
 ✓ 1  Data model    dev-1    12  0.42
 ⠹ 2  Sidebar list  dev-2     5  0.21
 ◑ 3  Live panel    rev-1     2  0.08
 ○ 4  Tests         —         —     —
 ─────────────────────────────────────
   Total 2/4                 19  0.71
```

- **Live page**: the same table with more room, ✓ and the animated spinner; a click on a row opens its per-person
  breakdown (role, step, minutes, ≈ $) and a short timeline (started, fix rounds, done).

## Out of scope

Editing tasks from the UI, budgets or cost alerts, history across features.

## Notes

- Built on `fix/run-findings` (11 commits not yet on `main` that touch `hooks/assign.ts` and `hooks/tools.ts`), so
  the feature lands after that fix.
