---
name: self-evaluation
description: Score your own finished work before you report it - five axes (accuracy, completeness, clarity, actionability, conciseness), 1 to 5 with evidence for each, fix the gaps you can close quickly, put a one-line scorecard in your reply and keep the lessons. Every Agent HQ team member carries it; use it before the final reply on any non-trivial assignment. Adapted from ECC's agent-self-evaluation.
---

# Self-evaluation

Before you report to the lead, rate what you are handing over against your assignment. It is not a pass/fail gate:
it is a short, honest check that catches a gap before the lead or a reviewer does, and turns it into a lesson for
your next run.

**Language:** speak, ask and write the files the person reads in the language Agent HQ's language section names (English when there is none); keep code, commands, paths, JSON keys and commit messages English.

## When

- Before your final reply on an assignment that changed code, ran several steps (implement, test, review), took three
  or more debugging attempts, or produced a written analysis or design.
- Not for a one-line answer, or a question back to the lead.

## The five axes

| Axis | Question | What it catches |
|---|---|---|
| **Accuracy** | Are the facts, claims and outputs correct? | Invented APIs or flags, wrong syntax, claims nothing verified |
| **Completeness** | Did it do everything the assignment asked? | A skipped part of the goal, an unhandled error path, a "done when" not met |
| **Clarity** | Can the lead understand the reply at once? | Rambling, jargon, missing context, buried results |
| **Actionability** | Can the lead use it now? | "You should X" without how, missing steps, no way to verify |
| **Conciseness** | Is it as short as it can be? | Repetition, filler, code or text that does nothing |

Scores: **5** nothing reasonable to improve · **4** minor nits only · **3** meets the assignment with one notable
weakness · **2** a clear gap that hurts correctness or use · **1** misses the assignment or has serious errors.

**The evidence rule.** Every score below 5 names the gap: what is missing or wrong, and where. "Could be better" is
not a score. A 5 needs proof too: cite the test run, exit code, lint output or grep that shows it. Show the gap, don't
just name it.

## Steps

1. Read the assignment back: its goal, files, "done when" and "do not touch".
2. Score each axis on its own, against that assignment. Don't decide the average first and work backwards.
3. Fix every gap you can close in a minute (a missing test run, an unclear sentence, a forgotten file), then score
   that axis again. A gap that needs real rework stays open: say what would fix it.
4. End your reply to the lead with the scorecard, in this shape:

   ```
   Self-check 4.2: accuracy 5, completeness 4 (no test for an empty list), clarity 4, actionability 4 (migration not run), conciseness 4
   Open: run the migration before merging; nothing else
   ```

   The number is the plain average to one decimal. `Open` lists what you did not fix, most important first, or "none".
5. Keep the lesson. For each axis at 3 or below, and for anything the lead or a reviewer corrected, write one general
   rule for next time where your role prompt says lessons go (your agent memory, or your reply when you cannot edit
   files). A lesson is a rule ("run the guard tests after changing guard.ts"), not a diary of this task.

## Example

```
Assignment: add retry logic to every HTTP call in the client.
Self-check 2.8: accuracy 2 (used urllib3; the client is built on httpx), completeness 3 (GET only, the assignment
said every call), clarity 4, actionability 2 (no tests, so the lead cannot merge it), conciseness 3 (retry settings
repeated in three places)
Open: switch to httpx retries, cover POST/PUT, add tests
Lesson kept: check which HTTP library the client uses before adding to it.
```

## Traps

- **Everything is a 5**, with no evidence: that is self-congratulation, not evaluation.
- **Marking down for scope** the assignment did not ask for: judge against the assignment, not what you could add.
- **Re-arguing a decision** the lead already made: judge what you delivered.
- **Taste as evidence**: "I don't like it" is not a gap. Name a correctness, readability or testability problem, or
  score it 4 or more.
- **No gap found**: look once more. What would the reviewer send back?

---

Adapted from the `agent-self-evaluation` skill of [ECC](https://github.com/affaan-m/ecc), MIT License, Copyright (c)
2026 Affaan Mustafa. See `THIRD_PARTY_NOTICES.md`.
