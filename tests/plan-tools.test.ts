// Spec for hq_plan and plan_task (docs/plans/task-sidebar.md task 4; spec AC1, AC2, AC4, AC5, AC7, AC20), with a hand-made `$` and
// in-memory deps, as tests/tools.test.ts does. The contract these tests pin down:
//  - hooks/tools.ts exports PLAN_TOOL (`mcp__agent-hq__hq_plan`), `hqPlan(input, deps)`, and a TOOL_SPECS entry `hq_plan`
//    ({ plan: string } required); isLeadTool knows it; hq_assign and hq_review get an optional integer `plan_task`;
//  - the lead's ToolDeps gain `readList(): Promise<{ list, reason? }>`, `writeList(list): Promise<void>` (hooks/tasklist.ts, bound to
//    tasks.json) and `readPlan(path): Promise<string | null>` (a project file's text, like readBrief);
//  - hq_plan: `plan` is a path inside the project (`deps.root()`), `.md` only, else refused before anything is read; the plan's
//    checklist is parsed (parsePlan) and merged over the earlier list (mergeList); one writeList call; the answer says "<n> tasks";
//  - plan_task is checked before any member starts: a number not in the list is refused naming the list's numbers;
//  - hq_assign with plan_task N: task N is working, the member has a work row (workMs 0) and a `start` event at deps.now();
//  - hq_review with plan_task N, or else the reviewed member's own task: that task is review, the reviewer has a work row with
//    step "review" and a `review` event;
//  - with no plan_task nothing in the list changes (no writeList), and with no list the tools behave as before.
import { expect, test } from 'claude-code/testing'

import type { HqAgent, HqAssignment } from '../types'
import { MAIN } from '../hooks/model'
import { parseTeam } from '../hooks/team'
import { TOOL_SPECS, hqAssign, hqPlan, hqReview, isLeadTool } from '../hooks/tools'
import type { ToolDeps } from '../hooks/tools'

const PARSED = parseTeam(
  JSON.stringify({
    name: 'T',
    purpose: 'p',
    lead: { title: 'Lead', rules: [], skills: [] },
    roles: [
      { id: 'dev', title: 'Developer', count: 2, mission: 'Build.', tasks: [], rules: [], skills: [] },
      { id: 'reviewer', title: 'Code Reviewer', count: 1, mission: 'Review.', tasks: [], rules: [], skills: [] },
    ],
  }),
)
if (typeof PARSED === 'string') throw new Error(PARSED)
const TEAM = PARSED

const ROOT = '/work/app'
const NOW = 1_761_300_000_000
const PLAN = '- [ ] 1. Store\n- [x] 2. Prices\n- [ ] 3. Guard\n'

const work = (over: Record<string, unknown> = {}) => ({ role: 'dev', step: 'build', workMs: 60_000, inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, model: 'claude-sonnet-5-5', ...over })
const task = (n: number, over: Record<string, unknown> = {}) => ({ n, title: `Task ${n}`, status: 'waiting', doneBy: null, startedAt: null, doneAt: null, work: {}, events: [], ...over })
type Row = ReturnType<typeof task>
const listOf = (tasks: Row[]) => ({ version: 1, plan: 'docs/plans/x.md', approvedAt: 1, tasks, removed: { workMs: 0, costUsd: 0 } })
type SavedList = ReturnType<typeof listOf>

const agent = (id: string, name: string, status: HqAgent['status'], role = 'agent-hq:dev'): HqAgent => ({ id, name, role, description: `job of ${name}`, status, startedAt: 0, tools: 0 })

type Setup = { list?: SavedList | null; plans?: Record<string, string>; agents?: HqAgent[]; reason?: string; kind?: 'missing' | 'invalid' | 'unreadable' }

function setup(options: Setup = {}) {
  const calls = { spawn: [] as Record<string, unknown>[], written: [] as SavedList[], read: [] as string[] }
  const memory = { assignments: {} as Record<string, HqAssignment>, results: {} as Record<string, string> }
  let current: SavedList | null = options.list === undefined ? null : options.list
  const rows = Object.fromEntries([{ id: MAIN, name: 'main', role: 'orchestrator', description: '', status: 'running', startedAt: 0, tools: 0 } as HqAgent, ...(options.agents ?? [])].map(a => [a.id, a]))
  const $ = {
    agent: {
      spawn: async (spec: Record<string, unknown>) => {
        calls.spawn.push(spec)
        return { model: 'sonnet', agentId: 'new1' }
      },
    },
    tool: { call: async (input: Record<string, unknown>) => (input.tool === 'TaskCreate' ? { result: { task: { id: '7' } } } : { result: {} }) },
    session: { send: async () => ({ isDelivered: true }) },
    ui: { log: () => undefined },
  } as never
  const deps = {
    readData: async () => ({ agents: rows, todos: {}, tasks: {}, now: 0, hideFinished: false, columns: 0, isLight: false, team: TEAM, assignments: memory.assignments }),
    syncAgents: async () => undefined,
    now: async () => NOW,
    assignmentOf: async (name: string) => memory.assignments[name],
    recordAssignment: async (name: string, assignment: HqAssignment) => void (memory.assignments[name] = assignment),
    resultOf: async (id: string) => memory.results[id],
    record: async () => undefined,
    readTeamFile: async () => null,
    writeTeam: async () => null,
    confirm: async () => 'yes' as const,
    root: async () => ROOT,
    readList: async () => (current ? { list: current } : { list: null, kind: options.kind ?? 'missing', reason: options.reason }),
    writeList: async (next: SavedList) => {
      calls.written.push(next)
      current = next
    },
    readPlan: async (path: string) => {
      calls.read.push(path)
      return options.plans?.[path] ?? null
    },
  } as unknown as ToolDeps
  return { $, deps, calls, memory, saved: () => calls.written[calls.written.length - 1] }
}

const THREE = () => listOf([task(1), task(2), task(3)])
const taskOf = (list: SavedList | undefined, n: number) => list?.tasks.find(t => t.n === n) as (Row & { work: Record<string, { step: string; workMs: number; role: string }>; events: { at: number; kind: string; who: string }[] }) | undefined

// ---- the tool is declared

test('hq_plan is a lead tool with a required plan path, and hq_assign and hq_review take an integer plan_task', () => {
  const spec = (name: string) => TOOL_SPECS.find(s => s.name === name) as { inputSchema: { properties: Record<string, { type?: string }>; required?: string[] } } | undefined

  expect(isLeadTool('mcp__agent-hq__hq_plan')).toBe(true)
  expect(spec('hq_plan')?.inputSchema.properties.plan?.type).toBe('string')
  expect(spec('hq_plan')?.inputSchema.required).toEqual(['plan'])
  expect(spec('hq_assign')?.inputSchema.properties.plan_task?.type).toBe('integer')
  expect(spec('hq_review')?.inputSchema.properties.plan_task?.type).toBe('integer')
  expect(spec('hq_assign')?.inputSchema.required).not.toContain('plan_task')
  expect(spec('hq_review')?.inputSchema.required).not.toContain('plan_task')
})

// ---- hq_plan: AC1, AC2

test('hq_plan saves the plan\'s checklist as the task list and says how many tasks (AC1)', async () => {
  const s = setup({ plans: { [`${ROOT}/docs/plans/x.md`]: PLAN, 'docs/plans/x.md': PLAN } })

  const answer = await hqPlan({ plan: 'docs/plans/x.md' }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(answer.text).toContain('3 tasks')
  expect(s.calls.written).toHaveLength(1)
  const saved = s.saved()!
  expect(saved.tasks.map(t => [t.n, t.status])).toEqual([[1, 'waiting'], [2, 'done'], [3, 'waiting']])
  expect(saved.plan).toBe('docs/plans/x.md')
  expect(saved.approvedAt).toBe(NOW)
})

test('hq_plan takes a path inside the project that is written out in full', async () => {
  const s = setup({ plans: { [`${ROOT}/docs/plans/x.md`]: PLAN } })

  const answer = await hqPlan({ plan: `${ROOT}/docs/plans/x.md` }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(s.saved()?.tasks).toHaveLength(3)
})

test('hq_plan refuses a plan with no checklist lines, says the line format it reads, and saves nothing (AC2)', async () => {
  const s = setup({ list: THREE(), plans: { [`${ROOT}/docs/plans/x.md`]: '# Plan\n\nJust prose.\n', 'docs/plans/x.md': '# Plan\n\nJust prose.\n' } })

  const answer = await hqPlan({ plan: 'docs/plans/x.md' }, s.deps)

  expect(answer.isError).toBe(true)
  expect(answer.text).toContain('- [ ] 1. Title')
  expect(answer.text).toContain('- [x] 1. Title')
  expect(s.calls.written).toEqual([])
})

test('hq_plan replaces an earlier list: the same number keeps its work, a dropped one moves to removed (AC3 through the tool)', async () => {
  const old = listOf([task(1, { status: 'working', work: { 'dev-1': work() } }), task(5, { work: { 'dev-2': work({ workMs: 30_000 }) } })])
  const s = setup({ list: old, plans: { 'docs/plans/x.md': PLAN, [`${ROOT}/docs/plans/x.md`]: PLAN } })

  await hqPlan({ plan: 'docs/plans/x.md' }, s.deps)

  const saved = s.saved()!
  expect(saved.tasks.map(t => t.n)).toEqual([1, 2, 3])
  expect(taskOf(saved, 1)?.work['dev-1']?.workMs).toBe(60_000)
  expect(saved.removed.workMs).toBe(30_000)
})

test('hq_plan refuses a path outside the project or not a .md file, before reading anything', async () => {
  const text = PLAN
  const s = setup({ plans: { '../secret.md': text, '/etc/plan.md': text, 'docs/plan.txt': text, 'docs/plans/x.md.json': text, [`${ROOT}/../other/x.md`]: text, 'docs/../../outside.md': text } })

  for (const plan of ['../secret.md', '/etc/plan.md', 'docs/plan.txt', 'docs/plans/x.md.json', `${ROOT}/../other/x.md`, 'docs/../../outside.md', 'plan', '']) {
    const answer = await hqPlan({ plan }, s.deps)

    expect(answer.isError, plan).toBe(true)
  }
  expect(s.calls.read).toEqual([])
  expect(s.calls.written).toEqual([])
})

test('hq_plan refuses missing or non-text input, and a plan file that cannot be read', async () => {
  const s = setup()

  for (const input of [undefined, null, {}, { plan: 7 }, { plan: ['a.md'] }, 'docs/plans/x.md']) {
    expect((await hqPlan(input, s.deps)).isError, JSON.stringify(input)).toBe(true)
  }
  const gone = await hqPlan({ plan: 'docs/plans/gone.md' }, s.deps)

  expect(gone.isError).toBe(true)
  expect(s.calls.written).toEqual([])
})

// ---- plan_task on hq_assign: AC4, AC5, AC20

test('hq_assign with plan_task 2 puts task 2 to working with that member in it and a start event (AC4)', async () => {
  const s = setup({ list: THREE() })

  const answer = await hqAssign(s.$, { role: 'dev', task: 'Build prices', plan_task: 2 }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(s.calls.spawn).toHaveLength(1)
  const saved = s.saved()
  const two = taskOf(saved, 2)
  expect(two?.status).toBe('working')
  expect(two?.startedAt).toBe(NOW)
  expect(two?.work['dev-1']).toMatchObject({ role: 'dev', workMs: 0 })
  expect(two?.events).toEqual([{ at: NOW, kind: 'start', who: 'dev-1' }])
  expect(taskOf(saved, 1)?.status).toBe('waiting')
  expect(taskOf(saved, 3)?.status).toBe('waiting')
})

test('hq_assign with a plan_task not in the list is refused, naming the list\'s numbers, and no member starts (AC5)', async () => {
  const s = setup({ list: THREE() })

  const answer = await hqAssign(s.$, { role: 'dev', task: 'Build it', plan_task: 9 }, s.deps)

  expect(answer.isError).toBe(true)
  expect(answer.text).toMatch(/1, 2, 3|1, 2 and 3/)
  expect(s.calls.spawn).toEqual([])
  expect(s.memory.assignments).toEqual({})
  expect(s.calls.written).toEqual([])
})

test('hq_assign refuses a plan_task that is not a whole positive number, before any member starts', async () => {
  const s = setup({ list: THREE() })

  for (const plan_task of [1.5, '2', 0, -1, null, Number.NaN, [2]]) {
    const answer = await hqAssign(s.$, { role: 'dev', task: 'Build it', plan_task }, s.deps)

    expect(answer.isError, String(plan_task)).toBe(true)
  }
  expect(s.calls.spawn).toEqual([])
  expect(s.calls.written).toEqual([])
})

test('hq_assign with a plan_task and no list is refused, and says there is no plan list', async () => {
  const s = setup({ list: null })

  const answer = await hqAssign(s.$, { role: 'dev', task: 'Build it', plan_task: 1 }, s.deps)

  expect(answer.isError).toBe(true)
  expect(answer.text).toMatch(/hq_plan|plan/i)
  expect(s.calls.spawn).toEqual([])
})

test('hq_assign without plan_task behaves as before and leaves the list alone, with a list or without (AC20)', async () => {
  for (const list of [THREE(), null]) {
    const s = setup({ list })

    const answer = await hqAssign(s.$, { role: 'dev', task: 'Build the search page', files: ['app/**'] }, s.deps)

    expect(answer.isError).toBeUndefined()
    expect(answer.text).toContain('Started dev-1 as Developer')
    expect(s.calls.spawn).toHaveLength(1)
    expect(s.calls.written).toEqual([])
  }
})

test('hq_assign whose start fails leaves the task as it was', async () => {
  const s = setup({ list: THREE() })

  const answer = await hqAssign(s.$, { role: 'ghost', task: 'Build it', plan_task: 1 }, s.deps)

  expect(answer.isError).toBe(true)
  expect(s.calls.written).toEqual([])
})

// ---- plan_task on hq_review: AC7, AC20

const reviewable = () => agent('a1', 'dev-1', 'completed')

test('hq_review with plan_task 2 puts task 2 to review and links the reviewer to it (AC7)', async () => {
  const list = listOf([task(1), task(2, { status: 'working', startedAt: 5, work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }), task(3)])
  const s = setup({ list, agents: [reviewable()] })

  const answer = await hqReview(s.$, { agent: 'dev-1', plan_task: 2 }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(s.calls.spawn).toHaveLength(1)
  const two = taskOf(s.saved(), 2)
  expect(two?.status).toBe('review')
  expect(two?.work['reviewer-1']).toMatchObject({ role: 'reviewer', step: 'review', workMs: 0 })
  expect(two?.work['dev-1']?.workMs).toBe(60_000) // the builder's work is kept
  expect(two?.events.at(-1)).toEqual({ at: NOW, kind: 'review', who: 'reviewer-1' })
  expect(taskOf(s.saved(), 1)?.status).toBe('waiting')
})

test('hq_review without plan_task uses the reviewed member\'s own task', async () => {
  const list = listOf([task(1), task(2), task(3, { status: 'working', work: { 'dev-1': work() } })])
  const s = setup({ list, agents: [reviewable()] })

  const answer = await hqReview(s.$, { agent: 'dev-1' }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(taskOf(s.saved(), 3)?.status).toBe('review')
  expect(taskOf(s.saved(), 3)?.work['reviewer-1']).toBeDefined()
  expect(taskOf(s.saved(), 2)?.status).toBe('waiting')
})

test('hq_review of a member linked to no task, with no plan_task, changes nothing in the list (AC20)', async () => {
  const s = setup({ list: THREE(), agents: [reviewable()] })

  const answer = await hqReview(s.$, { agent: 'dev-1' }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(s.calls.spawn).toHaveLength(1)
  expect(s.calls.written).toEqual([])
})

test('hq_review with no list behaves as today (AC20)', async () => {
  const s = setup({ list: null, agents: [reviewable()] })

  const answer = await hqReview(s.$, { agent: 'dev-1' }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(answer.text).toContain('reviewer-1')
  expect(s.calls.written).toEqual([])
})

test('hq_review with a plan_task not in the list is refused before any reviewer starts, naming the numbers', async () => {
  const s = setup({ list: THREE(), agents: [reviewable()] })

  const answer = await hqReview(s.$, { agent: 'dev-1', plan_task: 9 }, s.deps)

  expect(answer.isError).toBe(true)
  expect(answer.text).toMatch(/1, 2, 3|1, 2 and 3/)
  expect(s.calls.spawn).toEqual([])
  expect(s.memory.assignments).toEqual({})
  expect(s.calls.written).toEqual([])
})

test('hq_review with a plan_task and no list is refused, and a bad plan_task type too', async () => {
  const none = setup({ list: null, agents: [reviewable()] })
  expect((await hqReview(none.$, { agent: 'dev-1', plan_task: 1 }, none.deps)).isError).toBe(true)
  expect(none.calls.spawn).toEqual([])

  const s = setup({ list: THREE(), agents: [reviewable()] })
  for (const plan_task of [1.5, '2', 0, -3]) expect((await hqReview(s.$, { agent: 'dev-1', plan_task }, s.deps)).isError, String(plan_task)).toBe(true)
  expect(s.calls.spawn).toEqual([])
})

// ---- review round: the lock, a read error, a failing write, reopening a done task

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

test('two hq_assign with a plan_task at once both land in the list, however slow the file is', async () => {
  const s = setup({ list: THREE() })
  const read = s.deps.readList!
  const write = s.deps.writeList!
  s.deps.readList = async () => { const out = await read(); await tick(); return out }
  s.deps.writeList = async list => { await tick(); await write(list) }

  await Promise.all([
    hqAssign(s.$, { role: 'dev', task: 'A', name: 'dev-a', plan_task: 1 }, s.deps),
    hqAssign(s.$, { role: 'dev', task: 'B', name: 'dev-b', plan_task: 2 }, s.deps),
  ])

  const saved = s.saved()
  expect(taskOf(saved, 1)?.work['dev-a']).toBeDefined()
  expect(taskOf(saved, 2)?.work['dev-b']).toBeDefined()
})

test('hq_plan does not overwrite the list when it could not be read, and says why', async () => {
  const s = setup({ kind: 'unreadable', reason: 'could not read /work/app/.claude/agent-hq/tasks.json: EIO', plans: { [`${ROOT}/docs/plans/x.md`]: PLAN } })

  const answer = await hqPlan({ plan: 'docs/plans/x.md' }, s.deps)

  expect(answer.isError).toBe(true)
  expect(answer.text).toContain('could not read')
  expect(s.calls.written).toEqual([])
})

test('hq_plan rewrites a list that is invalid, and says it could not save when the write fails', async () => {
  const bad = setup({ kind: 'invalid', reason: 'not valid JSON (x)', plans: { [`${ROOT}/docs/plans/x.md`]: PLAN } })
  expect((await hqPlan({ plan: 'docs/plans/x.md' }, bad.deps)).isError).toBeUndefined()
  expect(bad.calls.written).toHaveLength(1)

  const s = setup({ plans: { [`${ROOT}/docs/plans/x.md`]: PLAN } })
  s.deps.writeList = async () => { throw new Error('disk full') }
  const answer = await hqPlan({ plan: 'docs/plans/x.md' }, s.deps)

  expect(answer.isError).toBe(true)
  expect(answer.text).toContain('could not save')
})

test('a list write that fails leaves the started member started', async () => {
  const s = setup({ list: THREE() })
  s.deps.writeList = async () => { throw new Error('disk full') }

  const answer = await hqAssign(s.$, { role: 'dev', task: 'Build', plan_task: 1 }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(s.calls.spawn).toHaveLength(1)
})

test('a member given a done task reopens it: doneAt and doneBy are cleared', async () => {
  const s = setup({ list: listOf([task(1, { status: 'done', doneBy: 'dev-9', doneAt: 5, work: { 'dev-9': work() } })]) })

  await hqAssign(s.$, { role: 'dev', task: 'Fix it', plan_task: 1 }, s.deps)

  expect(taskOf(s.saved(), 1)).toMatchObject({ status: 'working', doneBy: null, doneAt: null })
})

test('a member named like an object property gets its own work row', async () => {
  const s = setup({ list: THREE() })

  await hqAssign(s.$, { role: 'dev', task: 'A', name: 'constructor', plan_task: 1 }, s.deps)

  expect(Object.keys(taskOf(s.saved(), 1)?.work ?? {})).toEqual(['constructor'])
})
