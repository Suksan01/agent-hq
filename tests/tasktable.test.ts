// Spec for the sidebar task table, variant A "Ledger" (docs/specs/task-sidebar.md Screens/States, AC14, AC15, AC16, AC19; plan task 6;
// the spec's "Notes for the real build"). hooks/tasktable.tsx is new; hooks/view.tsx shows it in place of the Tasks section. The
// contract these tests pin down:
//  - HqData gets `taskList?: TaskList` (hooks/tasklist.ts), read from tasks.json by readData; no list (or an invalid file) is undefined;
//  - the table's lines are Boxes keyed `tasks-head`, `tasks-row-<n>` (plan order, one per shown task), `tasks-more` ("+N more") and
//    `tasks-total`; a Box's `text` is its line, columns: glyph, #, Task, Who, Min, ≈ $;
//  - glyphs: ✓ done, ◑ review, ○ waiting; a working row's glyph is a Raster drawn in `sidebarRasters(data, at)`, keyed `task-spin-<n>`,
//    1 column x 1 row, whose cells change from one 125 ms animation frame to the next (it is not a text glyph);
//  - Who: the member on a working or review task (the holder of its latest event), `doneBy` on a done task, `—` on a waiting one;
//  - Min: whole minutes of work, `<1` under a minute, `—` where nothing is counted; ≈ $: costOf (hooks/prices.ts) summed to two decimals,
//    `—` where nothing is priced, a trailing `+` where some member's model has no price; the total row says `Total <done>/<count>`;
//  - more tasks than fit (8 rows, as the prototype): working, then review, then waiting, then done rows first, a `+N more` line, the total row always last;
//  - strings in hooks/i18n.ts under `tasktable.*` (task, who, min, total, more) in en and th;
//  - with a list the Tasks section ("TASK BOARD") gives way to the table; with no list the sidebar is as it is today.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { textWidth } from '../hooks/cells'
import { TABLES } from '../hooks/i18n'
import type { Key } from '../hooks/i18n'
import { PRICES, costOf } from '../hooks/prices'
import type { TaskList } from '../hooks/tasklist'
import { sidebarRasters } from '../hooks/view'
import type { HqData } from '../hooks/view'

const ROOT = '/work/app'
const LIST_FILE = `${ROOT}/.claude/agent-hq/tasks.json`
const MODEL = PRICES[0]!.prefix
const THAI = /[฀-๿]/
const THAI_TITLE = 'ทำตารางงานในแถบด้านข้างให้แสดงผลได้ครบทุกความกว้าง'

type Row = Record<string, unknown>
const MIN = 60_000
/** One member's work: `min` minutes and a million output tokens, so its cost is the model's output price. */
const work = (min: number, over: Row = {}) => ({ role: 'dev', step: 'build', workMs: min * MIN, inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, model: MODEL, ...over })
const task = (n: number, over: Row = {}) => ({ n, title: `Task ${n}`, status: 'waiting', doneBy: null, startedAt: null, doneAt: null, work: {}, events: [], ...over })
const ev = (who: string, at: number) => ({ at, kind: 'start', who })
const listOf = (...tasks: Row[]) => ({ version: 1, plan: 'docs/plans/x.md', approvedAt: 1, tasks, removed: { workMs: 0, costUsd: 0 } }) as unknown as TaskList
const price = PRICES[0]!.output
const money = (n: number) => n.toFixed(2)

/** The ledger of the spec: done, working, review (one member's model unpriced), waiting, and a Thai title with markup. */
const LEDGER = () =>
  listOf(
    task(1, { title: 'Data model', status: 'done', doneBy: 'dev-1', work: { 'qa-1': work(3, { role: 'qa', step: 'tests' }), 'dev-1': work(9) }, events: [ev('qa-1', 1), ev('dev-1', 2)] }),
    task(2, { title: 'Sidebar list', status: 'working', work: { 'dev-2': work(5) }, events: [ev('dev-2', 3)] }),
    task(3, { title: THAI_TITLE, status: 'review', work: { 'dev-3': work(2), 'rev-1': work(1, { role: 'reviewer', step: 'review', model: 'mystery-model' }) }, events: [ev('dev-3', 4), ev('rev-1', 5)] }),
    task(4, { title: 'Tests <b>bold</b>' }),
    task(5, { title: 'Just started', status: 'working', work: { 'dev-4': work(0, { outputTokens: 0 }) }, events: [ev('dev-4', 6)] }),
  )

async function mountTable($: Engine, on: On, list: TaskList | string | null, cols: number, extra: { board?: boolean } = {}) {
  mock.clock(on)
  let text = list === null ? undefined : typeof list === 'string' ? list : JSON.stringify(list)
  // a new session settles a saved working task (AC11): a working row is one a linked member's turn made, so those members run here
  const members = typeof list === 'object' && list !== null ? list.tasks.filter(t => t.status === 'working').flatMap(t => (t.events.at(-1)?.who ? [t.events.at(-1)!.who as string] : [])) : []
  const listed = members.map((name, i) => ({ id: `m${i}`, name, type: 'agent-hq:dev', description: 'x', status: 'running' as const }))
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', (_, e) => ({ value: e.path === LIST_FILE && text !== undefined }))
  on('fs.read', (_, e) => {
    if (e.path === LIST_FILE && text !== undefined) return { value: text }
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('agent.list', () => ({ value: listed }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'm0' }))
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('fs.write', (_, e) => {
    if (e.path === LIST_FILE) text = e.text
    return { value: undefined }
  })
  for (const event of ['ui.status', 'ui.open', 'ui.log', 'ui.toast', 'command.register'] as const) on(event, () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '7', subject: 'x' } } } : { result: {} as never }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true } as never)
  if (listed.length > 0) await $.agent.spawn({ prompt: 'go' } as never)
  for (const m of listed) await $.turn.complete({ answer: 'ok', durationMs: 0, isAborted: false, turnId: `t-${m.id}`, reason: 'answer', agentId: m.id } as never)
  if (extra.board) await ($.tool.call as unknown as (i: Record<string, unknown>) => Promise<unknown>)({ tool: 'TaskCreate', subject: 'A board task', description: 'x' })
  return $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: { title: 'Agent HQ', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 120 }, view: {} } as never })
}

type Mounted = Awaited<ReturnType<typeof mountTable>>
async function linesOf(ui: Mounted) {
  const boxes = (await ui.findAll({ type: 'Box' })).filter(r => r.key?.startsWith('tasks-'))
  return boxes.map(r => ({ key: r.key ?? '', text: r.text ?? '' }))
}
const rowOf = (lines: { key: string; text: string }[], n: number) => lines.find(l => l.key === `tasks-row-${n}`)?.text ?? ''
/** The last two whitespace-separated cells of a line: Min and ≈ $. */
const tail = (line: string) => line.trim().split(/\s+/).slice(-2)

// ---- rows, glyphs, columns

test('every task is a row in plan order, with a header and a total row', async ($, on) => {
  const ui = await mountTable($, on, LEDGER(), 80)

  const lines = await linesOf(ui)

  expect(lines.map(l => l.key)).toEqual(['tasks-head', 'tasks-row-1', 'tasks-row-2', 'tasks-row-3', 'tasks-row-4', 'tasks-row-5', 'tasks-total'])
  for (const word of ['#', 'Task', 'Who', 'Min', '≈ $']) expect(lines[0]?.text, word).toContain(word)
  await ui.unmount()
})

test('done shows ✓, review ◑, waiting ○, and a working row has no text glyph (AC14)', async ($, on) => {
  const ui = await mountTable($, on, LEDGER(), 80)

  const lines = await linesOf(ui)

  expect(rowOf(lines, 1).trimStart()[0]).toBe('✓')
  expect(rowOf(lines, 3).trimStart()[0]).toBe('◑')
  expect(rowOf(lines, 4).trimStart()[0]).toBe('○')
  for (const n of [2, 5]) expect('✓◑○'.includes(rowOf(lines, n).trimStart()[0] ?? 'x'), `row ${n}`).toBe(false)
  await ui.unmount()
})

test('each row shows its number, title, who, whole minutes and the cost to the cent', async ($, on) => {
  const ui = await mountTable($, on, LEDGER(), 80)

  const lines = await linesOf(ui)

  expect(rowOf(lines, 1)).toMatch(new RegExp(`1\\s+Data model\\s+dev-1\\s+12\\s+${money(price * 2)}$`)) // done: who finished it
  expect(rowOf(lines, 2)).toMatch(new RegExp(`2\\s+Sidebar list\\s+dev-2\\s+5\\s+${money(price)}$`)) // working: the member on it
  expect(rowOf(lines, 3)).toMatch(new RegExp(`\\s+rev-1\\s+3\\s+${money(price)}\\+$`)) // review: the reviewer; one model unpriced: partial
  expect(rowOf(lines, 4)).toMatch(/4\s+Tests <b>bold<\/b>\s+—\s+—\s+—$/) // waiting, nobody, nothing counted; markup shown as text
  await ui.unmount()
})

test('under a minute shows <1, and a task with no tokens priced shows — for its cost', async ($, on) => {
  const list = listOf(
    task(1, { status: 'working', work: { 'dev-1': work(0, { workMs: 20_000 }) }, events: [ev('dev-1', 1)] }),
    task(2, { status: 'working', work: { 'dev-2': work(4, { model: 'mystery-model' }) }, events: [ev('dev-2', 2)] }),
  )
  const ui = await mountTable($, on, list, 80)

  const lines = await linesOf(ui)

  expect(tail(rowOf(lines, 1))).toEqual(['<1', money(price)])
  expect(tail(rowOf(lines, 2))).toEqual(['4', '—'])
  await ui.unmount()
})

test('a member just assigned, with nothing counted yet, shows — for Min and cost', async ($, on) => {
  const ui = await mountTable($, on, LEDGER(), 80)

  expect(tail(rowOf(await linesOf(ui), 5))).toEqual(['—', '—'])
  await ui.unmount()
})

test('the total row counts done over all, adds the minutes and the cost, and marks a partial cost with +', async ($, on) => {
  const ui = await mountTable($, on, LEDGER(), 80)

  const total = (await linesOf(ui)).find(l => l.key === 'tasks-total')?.text ?? ''

  expect(total).toMatch(/^Total 1\/5/)
  expect(tail(total)).toEqual([String(12 + 5 + 3), `${money(price * 4)}+`])
  await ui.unmount()
})

test('a total under one minute says <1 like its row', async ($, on) => {
  const ui = await mountTable($, on, listOf(task(1, { status: 'done', doneBy: 'dev-1', work: { 'dev-1': work(31 / 60) }, events: [ev('dev-1', 1)] })), 60)

  expect(tail((await linesOf(ui)).find(l => l.key === 'tasks-total')?.text ?? '')[0]).toBe('<1')
  await ui.unmount()
})

test('a total with nothing counted says 0', async ($, on) => {
  const ui = await mountTable($, on, listOf(task(1)), 60)

  expect(tail((await linesOf(ui)).find(l => l.key === 'tasks-total')?.text ?? '')[0]).toBe('0')
  await ui.unmount()
})

test('a total with every cost priced has no +', async ($, on) => {
  const list = listOf(task(1, { status: 'done', doneBy: 'dev-1', work: { 'dev-1': work(2) }, events: [ev('dev-1', 1)] }), task(2))
  const ui = await mountTable($, on, list, 60)

  const total = (await linesOf(ui)).find(l => l.key === 'tasks-total')?.text ?? ''

  expect(total).toMatch(/^Total 1\/2/)
  expect(tail(total)).toEqual(['2', money(price)])
  await ui.unmount()
})

// ---- widths: AC15

for (const cols of [40, 60, 100]) {
  test(`at ${cols} columns no row is wider than the sidebar, Min and ≈ $ are whole, and the Task column is cut with …`, async ($, on) => {
    const ui = await mountTable($, on, LEDGER(), cols)

    const lines = await linesOf(ui)

    expect(lines.length).toBeGreaterThan(2)
    for (const l of lines) expect(textWidth(l.text), `${l.key}: ${l.text}`).toBeLessThanOrEqual(cols)
    for (const n of [1, 2, 3, 4, 5]) {
      const [min, cost] = tail(rowOf(lines, n))
      expect(min, `row ${n} Min`).toMatch(/^(\d+|<1|—)$/)
      expect(cost, `row ${n} cost`).toMatch(/^(\d+\.\d\d\+?|—)$/)
    }
    if (cols < 100) expect(rowOf(lines, 3)).toMatch(/…\s/) // the Thai title does not fit: cut, the next column whole
    expect(tail(rowOf(lines, 1))).toEqual(['12', money(price * 2)])
    await ui.unmount()
  })
}

// ---- more tasks than fit: AC16

test('with more tasks than fit, working and review rows show first, then "+N more", and the total row is always last (AC16)', async ($, on) => {
  const many = [
    ...Array.from({ length: 12 }, (_, i) => task(i + 1, { status: 'done', doneBy: 'dev-1', work: { 'dev-1': work(1) }, events: [ev('dev-1', i)] })),
    task(13, { status: 'waiting' }),
    task(14, { status: 'review', work: { 'rev-1': work(1, { step: 'review' }) }, events: [ev('rev-1', 50)] }),
    task(15, { status: 'working', work: { 'dev-2': work(2) }, events: [ev('dev-2', 51)] }),
    ...Array.from({ length: 10 }, (_, i) => task(16 + i)),
  ]
  const ui = await mountTable($, on, listOf(...many), 60)

  const lines = await linesOf(ui)

  const keys = lines.map(l => l.key)
  const shown = keys.filter(k => k.startsWith('tasks-row-')).map(k => Number(k.slice('tasks-row-'.length)))
  expect(shown.length).toBeLessThan(many.length)
  expect(shown.slice(0, 2).sort((a, b) => a - b)).toEqual([14, 15]) // working and review before anything else
  expect(shown.indexOf(15)).toBeLessThan(shown.indexOf(14)) // working before review
  expect(shown.indexOf(13)).toBeGreaterThan(shown.indexOf(14)) // waiting after them
  expect(shown.filter(n => n <= 12)).toEqual([]) // done rows last: 11 waiting ones come first and fill what fits
  expect(lines.find(l => l.key === 'tasks-more')?.text).toBe(`+${many.length - shown.length} more`)
  expect(keys.at(-1)).toBe('tasks-total')
  expect(lines.at(-1)?.text).toMatch(/^Total 12\/25/)
  await ui.unmount()
})

// ---- the spinner is a Raster: AC14

const dataWith = (list: TaskList | undefined, over: Partial<HqData> = {}): HqData => ({ agents: {}, todos: {}, tasks: {}, now: 0, hideFinished: false, columns: 58, isLight: false, team: null, ...(list ? { taskList: list } : {}), ...over }) as HqData
const spins = (data: HqData, at: number) => sidebarRasters(data, at).filter(r => r.key.startsWith('task-spin-'))

test('a working task yields a one-cell Raster keyed for it, and only working tasks do (AC14)', () => {
  const list = listOf(task(1, { status: 'done', doneBy: 'a' }), task(2, { status: 'working', work: { 'dev-2': work(1) }, events: [ev('dev-2', 1)] }), task(3, { status: 'review' }), task(4), task(5, { status: 'working', work: { 'dev-4': work(1) }, events: [ev('dev-4', 2)] }))

  const rasters = spins(dataWith(list), 0)

  expect(rasters.map(r => r.key)).toEqual(['task-spin-2', 'task-spin-5'])
  for (const r of rasters) expect([r.columns, r.rows]).toEqual([1, 1])
})

test('the spinner Raster changes with the 125 ms animation tick, and holds still within one frame', () => {
  const list = listOf(task(2, { status: 'working', work: { 'dev-2': work(1) }, events: [ev('dev-2', 1)] }))
  const cellsAt = (at: number) => spins(dataWith(list), at)[0]?.cells

  expect(cellsAt(0)).toBeDefined()
  expect(cellsAt(0)).toBe(cellsAt(50))
  expect(cellsAt(125)).not.toBe(cellsAt(0))
  expect(cellsAt(250)).not.toBe(cellsAt(125))
  const seen = new Set(Array.from({ length: 10 }, (_, i) => cellsAt(i * 125)))
  expect(seen.size).toBeGreaterThan(2) // a run of frames, not a blink between two
})

test('no list gives no spinner Raster', () => {
  expect(spins(dataWith(undefined), 0)).toEqual([])
})

// ---- strings: en and th

test('every string of the table is in both tables, and the Thai ones are Thai', () => {
  const keys = (Object.keys(TABLES.en) as Key[]).filter(k => k.startsWith('tasktable.'))

  expect(keys.length).toBeGreaterThanOrEqual(5)
  for (const word of ['task', 'who', 'min', 'total', 'more']) expect(keys, word).toContain(`tasktable.${word}`)
  for (const key of keys) {
    expect(TABLES.th[key], key).toMatch(THAI)
    expect(TABLES.th[key], key).not.toBe(TABLES.en[key])
  }
})

test('in Thai the header, total and "+N more" are Thai, the Thai title is shown whole, and no row is wider than the sidebar', { options: { language: 'thai' } }, async ($, on) => {
  const many = Array.from({ length: 12 }, (_, i) => task(i + 1, { title: i === 0 ? THAI_TITLE : `Task ${i}`, status: i === 0 ? 'working' : 'waiting', work: i === 0 ? { 'dev-1': work(2) } : {}, events: i === 0 ? [ev('dev-1', 1)] : [] }))
  const ui = await mountTable($, on, listOf(...many), 40)

  const lines = await linesOf(ui)

  expect(lines.find(l => l.key === 'tasks-head')?.text).toMatch(THAI)
  expect(lines.find(l => l.key === 'tasks-total')?.text).toMatch(THAI)
  expect(lines.find(l => l.key === 'tasks-more')?.text).toMatch(THAI)
  expect(lines.find(l => l.key === 'tasks-head')?.text).not.toMatch(/Task|Who/)
  expect(lines.find(l => l.key === 'tasks-total')?.text).not.toContain('Total')
  expect(rowOf(lines, 1)).toContain('ทำตาราง')
  for (const l of lines) expect(textWidth(l.text), l.text).toBeLessThanOrEqual(40)
  await ui.unmount()
})

// ---- no list: AC19; a list replaces the Tasks section

test('with no tasks.json the sidebar has no table, and an unreadable file is the same (AC19)', async ($, on) => {
  const none = await mountTable($, on, null, 60)
  expect(await linesOf(none)).toEqual([])
  await none.unmount()
})

test('an invalid tasks.json shows no table and does not break the sidebar (AC12, AC19)', async ($, on) => {
  const ui = await mountTable($, on, '{ half a file', 60)

  expect(await linesOf(ui)).toEqual([])
  expect(await ui.find({ key: 'toggle-hide' })).toBeDefined() // the sidebar is still drawn
  await ui.unmount()
})

test('with a list the table takes the place of the TASK BOARD section; without one the board shows as today (AC19)', async ($, on) => {
  const withList = await mountTable($, on, LEDGER(), 60, { board: true })
  expect((await linesOf(withList)).length).toBeGreaterThan(0)
  expect(await withList.find({ text: /TASK BOARD/ })).toBeUndefined()
  await withList.unmount()
})

test('without a list the TASK BOARD section shows as today', async ($, on) => {
  const without = await mountTable($, on, null, 60, { board: true })

  expect(await without.find({ text: /TASK BOARD/ })).toBeDefined()
  expect(await linesOf(without)).toEqual([])
  await without.unmount()
})

test('costs follow the price table: a model\'s own price decides the number (AC10 on screen)', async ($, on) => {
  const model = PRICES.at(-1)!
  const list = listOf(task(1, { status: 'working', work: { 'dev-1': work(1, { model: model.prefix, outputTokens: 0, inputTokens: 1_000_000 }) }, events: [ev('dev-1', 1)] }))
  const ui = await mountTable($, on, list, 60)

  const cost = costOf({ model: model.prefix, inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

  expect(tail(rowOf(await linesOf(ui), 1))[1]).toBe(money(cost ?? Number.NaN))
  await ui.unmount()
})
