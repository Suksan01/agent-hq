// How the sidebar lays out where the app draws its own text (desktop, vscode, mobile): no Rasters, a proportional font,
// rows only as tall as what they hold. One line per thing, each agent's dot and tree branch on its name's line.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { TONE_COLOR } from '../hooks/cells'
import { TEAM_FILE } from '../hooks/team'

const RAW_TEAM = {
  name: 'Booking App Team',
  purpose: 'Build the booking web app',
  lead: { title: 'Tech Lead', rules: [], skills: [] },
  roles: [{ id: 'reviewer', title: 'Code Reviewer', count: 2, mission: 'Review.', tasks: [], rules: [], skills: [] }],
}
// the folder from the person's screenshot: long enough to push the heading past one line
const CWD = '/work/kind-brahmagupta-b5f6b1'
const running: AgentInfo = { id: 'm1', name: 'reviewer-1', type: 'agent-hq:reviewer', description: 'Review feature skill', status: 'running' }
const idle: AgentInfo = { id: 'm2', name: 'reviewer-2', type: 'agent-hq:reviewer', description: 'Wait for review', status: 'idle' }

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }
const isNode = (c: unknown): c is Node => typeof c === 'object' && c !== null && 'type' in c
const kids = (n: Node) => (n.children ?? []).filter(isNode)
const textOf = (n: unknown): string => (typeof n === 'string' ? n : isNode(n) ? (n.children ?? []).map(textOf).join('') : '')
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)]
const isColumn = (n: Node) => n.type === 'Box' && n.props?.flexDirection === 'column'

/** The innermost element holding every node `picks` finds: where they all sit together. */
function holderOf(root: Node, picks: ((n: Node) => boolean)[]): Node | undefined {
  const holds = (n: Node) => picks.every(p => all(n).some(p))
  if (!holds(root)) return undefined
  for (const kid of kids(root)) {
    const inner = holderOf(kid, picks)
    if (inner) return inner
  }
  return root
}

/** One line on screen: nothing in it stacks lines (a column Box), so whatever it holds reads side by side. */
const isOneLine = (n: Node) => !all(n).some(isColumn)

async function seed($: Engine, on: On, listed: AgentInfo[]) {
  mock.clock(on)
  mock.store(on, { approvedTeams: withApproval([], `${CWD}/${TEAM_FILE}`, JSON.stringify(RAW_TEAM)) })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: CWD }))
  on('fs.exists', (_, e) => ({ value: e.path === `${CWD}/${TEAM_FILE}` }))
  on('fs.read', () => ({ value: JSON.stringify(RAW_TEAM) }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('agent.list', () => ({ value: listed }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'm1' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: CWD, surface: null, isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'go', subagentType: 'agent-hq:reviewer' } as never)
}

async function drawn($: Engine, columns = 70): Promise<Node> {
  const props = { title: 'Agent HQ', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'desktop', component: 'Pane', requestId: 'agent-hq', props: props as never })
  const tree = (await ui.drawn()) as unknown as Node
  await ui.unmount()
  return tree
}

const agentBox = (tree: Node, id: string) => {
  const box = all(tree).find(n => n.type === 'Box' && n.props?.key === `agent-${id}`)
  if (!box) throw new Error(`no row for ${id}`)
  return box
}
const isNameOf = (id: string) => (n: Node) => n.type === 'Button' && n.props?.key === `view-${id}`
const isDot = (n: Node) => n.type === 'Text' && kids(n).length === 0 && textOf(n).includes('●')

test('on desktop the team heading is one line: no rule to wrap, the name and folder truncate, the count stays', async ($, on) => {
  await seed($, on, [running])
  for (const columns of [70, 34]) {
    const tree = await drawn($, columns)
    const heading = holderOf(tree, [n => n.type === 'Text' && /^ ?BOOKING APP TEAM/.test(textOf(n)), n => n.type === 'Text' && /1 agent/.test(textOf(n))])
    if (!heading) throw new Error(`no heading at ${columns}`)
    expect(isOneLine(heading), `${columns}`).toBe(true)
    // a drawn rule of ─ is wider than its count of columns in the app's font, and wraps under the heading
    expect(all(tree).some(n => n.type === 'Text' && /─{3,}/.test(textOf(n))), `${columns}`).toBe(false)
    const title = all(heading).find(n => n.type === 'Text' && /BOOKING APP TEAM/.test(textOf(n)))
    expect(String(title?.props?.wrap), `${columns}`).toMatch(/^truncate/)
  }
  // wide enough, the whole folder shows; narrow, the folder gives way before the team name and the count
  expect(textOf(await drawn($, 70))).toContain('BOOKING APP TEAM · kind-brahmagupta-b5f6b1')
  const narrow = textOf(await drawn($, 34))
  expect(narrow).toContain('BOOKING APP TEAM')
  expect(narrow).not.toContain('kind-brahmagupta-b5f6b1')
  expect(narrow).toContain('1 agent')
})

test('on desktop each agent has one dot, on its name line with its tree branch, before the name', async ($, on) => {
  await seed($, on, [running, idle])
  const tree = await drawn($)
  for (const [id, branch] of [['main', undefined], ['m1', '├─'], ['m2', '└─']] as const) {
    const box = agentBox(tree, id)
    expect(all(box).filter(isDot), id).toHaveLength(1)
    const picks = [isDot, isNameOf(id), ...(branch ? [(n: Node) => n.type === 'Text' && textOf(n).includes(branch)] : [])]
    const line = holderOf(box, picks)
    if (!line) throw new Error(`dot, branch and name of ${id} not found together`)
    expect(isOneLine(line), id).toBe(true)
    const order = all(line)
    expect(order.findIndex(isDot), id).toBeLessThan(order.findIndex(isNameOf(id)))
  }
})

test("on desktop a dot shows the agent's state in the header's colours, not its bot's", async ($, on) => {
  await seed($, on, [running, idle])
  const tree = await drawn($)
  const dotColor = (id: string) => all(agentBox(tree, id)).find(isDot)?.props?.color
  expect(dotColor('m1')).toBe(TONE_COLOR.running)
  expect(dotColor('m2')).toBe(TONE_COLOR.needs_input)
  expect(dotColor('main')).toBe(TONE_COLOR.running) // busy while its team works
})

test("on desktop an agent's lines start under its name: every line's gutter is as wide as the name line's", async ($, on) => {
  await seed($, on, [running, idle])
  const tree = await drawn($)
  for (const id of ['main', 'm1']) {
    const gutters = all(agentBox(tree, id)).filter(n => n.type === 'Text' && n.props?.mono === true)
    expect(gutters.length, id).toBeGreaterThan(1) // the name line and at least the live line
    expect(new Set(gutters.map(g => [...textOf(g)].length)).size, id).toBe(1)
  }
  // the first member's lines carry the tree's line down to the next member
  const lines = all(agentBox(tree, 'm1')).filter(n => n.type === 'Text' && n.props?.mono === true).map(textOf)
  expect(lines[0]).toMatch(/^├─\s●/)
  for (const line of lines.slice(1)) expect(line).toMatch(/^│\s/)
})

test('on desktop no line is left blank: the terminal keeps rows the height of its bots, the app does not', async ($, on) => {
  await seed($, on, [running, idle])
  const tree = await drawn($)
  const isBlank = (n: Node) => textOf(n).trim() === '' && !all(n).some(x => x.type === 'Svg' || x.type === 'Button')
  const blanks = all(tree)
    .filter(isColumn)
    .flatMap(col => kids(col).filter(isBlank))
  expect(blanks).toEqual([])
  // nor a lone space as a spacer beside a row's lines
  expect(all(tree).filter(n => n.type === 'Text' && textOf(n) === ' ')).toEqual([])
})
