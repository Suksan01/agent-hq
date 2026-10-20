// Where Rasters are not drawn, each bar is an Svg in plan-progress's look: a dot grid in its tone's colour filling to the
// done share, and at its head the pill the terminal's track carries (a count, a task's status, "getting started").
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { TONE_COLOR } from '../hooks/cells'

const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const agent = (id: string): AgentInfo => ({ id, name: id, type: 'general-purpose', description: `do ${id}`, status: 'running' })

/** Two working agents (one with no task yet, one owning a task in progress) and the lead's three todos, one done. */
async function seed($: Engine, on: On, activeForm = 'Owning it') {
  mock.clock(on)
  on('agent.list', () => ({ value: [agent('plain'), agent('owner')] }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'plain' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '1', subject: 'Own it' } } } : { result: {} as never }))
  // stands for the engine's own band: an empty Box
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as RenderElement)
  await $.agent.spawn({ prompt: 'go', description: 'seed' } as never)
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  await call({ tool: 'TaskCreate', subject: 'Own it', description: 'd' })
  await call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', owner: 'owner', activeForm })
  await call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read', status: 'completed', activeForm: 'Reading' },
      { content: 'Sum', status: 'in_progress', activeForm: 'Summarizing' },
      { content: 'Report', status: 'pending', activeForm: 'Reporting' },
    ],
  })
}

async function svgs($: Engine, component: 'Pane' | 'AbovePrompt') {
  const ui =
    component === 'Pane'
      ? await $.ui.mount({ plugin: 'agent-hq', surface: 'desktop', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
      : await $.ui.mount({ plugin: 'agent-hq', surface: 'desktop', component: 'AbovePrompt', props: BAND_PROPS as never })
  const found = await ui.findAll({ type: 'Svg' })
  const words = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return { bars: found.map(f => ({ alt: String(f.props.alt), source: String(f.props.source), height: f.props.height })), words }
}

/** What the pill at a track's head reads: the text of its one <text> element, tags dropped. */
const pillOf = (source: string) => (source.match(/<text[^>]*>(.*?)<\/text>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const dotsIn = (source: string) => source.split('h2v2h-2z').length - 1
const rgbOf = (hexColor: string) => `rgb(${[1, 3, 5].map(i => parseInt(hexColor.slice(i, i + 2), 16)).join(',')})`
const byAlt = <B extends { alt: string }>(bars: B[], alt: string): B => {
  const bar = bars.find(b => b.alt === alt)
  if (!bar) throw new Error(`no bar "${alt}" among ${bars.map(b => b.alt).join(' | ')}`)
  return bar
}

test("on desktop a todo bar is a dot grid in its tone's colour, filled to its share, with the count in a pill at its head", async ($, on) => {
  await seed($, on)
  const { bars } = await svgs($, 'Pane')
  const todo = byAlt(bars, '1 of 3 done')
  expect(pillOf(todo.source)).toBe('1/3')
  expect(dotsIn(todo.source)).toBeGreaterThan(20)
  expect(todo.source).toContain(TONE_COLOR.running) // the pill
  expect(todo.source).toContain(rgbOf(TONE_COLOR.running)) // the fill's tint
  expect(todo.height).toBe(22)
})

test("on desktop a working agent's bar with no todos carries its words in the pill, once", async ($, on) => {
  await seed($, on)
  const { bars, words } = await svgs($, 'Pane')
  const sweep = byAlt(bars, 'getting started · 0 tools')
  expect(pillOf(sweep.source)).toBe('getting started · 0 tools')
  expect(sweep.source).toContain('@keyframes') // no share known: a glow drifts along the track
  expect(pillOf(byAlt(bars, 'in progress').source)).toBe('in progress')
  // the words are in the bar, not repeated beside it
  expect(words.filter(w => /getting started|^in progress$/.test(w))).toEqual([])
})

test("the band's Team and Tasks tracks on desktop carry the terminal's pill: its words and n/m", async ($, on) => {
  await seed($, on)
  const { bars } = await svgs($, 'AbovePrompt')
  expect(bars.map(b => b.alt)).toEqual(['1 of 4 done', '0 of 1 done'])
  expect(pillOf(byAlt(bars, '1 of 4 done').source)).toBe('2 running 1/4')
  expect(pillOf(byAlt(bars, '0 of 1 done').source)).toBe('Owning it 0/1')
})

test("a task's words are escaped in the bar's Svg, so they draw as text and cannot break the picture", async ($, on) => {
  await seed($, on, 'Fix <b> & "quotes"')
  const { bars } = await svgs($, 'AbovePrompt')
  const tasks = byAlt(bars, '0 of 1 done').source
  expect(tasks).toContain('Fix &lt;b&gt; &amp; &quot;quotes&quot;')
  expect(tasks).not.toContain('<b>')
})
