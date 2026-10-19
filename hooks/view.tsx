import type { Elements, RenderElement } from 'claude-code'

import type { HqAgent, HqStatus, HqTask, HqTaskStatus, HqTodo } from '../types'
import { MASCOT_W, TONE_COLOR, TONE_GLYPH, mascotCells, mascotText, speciesOf, trackCells } from './cells'
import type { Tone } from './cells'
import { MAIN, agentWork, elapsed, isFinished, overallProgress, progressOf, teamTree } from './model'
import type { AgentWork, Progress } from './model'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type DrawRaster = (key: string) => RenderElement | null

export type HqData = {
  agents: Record<string, HqAgent>
  todos: Record<string, HqTodo[]>
  tasks: Record<string, HqTask>
  now: number
  hideFinished: boolean
  columns: number
  isLight: boolean
}

/** The sidebar's own background: a shade deeper than the terminal's, in either theme. */
export const panelBg = (isLight: boolean) => (isLight ? '#E6E5E1' : '#0E0E10')

export type HqActions = {
  onView: (agentId: string) => void
  onToggleHide: () => void
  onClear: () => void
}

export type BandActions = { onOpenSidebar: () => void; onHide: () => void }

export type Raster = { key: string; columns: number; cells: string }

// ---------- tones, shared by band and sidebar ----------

const TONE_OF: Record<HqStatus, Tone> = {
  pending: 'running',
  running: 'running',
  waiting: 'needs_input',
  idle: 'needs_input',
  completed: 'done',
  failed: 'error',
  killed: 'error',
}
const TASK_TONE: Record<HqTaskStatus, Tone> = { in_progress: 'running', pending: 'running', completed: 'done' }
const TASK_GLYPH: Record<HqTaskStatus, string> = { in_progress: '◐', pending: '○', completed: '✓' }

const teamOf = (data: HqData) => Object.values(data.agents).filter(a => a.id !== MAIN)

/** A whole progress as one tone: waiting wins, then an error once nothing runs, then done. */
function toneOf(p: Progress, agents: HqAgent[]): Tone {
  const live = agents.filter(a => !isFinished(a.status))
  if (live.some(a => TONE_OF[a.status] === 'needs_input')) return 'needs_input'
  if (live.length === 0 && agents.some(a => TONE_OF[a.status] === 'error')) return 'error'
  if (p.total > 0 && p.done === p.total && live.length === 0) return 'done'
  return 'running'
}

const pct = (p: Progress) => (p.total === 0 ? 0 : p.done === p.total ? 100 : Math.min(99, Math.round((p.done / p.total) * 100)))
const pctText = (p: Progress) => `${String(pct(p)).padStart(3, ' ')}%`

/** The Team track counts tasks and todos; with none yet, it counts finished agents. */
function teamProgress(data: HqData): Progress {
  const team = teamOf(data)
  const overall = overallProgress(data.tasks, data.todos)
  if (overall.total > 0) return overall
  const done = team.filter(a => isFinished(a.status)).length
  return { done, active: team.length - done, total: team.length }
}

// ---------- the band above the prompt: plan-progress style tracks ----------

const BAND_TITLE_W = 6
// glyph, title, track, percent with their gaps; where clicks land the "Agents ›" button and ✕ too
export const bandTrackWidth = (cols: number, hasClicks: boolean) => Math.max(12, Math.min(512, cols - BAND_TITLE_W - 10 - (hasClicks ? 13 : 0)))

export const hasBand = (data: HqData) => teamOf(data).length > 0 || Object.keys(data.tasks).length > 0

export function bandRasters(data: HqData, W: number, t: number, isLight: boolean): Raster[] {
  const team = teamOf(data)
  const out: Raster[] = []
  const running = team.filter(a => !isFinished(a.status)).length
  const p = teamProgress(data)
  if (p.total > 0) {
    const label = running > 0 ? `${running} running` : p.done === p.total ? 'Done' : 'Team'
    out.push({ key: 'track-team', columns: W, cells: trackCells({ ...p, tone: toneOf(p, team), label, count: `${p.done}/${p.total}` }, W, t, isLight) })
  }
  const tasks = Object.values(data.tasks)
  if (tasks.length > 0) {
    const tp = progressOf(tasks)
    const current = tasks.find(x => x.status === 'in_progress')
    const label = current ? (current.activeForm ?? current.subject) : tp.done === tp.total ? 'Done' : 'Tasks'
    out.push({ key: 'track-tasks', columns: W, cells: trackCells({ ...tp, tone: tp.done === tp.total ? 'done' : 'running', label, count: `${tp.done}/${tp.total}` }, W, t, isLight) })
  }
  return out
}

export function BandView(els: Els, data: HqData, actions: BandActions, draw: DrawRaster, hasClicks: boolean): RenderElement {
  const { Box, Text, Button } = els
  const team = teamOf(data)
  const p = teamProgress(data)
  const tp = progressOf(Object.values(data.tasks))
  const row = (key: string, tone: Tone, title: string, prog: Progress, isFirst: boolean) => (
    <Box key={`band-${key}`} flexDirection="row" gap={1}>
      <Text color={TONE_COLOR[tone]}>{TONE_GLYPH[tone]}</Text>
      <Box width={BAND_TITLE_W} flexShrink={0}>
        <Text wrap="truncate">{title}</Text>
      </Box>
      {draw(key)}
      <Text dimColor>{pctText(prog)}</Text>
      {hasClicks && isFirst ? <Button key="open-sidebar" plain dimColor label="Agents ›" onPress={actions.onOpenSidebar} /> : null}
      {hasClicks && isFirst ? <Button key="hide-band" plain dimColor label="✕" onPress={actions.onHide} /> : null}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {p.total > 0 && row('track-team', toneOf(p, team), 'Team', p, true)}
      {tp.total > 0 && row('track-tasks', tp.done === tp.total ? 'done' : 'running', 'Tasks', tp, p.total === 0)}
    </Box>
  )
}

// ---------- the sidebar: agent tree, what each does now and next ----------

type TreeRow = { agent: HqAgent; prefix: string; indent: string; work: AgentWork }

/** Agents in tree order with their branch drawing; main is the root. */
export function treeRows(data: HqData): TreeRow[] {
  const tree = teamTree(data.agents)
  const rows: TreeRow[] = []
  const add = (agent: HqAgent, prefix: string, indent: string) => rows.push({ agent, prefix, indent, work: agentWork(agent, data.todos, data.tasks) })
  const walk = (parent: string, indent: string) => {
    const kids = (tree[parent] ?? []).filter(a => !(data.hideFinished && isFinished(a.status)))
    kids.forEach((kid, i) => {
      const isLast = i === kids.length - 1
      const childIndent = indent + (isLast ? '   ' : '│  ')
      add(kid, `${indent}${isLast ? '└─ ' : '├─ '}`, childIndent)
      walk(kid.id, childIndent)
    })
  }
  const main = data.agents[MAIN]
  if (main) add(main, '', '')
  walk(MAIN, '')
  return rows
}

const PCT_W = 5
const todoTrackWidth = (cols: number, indent: string) => Math.max(8, cols - [...indent].length - 3 - PCT_W)

/** The mascot's mood: an agent's own state; main is busy while any of its agents are. */
export function mascotTone(agent: HqAgent, data: HqData): Tone {
  if (agent.id !== MAIN) return TONE_OF[agent.status]
  return teamOf(data).some(a => !isFinished(a.status)) ? 'running' : 'done'
}

export function sidebarRasters(data: HqData, t: number): Raster[] {
  const base = panelBg(data.isLight)
  return treeRows(data).flatMap(({ agent, indent, work }) => {
    const mood = mascotTone(agent, data)
    const mascot: Raster = { key: `mascot-${agent.id}`, columns: MASCOT_W, cells: mascotCells(speciesOf(agent.mascot), mood, t, base) }
    if (!work.todos) return [mascot]
    const W = todoTrackWidth(data.columns, indent)
    const p = work.todos
    const tone: Tone = p.done === p.total ? 'done' : TONE_OF[agent.status] === 'error' ? 'error' : 'running'
    const count = `${p.done}/${p.total}`
    // the pill is the count alone: the line above already says what is in progress
    const todo = { key: `todo-${agent.id}`, columns: W, cells: trackCells({ ...p, tone, label: '', count }, W, mood === 'running' ? t : 0, data.isLight, base) }
    return [mascot, todo]
  })
}

function nowLine(agent: HqAgent, work: AgentWork, now: number): { tone: Tone; text: string } {
  if (agent.status === 'waiting') return { tone: 'needs_input', text: '? Needs approval' }
  if (agent.status === 'failed' || agent.status === 'killed') return { tone: 'error', text: `! ${agent.status === 'killed' ? 'stopped' : 'failed'}` }
  // the row above already shows how long it ran, so the last finished item takes the line when there is one
  if (agent.status === 'completed') return { tone: 'done', text: work.last ? `✓ ${work.last}` : `✓ done in ${elapsed((agent.endedAt ?? now) - agent.startedAt)}` }
  if (agent.status === 'idle') return { tone: 'needs_input', text: '◌ idle, waiting for a message' }
  const tool = agent.lastTool ? `${agent.lastTool}` : ''
  if (work.now) return { tone: 'running', text: `▸ ${work.now}${tool ? ` · ${tool}` : ''}` }
  return { tone: 'running', text: tool ? `▸ ${tool}` : '▸ starting…' }
}

function Section({ Box, Text }: Els, title: string, columns: number, aside?: string) {
  const label = ` ${title} ${aside ? `· ${aside} ` : ''}`
  return (
    <Box marginTop={1}>
      <Text bold>{label}</Text>
      <Text dimColor>{'─'.repeat(Math.max(0, columns - label.length))}</Text>
    </Box>
  )
}

function Header({ Box, Text }: Els, team: HqAgent[]) {
  const count = (tone: Tone) => team.filter(a => TONE_OF[a.status] === tone).length
  return (
    <Box justifyContent="space-between">
      <Text bold>
        <Text color={TONE_COLOR.running}>◆ </Text>AGENT HQ
      </Text>
      <Text>
        <Text color={TONE_COLOR.running}>●{count('running')} </Text>
        <Text color={TONE_COLOR.needs_input}>?{count('needs_input')} </Text>
        <Text color={TONE_COLOR.done}>✓{count('done')} </Text>
        <Text color={TONE_COLOR.error}>!{count('error')}</Text>
      </Text>
    </Box>
  )
}

function AgentNode(els: Els, data: HqData, actions: HqActions, row: TreeRow, draw: DrawRaster) {
  const { Box, Text, Button } = els
  const { agent, prefix, indent, work } = row
  const isMain = agent.id === MAIN
  const tone: Tone = isMain ? 'running' : TONE_OF[agent.status]
  const time = isMain ? `${agent.tools} tools` : elapsed((agent.endedAt ?? Math.max(data.now, agent.startedAt)) - agent.startedAt)
  const status = nowLine(agent, work, data.now)
  const pad = `${indent}   `
  return (
    <Box key={`agent-${agent.id}`} flexDirection="column">
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          <Text dimColor>{prefix}</Text>
          {draw(`mascot-${agent.id}`)}
          <Button key={`view-${agent.id}`} plain onPress={() => actions.onView(agent.id)}>
            <Text bold color={TONE_COLOR[tone]}>
              {agent.name}
            </Text>
          </Button>
          <Text dimColor wrap="truncate-end">
            {' '}
            {agent.role}
          </Text>
        </Box>
        <Text dimColor>{time}</Text>
      </Box>
      <Text wrap="truncate-end">
        <Text dimColor>{pad}</Text>
        <Text color={TONE_COLOR[status.tone]}>{status.text}</Text>
      </Text>
      {work.next && !isFinished(agent.status) && (
        <Text wrap="truncate-end" dimColor>
          {pad}○ next: {work.next}
        </Text>
      )}
      {work.todos && (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{pad}</Text>
          {draw(`todo-${agent.id}`)}
          <Text dimColor>{pctText(work.todos)}</Text>
        </Box>
      )}
    </Box>
  )
}

function TaskList({ Box, Text }: Els, data: HqData) {
  const ORDER: HqTaskStatus[] = ['in_progress', 'pending', 'completed']
  const all = Object.values(data.tasks)
  const isOpen = (id: string) => data.tasks[id] !== undefined && data.tasks[id]?.status !== 'completed'
  const shown = all
    .filter(t => t.status !== 'completed' || !data.hideFinished)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || Number(a.id) - Number(b.id))
  const hiddenDone = all.length - shown.length
  return (
    <Box flexDirection="column">
      {shown.map(task => {
        const blockers = task.blockedBy.filter(isOpen)
        return (
          <Box key={`task-${task.id}`} flexDirection="column">
            <Text wrap="truncate-end" dimColor={task.status === 'completed'}>
              <Text color={TONE_COLOR[TASK_TONE[task.status]]}>{TASK_GLYPH[task.status]} </Text>
              <Text dimColor>#{task.id} </Text>
              {task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject}
            </Text>
            {(task.owner || blockers.length > 0) && task.status !== 'completed' && (
              <Text wrap="truncate-end" dimColor>
                {'   '}
                {task.owner ? `@${task.owner}` : ''}
                {blockers.length > 0 ? `${task.owner ? ' · ' : ''}⛓ waits on ${blockers.map(b => `#${b}`).join(' ')}` : ''}
              </Text>
            )}
          </Box>
        )
      })}
      {hiddenDone > 0 && <Text dimColor>✓ {hiddenDone} completed (hidden)</Text>}
    </Box>
  )
}

export function SidebarView(els: Els, data: HqData, actions: HqActions, draw: DrawRaster): RenderElement {
  const { Box, Text, Button } = els
  const team = teamOf(data)
  const rows = treeRows(data)
  const taskP = progressOf(Object.values(data.tasks))
  const hiddenAgents = team.filter(a => data.hideFinished && isFinished(a.status)).length
  // data.columns is the width inside the padding, as the caller measured it for the Rasters
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} backgroundColor={panelBg(data.isLight)}>
      {Header(els, team)}
      {Section(els, 'TEAM', data.columns, `${team.length} agent${team.length === 1 ? '' : 's'}`)}
      {rows.map(row => AgentNode(els, data, actions, row, draw))}
      {team.length === 0 && <Text dimColor>No sub-agents yet. They appear here once one is spawned.</Text>}
      {hiddenAgents > 0 && <Text dimColor>{hiddenAgents} finished agent(s) hidden</Text>}
      {taskP.total > 0 && Section(els, 'TASK BOARD', data.columns, `${taskP.done}/${taskP.total}`)}
      {taskP.total > 0 && TaskList(els, data)}
      <Box marginTop={1} gap={1}>
        <Button key="toggle-hide" hotkey="h" onPress={actions.onToggleHide}>
          {data.hideFinished ? 'Show done' : 'Hide done'}
        </Button>
        <Button key="clear" hotkey="c" onPress={actions.onClear}>
          Clear done
        </Button>
      </Box>
    </Box>
  )
}

/** Where Rasters are not drawn (desktop, vscode, mobile), a track is a plain block bar of the same width. */
export function textTrack(els: Els, rasters: Raster[], data: HqData): DrawRaster {
  const { Text } = els
  const progressFor = (key: string): Progress | undefined => {
    if (key === 'track-team') return teamProgress(data)
    if (key === 'track-tasks') return progressOf(Object.values(data.tasks))
    const list = data.todos[key.replace(/^todo-/, '')]
    return list ? progressOf(list) : undefined
  }
  return key => {
    const r = rasters.find(x => x.key === key)
    const mascotOf = key.startsWith('mascot-') ? data.agents[key.slice('mascot-'.length)] : undefined
    if (mascotOf) {
      const species = speciesOf(mascotOf.mascot)
      return <Text color={species.color}>{mascotText(species, mascotTone(mascotOf, data), data.now)}</Text>
    }
    const p = progressFor(key)
    if (!r || !p) return null
    const width = Math.min(r.columns, 30)
    const done = p.total === 0 ? 0 : Math.round((p.done / p.total) * width)
    return (
      <Text>
        <Text color={TONE_COLOR[p.done === p.total ? 'done' : 'running']}>{'█'.repeat(done)}</Text>
        <Text dimColor>{'░'.repeat(Math.max(0, width - done))}</Text>
      </Text>
    )
  }
}
