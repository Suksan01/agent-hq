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
  assert.match(skill, /ToolSearch[^.]*restart/) // the MCP tools can load at once; restart only when they did not
})

test('UI roles list the official HeroUI skill when it is installed', () => {
  assert.match(skill, /`heroui-react`/)
  assert.match(skill, /`heroui-native`/)
  assert.match(skill, /npx skills add heroui-inc\/heroui --skill heroui-react -a claude-code/) // the Claude skill only
  assert.match(skill, /opt-in for in-app prototypes/) // the feature skill's default is the Design canvas
})

test('the Team Assistant can write the spec and plan files, and only those', () => {
  const card = JSON.parse(skill.match(/```json\n(\{\n  "id": "assistant"[\s\S]*?\n\})\n```/)[1])
  assert.ok(card.tools.includes('Write') && card.tools.includes('Edit'), 'it can write files')
  assert.deepEqual(card.guard.paths, ['docs/specs/**', 'docs/plans/**'])
})
