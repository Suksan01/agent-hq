// The state the browser overview draws (`/hq web`): one plain snapshot, rebuilt from the same data the sidebar reads,
// so the page shows exactly what the sidebar shows. Written to a file the local server pushes to the page.

import type { Tone } from './cells'
import type { LiveEvent } from './feed'
import type { InboxItem } from './inbox'
import type { AgentUsage } from './usage'
import { botState, paletteOf, speciesOf, spriteFrames } from './sprites'
import { MAIN, isFinished, progressOf } from './model'
import { currentActivity } from './activity'
import type { Progress } from './model'
import type { HqData } from './view'
import { TONE_OF, fallbackOf, labelOf, mascotTone, nowLine, teamProgress, treeRows } from './view'
import type { BarFallback } from './view'
import { BADGES } from './xp'
import type { XpSummary } from './xpstore'

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
  startedAt: number
  endedAt: number | null
  /** Tokens and working time so far (the engine reports no price); null before the agent finished a turn. */
  usage: AgentUsage | null
  /** Level, XP and the badges earned (with their titles), or null where nothing is kept. */
  xp: { level: number; xp: number; badges: { id: string; title: string; hint: string }[] } | null
}

export type LiveSnapshot = {
  v: 1
  at: number
  team: { name: string; purpose: string; lead: string } | null
  overall: Progress
  tasksProgress: Progress
  agents: LiveAgent[]
  tasks: { id: string; subject: string; status: string; owner: string | null; blockedBy: string[] }[]
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
}

/** What the snapshot carries beyond the agents and tasks: the acknowledged request id and the activity feed. */
export type LiveExtras = { lastAction?: number; events?: readonly LiveEvent[]; inbox?: readonly InboxItem[]; usage?: Readonly<Record<string, AgentUsage>> }

/** Roles the page offers, each with how many of it are at work now (a role's count caps that). */
export function rolesOf(data: HqData): LiveSnapshot['roles'] {
  const live = Object.values(data.agents).filter(a => a.id !== MAIN && !isFinished(a.status))
  if (!data.team) return [{ id: 'general-purpose', title: 'General agent', count: 10, active: live.filter(a => a.role === 'general-purpose').length }]
  return data.team.roles.map(r => ({ id: r.id, title: r.title, count: r.count, active: live.filter(a => a.role === `agent-hq:${r.id}`).length }))
}

/** An agent's XP as the page draws it: its badges with titles and hints. */
function xpOf(summary: XpSummary | undefined): LiveAgent['xp'] {
  if (!summary) return null
  return { level: summary.level, xp: summary.xp, badges: summary.badges.flatMap(id => BADGES.filter(b => b.id === id)) }
}

function activityOf(data: HqData, id: string): LiveAgent['activity'] {
  const a = currentActivity(data.activity, id)
  return a ? { text: a.text, since: a.since } : null
}

export function buildSnapshot(data: HqData, at: number, notice: LiveSnapshot['notice'] = null, extras: LiveExtras = {}): LiveSnapshot {
  const agents = treeRows(data).map(({ agent, work }): LiveAgent => {
    const isMain = agent.id === MAIN
    const label = labelOf(agent, data.team)
    const species = speciesOf(agent.mascot)
    const parent = isMain ? null : agent.parentId && data.agents[agent.parentId] ? agent.parentId : MAIN
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
      now: isMain && !work.now ? (agent.lastTool ? `▸ ${agent.lastTool}` : 'leading the team') : nowLine(agent, work, data.now).text,
      next: !isFinished(agent.status) ? (work.next ?? null) : null,
      last: work.last ?? null,
      todos: work.todos ?? null,
      fallback: work.todos ? null : (fallbackOf(agent, data.tasks) ?? null),
      tools: agent.tools,
      lastTool: agent.lastTool ?? null,
      activity: activityOf(data, agent.id),
      startedAt: agent.startedAt,
      endedAt: agent.endedAt ?? null,
      usage: extras.usage?.[agent.id] ?? null,
      xp: xpOf(data.xp?.[agent.id]),
    }
  })
  return {
    v: 1,
    at,
    team: data.team ? { name: data.team.name, purpose: data.team.purpose, lead: data.team.lead.title } : null,
    overall: teamProgress(data),
    tasksProgress: progressOf(Object.values(data.tasks)),
    agents,
    tasks: Object.values(data.tasks).map(t => ({ id: t.id, subject: t.subject, status: t.status, owner: t.owner ?? null, blockedBy: t.blockedBy })),
    roles: rolesOf(data),
    notice,
    hideFinished: data.hideFinished,
    lastAction: extras.lastAction ?? 0,
    events: [...(extras.events ?? [])],
    inbox: [...(extras.inbox ?? [])],
  }
}
