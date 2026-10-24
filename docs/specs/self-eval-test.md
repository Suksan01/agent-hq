# Self-evaluation skill test

Status: brainstorm (approved)

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
