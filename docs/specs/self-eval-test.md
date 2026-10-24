# Self-evaluation skill test

Status: done
Skipped: prototype (no user interface)

## Direction (chosen 2026-10-24)

Test + fix skill: add `skills/self-evaluation/skill.test.mjs`, a `node --test` file that reads `hooks/team.ts` as text
(no TypeScript import) and `skills/self-evaluation/SKILL.md`, and checks:

1. both state the same evidence rule: every score below 5 names its gap; a 5 cites proof that fits its axis (a test
   run or grep for accuracy and completeness; a file:line, a line count or a section for clarity, actionability and
   conciseness);
2. every `Self-check` example in SKILL.md follows it: each axis under 5 carries a `(gap)`, each 5 carries a `(proof)`,
   and the number is the plain average of the five scores, to one decimal (the short form names one axis and is exempt
   from the average check).

Then fix SKILL.md so the test passes.

## What the brainstorm found

- README promises this test (`node --test skills/self-evaluation/skill.test.mjs`) but the file does not exist.
- The skill's rule differs from the role prompt's: it names "test run, exit code, lint output or grep" for any 5.
- Both worked examples break the rule: `Self-check 4.2` has `accuracy 5` with no proof and `clarity 4`, `conciseness 4`
  with no gap; `Self-check 2.8` has `clarity 4` with no gap.

## Goal

Keep the self-evaluation skill and the role prompt teaching one evidence rule, and keep the skill's examples
following it, so a member that loads the skill on demand is never taught a looser rule than its prompt states.
For the maintainers: one `node --test` file that fails the moment the two drift apart.

## Flow

A maintainer (or CI) runs `node --test skills/self-evaluation/skill.test.mjs` from the repo root. The test reads two
files as text and reports one failure per broken rule, naming the example and the axis.

## Data

None stored. Reads `hooks/team.ts` and `skills/self-evaluation/SKILL.md`. Changes only the text of SKILL.md (its rule
paragraph and its examples); `hooks/team.ts` does not change (tests/team.test.ts pins its wording).

## States

- **Example wrapped over several lines** (the 2.8 example spans three): the line is joined up to its `Open:` line or
  the end of its code block before it is checked.
- **Short form** (`Self-check 4.6: clarity 4 (...)`, one axis): checked for its gap or proof, not for the average.
- **team.ts reworded**: the test fails with the phrase it could not find, not with a crash.

## Acceptance criteria

- **AC1** Given team.ts and SKILL.md, when the test runs, then it finds in both: every score below 5 names its gap;
  a 5 cites its proof; accuracy and completeness prove with a test run or grep; clarity, actionability and
  conciseness with a file:line, a line count or a section.
- **AC2** Given every `Self-check <n>:` example in SKILL.md, when the test runs, then each axis scored below 5 is
  followed by a `(gap)` and each axis scored 5 by a `(proof)`.
- **AC3** Given a full example (all five axes), when the test runs, then its number equals the mean of its five
  scores rounded to one decimal.
- **AC4** Given the current SKILL.md, when the test first runs, then it fails on AC1 and AC2 (the drift the
  brainstorm found), and after the skill is fixed it passes.
- **AC5** Given SKILL.md has at least two examples, when the test runs, then it checks at least two (a test that
  finds none fails instead of passing vacuously).

## Project rules

- README's Tests section already names this command: it stays true (checked by running it).
- CHANGELOG gets a line under Unreleased.
- The skill keeps the language line before its first section (skills/team/skill.test.mjs checks every skill).
- `claude plugin test .` and the other node skill tests stay green.

## Risks

None: no auth, money or personal data.

## Out of scope

A shared rule file both read; checking Self-check lines anywhere but SKILL.md.
