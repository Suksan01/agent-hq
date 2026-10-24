// The self-evaluation skill must teach the same evidence rule as the role prompt in hooks/team.ts, and its examples must follow it.
// team.ts is read as text (no TypeScript import); the mod's test sandbox cannot import it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const skill = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8')
// Join the adjacent string literals of the prompt, then collapse whitespace so a phrase wrapped over lines still matches.
const teamSource = readFileSync(new URL('../../hooks/team.ts', import.meta.url), 'utf8')
const flat = (text) => text.replace(/['`],?\s*\n\s*['`]/g, ' ').replace(/\s+/g, ' ')
const sources = { 'hooks/team.ts': flat(teamSource), 'SKILL.md': flat(skill) }

const RULE_PHRASES = [
  ['every score below 5 names its gap', /every score below 5[^.]*gap/i],
  ['a 5 cites its proof', /a 5 cites [^.]*proof/i],
  ['accuracy and completeness prove with a test run or grep', /accuracy and completeness[^.;]*test run or grep/i],
  ['clarity, actionability and conciseness prove with a file:line, a line count or a section', /clarity, actionability and conciseness[^.]*file:line[^.]*line count[^.]*section/i],
]
for (const [file, text] of Object.entries(sources)) {
  for (const [name, pattern] of RULE_PHRASES) {
    test(`AC1 ${file} states the rule: ${name}`, () => {
      assert.ok(pattern.test(text), `${file} has no phrase for "${name}" (${pattern})`) // not assert.match: it would dump the whole file
    })
  }
}

// Each `Self-check <n>:` line, joined with its wrapped lines up to the `Open:` line, a blank line or the end of its code block.
function findExamples(markdown) {
  const lines = markdown.split('\n')
  const examples = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*Self-check \d/.test(lines[i])) continue
    let joined = lines[i].trim()
    for (let j = i + 1; j < lines.length && !/^\s*(Open:|```|$)/.test(lines[j]); j++) joined += ' ' + lines[j].trim()
    examples.push({ text: joined, short: false })
  }
  // The short form sits inline in backticks, in prose.
  for (const [span] of markdown.matchAll(/`Self-check \d[\d.]*: [^`\n]+`/g)) examples.push({ text: span.slice(1, -1), short: true })
  return examples
}

// Axes in order, each with its score and the parenthesised text after it (nested parentheses kept), or null.
function parseAxes(example) {
  const axes = []
  const axis = /(accuracy|completeness|clarity|actionability|conciseness) (\d)/g
  let match
  while ((match = axis.exec(example))) {
    let end = axis.lastIndex
    let note = null
    if (example.slice(end).startsWith(' (')) {
      let depth = 0
      let k = end + 1
      for (; k < example.length; k++) {
        if (example[k] === '(') depth++
        if (example[k] === ')' && --depth === 0) break
      }
      if (depth === 0) note = example.slice(end + 2, k) // unbalanced: the note stays missing
      axis.lastIndex = end = k + 1
    }
    axes.push({ name: match[1], score: Number(match[2]), note })
  }
  return axes
}

const examples = findExamples(skill)

test('AC5 SKILL.md has at least two Self-check examples and the test checks them', () => {
  assert.ok(examples.length >= 2, `found ${examples.length} Self-check examples in SKILL.md, expected at least 2`)
})

const AXIS_ORDER = ['accuracy', 'completeness', 'clarity', 'actionability', 'conciseness']
for (const { text: example, short } of examples) {
  const label = example.match(/^Self-check [\d.]+/)[0] + (short ? ' (short)' : '')
  const axes = parseAxes(example)
  test(`AC2 example "${label}": names ${short ? 'an axis' : 'all five axes in order'}`, () => {
    if (short) assert.ok(axes.length >= 1, `"${example}" scores no axis`)
    else assert.deepEqual(axes.map((a) => a.name), AXIS_ORDER, `"${example}"`)
  })
  for (const { name, score, note } of axes) {
    test(`AC2 example "${label}": ${name} ${score} carries a ${score < 5 ? '(gap)' : '(proof)'}`, () => {
      assert.ok(note && note.trim(), `${name} ${score} has no parenthesised ${score < 5 ? 'gap' : 'proof'}`)
    })
  }
  if (!short && axes.length === 5) {
    test(`AC3 example "${label}": the number is the mean of the five scores`, () => {
      const mean = (axes.reduce((sum, a) => sum + a.score, 0) / 5).toFixed(1)
      assert.equal(example.match(/^Self-check (\d+(?:\.\d)?)/)[1], mean)
    })
  }
}
