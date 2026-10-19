// What waits on the person: tool calls the engine put to them (a permission ask), agents held on an approval and idle
// teammates. Pure helpers; register.tsx owns the state. The live page shows the list, the status line counts it.

import type { HqAgent, HqStatus } from '../types'
import { baseName, commandWords, hostOf } from './activity'
import { MAIN, isFinished } from './model'

export type InboxItem = { agent: string; since: number; what: string }
/** An open permission ask, by the tool call it is for. */
export type Ask = InboxItem
export type Asks = Record<string, Ask>

const WHAT_MAX = 120
const ASKS_MAX = 50

const clip = (text: string) => (text.length > WHAT_MAX ? `${text.slice(0, WHAT_MAX - 1)}…` : text)

/** A tool call in a few words: `Bash: npm test`, `Edit: page.tsx`, `WebFetch: example.com`, or just the tool. Never a command's arguments, a full path or a URL's path and query. */
export function describeAsk(tool: string, input: unknown): string {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const detail = commandWords(fields.command) || baseName(fields.file_path) || baseName(fields.notebook_path) || hostOf(fields.url)
  return clip(detail ? `${tool}: ${detail}` : tool)
}

/** The asks with this one added; at most 50 are kept, the oldest go first. */
export function addAsk(asks: Asks, toolUseId: string, ask: Ask): Asks {
  return Object.fromEntries(Object.entries({ ...asks, [toolUseId]: ask }).slice(-ASKS_MAX))
}

export const removeAsk = (asks: Asks, toolUseId: string): Asks => Object.fromEntries(Object.entries(asks).filter(([id]) => id !== toolUseId))

/** The asks of agents that are still running (an agent that ended can no longer be waiting for a dialog). */
export const liveAsks = (asks: Asks, agents: Record<string, HqAgent>): Asks =>
  Object.fromEntries(Object.entries(asks).filter(([, ask]) => ask.agent === MAIN || (agents[ask.agent] !== undefined && !isFinished(agents[ask.agent]?.status ?? 'completed'))))

/**
 * Why an agent waits on the person, by its status: `waiting` is held on a plan's approval, background work or an Agent
 * call (the sidebar calls it "needs approval"); `idle` is a teammate done with its turn, waiting for a message.
 */
const HELD: Partial<Record<HqStatus, string>> = {
  waiting: 'held, waiting on an approval or a background task',
  idle: 'idle, waiting for a message',
}

/** The agents newly waiting on the person (see HELD) get a start time, the ones no longer waiting lose theirs. */
export function trackWaiting(since: Record<string, number>, agents: Record<string, HqAgent>, now: number): Record<string, number> {
  return Object.fromEntries(
    Object.values(agents)
      .filter(a => a.id !== MAIN && HELD[a.status] !== undefined)
      .map(a => [a.id, since[a.id] ?? now]),
  )
}

/** Everything waiting on the person, longest waiting first: open permission asks, then held agents and idle teammates. */
export function buildInbox(asks: Asks, agents: Record<string, HqAgent>, waitingSince: Record<string, number>): InboxItem[] {
  const fromAsks = Object.values(liveAsks(asks, agents))
  const askers = new Set(fromAsks.map(a => a.agent))
  const fromAgents = Object.values(agents).flatMap((a): InboxItem[] => {
    const what = HELD[a.status]
    return a.id !== MAIN && what && !askers.has(a.id) ? [{ agent: a.id, since: waitingSince[a.id] ?? a.startedAt, what }] : []
  })
  return [...fromAsks, ...fromAgents].sort((a, b) => a.since - b.since)
}

/** The status line: how many are working and how many need the person; nothing at all when there is nothing to show. */
export function statusText(working: number, needsYou: number, tasks: { done: number; total: number }): string | undefined {
  if (working === 0 && needsYou === 0 && tasks.total === 0) return undefined
  return `🪐 ${working} working${needsYou > 0 ? ` · ${needsYou} needs you` : ''}${tasks.total > 0 ? ` · ${tasks.done}/${tasks.total} tasks` : ''}`
}
