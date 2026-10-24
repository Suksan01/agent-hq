---
name: handoff
description: Hand an assignment to a team member in Agent HQ with a complete, structured brief (Goal, Files, Done when, Do not touch, Report format) so the member can finish it alone. Use when the lead is about to assign work, when an assignment came back unclear or incomplete, or when the person runs /agent-hq:handoff.
---

# Hand work to a member

You are the team's lead. A member only knows what you put in the assignment, so a good handoff is the difference
between finished work and a guess. Use this template every time you hand work over, whether you send it with the
`hq_assign` tool or the Agent tool.

**Language:** speak, ask and write the files the person reads in the language Agent HQ's language section names (English when there is none); keep code, commands, paths, JSON keys and commit messages English.

## The template

Fill every field. A field you cannot fill means the work is not ready to hand over: find out first, or split it.

```
Goal
  One or two sentences: the outcome, and why it matters.

Files
  The files or folders the member owns for this assignment, and where to
  start reading. Project-relative globs (e.g. web/**/*.js): no leading /,
  ~ or drive letter, and no .. (hq_assign refuses those).

Done when
  3 to 5 checks anyone can verify: behaviour, tests passing, lint clean.

Do not touch
  Files, areas and actions that are off limits (other members' files,
  the backend, config, pushing or merging).

Report format
  Only what you need beyond the default: hq_assign already tells a member
  that can edit files to write its full report to a file and reply in at
  most 15 lines with a Status (DONE, DONE_WITH_CONCERNS, BLOCKED,
  NEEDS_CONTEXT). Leave this out when the default is enough.
```

Rules for a good brief:
- **One owner per file.** Two members never edit the same file at the same time; give each a distinct area.
- **Done is checkable.** "Works" is not a check; "the new test passes and `npm test` is green" is.
- **Context in, not a lecture.** Link the file, the issue or the earlier report instead of pasting history.
- **Boundaries are explicit.** Always name what not to touch, and repeat "never push or merge unless the person asks".
- **Fits one sitting.** If it needs more than one focused run, split it into several handoffs.

## Example

```
Goal
  Show the available time slots on the booking page, so people can pick one.

Files
  storefront/src/app/booking/** (new component next to page.tsx);
  read storefront/src/lib/medusa.ts for the store client.

Done when
  - the page lists slots from the store API for the chosen day
  - empty and error states render
  - component tests pass; lint and type check are clean

Do not touch
  Anything in backend/**. Other pages. Never push or merge.

Report format
  (default: status reply and report file)
```

## Sending it

1. **If the team assistant wrote the brief** to `.claude/agent-hq/briefs/`, read the file to check it, then pass its
   path as hq_assign's `brief_file` instead of pasting it.
2. **If the `hq_assign` tool is available** (it appears in your tool list when Agent HQ provides it), use it: it
   records the assignment on the team board so the sidebar and the live page show who owns what. Pass the role, the
   task title and the filled template as the brief, and the Files globs as `files` (at most 50, project-relative) so
   the guard keeps the member inside them.
3. **Otherwise** use the Agent tool: `subagent_type: "agent-hq:<role id>"`, `name: "<role id>-<n>"` (for example
   `senior-dev-1`), the filled template as the prompt. Run independent handoffs in the background in parallel, and
   never more of a role than its count in the roster.
4. Track each handoff in your plan (a plan-progress bar or TodoWrite), one step per assignment.

## When the member comes back

- **`Status: BLOCKED` or `NEEDS_CONTEXT`:** answer with SendMessage (the missing context or a ruling), or split the
  task; read its report file only when the status block is not enough.
- **Report matches "Done when":** send it to the team's review role if there is one, then accept it.
- **Report is missing a check, or the work strays outside "Files":** reply to the same member with SendMessage naming
  the exact gap; do not start a new member for it.
- **Member says the assignment is unclear:** that is a flaw in the brief. Fix the field it points at and resend.
- **Work is blocked on the person:** put the decision at the top of your next report and say what you will do meanwhile.

If the person asked you to hand something over and the assignment is ambiguous (which files, what "done" means), ask
one short plain-text question first; do not send a vague brief.
