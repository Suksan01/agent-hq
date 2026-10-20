---
name: feature
description: Build a big feature with the Agent HQ team in six phases - brainstorm, spec, parallel UI prototype variants on a canvas, implementation plan, subagent-driven build and finish - with an approval gate after each phase that only the person can pass. Use when the person asks the team to build or implement a large or multi-part feature, or runs /agent-hq:feature.
---

# Build a feature with the team

You are the team's lead (the main session). A big feature goes through six phases. Each phase ends at a **gate**: you
show the person what the phase produced and ask with AskUserQuestion whether to go on. The next phase starts only on
their yes; a "change it" answer repeats the phase with their notes. Never skip a gate because the answer seems obvious.
The spec's `Status:` line records where the feature is: `<phase> (draft)` while a phase is being worked on, and
`<phase> (approved)` once its gate passes, committed on the feature branch each time.
Members never push or merge, and you push, merge or open a pull request only on the person's explicit yes.

Keep every question short, use AskUserQuestion for choices (a `preview` on every option, plain text in a monospace box,
at most about 40 columns wide and 14 lines tall, drawn with `├─ └─ │ ●`, no Markdown tables, no emoji; `header` at
most 12 characters; the recommended option first with "(Recommended)" in its label), and wait for the answer. Say which
phase you are in at the start of each one ("Phase 3 of 6: prototypes").

## Before you start

- **Name the feature**: a short kebab-case slug (`booking-cancellation`). The spec and plan files use it.
- **Resume, don't restart**: if `docs/specs/<feature>.md` already exists, read its `Status:` line and tell the person
  where you are picking up: at `<phase> (draft)`, finish that phase's work and hold its gate again; at
  `<phase> (approved)`, start the next phase.
- **Work on a feature branch**: create `feature/<feature>` from the base branch (or the project's own branch naming)
  before anything is written, unless the person is already on a branch for it. Every commit in this skill lands there.
- **Map the phases to the team**: read the "Members" section of your system prompt. The writer of the spec and the plan
  is the Team Assistant when the team has one, else you. Prototypes need a frontend or UI role. Review needs a review
  role, tests need a QA or test role. Where a role is missing, say in the plan who does it instead (usually you), or
  offer to add one with hq_hire.
- **Skip a phase on purpose**: the person may skip any phase ("no prototype", "spec only, I will plan it myself"). Say
  what the skip costs in one line, then add `Skipped: <phase> (<their reason>)` under the spec's `Status:` line and go
  on. A feature with no user interface skips phase 3 by itself.
- **Share at any gate**: when the person wants someone else to review a phase, share the spec, the plan or the canvas as
  a page they can send on: publish it as an Artifact when the session can, else give the file path or the canvas URL.
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

Brief the writer with hq_assign (`files: ["docs/specs/<feature>.md"]`), giving it everything from phase 1: it sees none
of this conversation. Read the spec yourself before showing it. When it has Risks, have the risk review done before the
gate and show its findings with the spec.

**Gate:** AskUserQuestion, header "Spec": "Approve" (Recommended), "Change it" (the person says what in "Other"),
"Stop". Preview the spec's headings with one line each, and the risk review's result when there is one. The next phase
starts on "Approve": set `Status: spec (approved)` and commit the spec on the feature branch.

## 3. Prototype variants

Skip this phase when the feature has no user interface (an API, a job, a migration): say so, set `Status: plan` and go
to phase 4 (`Status: prototype (approved)` with a `Skipped:` line). Otherwise, show the person a few real, clickable directions before anyone builds the real thing.

**Choose and rank the variants.** Pick 2 or 3 variants that differ in both UI and UX, never in colour alone:
- **visual style**: for example minimal and airy, dense and data-first, card-based, or bold and editorial;
- **UX**: the flow and where the action lives, for example one page against a step-by-step wizard, inline editing
  against a side panel, or the main action up front against behind a menu.

Give each a short name and one line: its style, its flow, and who it suits. Then **rank** them, best fit for the spec,
the project's design and the person's constraints first. The top one is the **Recommended** variant, and the rank is
the order everywhere after this: the briefs, the canvas and the gate.

**Build them with HeroUI by default.** Prototypes use HeroUI v3, so every variant draws on one complete, accessible
component set and differs by layout, flow and theme tokens (HeroUI themes through CSS variables):
- **Web**: `@heroui/react` with `@heroui/styles`. It needs React 19 or later and Tailwind CSS v4, and no provider.
- **v3 only**: never the v2 or NextUI setup (`HeroUIProvider`, `@heroui/theme`, the `heroui()` Tailwind plugin, a
  `tailwind.config` content entry); if a member's code needs one of those, it is v2 code.
- **React Native**: `heroui-native`, with its provider, following its own setup. A native screen cannot sit in an
  iframe: use the app's web build where it has one (Expo web), else each screen is a screenshot from the simulator.
- **Every UI brief calls HeroUI's own tools, never memory**: the member loads the `heroui-react` skill (`heroui-native`
  for React Native) for components, patterns and theming, and calls the HeroUI MCP server (`@heroui/react-mcp`) before it writes a component:
  `list_components` to find the right one, `get_component_docs` for its anatomy, props and examples,
  `get_theme_variables` for the tokens a variant's visual style changes, and `get_component_source_code` or
  `get_component_source_styles` when it must restyle a part. Without them, it reads `https://heroui.com/react/llms.txt`
  (`/native/llms.txt`).
- Use the project's own stack and UI library instead when the person asks for it, or when the app cannot take HeroUI
  (React older than 19, Tailwind older than v4). Use raw HTML only when the project has no frontend app yet.

**Set up the HeroUI tools.** Check that the session has the official HeroUI skill (`heroui-react` for web,
`heroui-native` for React Native) and the HeroUI MCP server (tools named `mcp__heroui-react__...`, or
`mcp__heroui-native__...`). For whichever is missing, ask the person before installing it, since it changes their
setup: the skills with `npx skills add heroui-inc/heroui` (add `HEROUI_SKILL_SCOPE=project` to the
`curl -fsSL https://heroui.com/install | bash -s heroui-react` form to keep it to this project), the MCP server with
`claude mcp add heroui-react -- npx -y @heroui/react-mcp@latest` (`@heroui/native-mcp` and the name `heroui-native` for
React Native; it needs Node 22 or later). The MCP server loads only after a restart of Claude Code: the approved spec is
already saved, so tell the person to restart and run `/agent-hq:feature` again, which resumes here. A UI role with a
tools list needs the MCP tools by full name (such as `mcp__heroui-react__get_component_docs`), which only
`/agent-hq:team` can add to an existing role; until then that member uses the `heroui-react` skill and
`https://heroui.com/react/llms.txt`, as does everyone when the person says no to the MCP server.

**First, one setup task.** One frontend member (or you) installs HeroUI if the app does not have it, at the exact
versions its quick start names, and adds a prototypes-only stylesheet (`@import "tailwindcss";` then
`@import "@heroui/styles";`) loaded by the prototypes folder's own layout, so the real app's styles do not change. It is
an hq_assign of its own, with `files`: package.json, the lockfile, the prototypes layout and its stylesheet, and `done`
as "a HeroUI `Button` renders at `/prototypes/<feature>`". It finishes before the variants and the canvas start, and it
is the only assignment that touches package.json or the lockfile; note in the spec what it added, so phase 6 can take
it out again.

**Build them in parallel.** Brief one frontend member per variant with hq_assign, **in parallel**: each builds
**one variant** only, from the approved spec and its line above, with HeroUI components and mock data and no backend
changes, on a **throwaway** route of its own (`<app>/prototypes/<feature>/<variant>/**`, in a folder the router serves:
the Next.js App Router never serves a folder whose name starts with `_`). Give each `files` limited to its own variant
folder and its flow file, `done` as "every screen of the main flow renders at desktop and mobile width on its own URL,
with its loading, empty, error and partial states, the flow file lists them, and the report gives the URLs", and
`limits` as "no backend, no shared components, no real data, no change to package.json". With fewer frontend members
than variants, run them one after another, or offer hq_hire.

Each variant also writes its flow file, `flows/<variant>.json` next to the canvas (below): its screens and how one leads
to the next. A screen has a `url`, or an `"image"` (a screenshot path) where it cannot be shown live, and a `state` when
it shows one (`"empty"`, `"error"`).

```json
{
  "variant": "wizard",
  "screens": [
    { "id": "list", "title": "My bookings", "url": "/prototypes/booking-cancellation/wizard/list" },
    { "id": "list-empty", "title": "No bookings", "state": "empty", "url": "/prototypes/booking-cancellation/wizard/list?state=empty" },
    { "id": "confirm", "title": "Confirm cancel", "url": "/prototypes/booking-cancellation/wizard/confirm" }
  ],
  "links": [{ "from": "list", "to": "confirm", "trigger": "Tap Cancel" }]
}
```

**Lay them out on a canvas.** At the same time as the variants, one more member (or you) builds the canvas with React Flow: one static
page, `index.html` in the app's public folder under `prototypes/<feature>/` (for Next.js,
`public/prototypes/<feature>/index.html`, served at `/prototypes/<feature>/index.html`, the same origin as the
variants). It loads React and `@xyflow/react@12.11.6` (or a newer exact version at least two weeks old) and its
`dist/style.css` from a CDN such as esm.sh, so nothing is installed and package.json does not change; if the project
already depends on `@xyflow/react`, it may be a route instead. Its own `files` are that folder, nothing shared. Like a
design tool's prototype canvas, it reads every `flows/*.json` and shows them all at once:
- each screen is a custom node, a labelled frame holding its URL in an iframe (or its `image`), with the classes
  `nodrag` and `nowheel` on the iframe so the person can use the screen; a variant's screens sit side by side in one
  row, in flow order with its state screens after the screen they belong to, and the rows go in rank order, so the
  Recommended variant is the top row and its first frame the leftmost, with a "Recommended" badge and one line on why;
- each row is headed by the variant's name, its style and flow line, and its main trade-off; a toggle in a `Panel`
  switches every frame between desktop and mobile width;
- every frame has a `Handle` node on its left and right edge, and every link is a connection between them: an edge with
  an arrow (`MarkerType.ArrowClosed`) labelled with its trigger; hovering a frame lights up the path through it;
- the person can drag from a frame's node to a frame in another row to add a connection across variants, sketching a
  mix ("Wizard's list, then Single page's confirm"): `onConnect` adds it with `addEdge`, drawn dashed; Backspace
  deletes a selected one, and a "Copy mix" button in a `Panel` copies the new connections as plain lines
  (`wizard/list -> single-page/confirm: Tap Cancel`);
- the person can pan the canvas (drag on empty space or scroll) and zoom it (pinch, ctrl+scroll), with `Controls` for
  zoom in, zoom out and fit view, a `MiniMap`, and a `Background` of dots; a double click on a frame opens that screen
  full size.

When the members report, check every screen URL, every flow file and the canvas render. Open the canvas for the
person in a browser when the session has one (the in-app browser or a preview), else give them its URL and how to start
the dev server.

**Gate:** AskUserQuestion, header "Variant" (it takes at most 4 options): one option per variant in the same order as
the canvas, the Recommended one first with "(Recommended)" in its label and why in its description, plus
"Mix or try again", where the person pastes the copied connections, says which parts to mix, or says what to try instead. Then, when the project has its own UI library, ask
header "Build with": port the chosen variant to the project's own UI library (Recommended: what ships matches the rest of
the app) or adopt HeroUI for this feature. The next phase starts once both are answered: set `Status: prototype (approved)`. Write the choice, for a mix
the connections that make up the chosen flow, and the library into the spec. Prototype code, the canvas included, is a
reference, never merged as it is.

## 4. Plan the build

The Team Assistant (or you) writes `docs/plans/<feature>.md` from the approved spec and the chosen variant:

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

Run the plan task by task, with a review after every task before the next one that depends on it starts.

For each task that is ready (its dependencies done):

1. **Test first**: the QA role writes the failing tests for the task's acceptance criteria in the task's test files
   (an hq_assign with those test files as its `files`; the developer does it, in the same assignment, when the team has
   no QA role) and shows they fail for the right reason. Commit them on the feature branch
   (`test: failing tests for task 3`) before step 2, so the developer starts from them.
2. **Assign** with hq_assign: the task from `docs/plans/<feature>.md` word for word, plus pointers to the spec, the plan
   and the failing tests, the `files` from the plan, its `done`, and `limits` (the rest of the code, and never push or
   merge). A screen task covers its loading, empty, error and partial states from the spec, not only the happy path.
   When the person adopted HeroUI, a UI task's brief has the member load `heroui-react` and look up every component
   with the HeroUI MCP (`get_component_docs`) before it uses it; when porting to the project's own library, the brief
   names that library's components instead.
3. **Keep parallel members apart**: hq_assign starts every member in this checkout (it has no worktree option), so run
   tasks in parallel only when they share no files, touch no lockfile or shared config, and need no dev server or test
   run of their own at the same time; run the rest one after another. Never two members on the same files.
4. **Review** when it reports. First run `git status` and check that every file it changed is inside its `files`
   (Bash is not limited to them); a file outside goes back as a finding. Then hq_review to the review role, with `focus` on the review checklist (the project rules
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

- **Full checks**: the QA role runs the full unit and end-to-end suites and the build command the project's rules name;
  the review role reads the whole diff against the spec and the review checklist; any risk review from the spec runs
  again on the finished diff.
- **In a real browser**: the QA role opens the built feature (the in-app browser, or the project's end-to-end tool) at
  desktop and mobile width, walks every acceptance criterion and state, and compares it with the chosen variant on the
  canvas. Differences the person did not ask for go back to phase 5 as tasks.
- **Clean up**, after the browser check: one hq_assign removes the prototype routes, the flow files, the canvas and the
  prototype setup, with `files`: the prototypes folders, `public/prototypes/<feature>/`, and, unless the person chose to
  adopt HeroUI, package.json, the lockfile and the prototypes stylesheet; nothing from them is left behind.
- Set `Status: done` in the spec and commit.
- Give the person the closing report: what was built and by whom, who reviewed each part, the test and browser results,
  anything deferred or still open, the feature branch and its commits. Offer to push it and open a pull request, and do
  either only on their explicit yes.
- Offer `/agent-hq:retro`, so what went well or wrong in this feature becomes proposed changes to the team's rules.
