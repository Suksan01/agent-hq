// Prototype only, variant A "Ledger" (docs/specs/task-sidebar.md, phase 3): the sidebar task table. Removed in phase 6.

import type { Elements, RenderElement } from 'claude-code'

import { fitText, textWidth, tonesFor } from '../cells'
import type { HqData } from '../view'
import type { ProtoStatus, ProtoTask } from './mock'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const SPINNER = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏']
const SPIN_MS = 125 // the sidebar's animation tick (register.tsx FRAME_MS): data.now moves with it
const MAX_ROWS = 8 // task rows shown before "+N more"
const MAX_WHO = 12
const MIN_TASK = 8
const MIN_WHO = 4
const RANK: Record<ProtoStatus, number> = { working: 0, review: 1, waiting: 2, done: 3 }
const NONE = '—'

type Cell = { text: string; color?: string; dim?: boolean }
const pad = (s: string, w: number, right = false) => (right ? ' '.repeat(Math.max(0, w - textWidth(s))) + s : s + ' '.repeat(Math.max(0, w - textWidth(s))))

const minutesOf = (x: ProtoTask) => x.work.reduce((m, w) => m + w.min, 0)
const usdOf = (x: ProtoTask) => {
  const known = x.work.filter(w => w.usd !== null)
  return { sum: known.reduce((s, w) => s + (w.usd ?? 0), 0), isPartial: known.length < x.work.length, isNone: known.length === 0 }
}
const money = (sum: number, isPartial: boolean) => `${sum.toFixed(2)}${isPartial ? '+' : ''}`

export function TaskTableA(els: Els, data: HqData, tasks: ProtoTask[]): RenderElement | null {
  const { Box, Text } = els
  const tones = tonesFor(data.isLight)
  if (tasks.length === 0) return <Box key="a-row-empty"><Text dimColor>The plan has no tasks yet.</Text></Box>

  const isCrowded = tasks.length > MAX_ROWS
  const shown = isCrowded ? [...tasks].sort((a, b) => RANK[a.status] - RANK[b.status] || a.n - b.n).slice(0, MAX_ROWS) : tasks
  const rows = shown.map(x => {
    const usd = usdOf(x)
    const who = x.status === 'done' ? x.doneBy : x.who
    return { x, who: who ?? NONE, min: x.work.length ? (minutesOf(x) < 1 ? '<1' : String(Math.round(minutesOf(x)))) : NONE, usd: usd.isNone ? NONE : money(usd.sum, usd.isPartial) }
  })
  const all = tasks.map(usdOf)
  const total = {
    min: String(Math.round(tasks.reduce((m, x) => m + minutesOf(x), 0))),
    usd: money(all.reduce((s, u) => s + u.sum, 0), all.some(u => u.isPartial)),
  }
  const nW = Math.max(1, ...tasks.map(x => String(x.n).length))
  const minW = Math.max(3, ...rows.map(r => r.min.length), total.min.length)
  const usdW = Math.max(3, ...rows.map(r => textWidth(r.usd)), total.usd.length)
  let whoW = Math.min(MAX_WHO, Math.max(3, ...rows.map(r => textWidth(r.who))))
  const fixed = (who: number) => 2 + nW + 1 + 1 + who + 1 + minW + 1 + usdW // glyph, space, #, space, task, space, who, ...
  let taskW = data.columns - fixed(whoW)
  while (taskW < MIN_TASK && whoW > MIN_WHO) { whoW--; taskW++ }
  taskW = Math.max(1, taskW)

  const line = (key: string, cells: Cell[]) => (
    <Box key={`a-row-${key}`}>
      {cells.map((c, i) => <Text key={`cell-${i}`} color={c.color} dimColor={c.dim}>{c.text}</Text>)}
    </Box>
  )
  const body = (glyph: Cell, n: string, task: string, who: string, min: string, usd: string, dim = false): Cell[] => [
    glyph,
    { text: ` ${pad(n, nW, true)} `, dim },
    { text: pad(fitText(task, taskW), taskW), dim },
    { text: ` ${pad(who === NONE ? NONE : fitText(who, whoW), whoW)} `, dim },
    { text: `${pad(min, minW, true)} ${pad(usd, usdW, true)}`, dim },
  ]
  const spin = SPINNER[Math.floor(data.now / SPIN_MS) % SPINNER.length] ?? '⠋'
  const glyphOf = (s: ProtoStatus): Cell =>
    s === 'done' ? { text: '✓', color: tones.done } : s === 'working' ? { text: spin, color: tones.running } : s === 'review' ? { text: '◑', color: tones.needs_input } : { text: '○', dim: true }

  const doneCount = tasks.filter(x => x.status === 'done').length
  const hidden = tasks.length - shown.length
  const totalLabel = `Total ${doneCount}/${tasks.length}`
  const totalGap = Math.max(1, 1 + nW + 2 + taskW + whoW + 2 - textWidth(totalLabel)) // up to the Min column
  return (
    <Box key="ledger" flexDirection="column">
      {line('head', body({ text: ' ' }, '#', 'Task', 'Who', 'Min', '≈ $', true))}
      {line('rule', [{ text: '─'.repeat(Math.max(1, data.columns)), dim: true }])}
      {rows.map(r => line(`task-${r.x.n}`, body(glyphOf(r.x.status), String(r.x.n), r.x.title, r.who, r.min, r.usd, r.x.status === 'waiting')))}
      {hidden > 0 && line('more', [{ text: `+${hidden} more`, dim: true }])}
      {line('rule2', [{ text: '─'.repeat(Math.max(1, data.columns)), dim: true }])}
      {line('total', [{ text: totalLabel + ' '.repeat(totalGap) }, { text: `${pad(total.min, minW, true)} ${pad(total.usd, usdW, true)}` }])}
    </Box>
  )
}
