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

test('the variants are shown on one canvas page, like a design tool: framed side by side, pan and zoom', () => {
  const text = section('Prototype')
  assert.match(text, /canvas/i)
  assert.match(text, /side by side/i)
  assert.match(text, /\bpan\b/i)
  assert.match(text, /\bzoom\b/i)
  assert.match(text, /frame/i)
  assert.match(text, /desktop and mobile/i)
})

test('variants differ in UI and UX style, and are ranked with the recommendation first everywhere', () => {
  const text = section('Prototype')
  assert.match(text, /visual style/i)
  assert.match(text, /UX/)
  assert.match(text, /rank/i)
  assert.match(text, /Recommended/)
  assert.match(text, /leftmost|first frame/i)
  assert.match(text, /same order/i) // the gate's options follow the canvas order
})

test('each variant reports its screens and the links between them in a flow file the canvas reads', () => {
  const text = section('Prototype')
  assert.match(text, /flows\/<variant>\.json/)
  assert.match(text, /"screens"/)
  assert.match(text, /"links"/)
  assert.match(text, /"trigger"/)
})

test('the canvas joins frames with node-to-node connections, inside a variant and across variants', () => {
  const text = section('Prototype')
  assert.match(text, /connection/i)
  assert.match(text, /node/i)
  assert.match(text, /arrow/i)
  assert.match(text, /across variants/i)
  assert.match(text, /drag/i) // the person draws a new connection to sketch a mix
  assert.match(text, /copy/i) // and copies it into the gate's answer
})

test('the gate takes a mix the person drew on the canvas', () => {
  const gate = section('Prototype').split('**Gate:**')[1] ?? ''
  assert.match(gate, /Mix or try again/)
  assert.match(gate, /connections/i)
})

test('prototypes use HeroUI by default, set up once, with the project\'s own library as the alternative', () => {
  const text = section('Prototype')
  assert.match(text, /HeroUI/)
  assert.match(text, /@heroui\/react/)
  assert.match(text, /@heroui\/styles/)
  assert.match(text, /heroui-native/) // React Native apps
  assert.match(text, /@heroui\/react-mcp/) // members read component APIs from it, not from memory
  assert.match(text, /React 19/)
  assert.match(text, /Tailwind (CSS )?v?4/)
  assert.match(text, /setup task/i) // one member installs it before the variants start, so package.json has one writer
  assert.match(text, /project's own (stack|UI library)/i)
  assert.match(text, /theme tokens/i)
  assert.match(text, /raw HTML/i)
  assert.match(text, /screenshot/i)
  assert.match(text, /"image"/)
  assert.match(text, /port/i) // the gate asks whether to port the chosen variant or adopt HeroUI
  assert.match(section('Finish'), /HeroUI/) // removed again unless adopted
})

test('the canvas is a React Flow page that adds no dependency to the project', () => {
  const text = section('Prototype')
  assert.match(text, /@xyflow\/react@\d+\.\d+\.\d+/) // an exact, pinned version
  assert.match(text, /package\.json/)
  for (const api of ['Handle', 'onConnect', 'addEdge', 'Background', 'Controls', 'MiniMap', 'Panel', 'nodrag', 'nowheel']) assert.match(text, new RegExp(api), api)
})

// ---------- the thirteen additions ----------

test('1. the project\'s own rules become plan tasks and review checks', () => {
  assert.match(section('Spec'), /CLAUDE\.md/)
  assert.match(section('Spec'), /project rules/i)
  assert.match(section('Plan'), /project rule/i)
  assert.match(section('Build'), /review checklist/i)
})

test('2. parallel builders each get a worktree, or never share a dev server, lockfile or test run', () => {
  const text = section('Build')
  assert.match(text, /worktree/i)
  assert.match(text, /lockfile/i)
  assert.match(text, /dev server/i)
})

test('3. work lands on a feature branch, one commit per reviewed task, and a PR is offered', () => {
  assert.match(skill, /feature branch/i)
  assert.match(section('Build'), /commit/i)
  assert.match(section('Finish'), /pull request/i)
})

test('4. acceptance criteria are written as Given/When/Then and QA writes the failing test first', () => {
  assert.match(section('Spec'), /Given\/When\/Then/)
  assert.match(section('Build'), /failing test/i)
})

test('5. prototypes and built screens cover every state, not just the happy path', () => {
  for (const name of ['Prototype', 'Build']) assert.match(section(name), /loading, empty, error/i, name)
})

test('6. auth, money or personal data adds a risk review the person must pass', () => {
  const text = section('Spec')
  assert.match(text, /auth, money or personal data/i)
  assert.match(text, /security review/i)
  assert.match(text, /money-path-audit/)
})

test('7. the plan covers rollout: a feature flag, migrations, and how to roll back', () => {
  const text = section('Plan')
  assert.match(text, /feature flag/i)
  assert.match(text, /migration/i)
  assert.match(text, /roll back/i)
})

test('8. before finishing, QA checks the built feature in a real browser against the chosen variant', () => {
  const text = section('Finish')
  assert.match(text, /browser/i)
  assert.match(text, /chosen variant/i)
  assert.match(text, /desktop and mobile/i)
})

test('9. the person can skip a phase on purpose, and the spec records it', () => {
  assert.match(skill, /skip a phase/i)
  assert.match(skill, /Skipped:/)
})

test('10. the plan gate shows an estimate of agents and time before a large build', () => {
  const gate = section('Plan').split('**Gate:**')[1] ?? ''
  assert.match(gate, /estimate/i)
  assert.match(gate, /agents/i)
})

test('11. docs, changelogs and change notes are tasks in the plan', () => {
  const text = section('Plan')
  assert.match(text, /changelog/i)
  assert.match(text, /change notes/i)
  assert.match(text, /docs/i)
})

test('12. the finish offers a retro so the team\'s rules improve', () => {
  assert.match(section('Finish'), /\/agent-hq:retro/)
})

test('13. the spec and the canvas can be shared as a page for others to review at a gate', () => {
  assert.match(skill, /share/i)
  assert.match(skill, /Artifact/)
})

test('HeroUI means v3 only: the v2 and NextUI setup is named so members do not use it', () => {
  const text = section('Prototype')
  assert.match(text, /HeroUI v3/)
  for (const old of ['HeroUIProvider', '@heroui/theme', 'heroui()', 'NextUI']) assert.ok(text.includes(old), old)
})

test('UI work calls the HeroUI MCP: set up before the prototypes, and every UI brief looks components up first', () => {
  assert.match(skill, /claude mcp add heroui-react -- npx -y @heroui\/react-mcp@latest/)
  assert.match(skill, /@heroui\/native-mcp/)
  const proto = section('Prototype')
  for (const tool of ['list_components', 'get_component_docs', 'get_theme_variables']) assert.match(proto, new RegExp(tool), tool)
  assert.match(proto, /before (it|they) (write|use)/i)
  assert.match(section('Build'), /HeroUI MCP/) // a UI task in the build looks components up too, when HeroUI was adopted
  assert.match(skill, /mcp__heroui-react__get_component_docs/) // a role with a tools list needs the MCP tools added, by full name
  assert.doesNotMatch(skill, /mcp__heroui-react__\*/)
})

test('UI work also loads the official HeroUI skills, installed with the person\'s yes, and names them on each UI role', () => {
  assert.match(skill, /npx skills add heroui-inc\/heroui/)
  assert.match(skill, /HEROUI_SKILL_SCOPE=project/)
  assert.match(skill, /`heroui-react`/)
  assert.match(skill, /`heroui-native`/)
  assert.match(section('Prototype'), /heroui-react/) // each variant brief loads the skill
  assert.match(skill, /ask the person/i) // installing a skill or an MCP server changes their setup
})

// ---------- fixes from the review of #3 ----------

test('parallel members share this checkout: hq_assign has no worktree option, so no step merges member branches', () => {
  const text = section('Build')
  assert.match(text, /no worktree option/i)
  assert.doesNotMatch(text, /merge its branch/i)
  assert.doesNotMatch(text, /worktree isolation/i)
})

test('QA writes the failing tests in its own files, and they are committed before the developer starts', () => {
  assert.match(section('Plan'), /test files/i)
  const step = section('Build').match(/1\. \*\*Test first\*\*[\s\S]*?(?=\n2\. )/)[0]
  assert.match(step, /test files/i)
  assert.match(step, /commit/i)
})

test('the plan never removes the prototypes: phase 6 compares against the canvas, then cleans up once', () => {
  assert.doesNotMatch(section('Plan'), /remove the prototype/i)
  const finish = section('Finish')
  assert.ok(finish.indexOf('In a real browser') < finish.indexOf('Clean up'), 'the browser check comes before the clean-up')
  assert.match(finish, /files/) // the clean-up assignment names its files (package.json, the lockfile, the prototype folders)
})

test('the HeroUI setup is its own assignment with its own files, and it finishes before the variants and the canvas start', () => {
  const text = section('Prototype')
  assert.match(text, /finishes before the variants and the canvas start/i)
  assert.match(text, /`files`: package\.json, the lockfile/i)
})

test('every question fits AskUserQuestion\'s limit of 4 options: 2 or 3 variants, and one option for mixing or trying again', () => {
  const text = section('Prototype')
  assert.match(text, /2 or 3 variants/)
  assert.doesNotMatch(text, /2 to 4 variants/)
  assert.match(text, /at most 4 options/i)
  assert.match(text, /"Mix or try again"/)
})

test('Status says whether a phase is a draft or approved, and the brainstorm is saved when its gate passes', () => {
  assert.match(skill, /\(draft\)/)
  assert.match(skill, /\(approved\)/)
  assert.match(section('Brainstorm').split('**Gate:**')[1], /docs\/specs\/<feature>\.md/)
})

test('the HeroUI tools are set up in phase 3, after the spec is saved, so a restart can resume', () => {
  const before = skill.slice(0, skill.indexOf('## 1. Brainstorm'))
  assert.doesNotMatch(before, /claude mcp add/)
  const text = section('Prototype')
  assert.match(text, /claude mcp add heroui-react/)
  assert.match(text, /restart/i)
  assert.match(text, /\/agent-hq:feature/) // resume by running the skill again
  assert.match(text, /llms\.txt/) // a role whose tools list lacks the MCP tools falls back to the docs
})

test('a member\'s changed files are checked against its files list, since Bash is not limited to them', () => {
  assert.match(section('Build'), /git status/)
})
