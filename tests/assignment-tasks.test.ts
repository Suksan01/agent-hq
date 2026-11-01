// Spec for the task table without a plan: each hq_assign that has no plan list adds its own row (docs/specs/task-sidebar.md "Assignments as tasks").
// The contract these tests pin down:
//  - TaskList gains an optional `source: 'assignments'` (a plan list, and a 0.9.0 file, have none); parseList reads both and rejects any other source;
//  - titleOfAssignment(text): the first non-empty line, trimmed, secrets masked, controls dropped, cut to 60 code units with "…", never inside a cluster;
//  - addAssignmentRow(list | null, { who, role, task, at }): a new list (plan "", source "assignments") or the next number on an assignments list, working, with the member's work row and a start event;
//  - hq_assign with no plan_task: no list at all (missing file) -> an assignments list with row 1; an assignments list -> the next row; a plan list, an invalid or unreadable file -> nothing written;
//  - hq_assign / hq_review with plan_task while only an assignments list exists: refused as "no plan list";
//  - hq_review of a member without plan_task: its row (even a done one) goes to review with the reviewer linked;
//  - hq_plan over an assignments list replaces it outright (no merge, no removed totals), the result has no source;
//  - settleAssignmentRows(list, agents, at): working -> done when every member completed, -> waiting when one failed or stopped; review -> done when the
//    reviewers completed; a running or unlisted member changes nothing; a plan list is never touched; nothing changed returns the same list;
//  - settleForNewSession keeps the source and sets working rows to waiting.
import { expect, test } from 'claude-code/testing'

import type { HqAgent, HqAssignment } from '../types'
import { addAssignmentRow } from '../hooks/assign'
import { MAIN } from '../hooks/model'
import { parseList, titleOfAssignment } from '../hooks/tasklist'
import type { ListTask, TaskList } from '../hooks/tasklist'
import { parseTeam } from '../hooks/team'
import { settleAssignmentRows, settleForNewSession } from '../hooks/taskwork'
import { hqAssign, hqPlan, hqReview } from '../hooks/tools'
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

type Row = Record<string, unknown>
const work = (over: Row = {}) => ({ role: 'dev', step: 'build', workMs: 60_000, inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, model: 'claude-sonnet-5-5', lastAt: null, ...over })
const task = (n: number, over: Row = {}) => ({ n, title: `Task ${n}`, status: 'waiting', doneBy: null, startedAt: null, doneAt: null, work: {}, events: [], ...over })
const assignments = (...tasks: Row[]) => ({ version: 1, plan: '', approvedAt: 1, source: 'assignments', tasks, removed: { workMs: 0, costUsd: 0 } }) as unknown as TaskList
const planList = (...tasks: Row[]) => ({ version: 1, plan: 'docs/plans/x.md', approvedAt: 1, tasks, removed: { workMs: 0, costUsd: 0 } }) as unknown as TaskList
const rowOf = (list: TaskList | undefined, n: number) => list?.tasks.find(t => t.n === n) as ListTask | undefined
const agent = (id: string, name: string, status: HqAgent['status'], role = 'agent-hq:dev'): HqAgent => ({ id, name, role, description: name, status, startedAt: 0, tools: 0 })
const agentsOf = (...list: HqAgent[]) => Object.fromEntries(list.map(a => [a.id, a]))

// ---- the saved file

test('parseList reads an assignments list and a file with no source, and rejects any other source', () => {
  const text = (source?: unknown) => JSON.stringify({ ...planList(task(1)), ...(source === undefined ? {} : { source }) })

  expect(parseList(text('assignments')).list?.source).toBe('assignments')
  expect(parseList(text()).list?.source).toBeUndefined() // a 0.9.0 file
  for (const bad of ['plan', 7, null, true]) expect(parseList(text(bad)).list, String(bad)).toBeNull()
})

// ---- the title

test('titleOfAssignment is the first line, trimmed, with secrets masked and no control characters', () => {
  expect(titleOfAssignment('  Build the search page  \nmore detail\nand more')).toBe('Build the search page')
  expect(titleOfAssignment('\n\n  Second line wins when the first is empty\n')).toBe('Second line wins when the first is empty')
  expect(titleOfAssignment('Fix\u0007the\u001bbell')).toBe('Fix the bell')
  expect(titleOfAssignment('Use key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789')).not.toContain('abcdefghijkl')
})

test('titleOfAssignment cuts a long line to 60 code units with an ellipsis and never inside an emoji', () => {
  const plain = titleOfAssignment('x'.repeat(100))
  expect(plain.length).toBeLessThanOrEqual(60)
  expect(plain.endsWith('…')).toBe(true)
  expect(titleOfAssignment('y'.repeat(60))).toBe('y'.repeat(60)) // exactly 60 stays whole

  const emoji = titleOfAssignment(`${'a'.repeat(58)}👨‍👩‍👧‍👦 and the rest of the line`)
  expect(emoji.length).toBeLessThanOrEqual(60)
  expect(emoji).not.toMatch(/[\ud800-\udbff]$|[\ud800-\udbff]…$/) // no lone high surrogate before the cut
  expect(emoji).not.toContain('‍…')
})

// ---- addAssignmentRow

test('addAssignmentRow makes an assignments list from nothing, and numbers the next row after the last', () => {
  const first = addAssignmentRow(null, { who: 'dev-1', role: 'dev', task: 'Build prices\nwith details', at: NOW })

  expect(first).toMatchObject({ version: 1, plan: '', source: 'assignments', approvedAt: NOW, removed: { workMs: 0, costUsd: 0 } })
  expect(first.tasks).toHaveLength(1)
  expect(rowOf(first, 1)).toMatchObject({ n: 1, title: 'Build prices', status: 'working', startedAt: NOW, doneAt: null, doneBy: null })
  expect(rowOf(first, 1)?.work['dev-1']).toMatchObject({ role: 'dev', step: 'build', workMs: 0, lastAt: null })
  expect(rowOf(first, 1)?.events).toEqual([{ at: NOW, kind: 'start', who: 'dev-1' }])

  const second = addAssignmentRow(first, { who: 'dev-2', role: 'dev', task: 'Build guard', at: NOW + 1 })
  expect(second.tasks.map(t => [t.n, t.title])).toEqual([[1, 'Build prices'], [2, 'Build guard']])
  expect(first.tasks).toHaveLength(1) // the list it was given is not changed

  const gap = addAssignmentRow(assignments(task(4)), { who: 'dev-1', role: 'dev', task: 'x', at: NOW })
  expect(gap.tasks.map(t => t.n)).toEqual([4, 5])
})

// ---- settleAssignmentRows

test('a working row is done once its member completed: doneAt and doneBy are set', () => {
  const list = assignments(task(1, { status: 'working', startedAt: 5, work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))

  const next = settleAssignmentRows(list, agentsOf(agent('a1', 'dev-1', 'completed')), NOW)

  expect(rowOf(next, 1)).toMatchObject({ status: 'done', doneAt: NOW, doneBy: 'dev-1' })
  expect(next.source).toBe('assignments')
})

test('a row whose member still runs, or is not listed yet, stays as it is, and the same list comes back', () => {
  const list = assignments(task(1, { status: 'working', work: { 'dev-1': work() } }), task(2, { status: 'working', work: { 'dev-2': work() } }))

  for (const status of ['running', 'pending', 'waiting', 'idle'] as const) {
    expect(settleAssignmentRows(list, agentsOf(agent('a1', 'dev-1', status), agent('a2', 'dev-2', 'running')), NOW), status).toBe(list)
  }
  expect(settleAssignmentRows(list, {}, NOW)).toBe(list)
})

test('a row with a member still running is not done when the other member completed', () => {
  const list = assignments(task(1, { status: 'working', work: { 'dev-1': work(), 'dev-2': work() } }))

  const next = settleAssignmentRows(list, agentsOf(agent('a1', 'dev-1', 'completed'), agent('a2', 'dev-2', 'running')), NOW)

  expect(next).toBe(list)
})

test('a working row whose member failed or was stopped waits (the closest existing behaviour: settleForNewSession\'s), and is not done', () => {
  const list = assignments(task(1, { status: 'working', work: { 'dev-1': work() } }), task(2, { status: 'working', work: { 'dev-2': work() } }))

  const next = settleAssignmentRows(list, agentsOf(agent('a1', 'dev-1', 'failed'), agent('a2', 'dev-2', 'killed')), NOW)

  expect(next.tasks.map(t => [t.status, t.doneAt])).toEqual([['waiting', null], ['waiting', null]])
})

test('a row in review is done when its reviewer completed; it stays in review while the reviewer runs or if the reviewer failed', () => {
  const list = assignments(task(1, { status: 'review', work: { 'dev-1': work(), 'reviewer-1': work({ role: 'reviewer', step: 'review' }) } }))
  const dev = agent('a1', 'dev-1', 'completed')
  const reviewer = (status: HqAgent['status']) => agent('r1', 'reviewer-1', status, 'agent-hq:reviewer')

  expect(rowOf(settleAssignmentRows(list, agentsOf(dev, reviewer('completed')), NOW), 1)).toMatchObject({ status: 'done', doneBy: 'dev-1', doneAt: NOW }) // the builder is the finisher, as for a ticked plan task
  expect(settleAssignmentRows(list, agentsOf(dev, reviewer('running')), NOW)).toBe(list)
  expect(settleAssignmentRows(list, agentsOf(dev, reviewer('failed')), NOW)).toBe(list)
})

test('a plan list, and a row already done or waiting, are never touched', () => {
  const plan = planList(task(1, { status: 'working', work: { 'dev-1': work() } }))
  const done = assignments(task(1, { status: 'done', doneAt: 3, doneBy: 'dev-1', work: { 'dev-1': work() } }), task(2, { work: { 'dev-2': work() } }))
  const all = agentsOf(agent('a1', 'dev-1', 'completed'), agent('a2', 'dev-2', 'completed'))

  expect(settleAssignmentRows(plan, all, NOW)).toBe(plan)
  expect(settleAssignmentRows(done, all, NOW)).toBe(done)
})

test('settleForNewSession keeps an assignments list\'s source and puts its working rows back to waiting', () => {
  const list = assignments(task(1, { status: 'working', work: { 'dev-1': work() } }), task(2, { status: 'done', doneAt: 4 }), task(3, { status: 'review' }))

  const next = settleForNewSession(list)

  expect(next.source).toBe('assignments')
  expect(next.tasks.map(t => t.status)).toEqual(['waiting', 'done', 'review'])
})

// ---- the tools

const STORE: HqAgent = { id: MAIN, name: 'main', role: 'orchestrator', description: '', status: 'running', startedAt: 0, tools: 0 }

type Setup = { list?: TaskList | null; agents?: HqAgent[]; kind?: 'missing' | 'invalid' | 'unreadable'; plans?: Record<string, string> }
function setup(options: Setup = {}) {
  const calls = { spawn: [] as Record<string, unknown>[], written: [] as TaskList[] }
  const memory = { assignments: {} as Record<string, HqAssignment> }
  let current: TaskList | null = options.list === undefined ? null : options.list
  const rows = Object.fromEntries([STORE, ...(options.agents ?? [])].map(a => [a.id, a]))
  const $ = {
    agent: { spawn: async (spec: Record<string, unknown>) => (calls.spawn.push(spec), { model: 'sonnet', agentId: 'new1' }) },
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
    resultOf: async () => undefined,
    record: async () => undefined,
    readTeamFile: async () => null,
    writeTeam: async () => null,
    confirm: async () => 'yes' as const,
    root: async () => ROOT,
    readList: async () => (current ? { list: current } : { list: null, kind: options.kind ?? 'missing', reason: options.kind ? 'the file is not usable' : undefined }),
    writeList: async (next: TaskList) => {
      calls.written.push(next)
      current = next
    },
    readPlan: async (path: string) => options.plans?.[path] ?? null,
  } as unknown as ToolDeps
  return { $, deps, calls, saved: () => calls.written[calls.written.length - 1] }
}

test('hq_assign with no plan_task and no list at all writes an assignments list with a working row for the member', async () => {
  const s = setup()

  const answer = await hqAssign(s.$, { role: 'dev', task: 'Build the search page\nthen test it' }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(s.calls.written).toHaveLength(1)
  const saved = s.saved()!
  expect(saved).toMatchObject({ source: 'assignments', plan: '', version: 1 })
  expect(rowOf(saved, 1)).toMatchObject({ title: 'Build the search page', status: 'working', startedAt: NOW })
  expect(rowOf(saved, 1)?.work['dev-1']).toMatchObject({ role: 'dev', step: 'build', workMs: 0 })
  expect(rowOf(saved, 1)?.events).toEqual([{ at: NOW, kind: 'start', who: 'dev-1' }])
})

test('each further hq_assign adds the next row, and the rows keep the earlier ones', async () => {
  const s = setup()

  await hqAssign(s.$, { role: 'dev', task: 'First job' }, s.deps)
  await hqAssign(s.$, { role: 'dev', task: 'Second job', name: 'dev-2' }, s.deps)

  expect(s.saved()!.tasks.map(t => [t.n, t.title, t.status])).toEqual([[1, 'First job', 'working'], [2, 'Second job', 'working']])
  expect(Object.keys(rowOf(s.saved(), 2)!.work)).toEqual(['dev-2'])
})

test('hq_assign on a plan list without plan_task adds no row and writes nothing', async () => {
  const s = setup({ list: planList(task(1), task(2)) })

  const answer = await hqAssign(s.$, { role: 'dev', task: 'Side job' }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(s.calls.spawn).toHaveLength(1)
  expect(s.calls.written).toEqual([])
})

test('hq_assign leaves an invalid or unreadable task file alone', async () => {
  for (const kind of ['invalid', 'unreadable'] as const) {
    const s = setup({ kind })

    const answer = await hqAssign(s.$, { role: 'dev', task: 'Job' }, s.deps)

    expect(answer.isError, kind).toBeUndefined()
    expect(s.calls.written, kind).toEqual([])
  }
})

test('plan_task is refused while only an assignments list exists, before anything starts', async () => {
  const list = assignments(task(1, { status: 'working', work: { 'dev-1': work() } }))
  const s = setup({ list, agents: [agent('a1', 'dev-1', 'completed')] })

  const assign = await hqAssign(s.$, { role: 'dev', task: 'Build it', plan_task: 1 }, s.deps)
  const review = await hqReview(s.$, { agent: 'dev-1', plan_task: 1 }, s.deps)

  expect(assign.isError).toBe(true)
  expect(assign.text).toMatch(/no plan list/)
  expect(review.isError).toBe(true)
  expect(s.calls.spawn).toEqual([])
  expect(s.calls.written).toEqual([])
})

test('hq_review of a member sends its row to review, even after the row was done, and links the reviewer', async () => {
  const list = assignments(task(1, { status: 'done', startedAt: 5, doneAt: 9, doneBy: 'dev-1', work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }), task(2, { status: 'done', doneAt: 9, work: { 'dev-2': work() } }))
  const s = setup({ list, agents: [agent('a1', 'dev-1', 'completed')] })

  const answer = await hqReview(s.$, { agent: 'dev-1' }, s.deps)

  expect(answer.isError).toBeUndefined()
  expect(rowOf(s.saved(), 1)).toMatchObject({ status: 'review', doneAt: null, doneBy: null })
  expect(rowOf(s.saved(), 1)?.work['reviewer-1']).toMatchObject({ role: 'reviewer', step: 'review', workMs: 0 })
  expect(rowOf(s.saved(), 1)?.events.at(-1)).toEqual({ at: NOW, kind: 'review', who: 'reviewer-1' })
  expect(rowOf(s.saved(), 2)?.status).toBe('done') // the other row is not touched
})

test('hq_plan over an assignments list replaces it outright: plan numbers never merge with assignment rows', async () => {
  const list = assignments(task(1, { status: 'done', work: { 'dev-1': work({ workMs: 90_000 }) } }), task(2, { work: { 'dev-2': work() } }), task(3))
  const text = '- [ ] 1. Store\n- [ ] 2. Prices\n'
  const s = setup({ list, plans: { [`${ROOT}/docs/plans/x.md`]: text } })

  const answer = await hqPlan({ plan: 'docs/plans/x.md' }, s.deps)

  expect(answer.isError).toBeUndefined()
  const saved = s.saved()!
  expect(saved.source).toBeUndefined()
  expect(saved.plan).toBe('docs/plans/x.md')
  expect(saved.tasks.map(t => [t.n, t.title, t.status, Object.keys(t.work).length])).toEqual([[1, 'Store', 'waiting', 0], [2, 'Prices', 'waiting', 0]])
  expect(saved.removed).toEqual({ workMs: 0, costUsd: 0 })
})
