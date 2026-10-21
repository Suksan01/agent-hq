import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { HqAgent } from '../types'
import { MAIN, mergeAgents, teamTree } from '../hooks/model'
import { fallbackOf } from '../hooks/view'

const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }

const agent = (id: string, status: AgentInfo['status'], parentId?: string): AgentInfo => ({ id, name: id, type: 'general-purpose', description: `do ${id}`, status, parentId })
const row = (id: string, status: HqAgent['status'], startedAt: number): HqAgent => ({ id, name: id, role: 'x', description: '', status, startedAt, tools: 0 })

async function mountWith($: Engine, on: On, listed: AgentInfo[]) {
  mock.clock(on)
  on('agent.list', () => ({ value: listed }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: listed[0]?.id ?? 'x' }))
  await $.agent.spawn({ prompt: 'go' } as never) // no description: a start's talk bubble would draw the full row for six seconds
  return $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
}

test('teamTree puts working agents first, then waiting, then finished, by start time within each', () => {
  const agents = Object.fromEntries(
    [row('done1', 'completed', 1), row('idle1', 'idle', 2), row('run2', 'running', 5), row('ask', 'waiting', 3), row('run1', 'pending', 4), row('fail', 'failed', 0)].map(a => [a.id, a]),
  )
  expect(teamTree(agents)[MAIN]?.map(a => a.id)).toEqual(['run1', 'run2', 'idle1', 'ask', 'fail', 'done1'])
})

test('idle and finished agents take one line with no bot sprite; working ones keep the full row', async ($, on) => {
  const ui = await mountWith($, on, [agent('sleepy', 'idle'), agent('busy', 'running'), agent('asker', 'waiting'), agent('gone', 'completed')])

  expect(await ui.find({ type: 'Raster', key: 'mascot-busy' })).toBeDefined()
  for (const id of ['sleepy', 'asker', 'gone']) {
    expect(await ui.find({ type: 'Raster', key: `mascot-${id}` })).toBeUndefined()
    expect(await ui.find({ key: `view-${id}` })).toBeDefined() // the name still opens its transcript
  }
  const sleepy = await ui.find({ key: 'agent-sleepy' })
  expect(sleepy?.props.flexDirection).not.toBe('column')
  expect(await ui.find({ type: 'Text', text: /● / })).toBeDefined()
  expect(await ui.find({ text: /^ idle$/ })).toBeDefined()
  expect(await ui.find({ text: /^ needs approval$/ })).toBeDefined()
  expect(await ui.find({ text: /^ done$/ })).toBeDefined()
  expect(await ui.find({ text: /idle, waiting for a message/ })).toBeUndefined()
  expect(await ui.find({ text: /no steps tracked/ })).toBeUndefined()

  // the working agent is listed before the idle ones
  const views = (await ui.findAll({ type: 'Button' })).map(b => b.key).filter(k => k?.startsWith('view-'))
  expect(views).toEqual(['view-main', 'view-busy', 'view-sleepy', 'view-asker', 'view-gone'])
  await ui.unmount()
})

test('more than four one-line agents under a parent fold into "+N more"', async ($, on) => {
  const ui = await mountWith($, on, [agent('w', 'running'), ...['i1', 'i2', 'i3', 'i4', 'i5', 'i6'].map(id => agent(id, 'idle'))])

  for (const id of ['i1', 'i2', 'i3', 'i4']) expect(await ui.find({ key: `view-${id}` })).toBeDefined()
  for (const id of ['i5', 'i6']) expect(await ui.find({ key: `view-${id}` })).toBeUndefined()
  expect(await ui.find({ text: /└─ \+2 more idle\/done/ })).toBeDefined()
  await ui.unmount()
})

test('two agents sharing a bot: the later-started one gets a free one', () => {
  const rows = mergeAgents({}, [agent('a', 'running'), agent('b', 'running')], 0)
  const clash = { ...rows, b: { ...rows.b!, mascot: rows.a!.mascot, startedAt: 10 } }

  const next = mergeAgents(clash, [agent('a', 'running'), agent('b', 'running')], 20)
  expect(next.a?.mascot).toBe(rows.a?.mascot)
  expect(next.b?.mascot).not.toBe(next.a?.mascot)
  expect(clash.b.mascot).toBe(rows.a?.mascot) // the input rows are left alone
})

test('a finished one-line agent shows its last item, cut to the room before the time', async ($, on) => {
  const listed = [agent('finisher', 'completed'), agent('crashed', 'failed')]
  mock.clock(on)
  on('agent.list', () => ({ value: listed }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'finisher' }))
  let id = 0
  on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: String(++id), subject: 'x' } } } : { result: {} as never }))
  await $.agent.spawn({ prompt: 'go' } as never) // no description: a start's talk bubble would draw the full row for six seconds
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  await call({ tool: 'TaskCreate', subject: 'Ship the whole release to production', description: 'd' })
  await call({ tool: 'TaskUpdate', taskId: '1', status: 'completed', owner: 'finisher' })
  await call({ tool: 'TaskCreate', subject: 'Probe', description: 'd' })
  await call({ tool: 'TaskUpdate', taskId: '2', status: 'completed', owner: 'crashed' })

  // 40 columns: 38 inside the padding, so the long subject cannot fit beside "└─ ● <nickname> ✓ " and the time
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: { ...PANE_PROPS, bodyColumns: 40 } as never })
  const cut = await ui.find({ type: 'Text', text: /^Ship the.*…$/ })
  expect(cut).toBeDefined()
  expect([...(cut?.text ?? '')].length).toBeLessThan(25)
  expect((await ui.find({ key: 'agent-finisher' }))?.text).not.toContain('production') // the task board still has it whole
  expect(await ui.find({ text: /failed · Probe/ })).toBeDefined()
  await ui.unmount()
})

test('a working agent with no todos still gets a bar: its owned task\'s status, else a "getting started" sweep', () => {
  const task = (id: string, status: 'pending' | 'in_progress' | 'completed', owner: string) => ({ id, subject: `t${id}`, status, owner, blockedBy: [] })
  const worker = { ...row('worker', 'running', 0), name: 'worker-1' }

  expect(fallbackOf(worker, {})).toEqual({ kind: 'sweep' })
  expect(fallbackOf(worker, { 1: task('1', 'pending', 'someone-else') })).toEqual({ kind: 'sweep' })
  expect(fallbackOf(worker, { 1: task('1', 'pending', 'worker-1') })).toEqual({ kind: 'task', status: 'pending' })
  expect(fallbackOf(worker, { 1: task('1', 'completed', 'worker'), 2: task('2', 'in_progress', 'worker-1'), 3: task('3', 'pending', 'worker-1') })).toEqual({ kind: 'task', status: 'in_progress' })
  expect(fallbackOf(worker, { 1: task('1', 'completed', 'worker') })).toEqual({ kind: 'task', status: 'completed' })
  // only a working agent has one: not the lead, a waiting agent or a finished one
  expect(fallbackOf(row(MAIN, 'running', 0), {})).toBeUndefined()
  expect(fallbackOf(row('w', 'waiting', 0), {})).toBeUndefined()
  expect(fallbackOf(row('d', 'completed', 0), {})).toBeUndefined()
})

test('the sidebar draws that bar on both surfaces, never leaving a working agent\'s row without one', async ($, on) => {
  const listed = [agent('plain', 'running'), agent('owner', 'running'), agent('gone', 'completed')]
  mock.clock(on)
  on('agent.list', () => ({ value: listed }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'plain' }))
  on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '1', subject: 'x' } } } : { result: {} as never }))
  await $.agent.spawn({ prompt: 'go' } as never) // no description: a start's talk bubble would draw the full row for six seconds
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  await call({ tool: 'TaskCreate', subject: 'Own it', description: 'd' })
  await call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', owner: 'owner' })

  const terminal = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  expect(await terminal.find({ type: 'Raster', key: 'todo-plain' })).toBeDefined() // the sweep
  expect(await terminal.find({ type: 'Raster', key: 'todo-owner' })).toBeDefined() // the task's status
  expect(await terminal.find({ type: 'Raster', key: 'todo-gone' })).toBeUndefined()
  await terminal.unmount()

  // the desktop draws each bar as an Svg whose pill carries its words, said in its alt
  const desktop = await $.ui.mount({ plugin: 'agent-hq', surface: 'desktop', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  const bars = (await desktop.findAll({ type: 'Svg' })).map(b => b.props.alt)
  expect(bars).toContain('getting started · 0 tools')
  expect(bars).toContain('in progress')
  await desktop.unmount()
})
