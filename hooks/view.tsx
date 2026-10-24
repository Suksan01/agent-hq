import type { Elements, RenderElement } from 'claude-code'

import type { HqActivity, HqAgent, HqAssignment, HqBubble, HqSays, HqStatus, HqTask, HqTaskStatus, HqTeam, HqTodo } from '../types'
import { roleTitle } from './team'
import { LEAD_COLOR, TONE_GLYPH, TRACK_PX, fitText, hasThai, spriteCells, textWidth, tonesFor, trackCells, trackSvg } from './cells'
import { SMALL_H, SMALL_W, SPRITE_H, SPRITE_W, paletteOf, speciesOf, spriteFrames } from './sprites'
import type { Tone, TrackSpec } from './cells'
import { MAIN, agentWork, elapsed, isFinished, isWorking, overallProgress, progressOf, teamTree, workingCount } from './model'
import { currentActivity } from './activity'
import { sayingOf } from './says'
import { talkLine } from './talk'
import type { AgentWork, Progress } from './model'
import type { XpSummary } from './xpstore'
import { t } from './i18n'
import type { Lang } from './i18n'
import { protoTasksFor } from './proto/mock'
import { TaskTableA } from './proto/tasks-a'
import { TaskTableB } from './proto/tasks-b'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
type DrawRaster = (key: string) => RenderElement | null

export type HqData = {
  agents: Record<string, HqAgent>
  todos: Record<string, HqTodo[]>
  tasks: Record<string, HqTask>
  now: number
  hideFinished: boolean
  /** The person unfolded the "+N more" lines: every one-line agent is listed. */
  isTreeExpanded?: boolean
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
  /** The surface draws its own text (desktop, vscode, mobile): no Rasters, a proportional font, rows as tall as what they hold. */
  isAppDrawn?: boolean
  /** The person's language (the `language` option); English when left out. */
  lang?: Lang
  /** What each agent said it is doing (hq_doing), by agent id (hooks/says.ts). */
  says?: Record<string, HqSays>
  /** The talk bubbles showing now, one per agent at most (hooks/talk.ts). */
  bubbles?: HqBubble[]
  /** Prototype only (task sidebar, phase 3): `AGENT_HQ_PROTO`, e.g. "a" or "b:empty". Removed in phase 6. */
  proto?: string
}

// the section's own spacing around its title: a space each side and the dot and aside between
const HEADING_PADDING = 6
const MIN_FOLDER = 3 // columns a folder name needs to be worth showing

/** The last part of a path: `/work/app/` is `app`. */
export const folderOf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? ''

/** "BOOKING APP TEAM · app" in `room` columns: the team name first, the folder giving way (cut, then dropped) before the name is. */
export function teamHeading(team: HqTeam | null, project: string | undefined, room: number, lang: Lang = 'en'): string {
  const name = team ? team.name.toUpperCase() : t(lang, 'team.heading')
  if (!project) return fitText(name, room)
  const full = `${name} · ${project}`
  if (width(full) <= room) return full
  const folderRoom = room - width(name) - 3
  return folderRoom >= MIN_FOLDER ? `${name} · ${fitText(project, folderRoom)}` : fitText(name, room)
}

/** How a row is named in the tree: main is the team's lead when there is a team; members show their role's title. */
export function labelOf(agent: HqAgent, team: HqTeam | null, lang: Lang = 'en'): { name: string; role: string } {
  if (agent.id !== MAIN) return { name: agent.name, role: roleTitle(team, agent.role) }
  return team ? { name: team.lead.title, role: t(lang, 'role.lead') } : { name: agent.name, role: agent.role }
}

const MIN_NAME = 6 // the real name is how the person addresses an agent: it stays readable down to this many columns
const MIN_ROLE = 4
const width = textWidth

/** Real name, then role, after a nickname, in `room` columns counting the space before each: the role gives way first, then the name. */
export function nameAndRole(name: string, role: string, room: number): { name: string; role: string } {
  const roleRoom = room - 1 - width(name) - 1
  if (roleRoom >= width(role)) return { name, role }
  if (roleRoom >= MIN_ROLE) return { name, role: fitText(role, roleRoom) }
  if (room - 1 >= width(name)) return { name, role: '' }
  return { name: room - 1 >= MIN_NAME ? fitText(name, room - 1) : '', role: '' }
}

/**
 * What heads an agent's row, in `room` columns: its nickname (bold, in its bot's colour) and the plain words after it.
 * Members read "Mochi-chan frontend-dev-1 Frontend Developer"; the lead "Captain Ramen · Tech Lead".
 */
export function titleParts(agent: HqAgent, label: { name: string; role: string }, room: number): { head: string; tail: string } {
  if (agent.nickname === undefined) {
    const left = room - width(label.name) - 1
    return { head: label.name, tail: left >= MIN_ROLE ? ` ${fitText(label.role, left)}` : '' }
  }
  const left = room - width(agent.nickname)
  if (agent.id === MAIN) return { head: agent.nickname, tail: left >= MIN_NAME ? ` · ${fitText(label.name, left - 3)}` : '' }
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
  /** Runs /agent-hq:team, from the "Build a team" button shown while no team exists. */
  onBuildTeam: () => void
  /** Unfolds the "+N more" lines, or folds them again. */
  onToggleExpand: () => void
}

export type BandActions = { onOpenSidebar: () => void; onHide: () => void }

/**
 * A drawing in cells; a track also carries its spec, which a surface without Rasters draws as an Svg (textTrack), and the
 * words that left its pill (`aside`), drawn in a Text beside it.
 */
export type Raster = { key: string; columns: number; rows: number; cells: string; spec?: TrackSpec; aside?: string }

const ASIDE_SHARE = 0.4 // the words beside a track take at most this share of its width
const MIN_TRACK = 6

/**
 * Thai never goes in a Raster cell (a mark has no column of its own, and the engine refuses the whole tree): in Thai, or
 * for Thai words, the pill keeps its count and glyph and the words go beside the track, which gives up their room.
 */
function besideTrack(spec: TrackSpec, W: number, lang: Lang): { spec: TrackSpec; W: number; aside?: string } {
  const isLabelOut = spec.label !== '' && (lang !== 'en' || hasThai(spec.label))
  const isCountOut = hasThai(spec.count)
  if (!isLabelOut && !isCountOut) return { spec, W }
  const words = [isLabelOut ? spec.label : '', isCountOut ? spec.count : ''].filter(Boolean).join(' ')
  const aside = fitText(words, Math.max(1, Math.min(Math.floor(W * ASIDE_SHARE), W - MIN_TRACK - 1)))
  const kept = { ...spec, label: isLabelOut ? '' : spec.label, count: isCountOut ? '' : spec.count }
  return { spec: kept, W: Math.max(MIN_TRACK, W - width(aside) - 1), aside }
}

/** A track's Raster (its spec kept for an Svg), its words beside it where they left the pill. */
function trackRaster(key: string, spec: TrackSpec, W: number, lang: Lang, draw: (spec: TrackSpec, W: number) => string): Raster {
  const placed = besideTrack(spec, W, lang)
  return { key, columns: placed.W, rows: 1, cells: draw(placed.spec, placed.W), spec: placed.spec, ...(placed.aside ? { aside: placed.aside } : {}) }
}

/** A drawn track, with the words that left its pill in a Text beside it. */
export function withAside(els: Els, r: Raster, track: RenderElement): RenderElement {
  if (!r.aside) return track
  const { Box, Text } = els
  return (
    <Box key={`${r.key}-aside`} flexDirection="row" gap={1}>
      {track}
      <Text dimColor wrap="truncate-end">
        {r.aside}
      </Text>
    </Box>
  )
}

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

/** The Team track's words: how many agents work now (idle and waiting ones do not), else Done or Team. */
export function teamTrackLabel(team: HqAgent[], p: Progress, lang: Lang = 'en'): string {
  const running = team.filter(a => isWorking(a.status)).length
  return running > 0 ? t(lang, 'band.running', { n: running }) : p.done === p.total ? t(lang, 'band.done') : t(lang, 'band.team')
}

export function bandRasters(data: HqData, W: number, at: number, isLight: boolean): Raster[] {
  const lang = data.lang ?? 'en'
  const team = teamOf(data)
  const out: Raster[] = []
  const p = teamProgress(data)
  const draw = (spec: TrackSpec, w: number) => trackCells(spec, w, at, isLight)
  if (p.total > 0) {
    const spec = { ...p, tone: toneOf(p, team), label: teamTrackLabel(team, p, lang), count: `${p.done}/${p.total}` }
    out.push(trackRaster('track-team', spec, W, lang, draw))
  }
  const tasks = Object.values(data.tasks)
  if (tasks.length > 0) {
    const tp = progressOf(tasks)
    const current = tasks.find(x => x.status === 'in_progress')
    const label = current ? (current.activeForm ?? current.subject) : tp.done === tp.total ? t(lang, 'band.done') : t(lang, 'band.tasks')
    const spec: TrackSpec = { ...tp, tone: tp.done === tp.total ? 'done' : 'running', label, count: `${tp.done}/${tp.total}` }
    out.push(trackRaster('track-tasks', spec, W, lang, draw))
  }
  return out
}

const BAND_AGENTS = 3 // working agents named on the band's activity line

/**
 * "Mochi-chan: Fixing the old API · Tanuki: Running npm test": the working agents that acted or spoke last, newest first,
 * each by its sentence (hooks/says.ts), else its tool line.
 */
export function bandActivity(data: HqData): string {
  const said = (a: HqAgent) => sayingOf(a, data, data.lang ?? 'en')?.text
  const lastSeen = (a: HqAgent) => Math.max(data.activity?.[a.id]?.since ?? 0, data.says?.[a.id]?.at ?? 0)
  return teamOf(data)
    .filter(a => isWorking(a.status) && (data.activity?.[a.id] || said(a)))
    .sort((a, b) => lastSeen(b) - lastSeen(a))
    .slice(0, BAND_AGENTS)
    .map(a => `${a.nickname ?? a.name}: ${said(a) ?? data.activity?.[a.id]?.text}`)
    .join(' · ')
}

export function BandView(els: Els, data: HqData, actions: BandActions, draw: DrawRaster, hasClicks: boolean): RenderElement {
  const { Box, Text, Button } = els
  const lang = data.lang ?? 'en'
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
      {hasClicks && isFirst ? <Button key="open-sidebar" plain dimColor label={t(lang, 'band.agents')} onPress={actions.onOpenSidebar} /> : null}
      {hasClicks && isFirst ? <Button key="hide-band" plain dimColor label="✕" onPress={actions.onHide} /> : null}
    </Box>
  )
  return (
    <Box flexDirection="column">
      <Text dimColor wrap="truncate">
        {teamHeading(data.team, data.project, data.columns, lang)}
      </Text>
      {doing && (
        <Text wrap="truncate-end">
          <Text color={TONE_COLOR.running}>▸ </Text>
          {fitText(doing, data.columns - 2)}
        </Text>
      )}
      {p.total > 0 && row('track-team', toneOf(p, team), t(lang, 'band.team'), p, true)}
      {tp.total > 0 && row('track-tasks', tp.done === tp.total ? 'done' : 'running', t(lang, 'band.tasks'), tp, p.total === 0)}
    </Box>
  )
}

// ---------- the sidebar: agent tree, what each does now and next ----------

type TreeRow = { agent: HqAgent; prefix: string; indent: string; work: AgentWork }
type MoreRow = { more: number; prefix: string }

/** Only the lead, working agents and an agent whose talk bubble shows (on its line 3) get the full row with their bot; the rest take one line. */
const isCompact = (agent: HqAgent, data: Pick<HqData, 'bubbles'>) => agent.id !== MAIN && TONE_OF[agent.status] !== 'running' && !data.bubbles?.some(b => b.agent === agent.id)
const COMPACT_LAST_MIN = 12 // columns kept for a finished agent's last item before the words after the nickname are cut
const MAX_COMPACT = 4 // one-line siblings shown before the rest fold into "+N more"

function walkTree(data: HqData, maxCompact: number): (TreeRow | MoreRow)[] {
  const tree = teamTree(data.agents)
  const rows: (TreeRow | MoreRow)[] = []
  const add = (agent: HqAgent, prefix: string, indent: string) => rows.push({ agent, prefix, indent, work: agentWork(agent, data.todos, data.tasks) })
  const walk = (parent: string, indent: string) => {
    const kids = (tree[parent] ?? []).filter(a => !(data.hideFinished && isFinished(a.status)))
    // an idle agent with agents of its own stays, so they do
    const folded = kids.filter(a => isCompact(a, data) && !tree[a.id]?.length).slice(maxCompact)
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
const rowTextWidth = (cols: number, prefix: string, spriteW: number) => Math.max(14, cols - [...prefix].length - spriteW - 1)
const todoTrackWidth = (cols: number, prefix: string, spriteW: number) => Math.max(6, rowTextWidth(cols, prefix, spriteW) - PCT_W - 1)
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

const TASK_BAR_DONE: Record<HqTaskStatus, number> = { pending: 0, in_progress: 0.5, completed: 1 }

/** The track a fallback draws: a task's status as the bar (no count is claimed), or the drifting band labelled with the tools used. */
function fallbackSpec(f: BarFallback, agent: HqAgent, lang: Lang): TrackSpec {
  if (f.kind === 'sweep') {
    const label = t(lang, agent.tools === 1 ? 'track.gettingStarted' : 'track.gettingStartedMany', { n: agent.tools })
    return { done: 0, total: 1, tone: 'running', label, count: '', sweep: true }
  }
  return { done: TASK_BAR_DONE[f.status], total: 1, tone: f.status === 'completed' ? 'done' : 'running', label: '', count: t(lang, `taskStatus.${f.status}`) }
}

export function sidebarRasters(data: HqData, at: number): Raster[] {
  const lang = data.lang ?? 'en'
  const base = panelBg(data.isLight)
  return treeRows(data).flatMap(({ agent, prefix, work }) => {
    if (isCompact(agent, data)) return [] // one-line rows draw no bot
    const mood = mascotTone(agent, data)
    const species = speciesOf(agent.mascot)
    const size = spriteSize(agent)
    const frames = spriteFrames(species, mood, size.small)
    const frame = frames[Math.floor(at / BEAT_MS) % frames.length] ?? []
    const mascot: Raster = { key: `mascot-${agent.id}`, columns: size.columns, rows: size.rows, cells: spriteCells(frame, paletteOf(species, mood), base) }
    const fallback = work.todos ? undefined : fallbackOf(agent, data.tasks)
    if (fallback) {
      const W = rowTextWidth(data.columns, prefix, size.columns)
      const bar = trackRaster(`todo-${agent.id}`, fallbackSpec(fallback, agent, lang), W, lang, (spec, w) => trackCells(spec, w, at, data.isLight, base))
      return [mascot, bar]
    }
    if (!work.todos) return [mascot]
    const W = todoTrackWidth(data.columns, prefix, size.columns)
    const p = work.todos
    const tone: Tone = p.done === p.total ? 'done' : TONE_OF[agent.status] === 'error' ? 'error' : 'running'
    const count = `${p.done}/${p.total}`
    // the pill is the count alone: the line above already says what is in progress
    const spec = { ...p, tone, label: '', count }
    const todo = { key: `todo-${agent.id}`, columns: W, rows: 1, cells: trackCells(spec, W, mood === 'running' ? at : 0, data.isLight, base), spec }
    return [mascot, todo]
  })
}

/** What an agent is on, in a line; `lang` is the person's (hq_status, which the model reads, keeps English). */
export function nowLine(agent: HqAgent, work: AgentWork, now: number, lang: Lang = 'en'): { tone: Tone; text: string } {
  if (agent.status === 'waiting') return { tone: 'needs_input', text: t(lang, 'now.needsApproval') }
  if (agent.status === 'failed' || agent.status === 'killed') return { tone: 'error', text: t(lang, agent.status === 'killed' ? 'now.stopped' : 'now.failed') }
  // the row above already shows how long it ran, so the last finished item takes the line when there is one
  if (agent.status === 'completed') return { tone: 'done', text: work.last ? `✓ ${work.last}` : t(lang, 'now.doneIn', { time: elapsed((agent.endedAt ?? now) - agent.startedAt, lang) }) }
  if (agent.status === 'idle') return { tone: 'needs_input', text: t(lang, 'now.idle') }
  const tool = agent.lastTool ? `${agent.lastTool}` : ''
  if (work.now) return { tone: 'running', text: `▸ ${work.now}${tool ? ` · ${tool}` : ''}` }
  return { tone: 'running', text: tool ? `▸ ${tool}` : t(lang, 'now.starting') }
}

const CURSOR = ['▸', '▹'] // the live line's cursor, blinking as the clock ticks
const SECOND = 1000

/** The live line: the tool call it is in, its seconds ticking, cut to `room`; between calls, what it works on (nowLine). */
export function activityLine(agent: HqAgent, work: AgentWork, data: HqData, room: number): { tone: Tone; text: string; isLive: boolean } {
  const lang = data.lang ?? 'en'
  const live = currentActivity(data.activity, agent.id)
  if (!live || isFinished(agent.status)) return { ...nowLine(agent, work, data.now, lang), isLive: false }
  const secs = ` · ${timeFor(data.now - live.since, lang, room)}`
  const cursor = CURSOR[Math.floor(data.now / SECOND) % CURSOR.length]
  return { tone: 'running', text: `${cursor} ${fitText(live.text, Math.max(1, room - 2 - width(secs)))}${secs}`, isLive: true }
}

/** What it is on: its in-progress todo or plan step, else the task the lead assigned it, else the board task it owns. */
export function currentTask(agent: HqAgent, work: AgentWork, data: HqData): string | undefined {
  const step = data.todos[agent.id]?.find(t => t.status === 'in_progress')
  if (step) return step.activeForm || step.content
  const assigned = agent.id === MAIN ? undefined : data.assignments?.[agent.name]?.task.replace(/\s+/g, ' ').trim()
  return assigned || work.now
}

const DOT_W = 2 // where no bot is drawn, its place on the name line: a dot and a space

/** Where the app draws the text: the tree branch and the agent's dot, in its state's colour, as one monospaced run the lines below line up with. */
function dotGutter({ Text }: Els, prefix: string, color: string) {
  return (
    <Text mono>
      <Text dimColor>{prefix}</Text>
      <Text color={color}>●</Text>
      {' '}
    </Text>
  )
}

function Section(els: Els, data: HqData, title: string, aside?: string) {
  const { Box, Text } = els
  if (data.isAppDrawn) {
    // no rule: a run of ─ is wider than its count of columns in the app's font and wraps; the title gives way at its end, the count stays
    return (
      <Box marginTop={1} gap={1}>
        <Box flexShrink={1}>
          <Text bold wrap="truncate-end">
            {title}
          </Text>
        </Box>
        {aside ? <Text dimColor>· {aside}</Text> : null}
      </Box>
    )
  }
  const label = ` ${title} ${aside ? `· ${aside} ` : ''}`
  return (
    <Box marginTop={1}>
      <Text bold>{label}</Text>
      <Text dimColor>{'─'.repeat(Math.max(0, data.columns - width(label)))}</Text>
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

// a Thai time ("4 นาที 12 วิ") takes at most this share of its row; past it the row shows "4:12"
const TIME_SHARE = 1 / 3

/** How long, in words that fit a row `room` columns wide: the narrow "4:12" once the words would take too much of it. */
function timeFor(ms: number, lang: Lang, room: number): string {
  const full = elapsed(ms, lang)
  return width(full) > room * TIME_SHARE ? elapsed(ms, lang, true) : full
}

const ranFor = (agent: HqAgent, data: HqData, room: number) => timeFor((agent.endedAt ?? Math.max(data.now, agent.startedAt)) - agent.startedAt, data.lang ?? 'en', room)
const statusWord = (status: HqStatus, lang: Lang) => t(lang, `status.${status}`)

/** An agent not at work: one line with its bot's colour as a dot, its status in a word or its last finished item. */
function CompactNode(els: Els, data: HqData, actions: HqActions, { agent, prefix, work }: TreeRow) {
  const { Box, Text, Button } = els
  const lang = data.lang ?? 'en'
  const tone = TONE_OF[agent.status]
  const TONE_COLOR = tonesFor(data.isLight)
  const label = labelOf(agent, data.team, lang)
  const time = ranFor(agent, data, data.columns - [...prefix].length)
  const head = !work.last ? undefined : agent.status === 'completed' ? '✓ ' : agent.status === 'failed' ? t(lang, 'row.failedLast') : undefined
  const status = head ?? statusWord(agent.status, lang)
  const botColor = speciesOf(agent.mascot).color
  const headW = width(agent.nickname ?? label.name)
  // prefix, dot, nickname, the space before the status and the gap to the time stay; the words after the nickname give way
  // before the status does, and the last item takes what is left
  const fixed = [...prefix].length + 2 + headW + 1 + width(status) + 1 + width(time)
  const lastRoom = work.last && head ? Math.min(width(work.last), COMPACT_LAST_MIN) : 0
  const title = titleParts(agent, label, data.columns - fixed - lastRoom + headW)
  const room = data.columns - fixed - width(title.tail)
  const appDrawn = data.isAppDrawn === true
  return (
    <Box key={`agent-${agent.id}`} justifyContent="space-between">
      <Box flexShrink={1}>
        {appDrawn ? dotGutter(els, prefix, TONE_COLOR[tone]) : <Text dimColor>{prefix}</Text>}
        {appDrawn ? null : <Text color={botColor}>● </Text>}
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
          {head && work.last ? <Text dimColor>{fitText(work.last, Math.max(1, room))}</Text> : null}
        </Text>
      </Box>
      <Text dimColor>{time}</Text>
    </Box>
  )
}

function TreeLine(els: Els, data: HqData, actions: HqActions, row: TreeRow | MoreRow, draw: DrawRaster) {
  const { Text } = els
  if ('more' in row) {
    const { Button } = els
    return (
      <Button key={`more-${row.prefix}`} plain onPress={actions.onToggleExpand}>
        <Text dimColor>
          {data.isAppDrawn ? <Text mono>{row.prefix}</Text> : row.prefix}
          {t(data.lang ?? 'en', 'tree.more', { n: row.more })}
        </Text>
      </Button>
    )
  }
  if (isCompact(row.agent, data)) return CompactNode(els, data, actions, row)
  return data.isAppDrawn ? AppAgentNode(els, data, actions, row, draw) : AgentNode(els, data, actions, row, draw)
}

/** A full row where the app draws the text: dot and branch on the name's line, each line below behind a gutter as wide, no blank lines. */
function AppAgentNode(els: Els, data: HqData, actions: HqActions, row: TreeRow, draw: DrawRaster) {
  const { Box, Text, Button } = els
  const { agent, prefix, indent, work } = row
  const { time, status, mark, title, taskLine, after, botColor } = rowWords(data, row, data.columns - [...prefix].length - DOT_W)
  const TONE_COLOR = tonesFor(data.isLight)
  // the tree's line carried down, as wide as branch and dot; inside each line, so it shares the line's baseline
  const gutter = () => (
    <Text mono dimColor>
      {indent + ' '.repeat(DOT_W)}
    </Text>
  )
  return (
    <Box key={`agent-${agent.id}`} flexDirection="column">
      <Box justifyContent="space-between">
        <Box flexShrink={1}>
          {dotGutter(els, prefix, TONE_COLOR[mascotTone(agent, data)])}
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
        <Text dimColor tabular>
          {time}
        </Text>
      </Box>
      <Text wrap="truncate-end">
        {gutter()}
        <Text bold={status.isLive} color={TONE_COLOR[status.tone]}>
          {status.text}
        </Text>
      </Text>
      {taskLine ? (
        <Text wrap="truncate-end" dimColor>
          {gutter()}
          {taskLine}
        </Text>
      ) : null}
      {after ? (
        <Text wrap="truncate-end" dimColor>
          {gutter()}
          {after}
        </Text>
      ) : null}
      {(work.todos || fallbackOf(agent, data.tasks)) && (
        <Box>
          {gutter()}
          <Box gap={1}>
            {draw(`todo-${agent.id}`)}
            {work.todos && <Text dimColor>{pctText(work.todos)}</Text>}
          </Box>
        </Box>
      )}
    </Box>
  )
}

/** What a full row says, its text in `room` columns: the name line's parts and time, the live line, the task and next lines. */
function rowWords(data: HqData, { agent, work }: TreeRow, room: number) {
  const lang = data.lang ?? 'en'
  const isMain = agent.id === MAIN
  const team = teamOf(data)
  const time = isMain ? t(lang, 'row.tools', { n: agent.tools }) : ranFor(agent, data, room)
  const live = activityLine(agent, work, data, room)
  // what it says it does takes line 2; its tool and seconds then move to line 3, while that line is free
  const saying = sayingOf(agent, data, lang)
  const status = saying ? { tone: 'running' as Tone, text: `▸ ${fitText(saying.text, room - 2)}`, isLive: false } : live
  const mark = isMain ? '✦ ' : '' // the lead's star
  const title = titleParts(agent, labelOf(agent, data.team, lang), room - width(time) - 1 - mark.length)
  const task = currentTask(agent, work, data)
  // between calls the live line already says what it works on; the task line then shows only an assignment it does not.
  // A sentence from that same step or assignment says it already
  const isTaskSaid = saying !== null && saying.source !== 'doing'
  const ownTask = task && !isTaskSaid && (status.isLive || saying !== null || task !== work.now) ? t(lang, 'row.task', { task }) : ''
  // the lead's line also counts its team at work (beside the name it would push the real name out), unless its sentence does
  const crew = isMain && team.length > 0 && saying?.source !== 'lead' ? t(lang, 'row.crew', { working: workingCount(data.agents), total: team.length }) : ''
  // line 3: a talk bubble while it lasts; else the lead's crew count; else, under a sentence, the call it is in now;
  // else its task
  const bubble = data.bubbles?.find(b => b.agent === agent.id)
  const listed = [crew, ownTask].filter(Boolean).join(' · ')
  const taskLine = bubble ? `» ${talkLine(bubble, data.agents, lang, room - 2)}` : !crew && saying && live.isLive ? live.text : listed
  const after = work.next && !isFinished(agent.status) ? t(lang, 'row.next', { what: work.next }) : work.last && !isMain ? t(lang, 'row.last', { what: work.last }) : ''
  return { time, status, mark, title, taskLine, after, botColor: speciesOf(agent.mascot).color }
}

function AgentNode(els: Els, data: HqData, actions: HqActions, row: TreeRow, draw: DrawRaster) {
  const { Box, Text, Button } = els
  const { agent, prefix, indent, work } = row
  const { time, status, mark, title, taskLine, after, botColor } = rowWords(data, row, rowTextWidth(data.columns, prefix, spriteSize(agent).columns))
  const TONE_COLOR = tonesFor(data.isLight)
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

function TaskList({ Box, Text, Button }: Els, data: HqData, actions: HqActions) {
  const lang = data.lang ?? 'en'
  const ORDER: HqTaskStatus[] = ['in_progress', 'pending', 'completed']
  const TONE_COLOR = tonesFor(data.isLight)
  const all = Object.values(data.tasks)
  const isOpen = (id: string) => data.tasks[id] !== undefined && data.tasks[id]?.status !== 'completed'
  const shown = all
    .filter(task => task.status !== 'completed' || !data.hideFinished)
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || Number(a.id) - Number(b.id))
  const hiddenDone = all.length - shown.length
  return (
    <Box flexDirection="column">
      {shown.map(task => {
        const blockers = task.blockedBy.filter(isOpen)
        // a task names its owner by agent name; a listed one opens on a press
        const owner = task.owner ? Object.values(data.agents).find(a => a.name === task.owner) : undefined
        const line = (
          <Text wrap="truncate-end" dimColor={task.status === 'completed'}>
            <Text color={TONE_COLOR[TASK_TONE[task.status]]}>{TASK_GLYPH[task.status]} </Text>
            <Text dimColor>#{task.id} </Text>
            {task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject}
          </Text>
        )
        return (
          <Box key={`task-${task.id}`} flexDirection="column">
            {owner ? (
              <Button key={`open-task-${task.id}`} plain onPress={() => actions.onView(owner.id)}>
                {line}
              </Button>
            ) : (
              line
            )}
            {(task.owner || blockers.length > 0) && task.status !== 'completed' && (
              <Text wrap="truncate-end" dimColor>
                {'   '}
                {task.owner ? `@${task.owner}` : ''}
                {blockers.length > 0 ? `${task.owner ? ' · ' : ''}${t(lang, 'tasks.waitsOn', { list: blockers.map(b => `#${b}`).join(' ') })}` : ''}
              </Text>
            )}
          </Box>
        )
      })}
      {hiddenDone > 0 && <Text dimColor>{t(lang, 'tasks.hiddenDone', { n: hiddenDone })}</Text>}
    </Box>
  )
}

/** Prototype only: the variant `data.proto` names, with the mock list its state picks. Removed in phase 6. */
function ProtoTable(els: Els, data: HqData): RenderElement | null {
  const [variant, state] = (data.proto ?? '').split(':')
  const tasks = protoTasksFor(state)
  if (!tasks) return null
  return variant === 'a' ? TaskTableA(els, data, tasks) : variant === 'b' ? TaskTableB(els, data, tasks) : null
}

export function SidebarView(els: Els, data: HqData, actions: HqActions, draw: DrawRaster): RenderElement {
  const { Box, Text, Button } = els
  const lang = data.lang ?? 'en'
  const team = teamOf(data)
  const rows = walkTree(data, data.isTreeExpanded ? Infinity : MAX_COMPACT)
  const taskP = progressOf(Object.values(data.tasks))
  const hiddenAgents = team.filter(a => data.hideFinished && isFinished(a.status)).length
  const agentCount = t(lang, team.length === 1 ? 'sidebar.agent' : 'sidebar.agents', { n: team.length })
  // data.columns is the width inside the padding, as the caller measured it for the Rasters
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} backgroundColor={panelBg(data.isLight)}>
      {Header(els, team, data.isLight)}
      {/* controls up top: with a long team a footer falls below the dock's bottom edge */}
      <Box gap={1}>
        <Button key="toggle-hide" hotkey="h" onPress={actions.onToggleHide}>
          {t(lang, data.hideFinished ? 'sidebar.showDone' : 'sidebar.hideDone')}
        </Button>
        <Button key="clear" hotkey="c" onPress={actions.onClear}>
          {t(lang, 'sidebar.clearDone')}
        </Button>
        <Button key="close-sidebar" hotkey="q" onPress={actions.onClose}>
          {t(lang, 'sidebar.close')}
        </Button>
        {data.isTreeExpanded ? (
          <Button key="fold-agents" onPress={actions.onToggleExpand}>
            {t(lang, 'sidebar.foldIdle')}
          </Button>
        ) : null}
      </Box>
      {Section(els, data, teamHeading(data.team, data.project, data.columns - width(agentCount) - HEADING_PADDING, lang), agentCount)}
      {!data.team && (
        <Box gap={1}>
          <Text dimColor>{t(lang, 'sidebar.noTeam')}</Text>
          <Button key="build-team" variant="primary" onPress={actions.onBuildTeam}>
            {t(lang, 'sidebar.buildTeam')}
          </Button>
        </Box>
      )}
      {rows.map(row => TreeLine(els, data, actions, row, draw))}
      {team.length === 0 && <Text dimColor>{t(lang, 'sidebar.noAgents')}</Text>}
      {hiddenAgents > 0 && <Text dimColor>{t(lang, 'sidebar.hiddenAgents', { n: hiddenAgents })}</Text>}
      {ProtoTable(els, data)}
      {taskP.total > 0 && Section(els, data, t(lang, 'sidebar.taskBoard'), `${taskP.done}/${taskP.total}`)}
      {taskP.total > 0 && TaskList(els, data, actions)}
    </Box>
  )
}

const COLUMN_PX = 7 // about one monospace column, so an Svg track is as wide as the Raster it stands for

/**
 * Where Rasters are not drawn (desktop, vscode, mobile), a track is the terminal's track as an Svg (trackSvg): the same
 * share, tone and pill, what it shows said in `alt` for a reader.
 */
export function textTrack(els: Els, rasters: Raster[], data: HqData): DrawRaster {
  const { Svg } = els as Partial<Elements['desktop']>
  return key => {
    const r = rasters.find(x => x.key === key)
    if (!r?.spec || !Svg) return null
    const { spec } = r
    // a working agent with no todos says what stands in for them: a task's status, or "getting started"
    const isFallback = key.startsWith('todo-') && !data.todos[key.slice('todo-'.length)]?.length
    const alt = spec.sweep ? spec.label || r.aside : isFallback ? spec.count || r.aside : t(data.lang ?? 'en', 'track.alt', { done: spec.done, total: spec.total })
    const W = r.columns * COLUMN_PX
    return withAside(els, r, <Svg key={key} source={trackSvg(spec, W, data.isLight)} alt={alt ?? ''} width={W} height={TRACK_PX} />)
  }
}
