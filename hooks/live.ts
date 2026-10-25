// The state the browser overview draws (`/hq web`): one plain snapshot, rebuilt from the same data the sidebar reads,
// so the page shows exactly what the sidebar shows. Written to a file the local server pushes to the page.

import type { Tone } from './cells'
import type { LiveEvent } from './feed'
import type { InboxItem } from './inbox'
import { IDLE_LIMIT_MS } from './inbox'
import type { AgentUsage } from './usage'
import { botState, paletteOf, speciesOf, spriteFrames } from './sprites'
import { MAIN, isFinished, progressOf } from './model'
import { currentActivity } from './activity'
import { sayingOf } from './says'
import type { Progress } from './model'
import type { HqAgent, HqBubble, HqSuggestions } from '../types'
import type { HqData } from './view'
import { TONE_OF, fallbackOf, labelOf, mascotTone, nowLine, teamProgress, treeRows } from './view'
import type { BarFallback } from './view'
import { BADGES } from './xp'
import type { XpSummary } from './xpstore'
import { costOf } from './prices'
import { isCounted } from './tasklist'
import type { ListTask, TaskList } from './tasklist'
import { t } from './i18n'
import type { Lang } from './i18n'

export type LiveAgent = {
  id: string
  parentId: string | null // null for the lead; MAIN for agents the main session started
  name: string
  nickname: string // its joyful nickname; the name itself for a row that has none yet
  role: string
  status: string
  tone: Tone
  isMain: boolean
  // the Bot Avatars character the page draws, and the same pixel frames the terminal shows, for when it can't load
  mascot: { type: string; color: string; hat: 'crown' | 'none'; state: 'working' | 'sleeping' | 'default'; frames: string[][]; palette: Record<string, string> }
  now: string
  next: string | null
  last: string | null
  todos: Progress | null
  fallback: BarFallback | null // for a working agent with no todos yet: the status of a board task it owns, or an indeterminate bar
  tools: number
  lastTool: string | null
  /** The tool call it is in right now ("Editing view.tsx") and since when; null between calls. */
  activity: { text: string; since: number } | null
  /** What it is doing, in a sentence (hooks/says.ts): what it said with hq_doing, else its step, its assignment, or the lead's line; null when none. */
  says: string | null
  startedAt: number
  endedAt: number | null
  /** Tokens and working time so far (the engine reports no price); null before the agent finished a turn. */
  usage: AgentUsage | null
  /** Level, XP and the badges earned (with their titles), or null where nothing is kept. */
  xp: { level: number; xp: number; badges: { id: string; title: string; hint: string }[] } | null
}

/** One member's work on a task, for the page's detail; `costUsd` is null where its model has no price. */
export type LiveTaskWork = { who: string; role: string; step: string; workMs: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number | null; lastAt: number | null }
export type LiveTaskRow = {
  n: number
  title: string
  status: string
  /** The member on a working or review task, the finisher on a done one, nobody on a waiting one. */
  who: string | null
  doneBy: string | null
  startedAt: number | null
  doneAt: number | null
  /** The latest time a turn was counted on this task by any member, null when none was. */
  lastActiveAt: number | null
  workMs: number
  costUsd: number | null
  isPartial: boolean
  work: LiveTaskWork[]
  events: { at: number; kind: string; who: string | null }[]
}
/** The approved plan's task list as the page's Tasks panel draws it; `total` adds the work of tasks dropped by a re-plan (`removed`), as the sidebar's does; titles are the plan's text, drawn as text, never escaped here. */
export type LiveTaskList = {
  rows: LiveTaskRow[]
  total: { done: number; count: number; workMs: number; costUsd: number | null; isPartial: boolean }
  removed: TaskList['removed']
}

export type LiveSnapshot = {
  v: 1
  at: number
  /** The person's language (the `language` option): the page draws its own words in it. */
  lang: Lang
  team: { name: string; purpose: string; lead: string } | null
  overall: Progress
  tasksProgress: Progress
  agents: LiveAgent[]
  tasks: { id: string; subject: string; status: string; owner: string | null; blockedBy: string[] }[]
  /** The saved task list of the approved plan with time and estimated cost per task; null when there is none. */
  taskList: LiveTaskList | null
  // what the page's "+" can add: the team's roles with how many run now, or a general agent without a team
  roles: { id: string; title: string; count: number; active: number }[]
  notice: { seq: number; ok: boolean; text: string } | null
  hideFinished: boolean // the page's Hide done / Show done toggle
  /** The highest page request id the mod has handled; the server stops re-sending requests up to it. */
  lastAction: number
  /** The last 200 things that happened, oldest first; `n` only rises, so a gap in it means the page missed some. */
  events: LiveEvent[]
  /** What waits on the person: permission asks and agents held on an approval, longest waiting first. */
  inbox: InboxItem[]
  /** Members that left the page (see FINISHED_GRACE_MS) and are only counted: completed, and failed or stopped. */
  folded: { done: number; failed: number }
  /** The talk bubbles showing now (hooks/talk.ts): on `agent`'s card, to or from `other` (`main` for the lead); the page draws exactly these. */
  bubbles: HqBubble[]
  /** What the person could send the lead next (hooks/suggest.ts), drafted after its last answered turn; null when none. */
  suggestions: HqSuggestions | null
}

/** What the snapshot carries beyond the agents and tasks: the acknowledged request id and the activity feed. */
export type LiveExtras = {
  lastAction?: number
  events?: readonly LiveEvent[]
  inbox?: readonly InboxItem[]
  usage?: Readonly<Record<string, AgentUsage>>
  /** Since when each held or idle agent waits (see ./inbox trackWaiting): an idle one past IDLE_LIMIT_MS leaves the page. */
  waitingSince?: Readonly<Record<string, number>>
  suggestions?: HqSuggestions | null
}

/** A finished member stays on the page this long after it ended, then leaves it and is only counted. */
export const FINISHED_GRACE_MS = 2 * 60_000

/** Is this member off the page at `at`: ended longer than the grace ago, or idle past the limit? Never the lead. */
function isFolded(agent: HqAgent, at: number, waitingSince: Readonly<Record<string, number>>): boolean {
  if (agent.id === MAIN) return false
  if (isFinished(agent.status)) return at - (agent.endedAt ?? agent.startedAt) > FINISHED_GRACE_MS
  return agent.status === 'idle' && at - (waitingSince[agent.id] ?? agent.startedAt) > IDLE_LIMIT_MS
}

/** Roles the page offers, each with how many of it are at work now (a role's count caps that). */
export function rolesOf(data: HqData): LiveSnapshot['roles'] {
  const live = Object.values(data.agents).filter(a => a.id !== MAIN && !isFinished(a.status))
  if (!data.team) return [{ id: 'general-purpose', title: t(data.lang ?? 'en', 'live.generalAgent'), count: 10, active: live.filter(a => a.role === 'general-purpose').length }]
  return data.team.roles.map(r => ({ id: r.id, title: r.title, count: r.count, active: live.filter(a => a.role === `agent-hq:${r.id}`).length }))
}

/** An agent's XP as the page draws it: its badges with titles and hints, in the person's language. */
function xpOf(summary: XpSummary | undefined, lang: Lang): LiveAgent['xp'] {
  if (!summary) return null
  const badges = summary.badges.flatMap(id => BADGES.filter(b => b.id === id)).map(b => ({ id: b.id, title: t(lang, `badge.${b.id}.title`), hint: t(lang, `badge.${b.id}.hint`) }))
  return { level: summary.level, xp: summary.xp, badges }
}

function activityOf(data: HqData, id: string): LiveAgent['activity'] {
  const a = currentActivity(data.activity, id)
  return a ? { text: a.text, since: a.since } : null
}

const sumCosts = (costs: (number | null)[]) => (costs.every(c => c === null) ? null : costs.reduce<number>((s, c) => s + (c ?? 0), 0))

function taskRow(task: ListTask): LiveTaskRow {
  const events = [...task.events].sort((a, b) => a.at - b.at)
  const work = Object.entries(task.work).map(([who, w]): LiveTaskWork => ({ who, role: w.role, step: w.step, workMs: w.workMs, inputTokens: w.inputTokens, outputTokens: w.outputTokens, cacheReadTokens: w.cacheReadTokens, cacheWriteTokens: w.cacheWriteTokens, costUsd: costOf({ ...w, model: w.model ?? undefined }), lastAt: w.lastAt ?? null }))
  const holder = events.at(-1)?.who ?? work.at(-1)?.who ?? null
  const who = task.status === 'done' ? task.doneBy : task.status === 'waiting' ? null : holder
  return {
    n: task.n,
    title: task.title,
    status: task.status,
    who,
    doneBy: task.status === 'done' ? task.doneBy : null,
    startedAt: task.startedAt,
    doneAt: task.doneAt,
    lastActiveAt: work.reduce<number | null>((max, w) => (w.lastAt === null ? max : Math.max(max ?? w.lastAt, w.lastAt)), null),
    workMs: work.reduce((s, w) => s + w.workMs, 0),
    costUsd: sumCosts(work.map(w => w.costUsd)),
    isPartial: work.some(w => w.costUsd === null && isCounted(w)), // a member just linked, with nothing counted yet, is not an unpriced one
    work,
    events,
  }
}

function taskListOf(list: TaskList | null | undefined): LiveTaskList | null {
  if (!list) return null
  const rows = list.tasks.map(taskRow)
  const total = {
    done: rows.filter(r => r.status === 'done').length,
    count: rows.length,
    workMs: rows.reduce((s, r) => s + r.workMs, 0) + list.removed.workMs,
    costUsd: sumCosts([...rows.map(r => r.costUsd), list.removed.costUsd]),
    isPartial: list.removed.isPartial === true || rows.some(r => r.isPartial),
  }
  return { rows, total, removed: list.removed }
}

export function buildSnapshot(data: HqData, at: number, notice: LiveSnapshot['notice'] = null, extras: LiveExtras = {}): LiveSnapshot {
  const lang = data.lang ?? 'en'
  const gone = Object.values(data.agents).filter(a => isFolded(a, at, extras.waitingSince ?? {}))
  const goneIds = new Set(gone.map(a => a.id))
  const agents = treeRows(data).filter(({ agent }) => !goneIds.has(agent.id)).map(({ agent, work }): LiveAgent => {
    const isMain = agent.id === MAIN
    const label = labelOf(agent, data.team, lang)
    const species = speciesOf(agent.mascot)
    // a helper of a member that left the page hangs on the lead
    const parent = isMain ? null : agent.parentId && data.agents[agent.parentId] && !goneIds.has(agent.parentId) ? agent.parentId : MAIN
    const tone: Tone = isMain ? mascotTone(agent, data) : TONE_OF[agent.status]
    return {
      id: agent.id,
      parentId: parent,
      name: label.name,
      nickname: agent.nickname ?? label.name,
      role: label.role,
      status: isMain ? 'running' : agent.status,
      tone,
      isMain,
      mascot: {
        type: species.type,
        color: species.color,
        hat: species.hat ?? 'none',
        state: botState(tone),
        frames: spriteFrames(species, tone),
        palette: paletteOf(species, tone),
      },
      now: isMain && !work.now ? (agent.lastTool ? `▸ ${agent.lastTool}` : t(lang, 'live.leading')) : nowLine(agent, work, data.now, lang).text,
      next: !isFinished(agent.status) ? (work.next ?? null) : null,
      last: work.last ?? null,
      todos: work.todos ?? null,
      fallback: work.todos ? null : (fallbackOf(agent, data.tasks) ?? null),
      tools: agent.tools,
      lastTool: agent.lastTool ?? null,
      activity: activityOf(data, agent.id),
      says: sayingOf(agent, data, lang)?.text ?? null,
      startedAt: agent.startedAt,
      endedAt: agent.endedAt ?? null,
      usage: extras.usage?.[agent.id] ?? null,
      xp: xpOf(data.xp?.[agent.id], lang),
    }
  })
  return {
    v: 1,
    at,
    lang,
    team: data.team ? { name: data.team.name, purpose: data.team.purpose, lead: data.team.lead.title } : null,
    overall: teamProgress(data),
    tasksProgress: progressOf(Object.values(data.tasks)),
    agents,
    tasks: Object.values(data.tasks).map(t => ({ id: t.id, subject: t.subject, status: t.status, owner: t.owner ?? null, blockedBy: t.blockedBy })),
    taskList: taskListOf((data as HqData & { taskList?: TaskList | null }).taskList),
    roles: rolesOf(data),
    notice,
    hideFinished: data.hideFinished,
    lastAction: extras.lastAction ?? 0,
    events: [...(extras.events ?? [])],
    inbox: [...(extras.inbox ?? [])],
    folded: { done: gone.filter(a => a.status === 'completed').length, failed: gone.filter(a => a.status === 'failed' || a.status === 'killed').length },
    bubbles: [...(data.bubbles ?? [])],
    suggestions: extras.suggestions ?? null,
  }
}
