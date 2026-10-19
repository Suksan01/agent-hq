// What the sidebar lets the person click, and how it draws its bars where Rasters are not drawn.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
const SURFACES = ['terminal', 'desktop'] as const

const agent = (id: string, status: AgentInfo['status']): AgentInfo => ({ id, name: id, type: 'general-purpose', description: `do ${id}`, status })

/** Agents listed as given, one board task owned by `owner`, and the view and command calls the sidebar makes. */
async function seed($: Engine, on: On, listed: AgentInfo[], owner?: string) {
  mock.clock(on)
  const views: unknown[] = []
  const commands: string[] = []
  on('agent.list', () => ({ value: listed }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: listed[0]?.id ?? 'x' }))
  on('ui.view', (_, e) => {
    views.push(e)
    return { value: undefined } as never
  })
  on('command.run', (_, e) => {
    commands.push(e.command)
    return { text: '' } as never
  })
  on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '1', subject: 'x' } } } : { result: {} as never }))
  await $.agent.spawn({ prompt: 'go', description: 'seed' } as never)
  if (owner) {
    const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
    await call({ tool: 'TaskCreate', subject: 'Own it', description: 'd' })
    await call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', owner })
  }
  const mount = (surface: (typeof SURFACES)[number]) => $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  return { views, commands, mount }
}

test('with no team, "Build a team" runs /agent-hq:team on both surfaces', async ($, on) => {
  const s = await seed($, on, [agent('solo', 'running')])

  for (const surface of SURFACES) {
    const ui = await s.mount(surface)
    expect(await ui.find({ key: 'build-team', text: /Build a team/ }), surface).toBeDefined()
    await ui.press({ key: 'build-team' })
    await ui.unmount()
  }
  expect(s.commands).toEqual(['agent-hq:team', 'agent-hq:team'])
})

test('a task on the board opens the agent that owns it; an unowned task is plain text', async ($, on) => {
  const s = await seed($, on, [agent('owner', 'running')], 'owner')

  for (const surface of SURFACES) {
    const ui = await s.mount(surface)
    await ui.press({ key: 'open-task-1' })
    await ui.unmount()
  }
  expect(s.views).toEqual([{ agentId: 'owner' }, { agentId: 'owner' }])
})

test('a task owned by no listed agent is plain text', async ($, on) => {
  const s = await seed($, on, [agent('other', 'running')], 'nobody')
  const ui = await s.mount('terminal')

  expect(await ui.find({ key: 'open-task-1' })).toBeUndefined()
  expect(await ui.find({ text: /Own it/ })).toBeDefined()
  await ui.unmount()
})

test('the folded "+N more" line shows the folded agents when pressed', async ($, on) => {
  const s = await seed($, on, ['a', 'b', 'c', 'd', 'e', 'f'].map(id => agent(id, 'completed')))
  const ui = await s.mount('terminal')

  const more = await ui.find({ type: 'Button', text: /\+2 more/ })
  expect(more).toBeDefined()
  await ui.press({ key: String(more?.key) })
  expect(await ui.find({ type: 'Button', text: /\+2 more/ })).toBeUndefined()
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) expect(await ui.find({ key: `view-${id}` }), id).toBeDefined()
  await ui.unmount()
})

test('where Rasters are not drawn, a bar is an Svg that says its progress in its alt text', async ($, on) => {
  const s = await seed($, on, [agent('plain', 'running'), agent('owner', 'running')], 'owner')
  const ui = await s.mount('desktop')

  // the desktop keeps keys on what can be pressed only, so the bars are told apart by what they say
  const bars = await ui.findAll({ type: 'Svg' })
  expect(bars.map(b => b.props.alt)).toEqual(['getting started · 0 tools', 'in progress'])
  for (const bar of bars) expect(String(bar.props.source)).toMatch(/^<svg /)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})
