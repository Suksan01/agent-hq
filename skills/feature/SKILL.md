---
name: feature
description: Build a big feature with the Agent HQ team in six phases - brainstorm, spec, parallel UI prototype variants, implementation plan, subagent-driven build and finish - with an approval gate after each phase that only the person can pass. Use when the person asks the team to build or implement a large or multi-part feature, or runs /agent-hq:feature.
---

# Build a feature with the team

You are the team's lead (the main session). A big feature goes through six phases. Each phase ends at a **gate**: you
show the person what the phase produced and ask with AskUserQuestion whether to go on. The next phase starts only on
their yes; a "change it" answer repeats the phase with their notes. Never skip a gate because the answer seems obvious,
and never push or merge: the person does that after phase 6.

Keep every question short, use AskUserQuestion for choices (a `preview` on every option, plain text in a monospace box,
at most about 40 columns wide and 14 lines tall, drawn with `├─ └─ │ ●`, no Markdown tables, no emoji; `header` at
most 12 characters; the recommended option first with "(Recommended)" in its label), and wait for the answer. Say which
phase you are in at the start of each one ("Phase 3 of 6: prototypes").

## Before you start

- **Name the feature**: a short kebab-case slug (`booking-cancellation`). The spec and plan files use it.
- **Resume, don't restart**: if `docs/specs/<feature>.md` already exists, read its `Status:` line and carry on from the
  phase it names, after telling the person where you are picking up.
- **Map the phases to the team**: read the "Members" section of your system prompt. The writer of the spec and the plan
  is the Team Assistant when the team has one, else you. Prototypes need a frontend or UI role. Review needs a review
  role, tests need a QA or test role. Where a role is missing, say in the plan who does it instead (usually you), or
  offer to add one with hq_hire.
- **Small work skips this skill**: a change one member can finish in one assignment goes straight to hq_assign.

## 1. Brainstorm

Understand the feature before anyone writes it down.

- Read what the project already has near the feature: `CLAUDE.md`/`AGENTS.md`, the team notes, the code and routes it
  touches, and anything the person pointed to.
- Ask the person questions **one at a time**, multiple choice where you can: who it is for, the main flow, what is out
  of scope, hard constraints (money, privacy, performance, deadlines). Stop when you could explain the feature back.
- Propose 2 or 3 approaches with their trade-offs and your recommendation.

**Gate:** AskUserQuestion, header "Direction": the approaches as options, each preview a 3-line sketch of the flow, your
pick first. The next phase starts once the person has chosen one.

## 2. Spec

The Team Assistant (or you) writes `docs/specs/<feature>.md`:

- `Status: spec` on the first line under the title (each phase updates it: `prototype`, `plan`, `build`, `finish`,
  `done`).
- Goal and who it is for, in the person's own words where they gave them.
- User flows, step by step, and every screen or endpoint they touch.
- Data: what is stored or changed, and what existing data it must not break.
- Edge cases and failure states (empty, loading, error, offline, permission denied, partial success).
- Out of scope, and open questions still waiting on the person.
- How it will be proven: the tests and checks that mean "done".

Brief the writer with hq_assign (`files: ["docs/specs/<feature>.md"]`), giving it everything from phase 1: it sees none
of this conversation. Read the spec yourself before showing it.

**Gate:** AskUserQuestion, header "Spec": "Approve" (Recommended), "Change it" (the person says what in "Other"),
"Stop". Preview the spec's headings with one line each. The next phase starts on "Approve".

## 3. Prototype variants

Skip this phase when the feature has no user interface (an API, a job, a migration): say so, set `Status: plan` and go
to phase 4. Otherwise, show the person a few real, clickable directions before anyone builds the real thing.

- Choose 2 or 3 variants that differ in a way that matters (layout, flow, density, where the action lives), never in
  colour alone. Write one line per variant.
- Brief one frontend member per variant with hq_assign, **in parallel**: each builds **one variant** only, from the
  approved spec, with mock data and no backend changes, on a **throwaway** route or page of its own
  (`<app>/_prototype/<feature>/<variant>/**` or the project's equivalent). Give each `files` limited to its own variant
  folder, `done` as "the route renders every screen of the main flow, and the report gives its URL and a screenshot or
  a short description of each screen", and `limits` as "no backend, no shared components, no real data".
- With fewer frontend members than variants, run them one after another, or offer hq_hire.
- When they report, check each route renders, then line them up for the person: what each does differently, and where
  to open it.

**Gate:** AskUserQuestion, header "Variant": one option per variant (your pick first, with why), plus "Mix them"
(the person says which parts in "Other") and "Try again". The next phase starts once a direction is picked. Write the
choice and what to keep from the others into the spec. Prototype code is a reference, never merged as it is.

## 4. Plan the build

The Team Assistant (or you) writes `docs/plans/<feature>.md` from the approved spec and the chosen variant:

- Tasks small enough that one member finishes each in one assignment, numbered, as a checklist (`- [ ] 3. ...`).
- For each task: the owner role, the files it may change, what "done" means, the tests it adds or must pass, and the
  tasks it depends on.
- Order: what others depend on first (data and API before the screens that use them).
- Mark which tasks can run in parallel: no dependency between them and no file they both change.
- The last tasks are always: remove the prototype routes, and the full test run.

**Gate:** AskUserQuestion, header "Plan": "Approve" (Recommended), "Change it", "Stop". Preview the task list with owners.
The next phase starts on "Approve".

## 5. Build, one task at a time

Run the plan task by task, with a review after every task before the next one that depends on it starts.

For each task that is ready (its dependencies done):

1. **Assign** with hq_assign: the task from `docs/plans/<feature>.md` word for word, plus pointers to the spec and the
   plan, the `files` from the plan, its `done`, and `limits` (the rest of the code, and never push or merge). Start
   independent tasks in parallel; never two members on the same files.
2. **Review** when it reports: hq_review to the review role, with `focus` on the spec's edge cases for this task. Have
   the QA role run the tests the task names. Do not accept the task until both pass.
3. **Fix**: findings go back to the same member with SendMessage, or a new hq_assign with the findings, then review
   again.
4. **Tick** it in the plan (`- [x]`) and give the person one line: the task, who did it, the review result.

If the build shows the spec or the plan is wrong (a missing case, a task bigger than planned), stop starting new tasks
and ask the person with AskUserQuestion, header "Re-plan", before changing either file.

**Gate:** when every task is ticked, AskUserQuestion, header "Build": "Finish up" (Recommended), "Change something",
listing what was built and the review results in the preview. The next phase starts on "Finish up".

## 6. Finish

- Have the QA role run the full unit and end-to-end suites, and the review role read the whole diff against the spec.
- Confirm the prototype routes are gone and nothing from them was left behind.
- Set `Status: done` in the spec.
- Give the person the closing report: what was built and by whom, who reviewed each part, the test results, anything
  deferred or still open, and the files changed. Offer to commit; never push or merge: that is theirs to do.
