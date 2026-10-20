// The team interview gives UI roles the HeroUI MCP rule. The mod's test sandbox cannot read Markdown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const skill = readFileSync(new URL('./SKILL.md', import.meta.url), 'utf8')

test('UI roles get a rule to look HeroUI components up with its MCP server, and its tools when they have a tools list', () => {
  assert.match(skill, /HeroUI MCP/)
  assert.match(skill, /get_component_docs/)
  assert.match(skill, /mcp__heroui-react__get_component_docs/) // full names: the guard matches tools exactly, no wildcards
  assert.doesNotMatch(skill, /mcp__heroui-react__\*/)
  assert.match(skill, /claude mcp add heroui-react/)
})

test('UI roles list the official HeroUI skill when it is installed', () => {
  assert.match(skill, /`heroui-react`/)
  assert.match(skill, /`heroui-native`/)
  assert.match(skill, /npx skills add heroui-inc\/heroui/)
})
