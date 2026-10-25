// Spec for hooks/tasklist.ts: the saved task list of the approved plan (docs/specs/task-sidebar.md "Data", AC1, AC2, AC3, AC12).
// The contract these tests pin down (the plan names the functions; the shapes are what the tests read):
//  - parsePlan(text) -> { n, title, done }[] in plan order, from `- [ ] N. Title` and `- [x] N. Title` lines only;
//    titles are masked for secrets and cut to a fixed length; no checklist line gives [];
//  - mergeList(old, parsed, { plan, approvedAt, now, price }) -> a TaskList: same number keeps its work, a new number starts waiting (or done when ticked),
//    a dropped number's workMs and costUsd move into `removed`; the old list is not changed;
//  - readList($, path) -> { list, reason? }: an invalid, unknown-version or missing file is { list: null, reason }, never a throw;
//  - writeList($, path, list) -> the file read back gives the same list (the engine has no rename: how it stays atomic is the builder's call).
import { expect, test } from 'claude-code/testing'
import type { EngineInterface } from 'claude-code'

import { applyPlanTicks, mergeList, parsePlan, readList, writeList } from '../hooks/tasklist'
import type { TaskList } from '../hooks/tasklist'

const work = (over: Record<string, unknown> = {}) => ({ role: 'senior-dev', step: 'build', workMs: 60_000, inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40, model: 'claude-sonnet-5-5', lastAt: null, ...over })
const task = (n: number, over: Record<string, unknown> = {}) => ({ n, title: `Task ${n}`, status: 'waiting', doneBy: null, startedAt: null, doneAt: null, work: {}, events: [], ...over })
const OPTS = { plan: 'docs/plans/x.md', approvedAt: 1, now: 9, price: (w: { model: string | null }) => (w.model === 'mystery-model-9' ? null : 0.01) }
const listOf = (tasks: unknown[], over: Record<string, unknown> = {}) => ({ version: 1, plan: 'docs/plans/x.md', approvedAt: 1_761_300_000_000, tasks, removed: { workMs: 0, costUsd: 0 }, ...over }) as TaskList

// ---- parsePlan: AC1, AC2

test('parsePlan reads each checklist line as a task: open boxes are not done, ticked boxes are done (AC1)', () => {
  const tasks = parsePlan('# Plan\n\n- [ ] 1. A\n- [x] 2. B\n- [ ] 3. C\n')

  expect(tasks.map(t => [t.n, t.title, t.done])).toEqual([[1, 'A', false], [2, 'B', true], [3, 'C', false]])
})

test('parsePlan keeps the plan order and the number the line gives, not its position', () => {
  const tasks = parsePlan('- [ ] 7. Seventh\n- [x] 2. Second\n- [ ] 10. Tenth\n')

  expect(tasks.map(t => t.n)).toEqual([7, 2, 10])
})

test('parsePlan gives no tasks for a plan with no checklist lines (AC2)', () => {
  expect(parsePlan('')).toEqual([])
  expect(parsePlan('# Plan\n\nJust prose.\n\n- a bullet\n- [ ] no number here\n1. a numbered line\n[ ] 1. no dash\n')).toEqual([])
})

test('parsePlan skips what is under a task: its sub-bullets and prose are not tasks', () => {
  const text = '- [ ] 1. Store\n  - Files: `hooks/tasklist.ts`\n  - Done: tests pass\n\nSome words.\n- [ ] 2. Prices\n'

  expect(parsePlan(text).map(t => t.n)).toEqual([1, 2])
})

test('parsePlan masks a secret in a title (AC1: titles are untrusted text)', () => {
  const [first] = parsePlan('- [ ] 1. Rotate sk-ant-abcdef1234567890 now\n')

  expect(first?.title).not.toContain('sk-ant-abcdef1234567890')
  expect(first?.title).toContain('Rotate')
})

test('parsePlan cuts a very long title to a fixed length, and keeps its start', () => {
  const [first] = parsePlan(`- [ ] 1. ${'Long title '.repeat(100)}\n`)

  expect(first?.title.length).toBeLessThanOrEqual(200)
  expect(first?.title.startsWith('Long title')).toBe(true)
})

test('parsePlan keeps markup and Thai text in a title as plain text', () => {
  const tasks = parsePlan('- [ ] 1. <script>alert(1)</script>\n- [ ] 2. ตารางงาน\n')

  expect(tasks[0]?.title).toContain('<script>')
  expect(tasks[1]?.title).toBe('ตารางงาน')
})

// ---- mergeList: AC3

test('mergeList with no earlier list starts every task waiting, or done when its box is ticked', () => {
  const merged = mergeList(null, [{ n: 1, title: 'A', done: false }, { n: 2, title: 'B', done: true }], OPTS)

  expect(merged.tasks.map(t => [t.n, t.status, t.work])).toEqual([[1, 'waiting', {}], [2, 'done', {}]])
  expect(merged.removed).toEqual({ workMs: 0, costUsd: 0 })
  expect(merged.version).toBe(1)
})

test('mergeList keeps the work of a task with the same number and takes the new title (AC3)', () => {
  const old = listOf([task(1, { status: 'working', work: { 'senior-dev-1': work() }, events: [{ at: 5, kind: 'start', who: 'senior-dev-1' }] }), task(2)])

  const merged = mergeList(old, [{ n: 1, title: 'A renamed', done: false }, { n: 2, title: 'B', done: false }], OPTS)

  const one = merged.tasks.find(t => t.n === 1)
  expect(one?.title).toBe('A renamed')
  expect(one?.work).toEqual({ 'senior-dev-1': work() })
  expect(one?.events).toEqual([{ at: 5, kind: 'start', who: 'senior-dev-1' }])
})

test('mergeList keeps lastAt on the work of a task that stays', () => {
  const old = listOf([task(1, { status: 'working', work: { 'senior-dev-1': work({ lastAt: 4242 }) } })])

  const merged = mergeList(old, [{ n: 1, title: 'Task 1', done: false }], OPTS)

  expect(merged.tasks[0]?.work['senior-dev-1']?.lastAt).toBe(4242)
})

test('mergeList starts a new number waiting, next to the kept ones, in the new plan order', () => {
  const old = listOf([task(1, { work: { 'senior-dev-1': work() } })])

  const merged = mergeList(old, [{ n: 2, title: 'New', done: false }, { n: 1, title: 'Task 1', done: false }], OPTS)

  expect(merged.tasks.map(t => t.n)).toEqual([2, 1])
  expect(merged.tasks[0]).toMatchObject({ n: 2, status: 'waiting', work: {} })
})

test('mergeList moves a dropped task\'s time into removed and adds it to what was removed before (AC3)', () => {
  const old = listOf(
    [task(1), task(3, { work: { 'senior-dev-1': work({ workMs: 60_000 }), 'qa-1': work({ workMs: 30_000 }) } })],
    { removed: { workMs: 1000, costUsd: 0.5 } },
  )

  const merged = mergeList(old, [{ n: 1, title: 'Task 1', done: false }], OPTS)

  expect(merged.tasks.map(t => t.n)).toEqual([1])
  expect(merged.removed.workMs).toBe(1000 + 60_000 + 30_000)
  expect(merged.removed.costUsd).toBeGreaterThanOrEqual(0.5)
})

test('mergeList adds no cost for a dropped task whose model has no price', () => {
  const old = listOf([task(4, { work: { 'x-1': work({ model: 'mystery-model-9' }) } })], { removed: { workMs: 0, costUsd: 0.25 } })

  const merged = mergeList(old, [], OPTS)

  expect(merged.tasks).toEqual([])
  expect(merged.removed).toEqual({ workMs: 60_000, costUsd: 0.25, isPartial: true }) // the total is marked partial
})

test('mergeList does not change the list it was given', () => {
  const old = listOf([task(1, { work: { 'senior-dev-1': work() } }), task(2, { work: { 'qa-1': work() } })])
  const before = JSON.stringify(old)

  mergeList(old, [{ n: 1, title: 'Other', done: true }], OPTS)

  expect(JSON.stringify(old)).toBe(before)
})

// ---- readList / writeList: AC12

/** A `$` with only what file I/O may use (fs.read, fs.write, fs.exists, ui.log), the files kept in memory: a file written is a file read back. */
function disk(throwWith?: unknown) {
  const files = new Map<string, string>()
  const $ = {
    fs: {
      read: async (path: string) => {
        if (throwWith !== undefined) throw throwWith
        const text = files.get(path)
        if (text === undefined) throw new Error(`ENOENT: no such file, open '${path}'`)
        return text
      },
      write: async (path: string, text: string) => {
        files.set(path, text)
      },
      exists: async (path: string) => files.has(path),
    },
    ui: { log: () => undefined },
  } as unknown as EngineInterface
  return { $, files, path: '/work/app/.claude/agent-hq/tasks.json' }
}

test('readList says there is no list, and no reason, when the file is missing: that is the normal state before a plan (AC12)', async () => {
  const d = disk()
    const out = await readList(d.$, d.path)

    expect(out).toEqual({ list: null, kind: 'missing' })
})

test('readList does not throw when the read itself fails with something that is not an Error (AC12)', async () => {
  const d = disk('disk on fire')
    const out = await readList(d.$, d.path)

    expect(out.list).toBeNull()
    expect(out.kind).toBe('unreadable')
    expect(out.reason).toBeTruthy()
})

test('readList says no list, with a reason, for every kind of invalid file (AC12)', async () => {
  const d = disk()
    const badTask = (over: Record<string, unknown>) => JSON.stringify(listOf([{ ...task(1), ...over }]))
    const invalid: [string, string][] = [
      ['empty file', ''],
      ['not json', '{ nope'],
      ['json null', 'null'],
      ['json array', '[]'],
      ['a number', '42'],
      ['tasks missing', JSON.stringify({ version: 1, plan: 'p.md', approvedAt: 1, removed: { workMs: 0, costUsd: 0 } })],
      ['tasks not an array', JSON.stringify(listOf([], { tasks: {} }))],
      ['task number not an integer', badTask({ n: 1.5 })],
      ['task number missing', badTask({ n: undefined })],
      ['task status unknown', badTask({ status: 'bogus' })],
      ['task work not an object', badTask({ work: 'lots' })],
      ['work time negative', badTask({ work: { 'a-1': work({ workMs: -5 }) } })],
      ['work time not a number', badTask({ work: { 'a-1': work({ workMs: 'long' }) } })],
      ['work lastAt not a time', badTask({ work: { 'a-1': work({ lastAt: 'soon' }) } })],
      ['removed missing', JSON.stringify({ version: 1, plan: 'p.md', approvedAt: 1, tasks: [] })],
    ]
    for (const [label, text] of invalid) {
      d.files.set(d.path, text)

      const out = await readList(d.$, d.path)

      expect(out.list, label).toBeNull()
      expect(out.kind, label).toBe('invalid')
      expect(out.reason, label).toBeTruthy()
    }
})

test('a list saved before lastAt loads with lastAt null, and a saved lastAt is kept', async () => {
    const d = disk()
    d.files.set(d.path, JSON.stringify(listOf([task(1, { work: { 'a-1': work({ lastAt: undefined }), 'b-1': work({ lastAt: 4242 }), 'c-1': work({ lastAt: null }) } })])))

    const out = await readList(d.$, d.path)

    const rows = out.list?.tasks[0]?.work
    expect([rows?.['a-1']?.lastAt, rows?.['b-1']?.lastAt, rows?.['c-1']?.lastAt]).toEqual([null, 4242, null])
})

test('readList ignores a list with an unknown version, and says why (AC12)', async () => {
  const d = disk()
    for (const version of [2, 0, 99, '1', null]) {
      d.files.set(d.path, JSON.stringify(listOf([task(1)], { version })))

      const out = await readList(d.$, d.path)

      expect(out.list, `version ${String(version)}`).toBeNull()
      expect(out.reason, `version ${String(version)}`).toMatch(/version/i)
    }
})

test('readList reads a valid file as the list it holds', async () => {
  const d = disk()
    const saved = listOf([task(1, { status: 'done', doneBy: 'senior-dev-1', work: { 'senior-dev-1': work() } }), task(2)])
    d.files.set(d.path, JSON.stringify(saved))

    const out = await readList(d.$, d.path)

    expect(out.list).toEqual(saved)
})

test('writeList writes a file that readList reads back as the same list,', async () => {
  const d = disk()
    const saved = listOf([task(1, { work: { 'senior-dev-1': work() }, events: [{ at: 1, kind: 'start', who: 'senior-dev-1' }] }), task(2, { title: 'ตารางงาน <b>' })])

    await writeList(d.$, d.path, saved)

    expect((await readList(d.$, d.path)).list).toEqual(saved)
    expect(JSON.parse(d.files.get(d.path) ?? 'null').version).toBe(1)
})

test('writeList then readList keeps each member\'s lastAt', async () => {
  const d = disk()
    const saved = listOf([task(1, { work: { 'a-1': work({ lastAt: 4242 }), 'b-1': work({ lastAt: null }) } })])

    await writeList(d.$, d.path, saved)

    const rows = (await readList(d.$, d.path)).list?.tasks[0]?.work
    expect([rows?.['a-1']?.lastAt, rows?.['b-1']?.lastAt]).toEqual([4242, null])
})

test('writeList replaces an earlier file whole', async () => {
  const d = disk()
    await writeList(d.$, d.path, listOf([task(1), task(2), task(3)]))

    await writeList(d.$, d.path, listOf([task(9)]))

    expect((await readList(d.$, d.path)).list?.tasks.map(t => t.n)).toEqual([9])
})

// ---- review fixes: ticks, duplicate and huge numbers, control characters, partial removed, backup

test('mergeList makes a kept task done when its box is now ticked, by the last builder (not the reviewer or QA), at now', () => {
  const old = listOf([task(1, { status: 'review', work: { 'dev-1': work({ role: 'dev' }), 'dev-2': work({ role: 'dev' }), 'rev-1': work({ role: 'reviewer', step: 'review' }), 'qa-1': work({ role: 'qa' }) } })])

  const one = mergeList(old, [{ n: 1, title: 'Task 1', done: true }], OPTS).tasks[0]

  expect(one).toMatchObject({ status: 'done', doneBy: 'dev-2', doneAt: 9 })
  expect(old.tasks[0]?.status).toBe('review')
})

test('applyPlanTicks falls back to the last linked member when only reviewers are linked, and leaves a done task and unticked boxes alone', () => {
  const list = listOf([task(1, { work: { 'rev-1': work({ role: 'reviewer' }) } }), task(2, { status: 'done', doneBy: 'a', doneAt: 3 }), task(3, { status: 'working' })])

  const next = applyPlanTicks(list, [{ n: 1, title: 'a', done: true }, { n: 2, title: 'b', done: true }, { n: 3, title: 'c', done: false }], 9)

  expect(next.tasks.map(t => [t.status, t.doneBy, t.doneAt])).toEqual([['done', 'rev-1', 9], ['done', 'a', 3], ['working', null, null]])
})

test('an unticked box on a done task leaves it done', () => {
  const old = listOf([task(1, { status: 'done', doneBy: 'dev-1', doneAt: 3 })])

  expect(mergeList(old, [{ n: 1, title: 'Task 1', done: false }], OPTS).tasks[0]).toMatchObject({ status: 'done', doneAt: 3 })
})

test('parsePlan keeps the first line of a number, and ignores a number too long to be safe', () => {
  const tasks = parsePlan(`- [ ] 3. First\n- [x] 3. Again\n- [ ] ${'9'.repeat(400)}. Huge\n- [ ] 4. Four\n`)

  expect(tasks.map(t => [t.n, t.title, t.done])).toEqual([[3, 'First', false], [4, 'Four', false]])
})

test('parsePlan takes control characters out of a title', () => {
  const [first] = parsePlan('- [ ] 1. A\u001b[31mred\u0007 title\n')

  expect(first?.title).not.toMatch(/[\x00-\x1f\x7f]/)
  expect(first?.title).toContain('red')
})

test('readList refuses a repeated task number and an unsafe one', async () => {
  const d = disk()
  for (const tasks of [[task(1), task(1)], [task(2 ** 60)]]) {
    d.files.set(d.path, JSON.stringify(listOf(tasks)))

    const out = await readList(d.$, d.path)

    expect(out.list).toBeNull()
    expect(out.reason).toBeTruthy()
  }
})

test('mergeList adds a dropped task\'s priced cost and leaves removed whole when every price is known', () => {
  const old = listOf([task(1, { work: { 'a-1': work({ workMs: 1000 }) } })])

  expect(mergeList(old, [], OPTS).removed).toEqual({ workMs: 1000, costUsd: 0.01 })
})

test('writeList keeps the last good file as .bak, and readList falls back to it when the list is cut short', async () => {
  const d = disk()
  const first = listOf([task(1, { work: { 'a-1': work() } })])
  await writeList(d.$, d.path, first)
  await writeList(d.$, d.path, listOf([task(1), task(2)]))
  expect(JSON.parse(d.files.get(`${d.path}.bak`) ?? 'null').tasks).toHaveLength(1)

  d.files.set(d.path, '{ "version": 1, "tasks": [') // a write cut short
  const out = await readList(d.$, d.path)

  expect(out.list?.tasks).toHaveLength(1) // the backup is the list before the last write
  expect(out.reason).toMatch(/backup/)
})

test('writeList does not replace a good backup with a broken file', async () => {
  const d = disk()
  await writeList(d.$, d.path, listOf([task(1)]))
  await writeList(d.$, d.path, listOf([task(1), task(2)]))
  d.files.set(d.path, '{ broken')

  await writeList(d.$, d.path, listOf([task(7)]))

  expect(JSON.parse(d.files.get(`${d.path}.bak`) ?? 'null').tasks).toHaveLength(1)
})

test('readList keeps kind invalid, with its reason, when it shows the backup instead', async () => {
  const d = disk()
  await writeList(d.$, d.path, listOf([task(1)]))
  await writeList(d.$, d.path, listOf([task(1), task(2)]))
  d.files.set(d.path, '{ cut')

  const out = await readList(d.$, d.path)

  expect(out).toMatchObject({ kind: 'invalid', reason: expect.stringMatching(/backup/) })
  expect(out.list).not.toBeNull()
})

test('readList has no kind for a good list', async () => {
  const d = disk()
  d.files.set(d.path, JSON.stringify(listOf([task(1)])))

  expect((await readList(d.$, d.path)).kind).toBeUndefined()
})

test('readList says unreadable, not invalid, when the list is broken and its backup is there but cannot be read', async () => {
  const d = disk()
  d.files.set(d.path, '{ cut')
  d.files.set(`${d.path}.bak`, JSON.stringify(listOf([task(1)])))
  const read = d.$.fs.read.bind(d.$.fs)
  d.$.fs.read = (async (path: string) => {
    if (path.endsWith('.bak')) throw new Error('EACCES: permission denied')
    return read(path)
  }) as unknown as typeof d.$.fs.read // the fake reads text; the engine's type is FsBytes

  const out = await readList(d.$, d.path)

  expect(out).toMatchObject({ list: null, kind: 'unreadable', reason: expect.stringMatching(/EACCES/) })
})

test('applyPlanTicks credits a QA member who built the task, not the reviewer who reviewed it', () => {
  const list = listOf([task(1, { status: 'review', work: { 'qa-1': work({ role: 'qa', step: 'build' }), 'rev-1': work({ role: 'reviewer', step: 'review' }) } })])

  const next = applyPlanTicks(list, [{ n: 1, title: 'a', done: true }], 9)

  expect(next.tasks[0]?.doneBy).toBe('qa-1')
})
