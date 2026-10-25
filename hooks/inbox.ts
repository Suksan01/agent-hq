// What waits on the person: tool calls the engine put to them (a permission ask), agents held on an approval and idle
// teammates. Pure helpers; register.tsx owns the state. The live page shows the list, the status line counts it.

import type { HqAgent, HqStatus } from '../types'
import { baseName, commandWords, hostOf } from './activity'
import { MAIN, isFinished } from './model'
import { headOf } from './cells'
import { t } from './i18n'
import { maskSecrets } from './secrets'
import type { Key, Lang } from './i18n'

/**
 * What the live page shows of an open ask (view only): the fields that decide it, masked, and the size of the rest.
 * `isHidden`: a secret was found or the fields are over CARD_MAX_BYTES, so none is shown and the terminal has them all.
 */
export type AskCard = {
  tool: string
  fields: { key: string; text: string }[]
  sizes: { key: string; chars: number }[]
  isHidden: boolean
  reason?: string
}
export type InboxItem = { agent: string; since: number; what: string; card?: AskCard }
/** An open permission ask, by the tool call it is for. */
export type Ask = InboxItem
export type Asks = Record<string, Ask>

const WHAT_MAX = 120
const ASKS_MAX = 50
const CARDS_MAX = 5 // asks that carry a card: the state is re-sent whole at every change
export const CARD_MAX_BYTES = 2048
const REASON_MAX = 300
// the fields that decide an ask; everything else a tool takes (file contents, edit strings, cells) is shown by size only
const DECIDING_FIELDS: readonly string[] = ['command', 'file_path', 'notebook_path', 'url', 'pattern', 'description']
/** How long an idle teammate (done with its turn) counts as needing the person; after that it is only resting. */
export const IDLE_LIMIT_MS = 10 * 60_000

const clip = (text: string) => (text.length > WHAT_MAX ? `${headOf(text, WHAT_MAX - 1)}…` : text)

/** A tool call in a few words: `Bash: npm test`, `Edit: page.tsx`, `WebFetch: example.com`, or just the tool. Never a command's arguments, a full path or a URL's path and query. */
export function describeAsk(tool: string, input: unknown): string {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const detail = commandWords(fields.command) || baseName(fields.file_path) || baseName(fields.notebook_path) || hostOf(fields.url)
  return clip(detail ? `${tool}: ${detail}` : tool)
}

function utf8Bytes(text: string): number {
  let bytes = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

const sizeOf = (value: unknown): number => {
  try {
    return typeof value === 'string' ? value.length : (JSON.stringify(value) ?? '').length
  } catch {
    return 0 // a cycle: nothing to say about its size
  }
}

/**
 * The card for an ask: the deciding fields as text, masked, and the other fields by name and size. Fails closed: a field
 * that changes when masked (a secret, as far as `maskSecrets` can tell), or fields over CARD_MAX_BYTES, show nothing.
 */
export function cardOf(tool: string, input: unknown, reason?: string): AskCard {
  const given = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null
  const maskedReason = reason ? clipTo(maskSecrets(reason), REASON_MAX) : undefined
  const withReason = (card: AskCard): AskCard => (maskedReason ? { ...card, reason: maskedReason } : card)
  const hidden = withReason({ tool, fields: [], sizes: [], isHidden: true })
  if (!given) return hidden
  const fields = DECIDING_FIELDS.flatMap(key => (typeof given[key] === 'string' ? [{ key, text: given[key] as string }] : []))
  const total = fields.reduce((sum, f) => sum + utf8Bytes(f.text), 0)
  if (total > CARD_MAX_BYTES || fields.some(f => maskSecrets(f.text) !== f.text)) return hidden
  const sizes = Object.keys(given)
    .filter(key => !DECIDING_FIELDS.includes(key) && (typeof given[key] === 'string' || (typeof given[key] === 'object' && given[key] !== null)))
    .map(key => ({ key, chars: sizeOf(given[key]) }))
  return withReason({ tool, fields, sizes, isHidden: false })
}

const clipTo = (text: string, max: number) => (text.length > max ? `${headOf(text, max - 1)}…` : text)

/** The asks with this one added; at most 50 are kept, the oldest go first, and only the newest CARDS_MAX keep their card. */
export function addAsk(asks: Asks, toolUseId: string, ask: Ask): Asks {
  const kept = Object.entries({ ...asks, [toolUseId]: ask }).slice(-ASKS_MAX)
  const withCard = kept.filter(([, a]) => a.card).map(([id]) => id)
  const stripped = new Set(withCard.slice(0, Math.max(0, withCard.length - CARDS_MAX)))
  return Object.fromEntries(kept.map(([id, a]) => (stripped.has(id) ? [id, { agent: a.agent, since: a.since, what: a.what }] : [id, a])))
}

export const removeAsk = (asks: Asks, toolUseId: string): Asks => Object.fromEntries(Object.entries(asks).filter(([id]) => id !== toolUseId))

/** The asks without any of this loop's: once its turn has ended, none of its calls can still wait on a dialog. */
export const dropAsksOf = (asks: Asks, agent: string): Asks => Object.fromEntries(Object.entries(asks).filter(([, ask]) => ask.agent !== agent))

/** The asks of agents that are still running (an agent that ended can no longer be waiting for a dialog). */
export const liveAsks = (asks: Asks, agents: Record<string, HqAgent>): Asks =>
  Object.fromEntries(Object.entries(asks).filter(([, ask]) => ask.agent === MAIN || (agents[ask.agent] !== undefined && !isFinished(agents[ask.agent]?.status ?? 'completed'))))

/**
 * Why an agent waits on the person, by its status: `waiting` is held on a plan's approval, background work or an Agent
 * call (the sidebar calls it "needs approval"); `idle` is a teammate done with its turn, waiting for a message.
 */
const HELD: Partial<Record<HqStatus, Key>> = {
  waiting: 'inbox.held',
  idle: 'inbox.idle',
}

/** The agents newly waiting on the person (see HELD) get a start time, the ones no longer waiting lose theirs. */
export function trackWaiting(since: Record<string, number>, agents: Record<string, HqAgent>, now: number): Record<string, number> {
  return Object.fromEntries(
    Object.values(agents)
      .filter(a => a.id !== MAIN && HELD[a.status] !== undefined)
      .map(a => [a.id, since[a.id] ?? now]),
  )
}

/**
 * Everything waiting on the person at `now`, longest waiting first: open permission asks, then held agents and idle
 * teammates (an idle one only for IDLE_LIMIT_MS: a teammate idle for hours is resting, not waiting on anyone).
 */
export function buildInbox(asks: Asks, agents: Record<string, HqAgent>, waitingSince: Record<string, number>, now: number, lang: Lang = 'en'): InboxItem[] {
  const fromAsks = Object.values(liveAsks(asks, agents))
  const askers = new Set(fromAsks.map(a => a.agent))
  const fromAgents = Object.values(agents).flatMap((a): InboxItem[] => {
    const held = HELD[a.status]
    const what = held && t(lang, held)
    const since = waitingSince[a.id] ?? a.startedAt
    const isResting = a.status === 'idle' && now - since > IDLE_LIMIT_MS
    return a.id !== MAIN && what && !askers.has(a.id) && !isResting ? [{ agent: a.id, since, what }] : []
  })
  return [...fromAsks, ...fromAgents].sort((a, b) => a.since - b.since)
}

/** The status line: how many are working and how many need the person; nothing at all when there is nothing to show. */
export function statusText(working: number, needsYou: number, tasks: { done: number; total: number }, lang: Lang = 'en'): string | undefined {
  if (working === 0 && needsYou === 0 && tasks.total === 0) return undefined
  return `${t(lang, 'line.working', { n: working })}${needsYou > 0 ? t(lang, 'line.needsYou', { n: needsYou }) : ''}${tasks.total > 0 ? t(lang, 'line.tasks', tasks) : ''}`
}

/** How many pages the hub says are open, from its pages.json `{ count, at }`; 0 for anything unreadable. */
export function pageCount(text: string): number {
  try {
    const count = (JSON.parse(text) as { count?: unknown } | null)?.count
    return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 0
  } catch {
    return 0
  }
}
