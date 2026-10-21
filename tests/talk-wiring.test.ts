// Talk bubbles end to end: each source makes its bubble on the right card (SendMessage both ways, a plugin's send, an
// assignment, a hand-back, a finish without one), never from a prompt or the person's own message; each is a feed
// `message` too; the poll ends it after six seconds; the sidebars show it on line 3 in English and Thai, terminal and
// desktop, with the live tool line taking line 3 over the step while a call runs.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { TEAM_FILE } from '../hooks/team'
import { DOING_TOOL, MAIN } from '../hooks/model'
import { PERSON_FRAME } from '../hooks/actions'
import type { HqBubble } from '../types'

type Call = (input: Record<string, unknown>) => Promise<{ result?: unknown; isError?: boolean; deny?: string }>
type Ui = { findAll: (query: { type: string }) => Promise<{ text?: string; props: Record<string, unknown> }[]> }
type FeedEvent = { agent: string; kind: string; text: string; failed?: boolean }

const TEAM = {
  name: 'Web',
  purpose: 'Ship it',
  lead: { title: 'Tech Lead', rules: [], skills: [] },
  roles: [
    { id: 'dev', title: 'Developer', count: 3, mission: 'Build.' },
    { id: 'reviewer', title: 'Reviewer', count: 1, mission: 'Review.' },
  ],
}
const LISTED: AgentInfo[] = [
  { id: 'd1', name: 'dev-1', type: 'agent-hq:dev', description: 'x', status: 'running' },
  { id: 'r1', name: 'reviewer-1', type: 'agent-hq:reviewer', description: 'x', status: 'running' },
]
const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
const SECRET_PROMPT = 'PROMPT-ONLY: the full brief nobody should see on a card'

const STATE = '/home/me/.claude/agent-hq/live/sess.json'
type Snapshot = { bubbles?: HqBubble[]; events?: FeedEvent[] }
type Box = { probe?: () => Promise<void>; delivered: boolean; spawned: string; listed: AgentInfo[]; page: (action: Record<string, unknown>) => void }
type Session = { box: Box; call: Call; clock: MockClock; snapshot: () => Promise<Snapshot> }

/**
 * The team loaded with a developer and a reviewer at work, and the live page running (its snapshots caught as written);
 * `box.probe` runs inside each Grep, while the call is live.
 */
async function session($: Engine, on: On): Promise<Session> {
  const clock = mock.clock(on, { now: 1_000 })
  const snaps: Snapshot[] = []
  mock.store(on, { approvedTeams: withApproval([], `/work/app/${TEAM_FILE}`, JSON.stringify(TEAM)), languageAsked: true })
  // the page server's stdout: its URL first, then each request the page makes (box.page)
  const out: string[] = ['AGENT_HQ_URL http://127.0.0.1:4321\n']
  let wake = () => {}
  const page = (action: Record<string, unknown>) => {
    out.push(`AGENT_HQ_ACTION ${JSON.stringify(action)}\n`)
    wake()
  }
  const box: Box = { delivered: true, spawned: 'd1', listed: LISTED, page }
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('fs.exists', (_, e) => ({ value: e.path === `/work/app/${TEAM_FILE}` }))
  on('fs.read', () => ({ value: JSON.stringify(TEAM) }))
  on('fs.write', (_, e) => {
    if (e.path === STATE) snaps.push(JSON.parse(e.text))
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'sess' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* () {
    for (;;) {
      while (out.length > 0) yield { stream: 'stdout' as const, text: out.shift() as string }
      await new Promise<void>(resolve => (wake = resolve))
    }
  })
  for (const event of ['ui.status', 'ui.open', 'ui.log', 'ui.toast'] as const) on(event, () => ({ value: undefined }) as never)
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('agent.list', () => ({ value: box.listed }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: box.spawned }))
  on('session.send', () => (box.delivered ? { isDelivered: true } : { isDelivered: false, reason: 'nobody by that name' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as RenderElement)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', async (_, e) => {
    if (String(e.tool) === 'Grep') await box.probe?.()
    return e.tool === 'TaskCreate' ? { result: { task: { id: '7', subject: 'x' } } } : { result: {} as never }
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'go', subagentType: 'agent-hq:dev' } as never)
  await $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} } as never)
  await clock.settle()
  // the page's state is written at most every 50 ms: past that, the last write holds everything so far
  const snapshot = async () => {
    await clock.advance(60)
    return snaps.at(-1) ?? {}
  }
  return { box, call: $.tool.call as unknown as Call, clock, snapshot }
}

const bubblesOf = async (s: Session) => (await s.snapshot()).bubbles ?? []
const messagesOf = async (s: Session) => ((await s.snapshot()).events ?? []).filter(e => e.kind === 'message')
const placed = (b: HqBubble | undefined) => (b ? { agent: b.agent, other: b.other, dir: b.dir, text: b.text } : undefined)
const send = ($: Engine, e: Record<string, unknown>) => $.session.send({ origin: { kind: 'model' }, ...e } as never)

test('SendMessage both ways and between members: the bubble sits on the member, facing the other party', async ($, on) => {
  const s = await session($, on)
  await send($, { to: 'dev-1', text: 'Stop after this file. Then wait.' })
  expect(placed((await bubblesOf(s)).find(b => b.agent === 'd1'))).toEqual({ agent: 'd1', other: MAIN, dir: 'from', text: 'Stop after this file.' })

  await send($, { to: 'main', text: 'Done, 3 tests added.', agentId: 'r1' })
  expect(placed((await bubblesOf(s)).find(b => b.agent === 'r1'))).toEqual({ agent: 'r1', other: MAIN, dir: 'to', text: 'Done, 3 tests added.' })

  await send($, { to: 'reviewer-1', text: 'Can you check the API tests? Thanks', agentId: 'd1' })
  const all = await bubblesOf(s)
  expect(all.filter(b => b.agent === 'd1').map(placed)).toEqual([{ agent: 'd1', other: 'r1', dir: 'to', text: 'Can you check the API tests?' }]) // one per card
  expect((await messagesOf(s)).map(e => [e.agent, e.text])).toEqual([
    ['d1', '← Lead: Stop after this file.'],
    ['r1', '→ Lead: Done, 3 tests added.'],
    ['d1', expect.stringMatching(/^→ \S+: Can you check the API tests\?$/)],
  ])
})

test("a plugin's send (hq_review to a running reviewer) bubbles; the person's own message and an undelivered one do not", async ($, on) => {
  const s = await session($, on)
  const { box } = s
  await $.session.send({ to: 'r1', text: 'Another review for you:\n\nReview the work of dev-1.', origin: { kind: 'plugin', name: 'agent-hq' } } as never)
  expect(placed((await bubblesOf(s)).find(b => b.agent === 'r1'))).toEqual({ agent: 'r1', other: MAIN, dir: 'from', text: 'Another review for you:' })

  await $.session.send({ to: 'd1', text: `${PERSON_FRAME}\n\nplease hurry`, origin: { kind: 'plugin', name: 'agent-hq' } } as never)
  box.delivered = false
  await send($, { to: 'dev-1', text: 'Nobody gets this.' })
  await send($, { to: 'someone-in-another-session', text: 'Not a card here.' })
  expect((await bubblesOf(s)).map(b => b.agent)).toEqual(['r1'])
  expect((await messagesOf(s)).length).toBe(1)
})

test('an Agent start bubbles its description, an hq_assign start its task first line, never the prompt; a resume makes none', async ($, on) => {
  const s = await session($, on)
  const { box, call } = s
  box.spawned = 'r1'
  await $.agent.spawn({ prompt: SECRET_PROMPT, description: 'Check the search page', subagentType: 'agent-hq:reviewer', name: 'reviewer-1' } as never)
  expect(placed((await bubblesOf(s)).find(b => b.agent === 'r1'))).toEqual({ agent: 'r1', other: MAIN, dir: 'from', text: 'Check the search page' })

  box.spawned = 'd2'
  box.listed = [...LISTED, { id: 'd2', name: 'dev-2', type: 'agent-hq:dev', description: 'x', status: 'running' }]
  const assigned = await call({ tool: 'mcp__agent-hq__hq_assign', role: 'dev', task: 'Fix the old API. Keep the routes.\nSecond line with token=abc12345', done: 'tests pass' })
  expect(assigned.isError).toBeUndefined()
  expect(placed((await bubblesOf(s)).find(b => b.agent === 'd2'))).toEqual({ agent: 'd2', other: MAIN, dir: 'from', text: 'Fix the old API.' })

  box.spawned = 'd1'
  const before = (await messagesOf(s)).length
  await $.agent.spawn({ prompt: 'woken', description: 'Resumed run', subagentType: 'agent-hq:dev', resume: { agentId: 'd1' } } as never)
  expect((await messagesOf(s)).length).toBe(before)
  const said = JSON.stringify([await bubblesOf(s), await messagesOf(s)])
  expect(said).not.toMatch(/PROMPT-ONLY|Second line|abc12345|tests pass/)
  // the feed's own "assigned" line carries the task too: masked
  expect(JSON.stringify((await s.snapshot()).events)).not.toContain('abc12345')
})

test("a member started by a member: the bubble sits on the starter, pointing at the new one", async ($, on) => {
  const s = await session($, on)
  s.box.spawned = 'r1'
  await $.agent.spawn({ prompt: SECRET_PROMPT, description: 'Look over my diff', subagentType: 'agent-hq:reviewer', parentAgentId: 'd1' } as never)
  expect(placed((await bubblesOf(s)).find(b => b.agent === 'd1'))).toEqual({ agent: 'd1', other: 'r1', dir: 'to', text: 'Look over my diff' })
})

test("a run's end bubbles the answer the engine delivered: a hand-back's report, or the start of the last answer", async ($, on) => {
  const s = await session($, on)
  // the hand-back call itself shows nothing: its report may yet be withheld; the turn's end carries what was delivered
  expect((await s.call({ tool: 'SubagentHandback', agentId: 'd1', message: '## Stage 3\nRaw words never shown. More.' })).deny).toBeUndefined()
  expect(await bubblesOf(s)).toEqual([])
  await $.turn.complete({ answer: '## Stage 3\nAll green: 12 tests added. Files below.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'd1' } as never)
  expect(placed((await bubblesOf(s)).find(b => b.agent === 'd1'))).toEqual({ agent: 'd1', other: MAIN, dir: 'to', text: 'All green: 12 tests added.' })

  await $.turn.complete({ answer: 'APPROVED. Two nits in api.ts', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'r1' } as never)
  expect(placed((await bubblesOf(s)).find(b => b.agent === 'r1'))).toEqual({ agent: 'r1', other: MAIN, dir: 'to', text: 'APPROVED.' })
  await $.turn.complete({ answer: 'cut off', durationMs: 5, isAborted: true, turnId: 't3', reason: 'aborted', agentId: 'd1' } as never)
  await $.turn.complete({ answer: 'the lead answers the person', durationMs: 5, isAborted: false, turnId: 't4', reason: 'answer' } as never)
  expect((await messagesOf(s)).length).toBe(2)
})

test("a teammate: SendMessage to team-lead bubbles toward the lead; its turn's end does not (its words reach the lead by SendMessage); to the user, none", async ($, on) => {
  const s = await session($, on)
  s.box.listed = [...LISTED, { id: 't1', name: 'scout', type: 'agent-hq:dev', description: 'x', status: 'running', teammateId: 'scout@web' } as AgentInfo]
  await s.clock.advance(1_000) // the poll lists it
  await send($, { to: 'team-lead', text: 'Found the slow query.', agentId: 't1' })
  expect(placed((await bubblesOf(s)).find(b => b.agent === 't1'))).toEqual({ agent: 't1', other: MAIN, dir: 'to', text: 'Found the slow query.' })
  await send($, { to: 'user', text: 'Hello person.', agentId: 'r1' })
  await $.turn.complete({ answer: 'Idle now. Waiting.', durationMs: 5, isAborted: false, turnId: 't5', reason: 'answer', agentId: 't1' } as never)
  expect((await messagesOf(s)).map(e => e.text)).toEqual(['→ Lead: Found the slow query.'])
})

test("an agent the person starts from the live page makes no bubble: the task is the person's own words", async ($, on) => {
  const s = await session($, on)
  s.box.spawned = 'd2'
  s.box.listed = [...LISTED, { id: 'd2', name: 'dev-2', type: 'agent-hq:dev', description: 'x', status: 'running' }]
  await s.clock.advance(1_000) // the poll lets the page's requests run
  s.box.page({ id: 1, type: 'spawn', role: 'dev', task: 'Please fix the login page for me.' })
  await s.clock.advance(1_000)
  const snap = await s.snapshot()
  expect(snap.events?.some(e => e.kind === 'action' && /^started /.test(e.text) && e.failed === false)).toBe(true) // it did start
  expect(snap.bubbles ?? []).toEqual([])
  expect((snap.events ?? []).filter(e => e.kind === 'message')).toEqual([])
})

test('the poll ends a bubble after six seconds', async ($, on) => {
  const s = await session($, on)
  await send($, { to: 'dev-1', text: 'Stop after this file.' })
  await s.clock.advance(4_900)
  expect((await bubblesOf(s)).length).toBe(1)
  await s.clock.advance(1_100)
  expect(await bubblesOf(s)).toEqual([])
})

const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
// a line as read: the tree's branch and gutter before it left out (the desktop draws them inside the line)
const clean = (line: string) => line.replace(/^[│└├─\s]+/, '').trimEnd()

/** The row line after the one that reads `▸ said`, skipping its gutter and the pieces nested in it (the desktop's). */
function lineAfter(lines: string[], said: string): string | undefined {
  const all = lines.map(clean)
  const at = all.indexOf(`▸ ${said}`)
  return at < 0 ? undefined : all.slice(at + 1).find(line => line !== '' && line !== `▸ ${said}`)
}

/** No Thai code point in any Raster cell the tree holds. */
async function expectNoThaiCells(ui: Ui) {
  for (const r of await ui.findAll({ type: 'Raster' })) {
    const words = new Uint32Array(Uint8Array.from(atob(String(r.props.cells)), c => c.charCodeAt(0)).buffer)
    for (let i = 0; i < words.length; i += 3) expect((words[i] ?? 0) >= 0x0e00 && (words[i] ?? 0) <= 0x0e7f).toBe(false)
  }
}

for (const lang of ['en', 'th'] as const) {
  const words =
    lang === 'en'
      ? { lead: 'Lead', task: /^task: Fixing the old API$/, said: 'Working on the old API', order: 'Fix the old API' }
      : { lead: 'หัวหน้า', task: /^งาน: กำลังแก้ API เก่า$/, said: 'กำลังทำ API เก่า', order: 'แก้ปัญหาของ API เก่า' }
  test(`${lang}: line 3 is the step between calls, the live tool line during one, and a bubble over both while it lasts`, { options: { language: lang === 'th' ? 'thai' : 'english' } }, async ($, on) => {
    const { box, call, clock } = await session($, on)
    const step = lang === 'en' ? { content: 'Fix the old API', activeForm: 'Fixing the old API' } : { content: 'แก้ API เก่า', activeForm: 'กำลังแก้ API เก่า' }
    await call({ tool: 'TodoWrite', agentId: 'd1', todos: [{ ...step, status: 'in_progress' }] })
    await call({ tool: DOING_TOOL, agentId: 'd1', text: words.said })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
      expect(lineAfter(await texts(ui), words.said), surface).toMatch(words.task) // no call runs: the step

      let during: string[] = []
      box.probe = async () => void (during = await texts(ui))
      await call({ tool: 'Grep', pattern: 'routes', agentId: 'd1', tool_use_id: `g-${surface}` })
      expect(lineAfter(during, words.said), surface).toMatch(/^[▸▹] \S.* · \d/) // the live tool line took line 3
      expect(during.some(line => words.task.test(clean(line))), surface).toBe(false)

      await send($, { to: 'dev-1', text: `${words.order}. More after.` })
      await call({ tool: 'Grep', pattern: 'routes', agentId: 'd1', tool_use_id: `g2-${surface}` })
      const talk = `» ← ${words.lead}: ${words.order}.`
      expect(lineAfter(during, words.said), surface).toBe(talk) // a bubble over the live line
      expect(lineAfter(await texts(ui), words.said), surface).toBe(talk) // and over the step
      if (surface === 'terminal') await expectNoThaiCells(ui)

      await clock.advance(6_000)
      const gone = await texts(ui)
      expect(gone.some(line => line.includes('»')), surface).toBe(false)
      expect(lineAfter(gone, words.said), surface).toMatch(words.task)
      await ui.unmount()
    }
  })
}

for (const lang of ['en', 'th'] as const) {
  test(`${lang}: the lead keeps its crew count on line 3 while its own call runs`, { options: { language: lang === 'th' ? 'thai' : 'english' } }, async ($, on) => {
    const { box, call } = await session($, on)
    const crew = lang === 'en' ? '2 of 2 working' : 'ทำงานอยู่ 2 จาก 2'
    await call({ tool: DOING_TOOL, text: 'Splitting the release' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
      let during: string[] = []
      box.probe = async () => void (during = await texts(ui))
      await call({ tool: 'Grep', pattern: 'release', tool_use_id: `lead-${surface}` })
      expect(lineAfter(during, 'Splitting the release'), surface).toBe(crew)
      await ui.unmount()
    }
  })
}

test('a member with a live bubble draws its full row, so line 3 shows it even once it finished; then one line again', async ($, on) => {
  const s = await session($, on)
  s.box.listed = [LISTED[0] as AgentInfo, { ...(LISTED[1] as AgentInfo), status: 'completed' }]
  await s.clock.advance(1_000) // the poll sees it finished: a one-line row
  await $.turn.complete({ answer: 'APPROVED. Two nits in api.ts', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'r1' } as never)
  const memberBots = async (ui: Ui) => (await ui.findAll({ type: 'Raster' })).filter(r => r.props.rows === 3).length // a full member row's bot
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
    expect((await texts(ui)).map(clean), surface).toContain('» → Lead: APPROVED.')
    if (surface === 'terminal') expect(await memberBots(ui)).toBe(2) // the working developer's, and the finished reviewer's while it talks
    await ui.unmount()
  }
  await s.clock.advance(6_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
    expect((await texts(ui)).some(l => l.includes('»')), surface).toBe(false)
    if (surface === 'terminal') expect(await memberBots(ui)).toBe(1)
    await ui.unmount()
  }
})

test("a member's sentence ends with its turn, as the lead's does", async ($, on) => {
  const s = await session($, on)
  await s.call({ tool: DOING_TOOL, agentId: 'd1', text: 'Checking the routes' })
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  expect((await texts(ui)).map(clean)).toContain('▸ Checking the routes')
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: false, turnId: 't9', reason: 'answer', agentId: 'd1' } as never)
  expect((await texts(ui)).map(clean)).not.toContain('▸ Checking the routes')
  await ui.unmount()
})
