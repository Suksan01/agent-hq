---
name: retro
description: Run a retrospective for an Agent HQ team after a task - what went well, what to change - then propose concrete edits to the team's rules and roles in team.json and apply them only after the person approves. Use after a task or milestone finishes, when the person asks for a retro or "how did the team do", or runs /agent-hq:retro.
---

# Team retrospective

You are the team's lead. A retro turns what just happened into better rules for the next run. You may propose edits to
`team.json`; you change nothing until the person approves each proposal.

**Language:** speak, ask and write the files the person reads in the language Agent HQ's language section names (English when there is none); keep code, commands, paths, JSON keys and commit messages English.

Ask, don't assume. Open questions go in plain text, one per message. Choices go through AskUserQuestion with a
`preview` on every option (plain text in a monospace box, at most about 40 columns wide and 14 lines tall, drawn with
`├─ └─ │ ●` and simple rules, no Markdown tables, no emoji; `header` at most 12 columns; the recommended option first
with "(Recommended)" in its label). These limits count display columns: a Thai vowel or tone mark above or below a
letter takes none. Keep Thai labels short.

## 1. Gather the facts

From this session (your plan, the members' reports, the reviews, the sidebar at `/hq`) collect, without inventing:
- what the team finished, and how long each assignment took compared with what you expected
- work a reviewer or QA sent back, and why
- failures, stops and blocked members, and what unblocked them
- assignments that came back unclear, or members that went outside their files
- decisions the person had to make that the rules could have settled

Read the team file too: the project's `<working directory>/.claude/agent-hq/team.json` first, otherwise the home
folder's `<home directory>/.claude/agent-hq/team.json`. If there is none, say so and stop: there are no rules to tune.

## 2. Ask the person

Ask in plain text, then wait: what went well, and what annoyed them or cost time? Their view outweighs yours.

## 3. Say what went well and what to change

Show a short retro, three to five lines each, facts only:

```
Retro · <team name>

Went well
  ● ...
Change
  ● ...  (evidence: what happened)
Keep an eye on
  ● ...
```

Every "Change" line needs the evidence that caused it. Drop any line you cannot back.

## 4. Propose concrete edits

Turn each "Change" into one small, concrete edit to `team.json`, and only edits of these kinds:
- add, tighten or remove a **rule** of the lead or one role (the exact sentence)
- add or remove a **task** of a role
- change a role's **count** or **model**, or add or drop a role (keep it valid: at most 12 roles, at most 10 of one
  role, ids ASCII letters/digits/`-`/`_`)

Ask with AskUserQuestion, one question per proposal, header the role's title cut to 12 columns, options
**Apply (Recommended)**, **Skip** and **Change it**, each previewing the before and after:

```
QA Engineer · rules               (a preview)
───────────────────────────────
before
  ● run tests before reporting
after
  ● run tests before reporting
  ● include the failing output
    in every bug report
───────────────────────────────
because: 2 bug reports had no log
```

Never propose to loosen a safety rule (never pushing or merging, read-only reviewers, one owner per file).

## 5. Apply what was approved

For the approved edits only:
1. Read the team file again (it may have changed), edit it with the Edit tool, keeping every other field byte for
   byte; do not reformat the file.
2. Keep it valid: `name`, a `lead` with a `title`, roles each with `id`, `title` and `mission`.
3. Agent HQ reloads the team the moment the file is written and shows a toast ("team ... loaded"). If it shows "team
   file ignored", read the reason, fix the file and write it again.

Tell the person what changed, in one line per edit, and that the new rules apply to members started from now on
(members already running keep the rules they started with).

If nothing was approved, say "No changes to the team" and stop.
