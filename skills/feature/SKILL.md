---
name: feature
description: Build a big feature with the Agent HQ team in six phases - brainstorm, spec, parallel UI prototype variants on a canvas, implementation plan, subagent-driven build and finish - with an approval gate after each phase that only the person can pass. Use whenever the person asks the team to build, design or implement a feature that spans several files, screens or members (a new flow, page, API with its UI, or "plan and build X with the team"), even without saying "feature", or runs /agent-hq:feature. Not for a change one member can finish in one assignment: that goes straight to hq_assign.
---

# Build a feature with the team

You are the team's lead (the main session). A big feature goes through six phases. Each phase ends at a **gate**: you
show the person what the phase produced and ask with AskUserQuestion whether to go on. The next phase starts only on
their yes; a "change it" answer repeats the phase with their notes. Never skip a gate because the answer seems obvious.
The spec's `Status:` line records where the feature is: `<phase> (draft)` while a phase is being worked on, and
`<phase> (approved)` once its gate passes, committed on the feature branch each time.
Members never push or merge, and you push, merge or open a pull request only on the person's explicit yes.

**Language:** speak, ask and write the files the person reads in the language Agent HQ's language section names (English when there is none); keep code, commands, paths, JSON keys and commit messages English.
Here the spec and the plan are written in that language; the feature slug, branch names, code, tests, commit messages,
and the spec's `Status:` and `Skipped:` words, phase names and `AC` ids stay English, so a resume can read them.

Keep every question short, use AskUserQuestion for choices (a `preview` on every option, plain text in a monospace box,
at most about 40 columns wide and 14 lines tall, drawn with `├─ └─ │ ●`, no Markdown tables, no emoji; `header` at
most 12 columns; the recommended option first with "(Recommended)" in its label), and wait for the answer. These limits
count display columns: a Thai vowel or tone mark above or below a letter takes none. Keep Thai labels short. Say which
phase you are in at the start of each one ("Phase 3 of 6: prototypes").

## Before you start

- **Name the feature**: a short kebab-case slug (`booking-cancellation`). The spec and plan files use it.
- **Find the spec and plan folders**: use the project's own (such as `docs/superpowers/specs/`), and `docs/specs/` and
  `docs/plans/` only when it has none. Below, `docs/specs/<feature>.md` and `docs/plans/<feature>.md` mean the files in
  the folders you chose. The Team Assistant's guard usually allows only `docs/specs/**` and `docs/plans/**`: with other
  folders, write the spec and plan yourself, or offer `/agent-hq:team` to set its guard paths and rule to them.
- **Resume, don't restart**: if `docs/specs/<feature>.md` already exists, read its `Status:` line and tell the person
  where you are picking up: at `<phase> (draft)`, finish that phase's work and hold its gate again; at
  `<phase> (approved)`, start the next phase.
- **Work on a feature branch**: create `feature/<feature>` from the base branch (or the project's own branch naming)
  before anything is written, unless the person is already on a branch for it. Every commit in this skill lands there.
- **Map the phases to the team**: read the "Members" section of your system prompt. The writer of the spec and the plan
  is the Team Assistant when the team has one, else you. Prototypes need a frontend or UI role. Review needs a review
  role, tests need a QA or test role. Where a role is missing, say in the plan who does it instead (usually you), or
  offer to add one with hq_hire.
- **Every brief**, when the plan-progress mod is installed, tells the member to close its own plan-progress bars when it
  finishes: a bar left open makes the Stop hook nag you.
- **Skip a phase on purpose**: the person may skip any phase ("no prototype", "spec only, I will plan it myself"). Say
  what the skip costs in one line, then add `Skipped: <phase> (<their reason>)` under the spec's `Status:` line and go
  on. A feature with no user interface skips phase 3 by itself.
- **Share at any gate**: when the person wants someone else to review a phase, share the spec, the plan or the canvas as
  a page they can send on: with `superset:page` in Superset (comments, versions), else as an Artifact when the session
  can, else give the file path or the canvas URL.
- **Small work skips this skill**: a change one member can finish in one assignment goes straight to hq_assign.

## 1. Brainstorm

Understand the feature before anyone writes it down.

- Read what the project already has near the feature: `CLAUDE.md`/`AGENTS.md`, the team notes, the code and routes it
  touches, and anything the person pointed to.
- Ask the person questions **one at a time**, multiple choice where you can: who it is for, the main flow, what is out
  of scope, hard constraints (money, privacy, performance, deadlines). Stop when you could explain the feature back.
- Propose 2 or 3 approaches with their trade-offs and your recommendation.

**Gate:** AskUserQuestion, header "Direction": the approaches as options, each preview a 3-line sketch of the flow, your
pick first. The next phase starts once the person has chosen one. Then save the brainstorm so it survives a restart:
create `docs/specs/<feature>.md` with the feature's title, `Status: brainstorm (approved)`, the chosen direction and
the person's answers, and commit it.

## 2. Spec

The Team Assistant (or you) writes `docs/specs/<feature>.md`:

- `Status: spec (draft)` on the first line under the title, and any `Skipped:` lines under it; the brainstorm's
  direction and answers stay in it.
- Goal and who it is for, in the person's own words where they gave them.
- User flows, step by step, and every screen or endpoint they touch.
- Data: what is stored or changed, and what existing data it must not break.
- Every state of every screen: loading, empty, error, offline, permission denied and partial success, not only the
  happy path.
- **Acceptance criteria**, numbered (`AC1`, `AC2`, ...), each written as Given/When/Then so a test can be written from
  it before the code.
- **Project rules**: every rule in `CLAUDE.md`/`AGENTS.md` and the project's other rules files that applies to this
  feature (for example translations in every locale, no hardcoded currency, a change note per app, the build command
  the deploy runs), each with how it will be checked.
- **Risks**: when the feature touches auth, money or personal data, say where, and add a required risk review: a
  security review by the review role (with a security review skill where one is installed) and, for money, the
  project's own audit skill (such as `money-path-audit`) run on the spec now and on the finished diff in phase 6.
- Out of scope, and open questions still waiting on the person.

Brief the writer with hq_assign (`files: ["docs/specs/<feature>.md"]`): it sees none of this conversation, so point it to
the spec file (phase 1 saved the direction and answers there) and add only what is in no file. Read the spec yourself before showing it. When it has Risks, have the risk review done before the
gate and show its findings with the spec.

**Gate:** AskUserQuestion, header "Spec": "Approve" (Recommended), "Change it" (the person says what in "Other"),
"Stop". Preview the spec's headings with one line each, and the risk review's result when there is one. The next phase
starts on "Approve": set `Status: spec (approved)` and commit the spec on the feature branch.

## 3. Prototype variants

Skip this phase when the feature has no user interface (an API, a job, a migration): say so, set
`Status: prototype (approved)` with a `Skipped:` line, and go to phase 4. Otherwise, set `Status: prototype (draft)` and
show the person a few real, clickable directions before anyone builds the real thing.

In short: 2 or 3 ranked variants that differ in UI and UX, built in parallel (one frontend member each) on the
Design canvas (default) or in the app with HeroUI (opt-in), checked by the review role against the spec, then shown to
the person.

Read `references/prototypes.md` (next to this file) now, before this phase's first question, and follow it: what to ask
first, how to choose and rank the variants, both build paths with their briefs, the canvas, and the review.

**Gate:** AskUserQuestion, header "Variant" (it takes at most 4 options): one option per variant in the same order as
the canvas, the Recommended one first with "(Recommended)" in its label and why in its description, plus
"Mix or try again", where the person says which parts to mix (or pastes the in-app canvas's copied connections) or what
to try instead. When the boards were not checked, say so in the question. On the in-app path, when the project has its
own UI library, also ask header "Build with": port the chosen variant to the project's own UI library (Recommended:
what ships matches the rest of the app) or adopt HeroUI for this feature. The next phase starts once these are
answered: set `Status: prototype (approved)`. Write the choice (for a mix, the parts or connections that make it up),
the canvas link and the library into the spec. Prototypes, the canvas included, are a reference, never merged as they
are.

## 4. Plan the build

Set `Status: plan (draft)`. The Team Assistant (or you) writes `docs/plans/<feature>.md` from the approved spec and the
chosen variant:

- Tasks small enough that one member finishes each in one assignment, numbered, as a checklist (`- [ ] 3. ...`).
- For each task: the owner role, the files it may change, the acceptance criteria it meets (`AC2`), the test files QA
  writes first (separate from the developer's files), what "done" means, and the tasks it depends on.
- Order: what others depend on first (data and API before the screens that use them).
- Mark which tasks can run in parallel: no dependency between them and no file they both change.
- **Project rules**: each project rule from the spec becomes a task (a change note, a translation in every locale) or a
  line on the review checklist, named in the plan.
- **Rollout**: whether it ships behind a feature flag (and its name), or why not; each migration, in order, backward
  compatible with the running code, never editing one already applied; and how to roll back each step.
- **Docs**: the docs, README, changelogs and change notes the project keeps, as tasks of their own.
- The last task is always the full test run. The prototypes stay until phase 6, which compares the build against them.

**Gate:** AskUserQuestion, header "Plan": "Approve" (Recommended), "Change it", "Stop". Preview the task list with
owners, and an estimate: how many tasks, how many agents at once at most, and roughly how long. For a large build (more
than about 10 tasks or 4 agents at once) say so plainly in the question. The next phase starts on "Approve": set `Status: plan (approved)` and
commit the plan on the feature branch.

## 5. Build, one task at a time

Set `Status: build (draft)`. Run the plan task by task, with a review after every task before the next one that
depends on it starts.

For each task that is ready (its dependencies done):

1. **Test first**: the QA role writes the failing tests for the task's acceptance criteria in the task's test files
   (an hq_assign with those test files as its `files`; the developer does it, in the same assignment, when the team has
   no QA role) and shows they fail for the right reason. Commit them on the feature branch
   (`test: failing tests for task 3`) before step 2, so the developer starts from them.
2. **Assign** with hq_assign: the task's title and "task <n> in `docs/plans/<feature>.md`; read that task, not the
   whole plan", plus pointers to the spec sections it meets and the failing tests (never paste the plan or earlier
   members' replies), the `files` from the plan, its `done`, and `limits` (the rest of the code, and never push or
   merge). A screen task covers its loading, empty, error and partial states from the spec, not only the happy path.
   When the person adopted HeroUI, a UI task's brief has the member load `heroui-react` and look up every component
   with the HeroUI MCP (`get_component_docs`) before it uses it; otherwise the brief names the project's own library's
   components.
3. **Keep parallel members apart**: hq_assign starts every member in this checkout (it has no worktree option), so run
   tasks in parallel only when they share no files, touch no lockfile or shared config, and need no dev server or test
   run of their own at the same time; run the rest one after another. Never two members on the same files.
4. **Review** as soon as it reports `DONE` or `DONE_WITH_CONCERNS`, before anyone else's work lands; its reply is a
   short status block, and its report file has the detail when you need it. On `BLOCKED` or `NEEDS_CONTEXT`, answer
   it with SendMessage (the missing context or a ruling) or split the task instead. First run `git status`: every accepted task and
   every set of failing tests is committed, so it shows only what the members running now changed. Each file must be
   inside the `files` of the member that reported or of another member running now (Bash is not limited to them). A
   changed file inside no one's `files` cannot be traced to one member: send it as a finding to every member running,
   and keep parallel tasks few so this stays rare. Then hq_review to the review role, with `focus` on the review checklist (the project rules
   for this task and the spec's edge cases and states). Have the QA role run the task's tests. Do not accept the task
   until both pass.
5. **Fix**: findings go back to the same member with SendMessage, or a new hq_assign with the findings, then review
   again.
6. **Commit and tick**: commit the accepted task on the feature branch (one commit per task, in the project's commit
   style), tick it in the plan (`- [x]`) and give the person one line: the task, who did it, the review result.

If the build shows the spec or the plan is wrong (a missing case, a task bigger than planned), stop starting new tasks
and ask the person with AskUserQuestion, header "Re-plan", before changing either file.

**Gate:** when every task is ticked, AskUserQuestion, header "Build": "Finish up" (Recommended), "Change something",
listing what was built and the review results in the preview. The next phase starts on "Finish up": set
`Status: build (approved)`.

## 6. Finish

Set `Status: finish (draft)`, then:

- **Full checks**: the QA role runs the full unit and end-to-end suites and the build command the project's rules name;
  the review role reads the whole diff against the spec and the review checklist; any risk review from the spec runs
  again on the finished diff.
- **In a real browser**: the QA role opens the built feature (the in-app browser, with the `superset:browser` skill in Superset, or the project's end-to-end tool) at
  desktop and mobile width, walks every acceptance criterion and state, and compares it with the chosen variant (its
  boards or its prototype routes). Differences the person did not ask for go back to phase 5 as tasks.
- **Clean up** the in-app prototypes, after the browser check (the Design canvas leaves nothing in the repo): one
  hq_assign removes the prototype routes, the flow files, the canvas and the prototype setup, with `files`: the
  prototypes folders, `public/prototypes/<feature>/`, the middleware file, and, unless the person chose to adopt
  HeroUI, the prototypes stylesheet, package.json and the lockfile. Those of the middleware, package.json and the
  lockfile in its `files` go back byte for byte to before the setup task (an install can bump shared transitive dependencies), then take any
  change the build made to them. Nothing else is left behind.
- Set `Status: done` in the spec and commit.
- Give the person the closing report: what was built and by whom, who reviewed each part, the test and browser results,
  anything deferred or still open, the feature branch and its commits. Offer to push it and open a pull request, and do
  either only on their explicit yes.
- Offer `/agent-hq:retro`, so what went well or wrong in this feature becomes proposed changes to the team's rules.
