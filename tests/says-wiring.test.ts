// hq_doing end to end: the lead and a tool-limited member say what they do; the sidebar shows it on the row's second
// line (the tool and its seconds on the third), the band's activity line and the snapshot use it, in English and Thai.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { TEAM_FILE } from '../hooks/team'
import { DOING_TOOL, MAIN, mergeAgents } from '../hooks/model'
import { buildSnapshot } from '../hooks/live'
import type { HqData } from '../hooks/view'

type Call = (input: Record<string, unknown>) => Promise<{ result?: unknown; isError?: boolean; deny?: string }>
type Ui = { findAll: (query: { type: string }) => Promise<{ text?: string }[]> }

const TEAM = {
  name: 'Web',
  purpose: 'Ship it',
  lead: { title: 'Tech Lead', rules: [], skills: [] },
  roles: [
    { id: 'dev', title: 'Developer', count: 2, mission: 'Build.' },
    { id: 'reviewer', title: 'Reviewer', count: 1, mission: 'Review.', tools: ['Read', 'Grep'], guard: { readOnly: true } },
  ],
}
const LISTED: AgentInfo[] = [
  { id: 'd1', name: 'dev-1', type: 'agent-hq:dev', description: 'x', status: 'running' },
  { id: 'r1', name: 'reviewer-1', type: 'agent-hq:reviewer', description: 'x', status: 'running' },
]
const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

/** The team loaded with a developer and a reviewer at work; `box.probe` runs inside each Grep, while the call is live. */
async function session($: Engine, on: On) {
  mock.clock(on)
  mock.store(on, { approvedTeams: withApproval([], `/work/app/${TEAM_FILE}`, JSON.stringify(TEAM)), languageAsked: true })
  const box: { probe?: () => Promise<void> } = {}
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('fs.exists', (_, e) => ({ value: e.path === `/work/app/${TEAM_FILE}` }))
  on('fs.read', () => ({ value: JSON.stringify(TEAM) }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('agent.list', () => ({ value: LISTED }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'd1' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as RenderElement)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', async (_, e) => {
    if (String(e.tool) === 'Grep') await box.probe?.()
    return { result: {} as never }
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'go', subagentType: 'agent-hq:dev' } as never)
  return { box, call: $.tool.call as unknown as Call }
}

const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

test('a tool-limited member and the lead say what they do; the row shows it on line 2 and the tool on line 3', async ($, on) => {
  const { box, call } = await session($, on)
  const reviewer = await call({ tool: DOING_TOOL, agentId: 'r1', text: 'Checking the API tests\nfor the search page' })
  expect(reviewer.deny).toBeUndefined()
  expect(reviewer.isError).toBeUndefined()
  expect(String(reviewer.result)).toMatch(/Checking the API tests for the search page/)
  expect((await call({ tool: DOING_TOOL, text: 'Splitting the release into parts' })).isError).toBeUndefined()

  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  let during: string[] = []
  box.probe = async () => void (during = await texts(ui))
  await call({ tool: 'Grep', pattern: 'search', agentId: 'r1', tool_use_id: 'g1' })

  const at = (pattern: RegExp) => during.findIndex(line => pattern.test(line))
  expect(at(/^▸ Checking the API tests for the search page$/)).toBeGreaterThan(-1)
  expect(at(/^[▸▹] Searching for search · 0s$/)).toBe(at(/^▸ Checking the API tests/) + 1) // the tool moved to the line below
  expect(at(/^▸ Splitting the release into parts$/)).toBeGreaterThan(-1)
  await ui.unmount()
})

test('the step in progress speaks when nothing was said, and a new step retires an old sentence', async ($, on) => {
  const { call } = await session($, on)
  await call({ tool: 'TodoWrite', agentId: 'd1', todos: [{ content: 'Fix the old API', status: 'in_progress', activeForm: 'Fixing the old API' }] })
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  expect(await ui.find({ text: /^▸ Fixing the old API$/ })).toBeDefined()

  await call({ tool: DOING_TOOL, agentId: 'd1', text: 'Working on the old API and fixing its issues' })
  expect(await ui.find({ text: /^▸ Working on the old API and fixing its issues$/ })).toBeDefined()

  await call({ tool: 'TodoWrite', agentId: 'd1', todos: [{ content: 'Fix the old API', status: 'completed', activeForm: 'x' }, { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' }] })
  expect(await ui.find({ text: /Working on the old API/ })).toBeUndefined()
  expect(await ui.find({ text: /^▸ Writing tests$/ })).toBeDefined()

  await call({ tool: DOING_TOOL, agentId: 'd1', text: 'Adding the missing cases' })
  await call({ tool: DOING_TOOL, agentId: 'd1', text: '' }) // an empty text clears it
  expect(await ui.find({ text: /Adding the missing cases/ })).toBeUndefined()
  await ui.unmount()
})

test("the lead's sentence ends with its turn", async ($, on) => {
  const { call } = await session($, on)
  await call({ tool: DOING_TOOL, text: 'Splitting the release into parts' })
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  expect(await ui.find({ text: /Splitting the release/ })).toBeDefined()
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(await ui.find({ text: /Splitting the release/ })).toBeUndefined()
  expect(await ui.find({ text: /^▸ Waiting for 2 of 2 members$/ })).toBeDefined() // the derived line takes its place
  await ui.unmount()
})

test('the band names who does what by their sentences', async ($, on) => {
  const { box, call } = await session($, on)
  await call({ tool: DOING_TOOL, agentId: 'r1', text: 'Checking the API tests' })
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never, viewport: { columns: 100, rows: 40, isFullscreen: true } as never })
  expect(await ui.find({ text: /: Checking the API tests/ })).toBeDefined()
  let during = ''
  box.probe = async () => void (during = (await texts(ui)).join('\n'))
  await call({ tool: 'Grep', pattern: 'x', agentId: 'd1', tool_use_id: 'g2' })
  expect(during).toMatch(/: Searching for x/) // no sentence: its tool line, as before
  await ui.unmount()
})

test('in Thai the sentence shows whole on the sidebar and band, never in a cell', { options: { language: 'thai' } }, async ($, on) => {
  const { call } = await session($, on)
  await call({ tool: DOING_TOOL, agentId: 'd1', text: 'กำลังทำ API เก่าและแก้ปัญหาที่เจอ' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
    expect(await ui.find({ text: /▸ กำลังทำ API เก่าและแก้ปัญหาที่เจอ/ }), surface).toBeDefined()
    expect(await ui.find({ text: /▸ รอสมาชิก 1\/2|▸ รอสมาชิก 2\/2/ }), surface).toBeDefined()
    await ui.unmount()
  }
  const band = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never, viewport: { columns: 100, rows: 40, isFullscreen: true } as never })
  expect(await band.find({ text: /: กำลังทำ API เก่าและแก้ปัญหาที่เจอ/ })).toBeDefined()
  for (const r of await band.findAll({ type: 'Raster' })) {
    const words = new Uint32Array(Uint8Array.from(atob(String(r.props.cells)), c => c.charCodeAt(0)).buffer)
    for (let i = 0; i < words.length; i += 3) expect((words[i] ?? 0) >= 0x0e00 && (words[i] ?? 0) <= 0x0e7f).toBe(false)
  }
  await band.unmount()
})

test('the snapshot carries each agent says: the sentence, else its fallback, else null', () => {
  const listed: AgentInfo[] = [
    { id: 'a', name: 'dev-a', type: 'agent-hq:dev', description: 'x', status: 'running' },
    { id: 'b', name: 'dev-b', type: 'agent-hq:dev', description: 'x', status: 'running' },
    { id: 'c', name: 'dev-c', type: 'agent-hq:dev', description: 'x', status: 'completed' },
  ]
  const data: HqData = {
    agents: mergeAgents({}, listed, 0),
    todos: { b: [{ content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' }] },
    tasks: {},
    now: 10,
    hideFinished: false,
    columns: 0,
    isLight: false,
    team: null,
    says: { a: { text: 'Fixing the old API', at: 5 }, c: { text: 'Old news', at: 1 } },
  }
  const byId = Object.fromEntries(buildSnapshot(data, 10).agents.map(a => [a.id, a.says]))
  expect(byId).toEqual({ [MAIN]: 'Waiting for 2 of 3 members', a: 'Fixing the old API', b: 'Writing tests', c: null })
})
