// Spec for the wiring of the task list into register.tsx (docs/specs/task-sidebar.md AC6, AC9, AC11, AC12; F2 step 4, F4, F5), driven
// the way tests/usage-wiring.test.ts drives turn.complete and tests/mask-wiring.test.ts drives tool.call. The files are kept in memory;
// what the mod saves is read back from `.claude/agent-hq/tasks.json`. The contract these tests pin down:
//  - a member's turn.complete adds its time and tokens to the task it is linked to and saves the list; the lead's turn saves nothing;
//  - after a Write or Edit of the list's plan file the plan is read again, and newly ticked tasks are saved as done; a write to any
//    other file leaves the list alone;
//  - the lead's hq_plan is registered and answered, and saves the list from the plan file;
//  - a saved list is read in a new session with no task working until a linked member's turn says so; an invalid file is no list:
//    nothing is saved over it and nothing throws.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { TEAM_FILE } from '../hooks/team'

type Call = (input: Record<string, unknown>) => Promise<{ result?: unknown; isError?: boolean; deny?: string }>

const ROOT = '/work/app'
const LIST_FILE = `${ROOT}/.claude/agent-hq/tasks.json`
const PLAN_FILE = `${ROOT}/docs/plans/x.md`
const STATE = '/home/me/.claude/agent-hq/live/sess.json'
const TEAM = { name: 'Web', purpose: 'Ship it', lead: { title: 'Tech Lead', rules: [], skills: [] }, roles: [{ id: 'dev', title: 'Developer', count: 2, mission: 'Build.' }] }
const LISTED: AgentInfo[] = [{ id: 'd1', name: 'dev-1', type: 'agent-hq:dev', description: 'x', status: 'running' }]
const PLAN_OPEN = '- [ ] 1. Store\n- [ ] 2. Prices\n- [ ] 3. Guard\n'
const PLAN_TICKED = '- [ ] 1. Store\n- [x] 2. Prices\n- [ ] 3. Guard\n'

const work = (over: Record<string, unknown> = {}) => ({ role: 'dev', step: 'build', workMs: 1000, inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40, model: 'claude-sonnet-5-5', ...over })
const task = (n: number, over: Record<string, unknown> = {}) => ({ n, title: `Task ${n}`, status: 'waiting', doneBy: null, startedAt: null, doneAt: null, work: {}, events: [], ...over })
const saved = (status = 'working') => ({
  version: 1,
  plan: 'docs/plans/x.md',
  approvedAt: 1,
  tasks: [task(1), task(2, { status, startedAt: 10, work: { 'dev-1': work() }, events: [{ at: 10, kind: 'start', who: 'dev-1' }] }), task(3)],
  removed: { workMs: 0, costUsd: 0 },
})
type Saved = ReturnType<typeof saved>

/** The mod running with the live page, a developer `dev-1` (agent d1) and the given files in memory. */
async function boot($: Engine, on: On, initial: Record<string, string>) {
  const clock = mock.clock(on, { now: 1_000 })
  const files = new Map<string, string>(Object.entries({ [`${ROOT}/${TEAM_FILE}`]: JSON.stringify(TEAM), ...initial }))
  const listWrites: string[] = []
  const registered: string[] = []
  mock.store(on, { approvedTeams: withApproval([], `${ROOT}/${TEAM_FILE}`, JSON.stringify(TEAM)), languageAsked: true })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    if (e.path === STATE) return { value: undefined }
    files.set(e.path, e.text)
    if (e.path === LIST_FILE) listWrites.push(e.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'AGENT_HQ_URL http://127.0.0.1:4321\n' }
    await new Promise(() => {})
    return { value: { code: 0, signal: null } }
  })
  for (const event of ['ui.status', 'ui.open', 'ui.log', 'ui.toast', 'command.register'] as const) on(event, () => ({ value: undefined }) as never)
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('agent.list', () => ({ value: LISTED }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'd1' }))
  on('tool.register', (_, e) => {
    registered.push(e.name)
    return { value: { tool: `mcp__agent-hq__${e.name}` } } as never
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  // the engine's own Write and Edit change the file the plan is read from
  on('tool.call', (_, e) => {
    const input = e as unknown as { tool: string; file_path?: string; content?: string }
    if ((input.tool === 'Write' || input.tool === 'Edit') && input.file_path !== undefined) files.set(input.file_path.startsWith('/') ? input.file_path : `${ROOT}/${input.file_path}`, input.content ?? '')
    return { result: {} as never }
  })
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'go', subagentType: 'agent-hq:dev' } as never)
  await $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} } as never)
  await clock.settle()

  const turn = async (agentId: string | undefined, durationMs: number) => {
    await $.turn.complete({ answer: 'ok', durationMs, isAborted: false, turnId: `t${durationMs}`, reason: 'answer', ...(agentId ? { agentId } : {}), usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 7, cache_creation_input_tokens: 3, model: 'claude-opus-5-5' } } as never)
    await clock.settle()
  }
  const call = $.tool.call as unknown as Call
  const list = (): Saved | null => {
    const text = files.get(LIST_FILE)
    return text ? (JSON.parse(text) as Saved) : null
  }
  return { clock, files, turn, call, list, listWrites, registered }
}
const taskOf = (list: Saved | null, n: number) => list?.tasks.find(t => t.n === n) as (Saved['tasks'][number] & { work: Record<string, ReturnType<typeof work>> }) | undefined

test('a member\'s turn lands on its linked task in tasks.json: time, tokens, cache read and cache write apart (AC6)', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('working')) })

  await s.turn('d1', 60_000)

  expect(taskOf(s.list(), 2)?.work['dev-1']).toMatchObject({ workMs: 61_000, inputTokens: 110, outputTokens: 60, cacheReadTokens: 37, cacheWriteTokens: 43, model: 'claude-opus-5-5' })
  expect(taskOf(s.list(), 1)?.work).toEqual({})
  expect(taskOf(s.list(), 3)?.work).toEqual({})
})

test('a member\'s turn stamps lastAt with the clock\'s time when it completes', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('working')) })
  await s.clock.advance(5_000)

  await s.turn('d1', 1000)

  expect(taskOf(s.list(), 2)?.work['dev-1']).toMatchObject({ lastAt: 6_000 }) // boot's clock started at 1000
})

test('turns of the same member add up in the file', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('working')) })

  await s.turn('d1', 1500)
  await s.turn('d1', 500)

  expect(taskOf(s.list(), 2)?.work['dev-1']?.workMs).toBe(3000)
})

test('the lead\'s turn counts on no task and saves nothing (AC6)', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('working')) })
  const before = s.listWrites.length

  await s.turn(undefined, 60_000)

  expect(s.listWrites.length).toBe(before)
  expect(taskOf(s.list(), 2)?.work['dev-1']?.workMs).toBe(1000)
})

test('a member linked to no task counts on none', async ($, on) => {
  const list = saved('working')
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify({ ...list, tasks: [task(1), task(2)] }) })
  const before = s.listWrites.length

  await s.turn('d1', 60_000)

  expect(s.listWrites.length).toBe(before)
})

test('a builder\'s turn on a task in review moves it back to working in the file (AC8)', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('review')) })

  await s.turn('d1', 1000)

  expect(taskOf(s.list(), 2)?.status).toBe('working')
})

test('a turn with no list at all is noted as before and saves no tasks.json', async ($, on) => {
  const s = await boot($, on, {})

  await s.turn('d1', 1000)

  expect(s.listWrites).toEqual([])
  expect(s.files.has(LIST_FILE)).toBe(false)
})

test('an invalid tasks.json is no list: a turn throws nothing and saves nothing over it (AC12)', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: '{ half a file' })

  await s.turn('d1', 1000)

  expect(s.listWrites).toEqual([])
  expect(s.files.get(LIST_FILE)).toBe('{ half a file')
})

// ---- plan ticks: AC9

test('after the lead writes the plan file with a ticked box, that task is saved as done by its builder (AC9)', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('review')), [PLAN_FILE]: PLAN_OPEN })

  await s.call({ tool: 'Write', file_path: PLAN_FILE, content: PLAN_TICKED })
  await s.clock.settle()

  expect(taskOf(s.list(), 2)).toMatchObject({ status: 'done', doneBy: 'dev-1' })
  expect(taskOf(s.list(), 2)?.doneAt).toEqual(expect.any(Number))
  expect(taskOf(s.list(), 1)?.status).toBe('waiting')
  expect(taskOf(s.list(), 3)?.status).toBe('waiting')
})

test('an Edit of the plan file by a relative path re-reads it too', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('review')), [PLAN_FILE]: PLAN_OPEN })

  await s.call({ tool: 'Edit', file_path: 'docs/plans/x.md', content: PLAN_TICKED })
  await s.clock.settle()

  expect(taskOf(s.list(), 2)?.status).toBe('done')
})

test('a write to any other file leaves the list alone', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('review')), [PLAN_FILE]: PLAN_OPEN })
  const before = s.listWrites.length

  await s.call({ tool: 'Write', file_path: `${ROOT}/docs/plans/other.md`, content: PLAN_TICKED })
  await s.call({ tool: 'Write', file_path: `${ROOT}/src/a.ts`, content: 'x' })
  await s.clock.settle()

  expect(s.listWrites.length).toBe(before)
})

test('a plan write that ticks nothing new saves no change to the statuses', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('working')), [PLAN_FILE]: PLAN_OPEN })

  await s.call({ tool: 'Write', file_path: PLAN_FILE, content: `${PLAN_OPEN}\nA note.\n` })
  await s.clock.settle()

  expect(s.list()?.tasks.map(t => t.status)).toEqual(['waiting', 'working', 'waiting'])
})

test('a plan write with no list saved does nothing', async ($, on) => {
  const s = await boot($, on, { [PLAN_FILE]: PLAN_OPEN })

  await s.call({ tool: 'Write', file_path: PLAN_FILE, content: PLAN_TICKED })
  await s.clock.settle()

  expect(s.files.has(LIST_FILE)).toBe(false)
})

// ---- hq_plan is the lead's tool

test('hq_plan is offered with the lead\'s tools and saves the list from the plan file', async ($, on) => {
  const s = await boot($, on, { [PLAN_FILE]: PLAN_TICKED })

  const answer = await s.call({ tool: 'mcp__agent-hq__hq_plan', plan: 'docs/plans/x.md' })

  expect(s.registered).toContain('hq_plan')
  expect(answer.isError).toBeFalsy()
  expect(s.list()?.tasks.map(t => [t.n, t.status])).toEqual([[1, 'waiting'], [2, 'done'], [3, 'waiting']])
  expect(s.list()?.plan).toBe('docs/plans/x.md')
})

test('a member cannot call hq_plan', async ($, on) => {
  const s = await boot($, on, { [PLAN_FILE]: PLAN_TICKED })

  const answer = await s.call({ tool: 'mcp__agent-hq__hq_plan', plan: 'docs/plans/x.md', agentId: 'd1' })

  expect(answer.isError === true || answer.deny !== undefined).toBe(true)
  expect(s.files.has(LIST_FILE)).toBe(false)
})

// ---- a new session: AC11

test('a saved list is read in a new session with no task working, until a linked member\'s turn says so (AC11)', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('working')) })
  // whatever the mod saved on its own while starting shows nobody working, and every total is as saved
  for (const text of s.listWrites) {
    const written = JSON.parse(text) as Saved
    expect(written.tasks.filter(t => t.status === 'working'), 'a task working before any turn').toEqual([])
    expect(taskOf(written, 2)?.work['dev-1']?.workMs).toBe(1000)
  }

  await s.turn('d1', 2000)

  expect(taskOf(s.list(), 2)?.status).toBe('working')
  expect(taskOf(s.list(), 2)?.work['dev-1']?.workMs).toBe(3000)
})

// ---- one lock for turns and the lead's tools

test('a member\'s turn and an hq_assign link made at the same time both land in the file', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('working')) })

  const [, answer] = await Promise.all([s.turn('d1', 1000), s.call({ tool: 'mcp__agent-hq__hq_assign', role: 'dev', task: 'Build the guard', plan_task: 3 })])
  await s.clock.settle()

  expect(answer.isError).toBeFalsy()
  expect(taskOf(s.list(), 2)?.work['dev-1']?.workMs).toBe(2000)
  expect(taskOf(s.list(), 3)?.events.some((event: { kind: string }) => event.kind === 'start')).toBe(true)
})

// ---- more ways in

test('a Bash command that names the plan file ticks its tasks too (F4)', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('review')), [PLAN_FILE]: PLAN_OPEN })
  s.files.set(PLAN_FILE, PLAN_TICKED) // what the command did to the file

  await s.call({ tool: 'Bash', command: 'sed -i "s/- \\[ \\] 2\\./- [x] 2./" docs/plans/x.md' })
  await s.clock.settle()

  expect(taskOf(s.list(), 2)?.status).toBe('done')
})

test('a Bash command that does not name the plan file leaves the list alone', async ($, on) => {
  const s = await boot($, on, { [LIST_FILE]: JSON.stringify(saved('review')), [PLAN_FILE]: PLAN_TICKED })
  const before = s.listWrites.length

  await s.call({ tool: 'Bash', command: 'ls docs' })
  await s.clock.settle()

  expect(s.listWrites.length).toBe(before)
})
