// Spec for hooks/taskwork.ts: what a turn and a ticked plan do to the saved task list (docs/specs/task-sidebar.md AC6, AC8, AC9,
// AC11; F2 step 4, F3 step 3, F4, F5). Pure functions over a TaskList (hooks/tasklist.ts); none changes the list it is given.
// The contract these tests pin down:
//  - linkedTask(list, member) -> the number of the task the member is linked to: the one holding its latest event (a member
//    given a new task moves its link), or undefined;
//  - addTurnToTask(list, member, turn, at) -> a list with the turn's time and tokens added to the member's work row on its linked
//    task: durationMs -> workMs, usage.input_tokens/output_tokens, cache_read_input_tokens -> cacheReadTokens and
//    cache_creation_input_tokens -> cacheWriteTokens apart (the same untrusted-number reading as usage.ts addTurn), usage.model -> model.
//    The lead (member undefined) and a member linked to no task count on none: the list comes back equal;
//    a turn of a builder (a row whose step is not "review") on a review task moves it back to working; a reviewer's turn does not;
//    a turn on a waiting task (a saved one, in a new session) makes it working;
//  - applyPlanTicks(list, parsed, at) (in hooks/tasklist.ts, also used by a re-plan) -> newly ticked tasks become done, doneAt = at, doneBy = the last linked member that is neither the
//    review nor the QA role (judged by role and step), else the last linked member, else null; a task already done is left as it was;
//  - settleForNewSession(list) -> the saved list for a new session: no task is working (a working one waits for a new turn), totals kept.
import { expect, test } from 'claude-code/testing'

import { applyPlanTicks } from '../hooks/tasklist'
import type { TaskList } from '../hooks/tasklist'
import { addTurnToTask, linkedTask, settleForNewSession } from '../hooks/taskwork'

type Row = Record<string, unknown>
const work = (over: Row = {}) => ({ role: 'dev', step: 'build', workMs: 1000, inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40, model: 'claude-sonnet-5-5', ...over })
const task = (n: number, over: Row = {}) => ({ n, title: `Task ${n}`, status: 'waiting', doneBy: null, startedAt: null, doneAt: null, work: {}, events: [], ...over })
const listOf = (...tasks: Row[]) => ({ version: 1, plan: 'docs/plans/x.md', approvedAt: 1, tasks, removed: { workMs: 0, costUsd: 0 } }) as unknown as TaskList
const taskOf = (list: TaskList, n: number) => list.tasks.find(t => t.n === n)!
const usage = (over: Row = {}) => ({ input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 7, cache_creation_input_tokens: 3, model: 'claude-opus-5-5', ...over })
const AT = 9_000

/** Task 2 with a QA, a developer and a reviewer on it, in the order they started. */
const crowded = (status = 'review') =>
  listOf(
    task(1),
    task(2, {
      status,
      startedAt: 10,
      work: { 'qa-1': work({ role: 'qa', step: 'tests' }), 'dev-1': work(), 'reviewer-1': work({ role: 'reviewer', step: 'review' }) },
      events: [
        { at: 10, kind: 'start', who: 'qa-1' },
        { at: 20, kind: 'start', who: 'dev-1' },
        { at: 30, kind: 'review', who: 'reviewer-1' },
      ],
    }),
  )

// ---- linkedTask

test('linkedTask finds the task a member works on, and none for the lead or a stranger', () => {
  const list = listOf(task(1), task(2, { work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))

  expect(linkedTask(list, 'dev-1')).toBe(2)
  expect(linkedTask(list, 'dev-2')).toBeUndefined()
  expect(linkedTask(list, 'main')).toBeUndefined()
})

test('linkedTask follows a member to the task it was given last', () => {
  const list = listOf(
    task(1, { work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }),
    task(2, { work: { 'dev-1': work({ workMs: 0 }) }, events: [{ at: 9, kind: 'start', who: 'dev-1' }] }),
  )

  expect(linkedTask(list, 'dev-1')).toBe(2)
})

// ---- addTurnToTask: AC6

test('a member\'s turn adds exactly its time and tokens to its row on the linked task, cache read and cache write apart (AC6)', () => {
  const list = listOf(task(2, { status: 'working', work: { 'dev-1': work({ workMs: 1000, inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 }) }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))

  const next = addTurnToTask(list, 'dev-1', { durationMs: 60_000, usage: usage() }, AT)

  expect(taskOf(next, 2).work['dev-1']).toMatchObject({ workMs: 61_000, inputTokens: 110, outputTokens: 60, cacheReadTokens: 37, cacheWriteTokens: 43, model: 'claude-opus-5-5' })
  expect(taskOf(next, 2).status).toBe('working')
})

test('a counted turn stamps the row with the turn\'s time; a member not counted keeps no stamp', () => {
  const list = listOf(task(2, { status: 'working', work: { 'dev-1': work({ lastAt: 100 }) }, events: [{ at: 5, kind: 'start', who: 'dev-1' }, { at: 6, kind: 'start', who: 'dev-2' }] }))

  const next = addTurnToTask(list, 'dev-1', { durationMs: 1000, usage: usage() }, AT)
  const fresh = addTurnToTask(list, 'dev-2', { durationMs: 1000, usage: usage() }, AT)

  expect(taskOf(next, 2).work['dev-1']?.lastAt).toBe(AT)
  expect(taskOf(fresh, 2).work['dev-2']?.lastAt).toBe(AT) // a row made by its first turn
  expect(taskOf(addTurnToTask(list, undefined, { durationMs: 1000 }, AT), 2).work['dev-1']?.lastAt).toBe(100) // the lead counts on none
})

test('turns add up, one after the other', () => {
  const list = listOf(task(1, { status: 'working', work: { 'dev-1': work({ workMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }) }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))

  const next = addTurnToTask(addTurnToTask(list, 'dev-1', { durationMs: 1500, usage: usage() }, AT), 'dev-1', { durationMs: 500, usage: usage({ input_tokens: 20 }) }, AT + 1)

  expect(taskOf(next, 1).work['dev-1']).toMatchObject({ workMs: 2000, inputTokens: 120, cacheReadTokens: 14, cacheWriteTokens: 6 })
})

test('a turn is read as untrusted numbers: text, negatives and NaN count as nothing, fractions are floored', () => {
  const list = listOf(task(1, { status: 'working', work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))

  const next = addTurnToTask(list, 'dev-1', { durationMs: 'long', usage: { input_tokens: -5, output_tokens: Number.NaN, cache_read_input_tokens: 2.9, cache_creation_input_tokens: '4', model: 7 } }, AT)

  expect(taskOf(next, 1).work['dev-1']).toMatchObject({ workMs: 1000, inputTokens: 10, outputTokens: 20, cacheReadTokens: 32, cacheWriteTokens: 40, model: 'claude-sonnet-5-5' })
})

test('a turn with no usage at all still adds its time', () => {
  const list = listOf(task(1, { status: 'working', work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))

  const next = addTurnToTask(list, 'dev-1', { durationMs: 250 }, AT)

  expect(taskOf(next, 1).work['dev-1']).toMatchObject({ workMs: 1250, inputTokens: 10 })
})

test('the lead\'s turn and the turn of a member linked to no task count on none (AC6)', () => {
  const list = listOf(task(1, { status: 'working', work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))
  const turn = { durationMs: 60_000, usage: usage() }

  expect(addTurnToTask(list, undefined, turn, AT)).toEqual(list)
  expect(addTurnToTask(list, 'main', turn, AT)).toEqual(list)
  expect(addTurnToTask(list, 'dev-9', turn, AT)).toEqual(list)
})

test('a turn lands only on the task the member is linked to now, not on an earlier one', () => {
  const list = listOf(
    task(1, { status: 'done', work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }),
    task(2, { status: 'working', work: { 'dev-1': work({ workMs: 0 }) }, events: [{ at: 9, kind: 'start', who: 'dev-1' }] }),
  )

  const next = addTurnToTask(list, 'dev-1', { durationMs: 500 }, AT)

  expect(taskOf(next, 1).work['dev-1']?.workMs).toBe(1000)
  expect(taskOf(next, 2).work['dev-1']?.workMs).toBe(500)
})

test('addTurnToTask does not change the list it was given', () => {
  const list = crowded('working')
  const before = JSON.stringify(list)

  addTurnToTask(list, 'dev-1', { durationMs: 99, usage: usage() }, AT)

  expect(JSON.stringify(list)).toBe(before)
})

// ---- review and working again: AC8

test('a builder working again on a task in review moves it back to working (AC8)', () => {
  const next = addTurnToTask(crowded('review'), 'dev-1', { durationMs: 5000, usage: usage() }, AT)

  expect(taskOf(next, 2).status).toBe('working')
  expect(taskOf(next, 2).work['dev-1']?.workMs).toBe(6000)
})

test('the reviewer\'s own turns on a task in review keep it in review, and count there', () => {
  const next = addTurnToTask(crowded('review'), 'reviewer-1', { durationMs: 5000, usage: usage() }, AT)

  expect(taskOf(next, 2).status).toBe('review')
  expect(taskOf(next, 2).work['reviewer-1']?.workMs).toBe(6000)
})

test('a turn of a member linked to a waiting task (saved by an earlier session) makes it working', () => {
  const list = listOf(task(3, { status: 'waiting', work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))

  expect(taskOf(addTurnToTask(list, 'dev-1', { durationMs: 10 }, AT), 3).status).toBe('working')
})

test('a linked member working on a done task adds to its time (F4 step 3)', () => {
  const list = listOf(task(1, { status: 'done', doneBy: 'dev-1', doneAt: 7, work: { 'dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'dev-1' }] }))

  const next = addTurnToTask(list, 'dev-1', { durationMs: 4000 }, AT)

  expect(taskOf(next, 1).work['dev-1']?.workMs).toBe(5000)
  expect(taskOf(next, 1).doneBy).toBe('dev-1')
})

// ---- applyPlanTicks: AC9

test('a newly ticked task becomes done, by the developer, not the QA or the reviewer, with doneAt set (AC9)', () => {
  const next = applyPlanTicks(crowded('review'), [{ n: 1, title: 'Task 1', done: false }, { n: 2, title: 'Task 2', done: true }], AT)

  expect(taskOf(next, 2)).toMatchObject({ status: 'done', doneBy: 'dev-1', doneAt: AT })
  expect(taskOf(next, 1)).toMatchObject({ status: 'waiting', doneBy: null, doneAt: null })
})

test('doneBy is the last builder when several built it', () => {
  const list = listOf(
    task(2, {
      status: 'review',
      work: { 'dev-1': work(), 'dev-2': work(), 'reviewer-1': work({ role: 'reviewer', step: 'review' }) },
      events: [
        { at: 20, kind: 'start', who: 'dev-1' },
        { at: 25, kind: 'start', who: 'dev-2' },
        { at: 30, kind: 'review', who: 'reviewer-1' },
      ],
    }),
  )

  expect(taskOf(applyPlanTicks(list, [{ n: 2, title: 'Task 2', done: true }], AT), 2).doneBy).toBe('dev-2')
})

test('when only the QA and the reviewer are linked, doneBy is the last linked member', () => {
  const list = listOf(
    task(2, {
      status: 'review',
      work: { 'qa-1': work({ role: 'qa', step: 'tests' }), 'reviewer-1': work({ role: 'reviewer', step: 'review' }) },
      events: [
        { at: 10, kind: 'start', who: 'qa-1' },
        { at: 30, kind: 'review', who: 'reviewer-1' },
      ],
    }),
  )

  expect(taskOf(applyPlanTicks(list, [{ n: 2, title: 'Task 2', done: true }], AT), 2).doneBy).toBe('reviewer-1')
})

test('a ticked task nobody worked on is done with doneBy null', () => {
  const next = applyPlanTicks(listOf(task(4)), [{ n: 4, title: 'Task 4', done: true }], AT)

  expect(taskOf(next, 4)).toMatchObject({ status: 'done', doneBy: null, doneAt: AT })
})

test('a task already done keeps its doneBy and doneAt, and an unticked or unknown number changes nothing', () => {
  const list = listOf(task(1, { status: 'done', doneBy: 'dev-1', doneAt: 77, work: { 'dev-1': work(), 'dev-2': work() }, events: [{ at: 5, kind: 'start', who: 'dev-2' }] }), task(2, { status: 'working' }))

  const next = applyPlanTicks(list, [{ n: 1, title: 'Task 1', done: true }, { n: 2, title: 'Task 2', done: false }, { n: 8, title: 'New', done: true }], AT)

  expect(next).toEqual(list)
})

test('ticking adds no work, and the time and tokens stay as they were', () => {
  const next = applyPlanTicks(crowded('review'), [{ n: 2, title: 'Task 2', done: true }], AT)

  expect(taskOf(next, 2).work).toEqual(taskOf(crowded('review'), 2).work)
})

test('applyPlanTicks does not change the list it was given', () => {
  const list = crowded('review')
  const before = JSON.stringify(list)

  applyPlanTicks(list, [{ n: 2, title: 'Task 2', done: true }], AT)

  expect(JSON.stringify(list)).toBe(before)
})

// ---- settleForNewSession: AC11

test('a saved list opens in a new session with no task working, and every total kept (AC11)', () => {
  const saved = listOf(
    task(1, { status: 'done', doneBy: 'dev-1', doneAt: 7, work: { 'dev-1': work() } }),
    task(2, { status: 'working', startedAt: 10, work: { 'dev-2': work({ workMs: 4000 }) }, events: [{ at: 10, kind: 'start', who: 'dev-2' }] }),
    task(3, { status: 'review', work: { 'reviewer-1': work({ role: 'reviewer', step: 'review' }) } }),
    task(4),
  )

  const next = settleForNewSession(saved)

  expect(next.tasks.filter(t => t.status === 'working')).toEqual([])
  expect(next.tasks.map(t => t.n)).toEqual([1, 2, 3, 4])
  expect(taskOf(next, 1).status).toBe('done')
  expect(taskOf(next, 2).work).toEqual({ 'dev-2': work({ workMs: 4000 }) })
  expect(taskOf(next, 2).startedAt).toBe(10)
  expect(next.removed).toEqual(saved.removed)
})

test('after a new session, the first turn of a linked member makes its task working again', () => {
  const saved = listOf(task(2, { status: 'working', work: { 'dev-2': work() }, events: [{ at: 10, kind: 'start', who: 'dev-2' }] }))

  const next = addTurnToTask(settleForNewSession(saved), 'dev-2', { durationMs: 100 }, AT)

  expect(taskOf(next, 2).status).toBe('working')
})
