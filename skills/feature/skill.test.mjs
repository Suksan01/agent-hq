// The feature workflow skill: six phases in order, a gate after each that only the person can pass, and the
// team-specific steps (parallel prototype variants, review after every task). The mod's test sandbox cannot read Markdown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const skill = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8')
const PHASES = ['Brainstorm', 'Spec', 'Prototype', 'Plan', 'Build', 'Finish']
const phaseHeadings = [...skill.matchAll(/^## (\d)\. (.+)$/gm)]
const section = name => {
  const i = phaseHeadings.findIndex(m => m[2].startsWith(name))
  const start = phaseHeadings[i].index
  const end = phaseHeadings[i + 1]?.index ?? skill.length
  return skill.slice(start, end)
}

test('the skill is named feature and says when to use it', () => {
  assert.match(skill, /^---\nname: feature\ndescription: .+\/agent-hq:feature.+\n---\n/)
})

test('the six phases come in order, numbered 1 to 6', () => {
  assert.deepEqual(phaseHeadings.map(m => Number(m[1])), [1, 2, 3, 4, 5, 6])
  PHASES.forEach((name, i) => assert.ok(phaseHeadings[i][2].startsWith(name), `phase ${i + 1} is ${name}, got ${phaseHeadings[i][2]}`))
})

test('every phase but the last ends at a gate the person must pass with AskUserQuestion', () => {
  for (const name of PHASES.slice(0, -1)) {
    const text = section(name)
    assert.match(text, /\*\*Gate:\*\*/, `${name} has a gate`)
    assert.match(text, /AskUserQuestion/, `${name} asks with AskUserQuestion`)
    assert.match(text, /next phase/i, `${name} says the next phase waits`)
  }
})

test('the spec and the plan are files in the repo that members brief from', () => {
  assert.match(section('Spec'), /docs\/specs\/<feature>\.md/)
  assert.match(section('Plan'), /docs\/plans\/<feature>\.md/)
  assert.match(section('Build'), /docs\/plans\/<feature>\.md/)
})

test('prototype variants are built in parallel by separate members, each on its own throwaway route', () => {
  const text = section('Prototype')
  assert.match(text, /in parallel/i)
  assert.match(text, /one variant/i)
  assert.match(text, /throwaway/i)
  assert.match(text, /skip/i) // a feature with no UI skips this phase
})

test('the build runs one task at a time per member and reviews each before the next starts', () => {
  const text = section('Build')
  assert.match(text, /hq_assign/)
  assert.match(text, /hq_review/)
  assert.match(text, /before the next/i)
})

test('nobody pushes or merges, and the finish leaves that to the person', () => {
  assert.match(skill, /never push or merge/i)
  assert.match(section('Finish'), /closing report/i)
})
