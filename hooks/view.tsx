import type { Elements, RenderElement } from 'claude-code'

import type { HqActivity, HqAgent, HqAssignment, HqStatus, HqTask, HqTaskStatus, HqTeam, HqTodo } from '../types'
import { roleTitle } from './team'
import { LEAD_COLOR, TONE_GLYPH, cellText, fit, spriteCells, tonesFor, trackCells } from './cells'
import { SMALL_H, SMALL_W, SPRITE_H, SPRITE_W, paletteOf, speciesOf, spriteFrames } from './sprites'
import type { Tone, TrackSpec } from './cells'
import { MAIN, agentWork, elapsed, isFinished, isWorking, overallProgress, progressOf, teamTree, workingCount } from './model'
import { currentActivity } from './activity'
import type { AgentWork, Progress } from './model'
import type { XpSummary } from './xpstore'

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
  /** The team in force: its lead names the main row, its role titles name the members. */
  team: HqTeam | null
  /** Each agent's level, XP and badges by agent id (hooks/xpstore.ts); absent where nothing is kept. */
  xp?: Record<string, XpSummary>
  /** The project folder's name (the session's working directory), shown beside the team name. */
  project?: string
  /** Each agent's current (or last) tool call as a short line, by agent id (hooks/activity.ts). */
  activity?: Record<string, HqActivity>
  /** What the lead assigned each agent (hq_assign), by agent name. */
  assignments?: Record<string, HqAssignment>
}

// the section's own spacing around its title: a space each side and the dot and aside between
const HEADING_PADDING = 6
const MIN_FOLDER = 3 // columns a folder name needs to be worth showing

/** The last part of a path: `/work/app/` is `app`. */
export const folderOf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''

/** "BOOKING APP TEAM · app" in `room` columns: the team name first, the folder giving way (cut, then dropped) before the name is. */
export function teamHeading(team: HqTeam | null, project: string | undefined, room: number): string {
  const name = team ? team.name.toUpperCase() : 'TEAM'
  if (!project) return fit(name, room)
  const full = `${name} · ${project}`
  if (width(full) <= room) return full
  const folderRoom = room - width(name) - 3
  return folderRoom >= MIN_FOLDER ? `${name} · ${fit(project, folderRoom)}` : fit(name, room)
}

/** How a row is named in the tree: main is the team's lead when there is a team; members show their role's title. */
export function labelOf(agent: HqAgent, team: HqTeam | null): { name: string; role: string } {
  if (agent.id !== MAIN) return { name: agent.name, role: roleTitle(team, agent.role) }
  return team ? { name: team.lead.title, role: 'lead' } : { name: agent.name, role: agent.role }
}

const MIN_NAME = 6 // the real name is how the person addresses an agent: it stays readable down to this many columns
const MIN_ROLE = 4
const width = (s: string) => [...cellText(s)].length

/** Real name, then role, after a nickname, in `room` columns counting the space before each: the role gives way first, then the name. */
export function nameAndRole(name: string, role: string, room: number): { name: string; role: string } {
  const roleRoom = room - 1 - width(name) - 1
  if (roleRoom >= width(role)) return { name, role }
  if (roleRoom >= MIN_ROLE) return { name, role: fit(role, roleRoom) }
  if (room - 1 >= width(name)) return { name, role: '' }
  return { name: room - 1 >= MIN_NAME ? fit(name, room - 1) : '', role: '' }
}

/**
 * What heads an agent's row, in `room` columns: its nickname (bold, in its bot's colour) and the plain words after it.
 * Members read "Mochi-chan frontend-dev-1 Frontend Developer"; the lead "Captain Ramen · Tech Lead".
 */
export function titleParts(agent: HqAgent, label: { name: string; role: string }, room: number): { head: string; tail: string } {
  if (agent.nickname === undefined) {
    const left = room - width(label.name) - 1
    return { head: label.name, tail: left >= MIN_ROLE ? ` ${fit(label.role, left)}` : '' }
  }
  const left = room - width(agent.nickname)
  if (agent.id === MAIN) return { head: agent.nickname, tail: left >= MIN_NAME ? ` · ${fit(label.name, left - 3)}` : '' }
  const { name, role } = nameAndRole(label.name, label.role, left)
  return { head: agent.nickname, tail: `${name ? ` ${name}` : ''}${role ? ` ${role}` : ''}` }
}

/** The sidebar's own background: a shade deeper than the terminal's, in either theme (deep space when dark). */
export const panelBg = (isLight: boolean) => (isLight ? '#E6E5E1' : '#050507')

export type HqActions = {
  onView: (agentId: string) => void
  onToggleHide: () => void
  onClear: () => void
  onClose: () => void
}

export type BandActions = { onOpenSidebar: () => void; onHide: () => void }

export type Raster = { key: string; columns: number; rows: number; cells: string }

// ---------- tones, shared by band and sidebar ----------

export const TONE_OF: Record<HqStatus, Tone> = {
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
export function teamProgress(data: HqData): Progress {
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
    out.push({ key: 'track-team', columns: W, rows: 1, cells: trackCells({ ...p, tone: toneOf(p, team), label, count: `${p.done}/${p.total}` }, W, t, isLight) })
  }
  const tasks = Object.values(data.tasks)
  if (tasks.length > 0) {
    const tp = progressOf(tasks)
    const current = tasks.find(x => x.status === 'in_progress')
    const label = current ? (current.activeForm ?? current.subject) : tp.done === tp.total ? 'Done' : 'Tasks'
    out.push({ key: 'track-tasks', columns: W, rows: 1, cells: trackCells({ ...tp, tone: tp.done === tp.total ? 'done' : 'running', label, count: `${tp.done}/${tp.total}` }, W, t, isLight) })
  }
  return out
}

const BAND_AGENTS = 3 // working agents named on the band's activity line

/** "Mochi-chan: Editing view.tsx · Tanuki: Running npm test": the working agents that acted last, newest first. */
export function bandActivity(data: HqData): string {
  return teamOf(data)
    .filter(a => isWorking(a.status) && data.activity?.[a.id])
    .sort((a, b) => (data.activity?.[b.id]?.since ?? 0) - (data.activity?.[a.id]?.since ?? 0))
    .slice(0, BAND_AGENTS)
    .map(a => `${a.nickname ?? a.name}: ${data.activity?.[a.id]?.text}`)
    .join(' · ')
}

export function BandView(els: Els, data: HqData, actions: BandActions, draw: DrawRaster, hasClicks: boolean): RenderElement {
  const { Box, Text, Button } = els
  const team = teamOf(data)
  const p = teamProgress(data)
  const tp = progressOf(Object.values(data.tasks))
  const doing = bandActivity(data)
  const TONE_COLOR = tonesFor(data.isLight)
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
      <Text dimColor wrap="truncate">
        {teamHeading(data.team, data.project, data.columns)}
      </Text>
      {doing && (
        <Text wrap="truncate-end">
          <Text color={TONE_COLOR.running}>▸ </Text>
          {fit(doing, data.columns - 2)}
        </Text>
      )}
      {p.total > 0 && row('track-team', toneOf(p, team), 'Team', p, true)}
      {tp.total > 0 && row('track-tasks', tp.done === tp.total ? 'done' : 'running', 'Tasks', tp, p.total === 0)}
    </Box>
  )
}

// ---------- the sidebar: agent tree, what each does now and next ----------

type TreeRow = { agent: HqAgent; prefix: string; indent: string; work: AgentWork }
type MoreRow = { more: number; prefix: string }

/** Only the lead and working agents get the full row with their bot; the rest take one line. */
const isCompact = (agent: HqAgent) => agent.id !== MAIN && TONE_OF[agent.status] !== 'running'
const COMPACT_LAST_MIN = 12 // columns kept for a finished agent's last item before the words after the nickname are cut
const MAX_COMPACT = 4 // one-line siblings shown before the rest fold into "+N more"

function walkTree(data: HqData, maxCompact: number): (TreeRow | MoreRow)[] {
  const tree = teamTree(data.agents)
  const rows: (TreeRow | MoreRow)[] = []
  const add = (agent: HqAgent, prefix: string, indent: string) => rows.push({ agent, prefix, indent, work: agentWork(agent, data.todos, data.tasks) })
  const walk = (parent: string, indent: string) => {
    const kids = (tree[parent] ?? []).filter(a => !(data.hideFinished && isFinished(a.status)))
    // an idle agent with agents of its own stays, so they do
    const folded = kids.filter(a => isCompact(a) && !tree[a.id]?.length).slice(maxCompact)
    const shown = kids.filter(a => !folded.includes(a))
    shown.forEach((kid, i) => {
      const isLast = i === shown.length - 1 && folded.length === 0
      const childIndent = indent + (isLast ? '   ' : '│  ')
      add(kid, `${indent}${isLast ? '└─ ' : '├─ '}`, childIndent)
      walk(kid.id, childIndent)
    })
    if (folded.length > 0) rows.push({ more: folded.length, prefix: `${indent}└─ ` })
  }
  const main = data.agents[MAIN]
  if (main) add(main, '', '')
  walk(MAIN, '')
  return rows
}

/** Agents in tree order with their branch drawing; main is the root. */
export const treeRows = (data: HqData): TreeRow[] => walkTree(data, Infinity).filter((r): r is TreeRow => 'agent' in r)

const PCT_W = 5
const ROW_LINES = 5 // a full row's lines: name, live line, task, next, track
// the lead's crowned star is 12×10 (5 rows of half blocks); members' bots are 8×6 (3 rows), so their text gains 4 columns
export const spriteSize = (agent: HqAgent) =>
  agent.id === MAIN ? { columns: SPRITE_W, rows: SPRITE_H / 2, small: false } : { columns: SMALL_W, rows: SMALL_H / 2, small: true }
// a row: tree prefix, the sprite, a space, then its lines; the todo track leaves room for its percent
const textWidth = (cols: number, prefix: string, spriteW: number) => Math.max(14, cols - [...prefix].length - spriteW - 1)
const todoTrackWidth = (cols: number, prefix: string, spriteW: number) => Math.max(6, textWidth(cols, prefix, spriteW) - PCT_W - 1)
const BEAT_MS = 220 // one sprite frame

/** The mascot's mood: an agent's own state; main is busy while any of its agents are. */
export function mascotTone(agent: HqAgent, data: HqData): Tone {
  if (agent.id !== MAIN) return TONE_OF[agent.status]
  return teamOf(data).some(a => !isFinished(a.status)) ? 'running' : 'done'
}

/** What stands in for a todo bar on a working agent with no todos yet: a board task it owns, else an indeterminate "working" bar. */
export type BarFallback = { kind: 'task'; status: HqTaskStatus } | { kind: 'sweep' }

export function fallbackOf(agent: HqAgent, tasks: Record<string, HqTask>): BarFallback | undefined {
  if (agent.id === MAIN || TONE_OF[agent.status] !== 'running') return undefined
  const owned = Object.values(tasks)
    .filter(t => t.owner !== undefined && (t.owner === agent.name || t.owner === agent.id))
    .sort((a, b) => Number(a.id) - Number(b.id))
  const task = owned.find(t => t.status === 'in_progress') ?? owned.find(t => t.status === 'pending') ?? owned.at(-1)
  return task ? { kind: 'task', status: task.status } : { kind: 'sweep' }
}

const TASK_BAR: Record<HqTaskStatus, { done: number; word: string }> = {
  pending: { done: 0, word: 'pending' },
  in_progress: { done: 0.5, word: 'in progress' },
  completed: { done: 1, word: 'done' },
}

/** The track a fallback draws: a task's status as the bar (no count is claimed), or the drifting band labelled with the tools used. */
function fallbackSpec(f: BarFallback, agent: HqAgent): TrackSpec {
  if (f.kind === 'sweep') return { done: 0, total: 1, tone: 'running', label: `getting started · ${agent.tools} tool${agent.tools === 1 ? '' : 's'}`, count: '', sweep: true }
  const bar = TASK_BAR[f.status]
  return { done: bar.done, total: 1, tone: f.status === 'completed' ? 'done' : 'running', label: '', count: bar.word }
}

export function sidebarRasters(data: HqData, t: number): Raster[] {
  const base = panelBg(data.isLight)
  return treeRows(data).flatMap(({ agent, prefix, work }) => {
    if (isCompact(agent)) return [] // one-line rows draw no bot
    const mood = mascotTone(agent, data)
    const species = speciesOf(agent.mascot)
    const size = spriteSize(agent)
    const frames = spriteFrames(species, mood, size.small)
    const frame = frames[Math.floor(t / BEAT_MS) % frames.length] ?? []
    const mascot: Raster = { key: `mascot-${agent.id}`, columns: size.columns, rows: size.rows, cells: spriteCells(frame, paletteOf(species, mood), base) }
    const fallback = work.todos ? undefined : fallbackOf(agent, data.tasks)
    if (fallback) {
      const W = textWidth(data.columns, prefix, size.columns)
      const bar = { key: `todo-${agent.id}`, columns: W, rows: 1, cells: trackCells(fallbackSpec(fallback, agent), W, t, data.isLight, base) }
      return [mascot, bar]
    }
    if (!work.todos) return [mascot]
    const W = todoTrackWidth(data.columns, prefix, size.columns)
    const p = work.todos
    const tone: Tone = p.done === p.total ? 'done' : TONE_OF[agent.status] === 'error' ? 'error' : 'running'
    const count = `${p.done}/${p.total}`
    // the pill is the count alone: the line above already says what is in progress
    const todo = { key: `todo-${agent.id}`, columns: W, rows: 1, cells: trackCells({ ...p, tone, label: '', count }, W, mood === 'running' ? t : 0, data.isLight, base) }
    return [mascot, todo]
  })
}

export function nowLine(agent: HqAgent, work: AgentWork, now: number): { tone: Tone; text: string } {
  if (agent.status === 'waiting') return { tone: 'needs_input', text: '? Needs approval' }
  if (agent.status === 'failed' || agent.status === 'killed') return { tone: 'error', text: `! ${agent.status === 'killed' ? 'stopped' : 'failed'}` }
  // the row above already shows how long it ran, so the last finished item takes the line when there is one
  if (agent.status === 'completed') return { tone: 'done', text: work.last ? `✓ ${work.last}` : `✓ done in ${elapsed((agent.endedAt ?? now) - agent.startedAt)}` }
  if (agent.status === 'idle') return { tone: 'needs_input', text: '◌ idle, waiting for a message' }
  const tool = agent.lastTool ? `${agent.lastTool}` : ''
  if (work.now) return { tone: 'running', text: `▸ ${work.now}${tool ? ` · ${tool}` : ''}` }
  return { tone: 'running', text: tool ? `▸ ${tool}` : '▸ starting…' }
}

const CURSOR = ['▸', '▹'] // the live line's cursor, blinking as the clock ticks
const SECOND = 1000

/** The live line: the tool call it is in, its seconds ticking, cut to `room`; between calls, what it works on (nowLine). */
export function activityLine(agent: HqAgent, work: AgentWork, data: HqData, room: number): { tone: Tone; text: string; isLive: boolean } {
  const live = currentActivity(data.activity, agent.id)
  if (!live || isFinished(agent.status)) return { ...nowLine(agent, work, data.now), isLive: false }
  const secs = ` · ${elapsed(data.now - live.since)}`
  const cursor = CURSOR[Math.floor(data.now / SECOND) % CURSOR.length]
  return { tone: 'running', text: `${cursor} ${fit(live.text, Math.max(1, room - 2 - secs.length))}${secs}`, isLive: true }
}

/** What it is on: its in-progress todo or plan step, else the task the lead assigned it, else the board task it owns. */
export function currentTask(agent: HqAgent, work: AgentWork, data: HqData): string | undefined {
  const step = data.todos[agent.id]?.find(t => t.status === 'in_progress')
  if (step) return step.activeForm || step.content
  const assigned = agent.id === MAIN ? undefined : data.assignments?.[agent.name]?.task.replace(/\s+/g, ' ').trim()
  return assigned || work.now
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

function Header({ Box, Text }: Els, team: HqAgent[], isLight: boolean) {
  const TONE_COLOR = tonesFor(isLight)
  const count = (tone: Tone) => team.filter(a => TONE_OF[a.status] === tone).length
  return (
    <Box justifyContent="space-between">
      <Text bold>
        <Text color={LEAD_COLOR}>✦ </Text>AGENT HQ
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

const ranFor = (agent: HqAgent, now: number) => elapsed((agent.endedAt ?? Math.max(now, agent.startedAt)) - agent.startedAt)
const STATUS_WORD: Record<HqStatus, string> = {
  pending: 'starting',
  running: 'working',
  waiting: 'needs approval',
  idle: 'idle',
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
}

/** An agent not at work: one line with its bot's colour as a dot, its status in a word or its last finished item. */
function CompactNode(els: Els, data: HqData, actions: HqActions, { agent, prefix, work }: TreeRow) {
  const { Box, Text, Button } = els
  const tone = TONE_OF[agent.status]
  const TONE_COLOR = tonesFor(data.isLight)
  const label = labelOf(agent, data.team)
  const time = ranFor(agent, data.now)
  const head = !work.last ? undefined : agent.status === 'completed' ? '✓ ' : agent.status === 'failed' ? 'failed · ' : undefined
  const status = head ?? STATUS_WORD[agent.status]
  const botColor = speciesOf(agent.mascot).color
  const headW = width(agent.nickname ?? label.name)
  // prefix, dot, nickname, the space before the status and the gap to the time stay; the words after the nickname give way
  // before the status does, and the last item takes what is left
  const fixed = [...prefix].length + 2 + headW + 1 + status.length + 1 + time.length
  const lastRoom = work.last && head ? Math.min(width(work.last), COMPACT_LAST_MIN) : 0
  const title = titleParts(agent, label, data.columns - fixed - lastRoom + headW)
  const room = data.columns - fixed - width(title.tail)
  return (
    <Box key={`agent-${agent.id}`} justifyContent="space-between">
      <Box flexShrink={1}>
        <Text dimColor>{prefix}</Text>
        <Text color={botColor}>● </Text>
        <Button key={`view-${agent.id}`} plain onPress={() => actions.onView(agent.id)}>
          <Text bold color={botColor}>
            {title.head}
          </Text>
        </Button>
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {title.tail}
          </Text>
        </Box>
        <Text color={TONE_COLOR[tone]}>
          {' '}
          {status}
          {head && work.last ? <Text dimColor>{fit(work.last, Math.max(1, room))}</Text> : null}
        </Text>
      </Box>
      <Text dimColor>{time}</Text>
    </Box>
  )
}

function TreeLine(els: Els, data: HqData, actions: HqActions, row: TreeRow | MoreRow, draw: DrawRaster) {
  const { Text } = els
  if ('more' in row) {
    return (
      <Text key={`more-${row.prefix}`} dimColor>
        {row.prefix}+{row.more} more idle/done
      </Text>
    )
  }
  return isCompact(row.agent) ? CompactNode(els, data, actions, row) : AgentNode(els, data, actions, row, draw)
}

function AgentNode(els: Els, data: HqData, actions: HqActions, row: TreeRow, draw: DrawRaster) {
  const { Box, Text, Button } = els
  const { agent, prefix, indent, work } = row
  const isMain = agent.id === MAIN
  const team = teamOf(data)
  const time = isMain ? `${agent.tools} tools` : ranFor(agent, data.now)
  const room = textWidth(data.columns, prefix, spriteSize(agent).columns)
  const status = activityLine(agent, work, data, room)
  const label = labelOf(agent, data.team)
  const botColor = speciesOf(agent.mascot).color
  const TONE_COLOR = tonesFor(data.isLight)
  const mark = isMain ? '✦ ' : '' // the lead's star
  const title = titleParts(agent, label, room - time.length - 1 - mark.length)
  const task = currentTask(agent, work, data)
  // between calls the live line already says what it works on; the task line then shows only an assignment it does not
  const ownTask = task && (status.isLive || task !== work.now) ? `task: ${task}` : ''
  // the lead's line also counts its team at work (beside the name it would push the real name out)
  const crew = isMain && team.length > 0 ? `${workingCount(data.agents)} of ${team.length} working` : ''
  const taskLine = [crew, ownTask].filter(Boolean).join(' · ')
  const after = work.next && !isFinished(agent.status) ? `○ next: ${work.next}` : work.last && !isMain ? `✓ last: ${work.last}` : ''
  // the tree's lines run down beside the row: its branch on the first line, its siblings' line below
  const gutter = prefix ? [prefix, ...Array.from({ length: ROW_LINES - 1 }, () => indent || ' ')] : []
  return (
    <Box key={`agent-${agent.id}`} flexDirection="row">
      {gutter.length > 0 && (
        <Box flexDirection="column" flexShrink={0}>
          {gutter.map((line, i) => (
            <Text key={`g${i}`} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      )}
      {draw(`mascot-${agent.id}`)}
      <Text> </Text>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            {mark && <Text color={LEAD_COLOR}>{mark}</Text>}
            <Button key={`view-${agent.id}`} plain onPress={() => actions.onView(agent.id)}>
              <Text bold color={botColor}>
                {title.head}
              </Text>
            </Button>
            <Text dimColor wrap="truncate-end">
              {title.tail}
            </Text>
          </Box>
          <Text dimColor>{time}</Text>
        </Box>
        <Text wrap="truncate-end" bold={status.isLive} color={TONE_COLOR[status.tone]}>
          {status.text}
        </Text>
        <Text wrap="truncate-end" dimColor>
          {taskLine || ' '}
        </Text>
        <Text wrap="truncate-end" dimColor>
          {after || ' '}
        </Text>
        {(work.todos || fallbackOf(agent, data.tasks)) && (
          <Box flexDirection="row" gap={1}>
            {draw(`todo-${agent.id}`)}
            {work.todos && <Text dimColor>{pctText(work.todos)}</Text>}
          </Box>
        )}
      </Box>
    </Box>
  )
}

function TaskList({ Box, Text }: Els, data: HqData) {
  const ORDER: HqTaskStatus[] = ['in_progress', 'pending', 'completed']
  const TONE_COLOR = tonesFor(data.isLight)
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
  const rows = walkTree(data, MAX_COMPACT)
  const taskP = progressOf(Object.values(data.tasks))
  const hiddenAgents = team.filter(a => data.hideFinished && isFinished(a.status)).length
  const agentCount = `${team.length} agent${team.length === 1 ? '' : 's'}`
  // data.columns is the width inside the padding, as the caller measured it for the Rasters
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} backgroundColor={panelBg(data.isLight)}>
      {Header(els, team, data.isLight)}
      {/* controls up top: with a long team a footer falls below the dock's bottom edge */}
      <Box gap={1}>
        <Button key="toggle-hide" hotkey="h" onPress={actions.onToggleHide}>
          {data.hideFinished ? 'Show done' : 'Hide done'}
        </Button>
        <Button key="clear" hotkey="c" onPress={actions.onClear}>
          Clear done
        </Button>
        <Button key="close-sidebar" hotkey="q" onPress={actions.onClose}>
          ✕ Close
        </Button>
      </Box>
      {Section(els, teamHeading(data.team, data.project, data.columns - agentCount.length - HEADING_PADDING), data.columns, agentCount)}
      {!data.team && <Text dimColor>No team defined. /agent-hq:team builds one.</Text>}
      {rows.map(row => TreeLine(els, data, actions, row, draw))}
      {team.length === 0 && <Text dimColor>No sub-agents yet. They appear here once one is spawned.</Text>}
      {hiddenAgents > 0 && <Text dimColor>{hiddenAgents} finished agent(s) hidden</Text>}
      {taskP.total > 0 && Section(els, 'TASK BOARD', data.columns, `${taskP.done}/${taskP.total}`)}
      {taskP.total > 0 && TaskList(els, data)}
    </Box>
  )
}

/** Where Rasters are not drawn (desktop, vscode, mobile), a track is a plain block bar of the same width. */
export function textTrack(els: Els, rasters: Raster[], data: HqData): DrawRaster {
  const { Text } = els
  const TONE_COLOR = tonesFor(data.isLight)
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
      // no Rasters on this surface: the bot's colour as a dot
      return <Text color={speciesOf(mascotOf.mascot).color}>● </Text>
    }
    // an agent with no todos: the fallback bar's words (a task's status, or "getting started") where no Raster is drawn
    const owner = key.startsWith('todo-') ? data.agents[key.slice('todo-'.length)] : undefined
    const fallback = owner && !data.todos[owner.id]?.length ? fallbackOf(owner, data.tasks) : undefined
    if (fallback) {
      const spec = fallbackSpec(fallback, owner as HqAgent)
      const width = Math.min(r?.columns ?? 30, 30)
      const done = Math.round(spec.done * width)
      return spec.sweep ? (
        <Text dimColor>{'⠶⠶⠶ '}{spec.label}</Text>
      ) : (
        <Text>
          <Text color={TONE_COLOR[spec.tone]}>{'█'.repeat(done)}</Text>
          <Text dimColor>{'░'.repeat(Math.max(0, width - done))} {spec.count}</Text>
        </Text>
      )
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
