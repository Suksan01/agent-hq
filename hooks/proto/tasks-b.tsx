// Prototype only, variant B "Focus" (docs/specs/task-sidebar.md, phase 3): the sidebar task table. Removed in phase 6.
// What happens now comes first (working and review rows); done and waiting fold into one line each.

import type { Elements, RenderElement } from 'claude-code'

import { fitText, textWidth, tonesFor } from '../cells'
import type { HqData } from '../view'
import type { ProtoTask } from './mock'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const FRAME_MS = 120 // read off the sidebar's own clock (data.now): no timer of its own
const MAX_NOW = 6 // working and review rows shown before "+N more"
const MIN_W = 3
const USD_W = 6 // "12.34+"
const MIN_TASK_W = 6
const CHROME_W = 1 + 5 + MIN_W + USD_W // glyph, five gaps, Min and ≈ $: the columns that are never cut
const unfolded = new Set<'done' | 'waiting'>() // shortcut: module state, no action exists for it; the real build adds one to HqActions

const usdOf = (t: ProtoTask) => t.work.reduce((sum, w) => sum + (w.usd ?? 0), 0)
const minOf = (t: ProtoTask) => t.work.reduce((sum, w) => sum + w.min, 0)
const isPartial = (t: ProtoTask) => t.work.some(w => w.usd === null)
const sumOf = (list: ProtoTask[]) => ({
  min: list.reduce((s, t) => s + minOf(t), 0),
  usd: list.reduce((s, t) => s + usdOf(t), 0),
  partial: list.some(isPartial),
})
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - textWidth(s)))
const padLeft = (s: string, w: number) => ' '.repeat(Math.max(0, w - textWidth(s))) + s
const usdText = (usd: number, partial: boolean) => `${usd.toFixed(2)}${partial ? '+' : ''}`
/** The parts joined while they fit (fitText would dot the ≈); a part that does not fit is dropped whole, the last ones first. */
const fitParts = (parts: string[], room: number): string => {
  const kept = parts.filter((_, i) => textWidth(parts.slice(0, i + 1).join('')) <= room)
  return kept.join('')
}
const nameOf = (t: ProtoTask) => (t.status === 'done' ? t.doneBy : t.who)?.replace(/^senior-/, '') ?? null

export function TaskTableB(els: Els, data: HqData, tasks: ProtoTask[]): RenderElement | null {
  const { Box, Text, Button } = els
  const tone = tonesFor(data.isLight)
  const W = data.columns
  if (tasks.length === 0) return <Text dimColor>{fitText('The plan has no tasks yet', W)}</Text>

  const numW = String(Math.max(...tasks.map(t => t.n))).length
  const whoW = Math.max(3, Math.min(10, W - (CHROME_W + numW + MIN_TASK_W))) // Task gives way first, then Who
  const taskW = Math.max(1, W - (CHROME_W + numW + whoW))

  const glyph = (t: ProtoTask) => {
    if (t.status === 'working') return <Text color={tone.running}>{SPINNER[Math.floor(data.now / FRAME_MS) % SPINNER.length]}</Text>
    if (t.status === 'review') return <Text color={tone.needs_input}>◑</Text>
    if (t.status === 'done') return <Text color={tone.done}>✓</Text>
    return <Text dimColor>○</Text>
  }
  const columns = (lead: RenderElement, num: string, title: string, who: string, min: string, usd: string, props: { bold?: boolean; dimColor?: boolean } = {}) => (
    <Box>
      {lead}
      <Text {...props}>{` ${padLeft(num, numW)} ${pad(fitText(title, taskW), taskW)} ${pad(fitText(who, whoW), whoW)} ${padLeft(min, MIN_W)} ${padLeft(usd, USD_W)}`}</Text>
    </Box>
  )
  const row = (t: ProtoTask) => {
    const isEmpty = t.work.length === 0
    const min = isEmpty ? '—' : minOf(t) === 0 ? '<1' : String(minOf(t))
    const usd = isEmpty ? '—' : usdText(usdOf(t), isPartial(t))
    return (
      <Box key={`b-row-${t.n}`}>
        {columns(glyph(t), String(t.n), t.title, nameOf(t) ?? '—', min, usd, t.status === 'waiting' ? { dimColor: true } : {})}
      </Box>
    )
  }
  const fold = (key: 'done' | 'waiting', list: ProtoTask[], label: string, glyphNode: RenderElement, summary: string[]) => {
    if (list.length === 0) return null
    const isOpen = unfolded.has(key)
    const toggle = () => void (unfolded.has(key) ? unfolded.delete(key) : unfolded.add(key))
    return (
      <Box key={`b-fold-${key}`} flexDirection="column">
        <Box>
          <Text dimColor>{isOpen ? '▾ ' : '▸ '}</Text>
          {glyphNode}
          {/* the Button's label can't hold ▸ or ≈ (it dots them), so only the plain words are the target */}
          <Button key={`b-toggle-${key}`} onPress={toggle}>
            {` ${label} ${list.length}`}
          </Button>
          <Text>{fitParts(summary, W - 4 - textWidth(` ${label} ${list.length}`))}</Text>
        </Box>
        {isOpen && list.map(row)}
      </Box>
    )
  }

  const now = tasks.filter(t => t.status === 'working' || t.status === 'review')
  const done = tasks.filter(t => t.status === 'done')
  const waiting = tasks.filter(t => t.status === 'waiting')
  const doneSum = sumOf(done)
  const all = sumOf(tasks)
  const shown = now.slice(0, MAX_NOW)

  return (
    <Box flexDirection="column">
      {columns(<Text> </Text>, '#', 'Task', 'Who', 'Min', '≈ $', { dimColor: true })}
      {shown.length > 0 && <Text dimColor>Now</Text>}
      {shown.map(row)}
      {now.length > shown.length && <Text dimColor>{`  +${now.length - shown.length} more`}</Text>}
      {fold('done', done, 'Done', <Text color={tone.done}>✓</Text>, [` · ${doneSum.min} min`, ` · ≈ $${usdText(doneSum.usd, doneSum.partial)}`])}
      {fold('waiting', waiting, 'Waiting', <Text dimColor>○</Text>, [])}
      <Text dimColor>{'─'.repeat(W)}</Text>
      {columns(<Text> </Text>, '', `Total ${done.length}/${tasks.length}`, '', String(all.min), usdText(all.usd, all.partial), { bold: true })}
    </Box>
  )
}
