// XP for the team's agents, earned from what they do and kept by nickname across sessions (hooks/xp.ts holds the rules).
// Every poll `creditActivity` turns what changed since the last look (tools used, todos and tasks finished, an agent
// done or failed) into XP events; `creditTestRun` adds a test command's result. Stats live in the plugin's store under
// `xp:<nickname>` and are written in the same poll that changed them, so an agent that comes back under the same
// nickname carries on and nothing earned is lost. The store is passed in as two plain
// calls, which is also how the tests stand one in with memory.

import type { EngineInterface } from 'claude-code'

import type { HqAgent, HqStatus, HqTask, HqTodo } from '../types'
import { isFinished } from './model'
import { pickSound, playSound } from './sounds'
import type { Sound } from './sounds'
import { BADGES, applyEvent, emptyStats } from './xp'
import type { Badge, BadgeId, XpEvent, XpStats } from './xp'

export type XpStore = { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }

/** What the live page and the sidebar show for an agent. */
export type XpSummary = { level: number; xp: number; badges: BadgeId[] }

/** Something worth telling the person: a nickname reached a level and/or earned badges. */
export type XpNotice = { nickname: string; level: number | null; badges: Badge[] }

export type Activity = { agents: Record<string, HqAgent>; todos: Record<string, HqTodo[]>; tasks: Record<string, HqTask> }

type Seen = { tools: number; todosDone: number; status: HqStatus; doneTasks: string[] }

export type XpLedger = {
  /** When the first poll ran: agents that started before it were working before this plugin loaded. */
  bootAt: number | null
  seen: Map<string, Seen>
  stats: Map<string, XpStats>
  /** When a board task was first seen in progress, for the speedy badge. */
  taskStart: Map<string, number>
  /** Nicknames whose stats changed and are not in the store yet. */
  dirty: Set<string>
}

const REVIEWER = /review/i
const KNOWN_BADGES: readonly string[] = BADGES.map(b => b.id)
const TEST_COMMAND = /(^|[\s;&|(])(npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+(run\s+)?test|bun\s+(run\s+)?test|npx\s+vitest|vitest|jest|pytest|go\s+test|cargo\s+test|claude\s+plugin\s+test)(\s|$)/

const keyOf = (nickname: string) => `xp:${nickname}`

export const createLedger = (): XpLedger => ({ bootAt: null, seen: new Map(), stats: new Map(), taskStart: new Map(), dirty: new Set() })

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** Stored stats, read as untrusted: anything that is not whole stats starts over, and unknown badges are dropped. */
function parseStats(v: unknown): XpStats {
  if (typeof v !== 'object' || v === null) return emptyStats()
  const r = v as Record<string, unknown>
  if (![r.xp, r.level, r.tools, r.tasks, r.reviews, r.testStreak, r.failures].every(isCount) || !Array.isArray(r.badges)) return emptyStats()
  return {
    xp: r.xp as number,
    level: r.level as number,
    tools: r.tools as number,
    tasks: r.tasks as number,
    reviews: r.reviews as number,
    testStreak: r.testStreak as number,
    failures: r.failures as number,
    badges: r.badges.filter((b): b is BadgeId => typeof b === 'string' && KNOWN_BADGES.includes(b)),
  }
}

async function statsOf(store: XpStore, ledger: XpLedger, nickname: string): Promise<XpStats> {
  const cached = ledger.stats.get(nickname)
  if (cached) return cached
  const loaded = parseStats(await store.get(keyOf(nickname)).catch(() => undefined))
  ledger.stats.set(nickname, loaded)
  return loaded
}

const doneCount = (todos: readonly HqTodo[] | undefined) => (todos ?? []).filter(t => t.status === 'completed').length
const ownedBy = (agent: HqAgent, tasks: Record<string, HqTask>) => Object.values(tasks).filter(t => t.owner !== undefined && (t.owner === agent.name || t.owner === agent.id))

/** The events one agent earned since `seen`, and what to remember for next time. */
function eventsSince(agent: HqAgent, seen: Seen, activity: Activity, ledger: XpLedger): { events: XpEvent[]; next: Seen } {
  const events: XpEvent[] = []
  for (let i = seen.tools; i < agent.tools; i++) events.push({ type: 'tool' })
  const todosDone = doneCount(activity.todos[agent.id])
  for (let i = seen.todosDone; i < todosDone; i++) events.push({ type: 'todo_done' })
  const finished = ownedBy(agent, activity.tasks).filter(t => t.status === 'completed')
  for (const t of finished.filter(t => !seen.doneTasks.includes(t.id))) {
    const startedAt = ledger.taskStart.get(t.id)
    events.push({ type: 'task_done', subject: t.subject, ...(startedAt === undefined ? {} : { startedAt }) })
  }
  if (!isFinished(seen.status) && agent.status === 'completed') {
    if (REVIEWER.test(agent.role) || REVIEWER.test(agent.name)) events.push({ type: 'review_approved' })
    events.push({ type: 'agent_done' })
  } else if (!isFinished(seen.status) && agent.status === 'failed') events.push({ type: 'agent_failed' })
  return { events, next: { tools: agent.tools, todosDone, status: agent.status, doneTasks: finished.map(t => t.id) } }
}

async function apply(store: XpStore, ledger: XpLedger, nickname: string, events: readonly XpEvent[], now: number): Promise<XpNotice | null> {
  if (events.length === 0) return null
  let stats = await statsOf(store, ledger, nickname)
  let level: number | null = null
  const badges: Badge[] = []
  for (const event of events) {
    const out = applyEvent(stats, event, now)
    stats = out.stats
    level = out.levelUp ?? level
    badges.push(...out.badges)
  }
  ledger.stats.set(nickname, stats)
  ledger.dirty.add(nickname)
  return level !== null || badges.length > 0 ? { nickname, level, badges } : null
}

/** Writes the stats that changed, one write per nickname, so nothing earned is ever only in memory. */
async function flush(store: XpStore, ledger: XpLedger) {
  const nicknames = [...ledger.dirty]
  ledger.dirty.clear()
  for (const nickname of nicknames) {
    const stats = ledger.stats.get(nickname)
    if (stats) await store.set(keyOf(nickname), stats).catch(() => ledger.dirty.add(nickname)) // kept to try again next poll
  }
}

/** Credits what every agent did since the last poll; returns the level ups and badges to tell the person about. */
export async function creditActivity(store: XpStore, ledger: XpLedger, activity: Activity, now: number): Promise<XpNotice[]> {
  ledger.bootAt ??= now
  for (const task of Object.values(activity.tasks)) if (task.status === 'in_progress' && !ledger.taskStart.has(task.id)) ledger.taskStart.set(task.id, now)
  const notices: XpNotice[] = []
  for (const agent of Object.values(activity.agents)) {
    if (!agent.nickname) continue
    const before = ledger.seen.get(agent.id)
    // an agent that was already at work when the plugin loaded is only counted from now on
    const isOld = before === undefined && agent.startedAt < ledger.bootAt
    const seen: Seen = before ?? (isOld ? { tools: agent.tools, todosDone: doneCount(activity.todos[agent.id]), status: agent.status, doneTasks: ownedBy(agent, activity.tasks).filter(t => t.status === 'completed').map(t => t.id) } : { tools: 0, todosDone: 0, status: 'pending', doneTasks: [] })
    const { events, next } = eventsSince(agent, seen, activity, ledger)
    ledger.seen.set(agent.id, next)
    const notice = await apply(store, ledger, agent.nickname, events, now)
    if (notice) notices.push(notice)
  }
  await flush(store, ledger)
  return notices
}

/** `tests_green` or `tests_red` for a test command's result; null for any other command. */
export function testRunEvent(command: string, failed: boolean): XpEvent | null {
  // the text inside quotes is not a command: `echo "npm test"` is no test run
  const bare = command.replace(/"[^"]*"|'[^']*'/g, '""')
  return TEST_COMMAND.test(bare) ? { type: failed ? 'tests_red' : 'tests_green' } : null
}

/** Credits a test command's result to the agent (by nickname) that ran it. */
export async function creditTestRun(store: XpStore, ledger: XpLedger, nickname: string | undefined, command: string, failed: boolean, now: number): Promise<XpNotice[]> {
  const event = nickname ? testRunEvent(command, failed) : null
  if (!nickname || !event) return []
  const notice = await apply(store, ledger, nickname, [event], now)
  await flush(store, ledger)
  return notice ? [notice] : []
}

/** Each agent's level, XP and badges, read from the ledger and, for nicknames not seen yet, from the store. */
export async function xpSummaries(store: XpStore, ledger: XpLedger, agents: Record<string, HqAgent>): Promise<Record<string, XpSummary>> {
  const out: Record<string, XpSummary> = {}
  for (const agent of Object.values(agents)) {
    if (!agent.nickname) continue
    const { level, xp, badges } = await statsOf(store, ledger, agent.nickname)
    out[agent.id] = { level, xp, badges: [...badges] }
  }
  return out
}

/** The person-facing side of some notices: a toast line each, and the one clip to play (a level up outranks done). */
export function xpAnnouncement(notices: readonly XpNotice[], heard: Sound | null, muted: boolean): { toasts: string[]; sound: Sound | null } {
  const toasts = notices.map(n =>
    [n.level !== null ? `${n.nickname} reached level ${n.level}!` : '', ...n.badges.map(b => `${n.nickname} earned the ${b.title} badge`)].filter(Boolean).join(' · '),
  )
  const levelUp = !muted && notices.some(n => n.level !== null)
  return { toasts: toasts.map(t => `Agent HQ: ${t}`), sound: pickSound([heard, levelUp ? 'levelup' : null].filter((s): s is Sound => s !== null)) }
}

/** The plugin's store as the two calls the ledger needs. */
export function xpStoreOf($: EngineInterface): XpStore {
  return { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) }
}

/** Toasts the notices and plays the one clip of this poll: the status change's, or a level up's when that is louder. */
export async function announceXp($: EngineInterface, notices: readonly XpNotice[], heard: Sound | null, muted: boolean): Promise<void> {
  const { toasts, sound } = xpAnnouncement(notices, heard, muted)
  for (const text of toasts) $.ui.toast(text)
  await playSound($, sound)
}
