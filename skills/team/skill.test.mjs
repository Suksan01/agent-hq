// The team interview: the HeroUI rules it gives UI roles, and the display-column rule every skill carries. The mod's test sandbox cannot read Markdown.
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

test('UI roles get Impeccable by default, gated on the person, with a rule split by role', () => {
  const section = skill.match(/### UI roles, Impeccable and HeroUI[\s\S]*?\n### /)[0].replace(/\s+/g, ' ')
  assert.match(section, /`impeccable:impeccable`/)
  assert.match(section, /claude plugin marketplace add pbakaus\/impeccable/)
  assert.match(section, /claude plugin install impeccable@impeccable/)
  const install = section.match(/\*\*Impeccable skill\*\*:.*?(?= \*\*Impeccable rule\*\*)/)[0] // not the HeroUI line
  assert.match(install, /only on the person's yes/)
  assert.match(install, /\/reload-plugins/)
  assert.match(install, /`Skill`/)
  assert.match(section, /Skill tool/)
  const builder = section.match(/For a builder [^"]*"([^"]*)"/)[1]
  assert.match(builder, /`polish` before you report done/)
  assert.doesNotMatch(builder, /`init`|`shape`/)
  assert.match(builder, /send the question to the lead with SendMessage/) // it cannot ask the person
  const reviewer = section.match(/For a review or QA role: "([^"]*)"/)[1]
  assert.match(reviewer, /`audit`/)
  assert.doesNotMatch(reviewer.replace(/never run `polish`/, ''), /critique|polish/)
  assert.match(section, /keep `Bash` in\s+the tools/) // the skill runs a script on every load
  assert.match(reviewer, /do not launch the app/)
  const lead = section.match(/\*\*Impeccable lead rule\*\*: [^"]*"([^"]*)"/)[1]
  assert.match(lead, /`init` once per project/)
  assert.match(lead, /`shape`/)
  assert.match(lead, /DESIGN\.md if one exists/)
})

test('the Team Assistant can write the spec and plan files, and only those', () => {
  const card = JSON.parse(skill.match(/```json\n(\{\n  "id": "assistant"[\s\S]*?\n\})\n```/)[1])
  assert.ok(card.tools.includes('Write') && card.tools.includes('Edit'), 'it can write files')
  assert.deepEqual(card.guard.paths, ['docs/specs/**', 'docs/plans/**'])
})

// Every skill that asks with AskUserQuestion states its limits in display columns.
const SKILLS = readdirSync(new URL('../', import.meta.url), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(new URL(`../${entry.name}/SKILL.md`, import.meta.url)))
  .map(entry => entry.name)
const skillText = name => readFileSync(new URL(`../${name}/SKILL.md`, import.meta.url), 'utf8')

test('every skill that limits AskUserQuestion headers and previews counts display columns', () => {
  const limited = SKILLS.filter(name => /`header`/.test(skillText(name)))
  assert.deepEqual(limited.sort(), ['feature', 'retro', 'standup', 'team'])
  for (const name of limited) {
    const text = skillText(name).replace(/\s+/g, ' ') // wrapped lines read as one
    assert.match(text, /limits count display columns/, `${name} counts columns`)
    assert.doesNotMatch(text, /\b(12|16|40) characters\b/, `${name} states its limits in columns`)
  }
})

test('team ids are English ASCII kebab-case', () => {
  assert.match(skill, /\*\*id\*\*: kebab-case, ASCII letters, digits and `-` only/)
})
