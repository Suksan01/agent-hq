---
name: team
description: Build or change an agent team for Agent HQ - interview the person about what the team is for, how many members and which roles, give each role its own mission, tasks, rules and skills, save it as team.json, then lead the team on its first task. Use when the person asks to create, set up, edit or reset an agent team, or runs /agent-hq:team.
---

# Build an agent team

You set up a team the Agent HQ mod runs. The **main session (you) is the team's lead**; every other role becomes an
agent type `agent-hq:<role id>` that you hand work to with the Agent tool. Agent HQ loads the team the moment the file
is written: it registers the roles, adds the lead's rules and roster to your system prompt from the next request, and
shows the team in its sidebar (`/hq`).

Ask, don't assume: the person decides what the team is for, its size and its roles. Keep each question short, use
AskUserQuestion for choices, and wait for the answer before moving on.

## How to ask

- **Open questions first, in plain text** (what the team is for, what the first task is): the person's own words
  carry more than any menu. One question per message, ending with one example answer that fits this project, so the
  person sees how much detail helps.
- **Choices go through AskUserQuestion with a `preview` on every option.** A preview turns the question into the
  side-by-side view: the options on the left, the focused option's preview on the right, so the person sees exactly
  what each choice gives before picking. Previews only work on single-select questions.
- **Preview format**: plain text in a monospace box, at most about 40 columns wide and 14 lines tall. Draw with
  `├─ └─ │ ●` and simple rules (`───`); no Markdown tables, no emoji. Show what the choice produces (a team tree, a
  role card, a file path), not a description of it, and end with a `───` rule and a one-line summary (size, what it
  replaces, what it costs).
- **Variants show their difference**: when the options are versions of the same thing (lineups, role cards), end each
  line that differs from the recommended option with `+` (added or raised) or `-` (removed or lowered), so the person
  can compare by moving between options.
- **Labels say what happens**, in 1 to 5 words ("Save to this project", "Use opus"), never a bare "Yes", "OK" or
  "Option 2". The `description` is one line on the consequence or trade-off and does not repeat the label.
- **Recommend for this person**: the recommended option is the one that best fits the goal and the project, first
  in the list with "(Recommended)" in its label, and its `description` starts with the reason ("Fits a feature
  build: ...").
- **No catch-all options** such as "Change it" or "Something else": "Other" already lets the person type what to
  change. An option that goes back to an earlier step names that step ("Change the lineup").
- Keep `header` to 12 characters and 2 to 4 options. The person can always pick "Other" to type their own answer.

## 1. Look for an existing team

Check both places with Read (a missing file is fine):
- this project: `<working directory>/.claude/agent-hq/team.json`
- all projects: `<home directory>/.claude/agent-hq/team.json` (the project's wins when both exist)

If one exists, summarise it in two or three lines and ask with AskUserQuestion, header "Team found", each option
previewing what happens to the file:
- **Edit "<name>"** (Recommended): preview the current team tree and its path. Editing starts from the current file
  at step 4.
- **Start a new team**: preview that the file is replaced only when step 7 saves. When the team found is the
  all-projects one, the preview adds that saving the new team to this project keeps it for every other project.
- **Keep it as is**: preview that nothing changes; stop here.

Recommend **Start a new team** instead when the person asked for a new team in so many words.

## 2. Ask what the team is for

First glance at the working directory (its folder name, the README and a package or build file, a few reads at
most) so the question can name what you see. Then ask in plain text and wait: what the team should accomplish, and
what it works on (repository, stack, product, documents), with one example answer, for example: "What should this
team do? This looks like a Next.js storefront, so for example: build the checkout flow and keep the tests green."
Skip the guess when the directory is empty or is the home directory. One or two sentences from the person is enough;
ask one follow-up only if the goal is unclear.

## 3. Ask where to save it

AskUserQuestion, header "Saved for", each option previewing the file and where the team is used:
- **This project**: `<working directory>/.claude/agent-hq/team.json`, used in this project only.
- **All my projects**: `<home directory>/.claude/agent-hq/team.json`, used wherever no project team exists.

Recommend **This project** when the working directory is a project (it has a `.git` folder, a package or build file,
or a team file already); recommend **All my projects** when it is the home directory or holds no project files. When
a team file already exists at a place, that option's preview says what happens to it: `● replaces "<name>"` for the
same file, or `● "<name>" stays for other projects` when a project team will sit in front of the all-projects one.

```
This project                      (preview of the first option)
───────────────────────────────
<project>/.claude/agent-hq/
  team.json
● used in this project only
● share it by committing the file
● "Global Crew" stays for other projects
───────────────────────────────
new file · nothing replaced
```

Resolve the directory to an absolute path; never write a literal `~`.

## 4. Propose the lineup, then let the person adjust it

Ready-made templates ship with this plugin in a `templates/` folder at the plugin root. This skill's base
directory is `skills/team`, so the folder is **`../../templates` relative to the base directory** (resolve it to an
absolute path before reading; never guess a path elsewhere). Read `../../templates/index.json` with Read first: a list of
`{id, title, lead, members, bestFor}`, one entry per `../../templates/<id>.json`. If the folder or index is missing,
carry on without templates.

Propose a lead title and 2 to 6 roles with a headcount each, sized to the goal (most work needs 3 to 6 members in
all; at most 12 roles, at most 10 of one role). Ask with AskUserQuestion, header "Lineup": up to three options, each
option's preview its team tree. When the index has templates that fit the goal (match on `bestFor` and `members`), offer
the best one or two as options, labelled with the template's `title`, the best match first and marked Recommended, and
fill the remaining slot with your own tailored lineup; with no fitting template, offer your own proposal first, then a
smaller and a larger one. Label a template by its `title` and your own lineups by their size ("Tailored · 4
members", "Leaner · 3 members"); each `description` says who it suits, from `bestFor` for a template. Every preview
is the team tree with its differences from the recommended lineup marked, and a summary line: how many members, how
many can work at once, and who reviews. The person picks one or types changes in "Other"; repeat until they accept.

When a template is picked, Read `../../templates/<id>.json` and use it as the starting point for step 6, with every
role pre-filled (id, title, count, mission, tasks, rules, skills, tools, model) and the lead's rules, skills and model:
- **purpose**: replace the `<purpose: ...>` placeholder with one sentence from the goal the person gave in step 2;
  never save the placeholder.
- **name**: the template's name is only a suggestion; step 5 asks the person for the team's name.
- **adapt**: rewrite titles, missions, tasks and rules where the goal calls for it (name the real stack, area or
  documents; drop a task that does not apply). Keep each role's `id`, `tools` (reviewers stay read-only) and the
  rules about review, tests and never pushing or merging.
- **skills**: keep only the skills this session lists; drop the rest. If a role ends up with none that fit, see "Where
  no installed skill fits".
- **lineup changes**: the person may change counts or drop or add a role; keep it valid (at most 12 roles, at most 10
  of one role).

Step 5 names the team, then step 6 walks through each pre-filled role card, so the person can still tighten or change it.

```
Tech Lead (you)                   (a lineup preview)
├─ Senior Developer ×3
├─ QA Engineer ×1
└─ Code Reviewer ×1
───────────────────────────────
5 members · 3 build at once · reviewed

Tech Lead (you)                   (a smaller variant)
├─ Senior Developer ×2          -
└─ QA Engineer ×1
   (no Code Reviewer)           -
───────────────────────────────
3 members · 2 build · lead reviews
```

A software team that ships reliably has clear ownership, a single lead who plans and integrates, independent review
before anything is accepted, tests as part of "done", and someone who owns release and environments. The shipped
templates follow this table; use it to size a tailored lineup when no template fits:

| Goal | Lead | Members |
| --- | --- | --- |
| Build or extend software | Tech Lead | Senior Developer ×2-3, QA Engineer ×1, Code Reviewer ×1 |
| Larger product work | Engineering Manager | Architect ×1, Senior Developer ×3, QA Engineer ×1, DevOps Engineer ×1, Code Reviewer ×1 |
| Fix bugs fast | Tech Lead | Debugger ×2, QA Engineer ×1 |
| Security or quality audit | Audit Lead | Security Reviewer ×1, Code Reviewer ×1, Test Engineer ×1 |
| Research or writing | Editor in Chief | Researcher ×2, Writer ×1, Fact Checker ×1 |
| Web UI work | Frontend Lead | UI Developer ×2, Accessibility Reviewer ×1, Visual QA ×1 |

### Pick the models

**The lead runs on opus.** The lead is this session: it plans, splits the work and checks everything, so it needs the
strongest model. Save it as the lead's `"model": "opus"`; Agent HQ then warns whenever the session runs on another
model (switch with `/model opus`).

Then pick a model for every role (all members of a role share it). AskUserQuestion, one question per role, up to four
in one call (a second call for the fifth role on), header the role's title cut to 12 characters, the suggested model
first with "(Recommended)":
- **Use opus**: architecture, hard debugging, security review; best results, slowest, costs most.
- **Use sonnet**: building, testing, reviewing, writing; the balanced choice for most roles.
- **Use haiku**: quick, narrow checks (lookups, links, formatting); fastest and cheapest.
- **Same as session** (`inherit`): follows the session's `/model`.

Suggest the current model when editing a team, else the picked template's `model`, else the model whose line above
fits the role's work; never suggest haiku for a role that writes code. The recommended option's description says why
("Fits building work: ..."). Each preview is the role's line with that model and what it means:

```
Senior Developer ×3 · sonnet      (a model preview)
───────────────────────────────
Work     implement + test
Depth    ●●○
Speed    ●●○
Cost     ●●○
───────────────────────────────
balanced · suggested for building
```

Opus is `●●●` depth and cost with `●○○` speed, haiku the reverse; "Same as session" names the session's model now.

## 5. Name the team

Ask the person what to call the team: the name shows as the sidebar header, on the island's flag in the live page and
in every report. AskUserQuestion, header "Team name", 3 options built from the goal (step 2) and the project (the
working directory's folder name), each option's preview showing where the name appears. Rules for the names:
- at most 40 characters, Title Case, no `<` or `>` and no leftovers of a template (a picked template's own name is only a
  suggestion: it may be offered when it fits, never assumed);
- the most descriptive first, marked **(Recommended)**, for example "Booking App Team"; then a shorter one with a role
  flavour ("Medusa Crew"); the last one playful ("Storefront Squad", "Booking Bandits");
- when step 1 found a team to edit, add **Keep "<current name>"** as the first option;
- "Other" lets the person type their own; trim it, cut it to 40 characters and refuse `<...>`.

Unique among the person's teams: read both `team.json` places (`<working directory>/.claude/agent-hq/team.json` and
`<home directory>/.claude/agent-hq/team.json`) and compare names ignoring case. Never offer a name another team file
already uses (the file being edited is the same team, so its own name is fine). If the person types one that is used,
say where ("The all-projects team is already called Booking App Team") and ask once more; if they still want it, keep
it, since the project's team wins over the home one anyway.

```
Booking App Team                  (a name preview)
───────────────────────────────
Sidebar   BOOKING APP TEAM · app
Flag      ⚑ Booking App Te…
Saved     "name": "Booking App Team"
───────────────────────────────
most descriptive · used nowhere else
```

The preview shows the sidebar header in capitals followed by the folder name, the flag cut to its 16 characters plus
"…" when longer (the flag is small), and the line that will be saved. Use the picked name as the team's `name` from here
on; it also replaces a template's default name.

## 6. Give every role a clear job

For the lead and each role, draft the fields below from the goal, then go through them with the person: one
AskUserQuestion per role (header: the role's title, cut to 12 characters), options **Looks good (Recommended)** and
the two changes this role is most likely to need, each labelled with the change itself and previewing the role card
as it would be saved, with its changed lines marked. Pick the two from: stricter or looser rules, one more or one
fewer member, an extra task or skill that fits the goal (the model was picked in step 4). For example **Ask before new
deps** and **One more member** for a developer, **Block on any finding** for a reviewer, **Cite every claim** for a
researcher. The
`description` gives the trade-off ("Safer, slower: asks before adding a dependency"). A change typed in "Other" is
applied and the card shown again.

```
Senior Developer ×3 · sonnet      (a role card preview)
───────────────────────────────
Mission  Implement features and
         fixes with tests.
Tasks    ● implement the change
         ● write or update tests
Rules    ● only touch assigned files
         ● never push or merge
         ● ask before new deps    +
Skills   tdd
Access   full
───────────────────────────────
safer · asks before adding a dep
```

- **id**: kebab-case, letters, digits and `-` only (`senior-dev`, `qa`); becomes `agent-hq:<id>`.
- **title**: what the sidebar shows (`Senior Developer`).
- **count**: how many may run at once.
- **mission**: one or two sentences, what this role is for.
- **tasks**: 3 to 6 concrete things it does (`Implement assigned features with tests`, `Report changed files`).
- **rules**: 3 to 6 musts and nevers, including its boundaries (`Never merge or push`, `Only touch files in the
  assignment`, `Write or update tests for every change`, `Never review your own work`).
- **skills**: installed skills that fit, by their exact names as this session lists them (for example `tdd`,
  `code-review`, `security-review`). Only list skills that exist in the session's skill list.
- **tools** (optional): leave out for full access; for review-only roles use `["Read", "Grep", "Glob", "Bash"]`.
- **model**: the one picked in "Pick the models" (step 4): `haiku` for quick, narrow work; `sonnet` for most roles;
  `opus` for architecture or hard debugging; `inherit` to match the session.

The lead gets a **title**, **rules** (how it plans, assigns, reviews and reports), **skills** and **model** (`opus`).

### Where no installed skill fits

Write a playbook skill for that role: `<save directory>/.claude/skills/<team id>-<role id>/SKILL.md`, with frontmatter
`name: <team id>-<role id>` and a `description`, then the role's step-by-step way of working, checklists and a
definition of done. Put its absolute path in the role's `playbook` field (the role reads it at the start of every
run, so it works before Claude Code lists the new skill). Tell the person which playbooks you wrote.

## 7. Confirm and save

Show the whole team once with AskUserQuestion, header "Save team":
- **Save the team (Recommended)**: preview the whole team (the lead as `Title (you) · opus`, then each role as
  `Title ×count · model` and its
  mission), then the path it is saved to and `● replaces "<name>"` when it overwrites a team file.
- **Change the lineup**: back to step 4; preview the current tree.
- **Change a role**: preview the numbered list of roles; then ask in plain text which role and what to change, and
  go back to step 6 for that role.
- **Save somewhere else**: back to step 3; preview the other place and what is already there.

On save, write the file with the Write tool:

```json
{
  "name": "Booking App Team",
  "purpose": "Build and maintain the booking web app",
  "lead": {
    "title": "Tech Lead",
    "rules": ["Split work into assignments that one member can finish", "Have every change reviewed before accepting it"],
    "skills": ["planning-and-task-breakdown"],
    "model": "opus"
  },
  "roles": [
    {
      "id": "senior-dev",
      "title": "Senior Developer",
      "count": 3,
      "mission": "Implement features and fixes in the booking app with tests.",
      "tasks": ["Implement the assigned change", "Write or update tests", "Report changed files and test results"],
      "rules": ["Only touch files in the assignment", "Never push or merge", "Run the tests before reporting"],
      "skills": ["tdd"],
      "model": "sonnet"
    },
    {
      "id": "reviewer",
      "title": "Code Reviewer",
      "count": 1,
      "mission": "Review every change for bugs, security issues and missing tests before it is accepted.",
      "tasks": ["Read the diff", "Report findings by severity", "Approve or request changes"],
      "rules": ["Never edit code", "Never approve work without tests"],
      "skills": ["code-review"],
      "tools": ["Read", "Grep", "Glob", "Bash"],
      "playbook": "/absolute/path/.claude/skills/booking-app-reviewer/SKILL.md"
    }
  ]
}
```

Agent HQ shows a toast when it loads the team ("team … loaded, N roles"). If it shows "team file ignored", the
reason follows: fix the file and write it again. A name or purpose that still holds a template
placeholder (`<...>`, `<purpose: ...>`) is refused the same way: check both before writing.

## 8. Start the first task

Ask in plain text what the team should do first, with two or three concrete suggestions drawn from the goal and the
project (for example "Add the booking cancel flow", "Get the test suite passing", "Map the codebase into the team
notes"), then lead it:
1. Plan the work and track it (a plan-progress bar or TodoWrite), one step per assignment.
2. Hand each assignment to a member with the Agent tool: `subagent_type: "agent-hq:<role id>"`,
   `name: "<role id>-<n>"` (`senior-dev-1`, `senior-dev-2`), a clear goal, the files or area, what done means and
   what not to touch. Run independent assignments in the background in parallel; never run more of a role than
   its count.
3. Send finished work to the review role when the team has one, and back to its author when changes are requested.
4. Give the person one combined report: what was done, by whom, what was reviewed, what is left.

The person can run `/agent-hq:team` again at any time to edit or replace the team, and `/hq` to watch it work.
