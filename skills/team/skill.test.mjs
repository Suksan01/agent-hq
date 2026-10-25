// The team interview: the HeroUI rules it gives UI roles, and the language rules every skill carries. The mod's test sandbox cannot read Markdown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const skill = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8')

test('UI roles get a rule to look HeroUI components up with its MCP server, and its tools when they have a tools list', () => {
  assert.match(skill, /HeroUI MCP/)
  assert.match(skill, /get_component_docs/)
  assert.match(skill, /mcp__heroui-react__get_component_docs/) // full names: the guard matches tools exactly, no wildcards
  assert.doesNotMatch(skill, /mcp__heroui-react__\*/)
  assert.match(skill, /claude mcp add heroui-react/)
  assert.match(skill, /ToolSearch[^.]*restart/) // the MCP tools can load at once; restart only when they did not
})

test('UI roles list the official HeroUI skill when it is installed', () => {
  assert.match(skill, /`heroui-react`/)
  assert.match(skill, /`heroui-native`/)
  assert.match(skill, /npx skills add heroui-inc\/heroui --skill heroui-react -a claude-code/) // the Claude skill only
  assert.match(skill, /opt-in for in-app prototypes/) // the feature skill's default is the Design canvas
})

test('UI roles get Impeccable by default, with an install line and a rule for its commands', () => {
  assert.match(skill, /`impeccable:impeccable`/)
  assert.match(skill, /claude plugin marketplace add pbakaus\/impeccable/)
  assert.match(skill, /claude plugin install impeccable@impeccable/)
  assert.match(skill, /`\/impeccable init` once per\s+project/)
  assert.match(skill, /`critique` or `audit` before review, `polish` before done/)
})

test('the Team Assistant can write the spec and plan files, and only those', () => {
  const card = JSON.parse(skill.match(/```json\n(\{\n  "id": "assistant"[\s\S]*?\n\})\n```/)[1])
  assert.ok(card.tools.includes('Write') && card.tools.includes('Edit'), 'it can write files')
  assert.deepEqual(card.guard.paths, ['docs/specs/**', 'docs/plans/**'])
})

// Every skill, not only this one, follows the language the person chose (Agent HQ's `language` option).
const SKILLS = readdirSync(new URL('../', import.meta.url), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(new URL(`../${entry.name}/SKILL.md`, import.meta.url)))
  .map(entry => entry.name)
const skillText = name => readFileSync(new URL(`../${name}/SKILL.md`, import.meta.url), 'utf8')
const LANGUAGE_LINE = "**Language:** speak, ask and write the files the person reads in the language Agent HQ's language section names (English when there is none); keep code, commands, paths, JSON keys and commit messages English."

test('every skill says, before its first section, to follow the chosen language and keep code English', () => {
  assert.ok(SKILLS.length >= 6, `found the skills: ${SKILLS.join(', ')}`)
  for (const name of SKILLS) {
    const text = skillText(name)
    const at = text.indexOf(LANGUAGE_LINE)
    assert.ok(at > 0, `${name} has the language line`)
    assert.ok(at < text.indexOf('\n## '), `${name} says it before its first section`)
  }
})

test('every skill that limits AskUserQuestion headers and previews counts display columns, Thai marks taking none', () => {
  const limited = SKILLS.filter(name => /`header`/.test(skillText(name)))
  assert.deepEqual(limited.sort(), ['feature', 'retro', 'standup', 'team'])
  for (const name of limited) {
    const text = skillText(name).replace(/\s+/g, ' ') // wrapped lines read as one
    assert.match(text, /limits count display columns/, `${name} counts columns`)
    assert.match(text, /Thai vowel or tone mark above or below a letter takes none/, `${name} gives Thai marks no column`)
    assert.match(text, /Keep Thai labels short/, `${name} keeps Thai labels short`)
    assert.doesNotMatch(text, /\b(12|16|40) characters\b/, `${name} states its limits in columns`)
  }
})

test('the interview writes titles, missions, tasks and rules in the chosen language, and ids stay English ASCII', () => {
  assert.match(skill, /name, purpose, titles, missions, tasks and rules in that language/)
  assert.match(skill, /role ids, tool names, skill names, models, globs and paths stay English/)
  assert.match(skill, /\*\*id\*\*: kebab-case, ASCII letters, digits and `-` only/)
  assert.match(skill, /templates are English[^.]*translate[^.]*keep[^.]*ids/i) // they ship as starting points
})
