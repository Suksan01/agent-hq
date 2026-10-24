// Spec for the live snapshot's task list (docs/specs/task-sidebar.md "Changed: Live snapshot", AC11, AC17's data side; plan task 7).
// The contract these tests pin down:
//  - the snapshot built in hooks/live.ts gets a `taskList` field from `data.taskList` (hooks/tasklist.ts): `null` with no list.
//    (The spec says "a `tasks` field", but `tasks` is already the board's array, which must not change, so the field is `taskList`.)
//  - `taskList` is `{ plan, rows, total, removed }`:
//      rows[i] = { n, title, status, who, doneBy, startedAt, doneAt, workMs, costUsd, isPartial, work, events } in plan order;
//        `who` is the member on a working or review task (the holder of its latest event), the finisher on a done one, null on a waiting one;
//        `doneBy` is the list's, null unless done;
//        `workMs` is the sum over members; `costUsd` is costOf (hooks/prices.ts) summed to the cent, null where nothing is priced,
//        `isPartial` where some member's model has no price;
//        work[j] = { who, role, step, workMs, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd } (costUsd null: unpriced);
//        events are the task's events, oldest first;
//      total = { done, count, workMs, costUsd, isPartial } over every row; `removed` is the list's, as saved;
//  - the titles are the plan's text, not escaped (the page draws text as text); the snapshot is plain JSON;
//  - a list opened in a new session (settleForNewSession) has no working row.
import { expect, test } from 'claude-code/testing'

import { buildSnapshot } from '../hooks/live'
import { PRICES, costOf } from '../hooks/prices'
import type { TaskList } from '../hooks/tasklist'
import { settleForNewSession } from '../hooks/taskwork'
import type { HqData } from '../hooks/view'

const MODEL = PRICES[0]!.prefix
const MIN = 60_000
type Row = Record<string, unknown>
const work = (min: number, over: Row = {}) => ({ role: 'dev', step: 'build', workMs: min * MIN, inputTokens: 100, outputTokens: 1_000_000, cacheReadTokens: 7, cacheWriteTokens: 3, model: MODEL, ...over })
const task = (n: number, over: Row = {}) => ({ n, title: `Task ${n}`, status: 'waiting', doneBy: null, startedAt: null, doneAt: null, work: {}, events: [], ...over })
const ev = (who: string, at: number, kind = 'start') => ({ at, kind, who })
const listOf = (tasks: Row[], over: Row = {}) => ({ version: 1, plan: 'docs/plans/x.md', approvedAt: 1, tasks, removed: { workMs: 5000, costUsd: 0.5 }, ...over }) as unknown as TaskList
const data = (list?: TaskList): HqData => ({ agents: {}, todos: {}, tasks: {}, now: 5000, hideFinished: false, columns: 0, isLight: false, team: null, ...(list ? { taskList: list } : {}) }) as HqData
const priced = (w: ReturnType<typeof work>) => costOf(w as never) as number
/** Dollars to the cent: within half a cent. */
const near = (got: unknown, want: number) => typeof got === 'number' && Math.abs(got - want) < 0.005

const LEDGER = () =>
  listOf([
    task(1, { title: 'Data model', status: 'done', doneBy: 'dev-1', startedAt: 10, doneAt: 90, work: { 'qa-1': work(3, { role: 'qa', step: 'tests' }), 'dev-1': work(9) }, events: [ev('dev-1', 40), ev('qa-1', 10), ev('dev-1', 90, 'done')] }),
    task(2, { title: '<script>alert(1)</script> ตารางงาน', status: 'working', work: { 'dev-2': work(5) }, events: [ev('dev-2', 20)] }),
    task(3, { status: 'review', work: { 'dev-3': work(2), 'rev-1': work(1, { role: 'reviewer', step: 'review', model: 'mystery-model' }) }, events: [ev('dev-3', 30), ev('rev-1', 31, 'review')] }),
    task(4),
  ])

const rowsOf = (list: TaskList) => buildSnapshot(data(list), 5000).taskList?.rows ?? []

test('the snapshot has no task list when there is no list (AC19), and the board field is as it was', () => {
  const snap = buildSnapshot(data(), 5000)

  expect(snap.taskList).toBeNull()
  expect(snap.tasks).toEqual([])
})

test('the snapshot carries the list: every task in plan order, and the saved removed totals', () => {
  const snap = buildSnapshot(data(LEDGER()), 5000)

  expect(snap.taskList).not.toHaveProperty('plan') // the page never uses it
  expect(snap.taskList?.rows.map(r => [r.n, r.status])).toEqual([[1, 'done'], [2, 'working'], [3, 'review'], [4, 'waiting']])
  expect(snap.taskList?.removed).toEqual({ workMs: 5000, costUsd: 0.5 })
})

test('who is the member on a working or review task, the finisher on a done one, and nobody on a waiting one', () => {
  const rows = rowsOf(LEDGER())

  expect(rows.map(r => [r.n, r.who, r.doneBy])).toEqual([[1, 'dev-1', 'dev-1'], [2, 'dev-2', null], [3, 'rev-1', null], [4, null, null]])
})

test('a row\'s work time is the sum over its members, and its cost the priced sum to the cent, partial where a model has no price', () => {
  const rows = rowsOf(LEDGER())
  const one = rows.find(r => r.n === 1)
  const three = rows.find(r => r.n === 3)

  expect(one?.workMs).toBe(12 * MIN)
  expect(near(one?.costUsd, priced(work(3)) + priced(work(9)))).toBe(true)
  expect(one?.isPartial).toBe(false)
  expect(three?.workMs).toBe(3 * MIN)
  expect(near(three?.costUsd, priced(work(2)))).toBe(true)
  expect(three?.isPartial).toBe(true)
})

test('a task nobody worked on has no cost and no time, and a task with only unpriced work has a null cost', () => {
  const rows = rowsOf(listOf([task(1), task(2, { status: 'working', work: { 'x-1': work(4, { model: 'mystery-model' }) }, events: [ev('x-1', 1)] })]))

  expect(rows[0]).toMatchObject({ workMs: 0, costUsd: null, isPartial: false, work: [] })
  expect(rows[1]).toMatchObject({ workMs: 4 * MIN, costUsd: null, isPartial: true })
})

test('each member\'s work is listed with its role, step, time, the four token counts and its own cost', () => {
  const three = rowsOf(LEDGER()).find(r => r.n === 3)

  const [first] = three?.work ?? []
  expect(near(first?.costUsd, priced(work(2)))).toBe(true)
  expect(three?.work.map(w => ({ ...w, costUsd: w.costUsd === null ? null : 'priced' }))).toEqual([
    { who: 'dev-3', role: 'dev', step: 'build', workMs: 2 * MIN, inputTokens: 100, outputTokens: 1_000_000, cacheReadTokens: 7, cacheWriteTokens: 3, costUsd: 'priced' },
    { who: 'rev-1', role: 'reviewer', step: 'review', workMs: 1 * MIN, inputTokens: 100, outputTokens: 1_000_000, cacheReadTokens: 7, cacheWriteTokens: 3, costUsd: null },
  ])
})

test('a task\'s events come oldest first, with when it started and was done', () => {
  const one = rowsOf(LEDGER()).find(r => r.n === 1)

  expect(one?.events.map(e => [e.at, e.kind, e.who])).toEqual([[10, 'start', 'qa-1'], [40, 'start', 'dev-1'], [90, 'done', 'dev-1']])
  expect([one?.startedAt, one?.doneAt]).toEqual([10, 90])
})

test('the total counts done over all, adds the time, adds the priced costs and is partial when any row is', () => {
  const total = buildSnapshot(data(LEDGER()), 5000).taskList?.total

  // the tasks' work plus what a re-plan removed (5000 ms, $0.50), as the sidebar adds it
  expect(total).toMatchObject({ done: 1, count: 4, workMs: 20 * MIN + 5000, isPartial: true })
  expect(near(total?.costUsd, priced(work(3)) + priced(work(9)) + priced(work(5)) + priced(work(2)) + 0.5)).toBe(true)
})

test('a total with everything priced is not partial', () => {
  const total = buildSnapshot(data(listOf([task(1, { status: 'done', doneBy: 'a', work: { 'a-1': work(1) }, events: [ev('a-1', 1)] })])), 5000).taskList?.total

  expect(total).toMatchObject({ done: 1, count: 1, isPartial: false })
})

test('a title is the plan\'s text as it is: markup is not escaped in the snapshot, the page draws it as text (AC17)', () => {
  expect(rowsOf(LEDGER())[1]?.title).toBe('<script>alert(1)</script> ตารางงาน')
})

test('a list from an earlier session shows the same tasks and totals with no task working (AC11)', () => {
  const saved = LEDGER()

  const snap = buildSnapshot(data(settleForNewSession(saved)), 5000).taskList
  const before = buildSnapshot(data(saved), 5000).taskList

  expect(snap?.rows.filter(r => r.status === 'working')).toEqual([])
  expect(snap?.rows.map(r => r.n)).toEqual(before?.rows.map(r => r.n))
  expect(snap?.total.workMs).toBe(before?.total.workMs)
  expect(snap?.total.costUsd).toBe(before?.total.costUsd)
  expect(snap?.removed).toEqual(before?.removed)
})

test('the snapshot with a list is plain JSON, nothing lost on the wire', () => {
  const snap = buildSnapshot(data(LEDGER()), 5000)

  expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
})

test('the removed totals count in the total, and a partial removed cost makes it partial', () => {
  const only = listOf([task(1, { status: 'done', doneBy: 'a', work: { 'a-1': work(1) }, events: [ev('a-1', 1)] })], { removed: { workMs: 2 * MIN, costUsd: 1.25, isPartial: true } })

  const total = buildSnapshot(data(only), 5000).taskList?.total

  expect(total?.workMs).toBe(3 * MIN)
  expect(near(total?.costUsd, priced(work(1)) + 1.25)).toBe(true)
  expect(total?.isPartial).toBe(true)
})

test('a member just linked, with nothing counted, does not make the row or the total partial; work with no price still does', () => {
  const empty = { ...work(0), inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: null }
  const linked = buildSnapshot(data(listOf([task(1, { status: 'review', work: { 'dev-1': work(2), 'rev-1': empty }, events: [ev('dev-1', 1), ev('rev-1', 2, 'review')] })])), 5000).taskList
  const unpriced = buildSnapshot(data(listOf([task(1, { status: 'review', work: { 'dev-1': work(2), 'rev-1': work(1, { model: 'mystery-model' }) }, events: [ev('dev-1', 1)] })])), 5000).taskList

  expect([linked?.rows[0]?.isPartial, linked?.total.isPartial]).toEqual([false, false])
  expect(near(linked?.rows[0]?.costUsd, priced(work(2)))).toBe(true)
  expect([unpriced?.rows[0]?.isPartial, unpriced?.total.isPartial]).toEqual([true, true])
})
