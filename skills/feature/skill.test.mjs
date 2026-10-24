// The feature workflow skill: six phases in order, a gate after each that only the person can pass, and the
// team-specific steps (parallel prototype variants, review after every task). The mod's test sandbox cannot read Markdown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const main = read('./SKILL.md')
// a phase's details live in references/ and load only when the lead reaches it: read them in place of their pointer
const POINTER = /^Read `(references\/[^`]+)`.*$/gm
const skill = main.replace(POINTER, (_, path) => read(`./${path}`))
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

test('prototype variants are built in parallel by separate members, each on its own boards or throwaway route', () => {
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

test('the in-app path uses HeroUI, set up once, with the project\'s own library as the alternative', () => {
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
  assert.match(skill, /npx skills add heroui-inc\/heroui --skill heroui-react -a claude-code/) // the Claude skill only
  assert.doesNotMatch(skill, /heroui\.com\/install/) // its install script installs into every AI tool it finds
  assert.match(skill, /`heroui-react`/)
  assert.match(skill, /`heroui-native`/)
  assert.match(section('Prototype'), /heroui-react/) // each variant brief loads the skill
  assert.match(section('Prototype'), /Ask the person before installing/) // installing a skill or an MCP server changes their setup
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

// ---------- fixes from the re-review of #3 ----------

test('every phase from the spec on marks itself (draft) when it starts, so a restart mid-phase resumes it', () => {
  const phases = { Spec: 'spec', Prototype: 'prototype', Plan: 'plan', Build: 'build', Finish: 'finish' }
  for (const [heading, name] of Object.entries(phases)) assert.match(section(heading), new RegExp(`Status: ${name} \\(draft\\)`), heading)
})

test('every Status the skill writes has the <phase> (draft|approved) form, or done', () => {
  const values = [...skill.matchAll(/`Status: ([^`]+)`/g)].map(m => m[1])
  assert.ok(values.length > 0)
  for (const v of values) assert.match(v, /^(brainstorm|spec|prototype|plan|build|finish) \((draft|approved)\)$|^done$|^<phase> \((draft|approved)\)$/, v)
})

test('the scope check runs as each member reports and holds every running member to account for a stray file', () => {
  const step = section('Build').match(/4\. \*\*Review\*\*[\s\S]*?(?=\n5\. )/)[0]
  assert.match(step, /as soon as (it|a member) reports/i)
  assert.match(step, /every member running/i)
})

// ---------- fixes from the 0.4.1 live test ----------

test('phase 3 prototypes on the Design canvas by default, with HeroUI in the app as an opt-in', () => {
  const text = section('Prototype')
  assert.match(text, /Design canvas \(the default\)/)
  assert.match(text, /Artifact tool/)
  assert.match(text, /Design type/)
  assert.match(text, /project\/canvas\.json/)
  assert.match(text, /HeroUI \(opt-in\)/)
  assert.doesNotMatch(text, /HeroUI by default/i)
  assert.ok(text.indexOf('Design canvas') < text.indexOf('HeroUI'), 'the default comes first')
})

test('phase 3 starts with one question: where, how many variants, and whether to check every board renders', () => {
  const text = section('Prototype')
  const start = text.slice(0, text.indexOf('**Choose and rank'))
  assert.match(start, /once/i)
  assert.match(start, /AskUserQuestion/)
  assert.match(start, /how many variants/i)
  assert.match(start, /renders/i)
  assert.match(text, /foreground tab/i) // a background tab freezes CSS transitions
  assert.match(text.split('**Gate:**')[1], /not checked/i)
})

test('the lead lays out every board before the builders start, and publishes the index with the entry board', () => {
  const text = section('Prototype')
  assert.match(text, /one row per variant/i)
  assert.match(text, /every state the spec's acceptance criteria name/i)
  assert.match(text, /Main\.dc\.html/)
  assert.match(text, /together with the entry board/i)
  assert.match(text, /promise no click-through/i) // links between boards were not proven in Play mode
})

test('Design canvas builders write only their own boards directly, then read and publish all of them in one call a turn later', () => {
  const text = section('Prototype')
  assert.match(text, /only its own/i)
  assert.match(text, /no generator scripts/i)
  assert.match(text, /shared scratch/i)
  assert.match(text, /separate turns/i)
  assert.match(text, /all its boards in one publish call/i)
  assert.match(text, /haven't viewed the latest version/)
  assert.match(text, /reads again/i)
})

test('the in-app path: the lead runs one dev server per app, and setup is done only on a real render', () => {
  const text = section('Prototype')
  assert.match(text, /one dev server per app/i)
  assert.match(text, /HTTP 200/)
  assert.match(text, /error overlay/i)
  assert.match(text, /lint and tsc/i) // passing them is not enough
})

test('the setup task checks legacy-peer-deps, installs HeroUI\'s peers itself, and pins versions', () => {
  const text = section('Prototype')
  assert.match(text, /legacy-peer-deps/)
  assert.match(text, /\.npmrc/)
  assert.match(text, /peer dependencies explicitly/i)
  assert.match(text, /newest exact versions at least two weeks old/i) // the same rule as @xyflow/react
})

test('the HeroUI tools: ToolSearch before a restart, and a SKILL.md path for members', () => {
  const text = section('Prototype')
  assert.match(text, /ToolSearch/)
  assert.match(text, /Unknown skill/)
  assert.match(text, /SKILL\.md/)
})

test('in-app prototype routes stay out of i18n middleware and the app shell; the canvas reads a manifest', () => {
  const text = section('Prototype')
  assert.match(text, /i18n middleware/i)
  assert.match(text, /own root layout/i)
  assert.match(text, /matcher exclusion/i)
  assert.match(text, /flows\/index\.json/)
  assert.match(text, /flow schema/i) // the canvas member gets it
})

test('the review role checks the prototypes against the spec before the variant gate', () => {
  const beforeGate = section('Prototype').split('**Gate:**')[0]
  assert.match(beforeGate, /hq_review/)
  assert.match(beforeGate, /against the spec/i)
})

test('phase 6 cleans up only what the in-app path left, and restores the lockfile byte for byte', () => {
  const finish = section('Finish')
  assert.match(finish, /Design canvas/)
  assert.match(finish, /byte for byte/i)
})

test('the spec and plan go in the project\'s own folders, docs/specs and docs/plans only when it has none', () => {
  const before = skill.slice(0, skill.indexOf('## 1. Brainstorm'))
  assert.match(before, /docs\/superpowers\/specs/)
  assert.match(before, /only when it has none/i)
  // the Team Assistant's guard allows only docs/specs/** and docs/plans/**, so other folders need the lead or a guard change
  const bullet = before.match(/- \*\*Find the spec and plan folders\*\*[\s\S]*?(?=\n- \*\*)/)[0]
  assert.match(bullet, /guard/i)
  assert.match(bullet, /yourself/i)
  assert.match(bullet, /\/agent-hq:team/)
})

test('every brief tells the member to close its own plan-progress bars when it finishes, when that mod is installed', () => {
  assert.match(skill, /close its own plan-progress bars/i)
  assert.match(skill, /when the plan-progress mod is installed/i)
})

// ---------- fixes from the skill review ----------

test('Design canvas builders get no files scope: their boards live outside the repo, and a tools list needs Artifact', () => {
  const text = section('Prototype')
  assert.match(text, /no `files`/) // hq_assign scopes only relative globs inside the project
  assert.match(text, /<scratchpad>\/boards\/<variant>\//)
  assert.match(text, /outside the repo/i)
  assert.match(text, /`Artifact`[^.]*\/agent-hq:team/) // a UI role with a tools list cannot publish without it
})

test('the i18n middleware file is in the setup task\'s files and in the clean-up\'s, restored byte for byte', () => {
  const setup = section('Prototype').match(/\*\*First, one setup task\*\*[\s\S]*?(?=\n- \*\*)/)[0]
  assert.match(setup, /`files`: package\.json, the lockfile[^.]*middleware/)
  const cleanup = section('Finish').match(/\*\*Clean up\*\*[\s\S]*?(?=\n- )/)[0]
  assert.match(cleanup, /middleware/)
  assert.match(cleanup, /byte for byte/)
})

test('the spec and plan are written in the chosen language, while the slug, branch, code, tests, commits and Status lines stay English', () => {
  const top = skill.slice(0, skill.indexOf('\n## '))
  assert.match(top, /spec and the plan are written in that language/)
  assert.match(top, /feature slug, branch names, code, tests, commit messages/)
  assert.match(top, /`Status:` and `Skipped:` words, phase names and `AC` ids stay English/) // a resume reads them back
})

test('SKILL.md stays small: phase details sit in references/ that it points to by a path that exists', () => {
  assert.ok(Buffer.byteLength(main) < 16_500, `SKILL.md is ${Buffer.byteLength(main)} bytes`) // it was 26.7 KB before the split
  const pointers = [...main.matchAll(POINTER)].map(m => m[1])
  assert.deepEqual(pointers, ['references/prototypes.md'])
  for (const path of pointers) assert.ok(existsSync(new URL(`./${path}`, import.meta.url)), path)
  assert.match(section('Prototype'), /Read `references\/prototypes\.md`|\*\*Ask once, first\*\*/) // the details are read inside phase 3
})

test('briefs point to the spec and plan files instead of pasting them, and the lead acts on each status', () => {
  assert.doesNotMatch(main, /word for word/)
  assert.match(section('Spec'), /point it to\nthe spec file/)
  assert.match(section('Build'), /task <n> in `docs\/plans\/<feature>\.md`; read that task, not the\n   whole plan/)
  assert.match(section('Build'), /never paste the plan or earlier\n   members' replies/)
  assert.match(section('Build'), /`BLOCKED` or `NEEDS_CONTEXT`/)
})
