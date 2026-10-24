# Plan: self-evaluation skill test

Spec: docs/specs/self-eval-test.md (AC1-AC5). Tasks run one after another: each depends on the one before.

- [x] 1. **Failing test** (QA Engineer, qa-1)
  - Files: `skills/self-evaluation/skill.test.mjs` (new)
  - Meets: AC1, AC2, AC3, AC5; shows the first half of AC4 (fails on today's SKILL.md)
  - Done: `node --test skills/self-evaluation/skill.test.mjs` fails, and every failure names the rule phrase, or the
    example and the axis, the brainstorm found (spec "What the brainstorm found"); no other file changed
  - Notes: plain `node:test` and `node:assert/strict`, read files with `readFileSync` like
    `skills/feature/skill.test.mjs`; read `hooks/team.ts` as text, never import it
- [ ] 2. **Fix the skill** (Senior Developer, senior-dev-1), after 1
  - Files: `skills/self-evaluation/SKILL.md`, `CHANGELOG.md`
  - Meets: AC4 (second half), project rules (CHANGELOG line under Unreleased; the language line stays)
  - Done: task 1's test passes; `node --test skills/*/skill.test.mjs` passes; the rule paragraph states the
    axis-specific proof the role prompt states; both examples follow it
  - Limits: never edit the test or `hooks/team.ts`
- [ ] 3. **Full test run** (QA Engineer)
  - Done: `node --test skills/*/skill.test.mjs` and `claude plugin test .` give no new failures (2 page-approval tests
    already fail on main)

Review: the Code Reviewer reviews after tasks 1 and 2 (hq_review).
Rollout: no flag, no migration; roll back by reverting the branch's commits.
Docs: README already names the command; CHANGELOG is in task 2.

## Follow-ups (from review, break no acceptance criterion)

- The AC1 check matches each proof phrase on its own; it could tie each proof to its axes (anchor on the sentence
  shape in hooks/team.ts).
- The team.ts reader joins only single-quote and backtick strings; a double-quoted rewording would fail as "phrase not
  found" rather than as drift.
