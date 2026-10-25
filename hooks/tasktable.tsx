// The sidebar's task table (docs/specs/task-sidebar.md Screens, AC14 to AC16): one row per task of the saved plan list, with its
// status, number, title, who, minutes and estimated cost, then a total. Shown in place of the Tasks section when a list exists.

import type { Elements, RenderElement } from 'claude-code'

import { MIN_NAME, fitText, glyphCells, textWidth, tonesFor } from './cells'
import { t } from './i18n'
import { costOf } from './prices'
import { isCounted } from './tasklist'
import type { ListTask, TaskStatus } from './tasklist'
import type { HqData, Raster } from './view'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const SPINNER = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏']
const SPIN_MS = 125 // the sidebar's animation tick (register.tsx FRAME_MS)
const MAX_ROWS = 8 // task rows shown before "+N more"
const MAX_WHO = 12
const MIN_TASK = 8 // the Task column shrinks first, then Who, down to these (a name keeps what the sidebar keeps of it)
const MS_PER_MIN = 60_000
const NONE = '—'
const RANK: Record<TaskStatus, number> = { working: 0, review: 1, waiting: 2, done: 3 }

type Cell = { text: string; color?: string; dim?: boolean }

const pad = (s: string, w: number, isRight = false) => (isRight ? ' '.repeat(Math.max(0, w - textWidth(s))) + s : s + ' '.repeat(Math.max(0, w - textWidth(s))))

/** The rows shown: plan order when all fit; otherwise working, review, waiting, then done, each by number, cut to MAX_ROWS. */
export function shownTasks(tasks: ListTask[]): ListTask[] {
  if (tasks.length <= MAX_ROWS) return tasks
  return [...tasks].sort((a, b) => RANK[a.status] - RANK[b.status] || a.n - b.n).slice(0, MAX_ROWS)
}

const works = (x: ListTask) => Object.values(x.work)

/** Work minutes, and the cost of the priced entries (partial when a counted entry has no price; none when nothing is priced). */
function totalsOf(x: ListTask) {
  const counted = works(x).filter(isCounted)
  const costs = counted.map(w => costOf({ ...w, model: w.model ?? undefined }))
  const priced = costs.filter((c): c is number => c !== null)
  return { ms: counted.reduce((s, w) => s + w.workMs, 0), usd: priced.reduce((s, c) => s + c, 0), isPriced: priced.length > 0, isPartial: priced.length < counted.length }
}

const minutes = (ms: number, isCounted: boolean) => (!isCounted ? NONE : ms < MS_PER_MIN ? '<1' : String(Math.round(ms / MS_PER_MIN)))
/** The total row's minutes: `<1` under a minute, else whole minutes, 0 where nothing is counted (the page's total follows the same rule). */
const totalMinutes = (ms: number) => (ms > 0 && ms < MS_PER_MIN ? '<1' : String(Math.round(ms / MS_PER_MIN)))
const money = (usd: number, isPartial: boolean) => `$${usd.toFixed(2)}${isPartial ? '+' : ''}`

/** The member on a working or review task (who holds its latest event), the finisher of a done one, nobody on a waiting one. */
function whoOf(x: ListTask): string {
  if (x.status === 'done') return x.doneBy ?? NONE
  if (x.status === 'waiting') return NONE
  return x.events.at(-1)?.who ?? Object.keys(x.work).at(-1) ?? NONE
}

/** One 1x1 Raster per shown working task: a text glyph would only move on the 1 s poll, a Raster moves on the 125 ms tick. */
export function taskSpinners(data: HqData, at: number, base: string): Raster[] {
  if (!data.taskList) return []
  const frame = SPINNER[Math.floor(at / SPIN_MS) % SPINNER.length] ?? SPINNER[0]!
  const color = tonesFor(data.isLight).running
  return shownTasks(data.taskList.tasks)
    .filter(x => x.status === 'working')
    .map(x => ({ key: `task-spin-${x.n}`, columns: 1, rows: 1, cells: glyphCells(frame, color, base) }))
}

export function TaskTable(els: Els, data: HqData, draw: (key: string) => RenderElement | null): RenderElement | null {
  const list = data.taskList
  if (!list || list.tasks.length === 0) return null
  const { Box, Text } = els
  const lang = data.lang ?? 'en'
  const tones = tonesFor(data.isLight)
  const shown = shownTasks(list.tasks)

  const rows = shown.map(x => {
    const sum = totalsOf(x)
    return { x, who: whoOf(x), min: minutes(sum.ms, sum.ms > 0), usd: sum.isPriced ? money(sum.usd, sum.isPartial) : NONE }
  })
  const all = list.tasks.map(totalsOf)
  const removed = list.removed
  const total = {
    min: totalMinutes(all.reduce((s, a) => s + a.ms, 0) + removed.workMs),
    usd: money(all.reduce((s, a) => s + a.usd, 0) + removed.costUsd, removed.isPartial === true || all.some(a => a.isPartial)),
  }
  const heads = { task: t(lang, 'tasktable.task'), who: t(lang, 'tasktable.who'), min: t(lang, 'tasktable.min') }
  const nW = Math.max(1, ...list.tasks.map(x => String(x.n).length))
  const minW = Math.max(textWidth(heads.min), ...rows.map(r => r.min.length), total.min.length)
  const usdW = Math.max(3, ...rows.map(r => textWidth(r.usd)), total.usd.length)
  let whoW = Math.min(MAX_WHO, Math.max(textWidth(heads.who), ...rows.map(r => textWidth(r.who))))
  // a row: glyph, number, title, who, min, cost, with a space between each
  const fixed = (who: number) => 1 + 1 + nW + 1 + 1 + who + 1 + minW + 1 + usdW
  let taskW = data.columns - fixed(whoW)
  while (taskW < MIN_TASK && whoW > MIN_NAME) {
    whoW--
    taskW++
  }
  taskW = Math.max(1, taskW)

  const line = (key: string, cells: Cell[], lead?: RenderElement | null) => (
    <Box key={key}>
      {lead}
      {cells.map((c, i) => (
        <Text key={`cell-${i}`} color={c.color} dimColor={c.dim}>
          {c.text}
        </Text>
      ))}
    </Box>
  )
  const body = (n: string, title: string, who: string, min: string, usd: string, dim = false): Cell[] => [
    { text: ` ${pad(n, nW, true)} `, dim },
    { text: pad(fitText(title, taskW), taskW), dim },
    { text: ` ${pad(who === NONE ? NONE : fitText(who, whoW), whoW)} `, dim },
    { text: `${pad(min, minW, true)} ${pad(usd, usdW, true)}`, dim },
  ]
  const glyphOf = (s: TaskStatus): Cell =>
    s === 'done' ? { text: '✓', color: tones.done } : s === 'review' ? { text: '◑', color: tones.needs_input } : { text: '○', dim: true }

  const done = list.tasks.filter(x => x.status === 'done').length
  const hidden = list.tasks.length - shown.length
  const totalLabel = `${t(lang, 'tasktable.total')} ${done}/${list.tasks.length}`
  const upToMin = Math.max(1, 1 + nW + 2 + taskW + whoW + 2 - textWidth(totalLabel))
  return (
    <Box key="task-table" flexDirection="column">
      {line('tasks-head', [{ text: ' ', dim: true }, ...body('#', heads.task, heads.who, heads.min, '≈ $', true)])}
      <Text key="task-rule-head" dimColor>
        {'─'.repeat(Math.max(1, data.columns))}
      </Text>
      {rows.map(r =>
        r.x.status === 'working'
          ? line(`tasks-row-${r.x.n}`, body(String(r.x.n), r.x.title, r.who, r.min, r.usd), draw(`task-spin-${r.x.n}`) ?? <Text color={tones.running}>●</Text>)
          : line(`tasks-row-${r.x.n}`, [glyphOf(r.x.status), ...body(String(r.x.n), r.x.title, r.who, r.min, r.usd, r.x.status === 'waiting')]),
      )}
      {hidden > 0 && line('tasks-more', [{ text: t(lang, 'tasktable.more', { n: hidden }), dim: true }])}
      <Text key="task-rule-total" dimColor>
        {'─'.repeat(Math.max(1, data.columns))}
      </Text>
      {line('tasks-total', [{ text: totalLabel + ' '.repeat(upToMin) }, { text: `${pad(total.min, minW, true)} ${pad(total.usd, usdW, true)}` }])}
    </Box>
  )
}
