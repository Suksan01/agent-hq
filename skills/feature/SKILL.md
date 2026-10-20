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

**Choose and rank the variants.** Pick 2 to 4 variants that differ in both UI and UX, never in colour alone:
- **visual style**: for example minimal and airy, dense and data-first, card-based, bold and editorial, or the
  project's own design system pushed one way;
- **UX**: the flow and where the action lives, for example one page against a step-by-step wizard, inline editing
  against a side panel, or the main action up front against behind a menu.

Give each a short name and one line: its style, its flow, and who it suits. Then **rank** them, best fit for the spec,
the project's design system and the person's constraints first. The top one is the **Recommended** variant, and the
rank is the order everywhere after this: the briefs, the canvas and the gate.

**Use the project's own stack.** Build the variants in the project's own stack and UI library: the framework, the
component library and the design tokens the real feature will use (in a Next.js app with `components/ui/`, its routes
and those components). Variants share those components and differ by layout, flow and theme tokens; a component a
variant needs and the library lacks goes in that variant's own folder. A React project with no UI library yet uses
shadcn/ui on Tailwind, whose components are copied in and themed by tokens. Then a variant shows what can really ship, and the chosen one is a head start for phase 5. Use
raw HTML only when the project has no frontend app yet. A native app (React Native, iOS, Android) cannot sit in an
iframe: use its web build where it has one (Expo web), else each screen is a screenshot from the simulator.

**Build them in parallel.** Brief one frontend member per variant with hq_assign, **in parallel**: each builds
**one variant** only, from the approved spec and its line above, with mock data and no backend changes, on a
**throwaway** route of its own (`<app>/prototypes/<feature>/<variant>/**`, in a folder the router serves: the Next.js
App Router never serves a folder whose name starts with `_`). Give each `files` limited to its own variant folder and
its flow file, `done` as "every screen of the main flow renders at desktop and mobile width on its own URL, the flow
file lists them, and the report gives the URLs", and `limits` as "no backend, no shared components, no real data, no
change to package.json". With fewer frontend members than variants, run them one after another, or offer hq_hire.

Each variant also writes its flow file, `flows/<variant>.json` next to the canvas (below): its screens and how one leads
to the next. A screen has a `url`, or an `"image"` (a screenshot path) where it cannot be shown live.

```json
{
  "variant": "wizard",
  "screens": [
    { "id": "list", "title": "My bookings", "url": "/prototypes/booking-cancellation/wizard/list" },
    { "id": "confirm", "title": "Confirm cancel", "url": "/prototypes/booking-cancellation/wizard/confirm" }
  ],
  "links": [{ "from": "list", "to": "confirm", "trigger": "Tap Cancel" }]
}
```

**Lay them out on a canvas.** At the same time, one more member (or you) builds the canvas with React Flow: one static
page, `index.html` in the app's public folder under `prototypes/<feature>/` (for Next.js,
`public/prototypes/<feature>/index.html`, served at `/prototypes/<feature>/index.html`, the same origin as the
variants). It loads React and `@xyflow/react@12.11.6` (or a newer exact version at least two weeks old) and its
`dist/style.css` from a CDN such as esm.sh, so nothing is installed and package.json does not change; if the project
already depends on `@xyflow/react`, it may be a route instead. Its own `files` are that folder, nothing shared. Like a
design tool's prototype canvas, it reads every `flows/*.json` and shows them all at once:
- each screen is a custom node, a labelled frame holding its URL in an iframe (or its `image`), with the classes
  `nodrag` and `nowheel` on the iframe so the person can use the screen; a variant's screens sit side by side in one
  row, in flow order, and the rows go in rank order, so the Recommended variant is the top row and its first frame the
  leftmost, with a "Recommended" badge and one line on why;
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

**Gate:** AskUserQuestion, header "Variant": one option per variant in the same order as the canvas, the Recommended
one first with "(Recommended)" in its label and why in its description, plus "Mix them" (the person pastes the copied
connections, or says which parts, in "Other") and "Try again". The next phase starts once a direction is picked. Write
the choice, and for a mix the connections that make up the chosen flow, into the spec. Prototype code, the canvas
included, is a reference, never merged as it is.

## 4. Plan the build

The Team Assistant (or you) writes `docs/plans/<feature>.md` from the approved spec and the chosen variant:

- Tasks small enough that one member finishes each in one assignment, numbered, as a checklist (`- [ ] 3. ...`).
- For each task: the owner role, the files it may change, what "done" means, the tests it adds or must pass, and the
  tasks it depends on.
- Order: what others depend on first (data and API before the screens that use them).
- Mark which tasks can run in parallel: no dependency between them and no file they both change.
- The last tasks are always: remove the prototype routes and the canvas, and the full test run.

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
- Confirm the prototype routes and the canvas are gone and nothing from them was left behind.
- Set `Status: done` in the spec.
- Give the person the closing report: what was built and by whom, who reviewed each part, the test results, anything
  deferred or still open, and the files changed. Offer to commit; never push or merge: that is theirs to do.
