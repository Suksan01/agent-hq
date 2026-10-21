// The activity feed on the live page: a numbered list of what just happened (a tool used, a step done, a status change,
// a message sent, a page request's result). `n` only rises, so the page can tell it missed some; the last 200 are kept.

import type { HqAgent, HqTodo } from '../types'
import { MAIN } from './model'
import { headOf } from './cells'
import { maskSecrets } from './secrets'
import { t } from './i18n'
import type { Lang } from './i18n'

export const FEED_MAX = 200
const TEXT_MAX = 140

export type EventKind = 'tool' | 'step' | 'status' | 'message' | 'action'
/**
 * `agent` is the agent's id (`main` for the lead), which the snapshot's agents list maps to a name. `failed` says whether
 * it reports a failure (a refused call, a request that failed), so the page tells it in any language; every event added
 * here carries it (only events kept from an older version lack it).
 */
export type LiveEvent = { n: number; at: number; agent: string; kind: EventKind; text: string; failed?: boolean }
export type Feed = { next: number; events: LiveEvent[] }
export type NewEvent = Pick<LiveEvent, 'agent' | 'kind' | 'text' | 'failed'>

export const EMPTY_FEED: Feed = { next: 1, events: [] }

// an event's text may carry what an agent or the lead wrote (a task, a step, a reason): masked before it is kept
const clip = (raw: string) => {
  const text = maskSecrets(raw)
  return text.length > TEXT_MAX ? `${headOf(text, TEXT_MAX - 1)}…` : text
}

/** The feed with these events added at `at`, numbered on from where it was; only the newest FEED_MAX stay. */
export function addEvents(feed: Feed, at: number, items: readonly NewEvent[]): Feed {
  if (items.length === 0) return feed
  const added = items.map((item, i): LiveEvent => ({ n: feed.next + i, at, agent: item.agent, kind: item.kind, text: clip(item.text), failed: item.failed === true }))
  return { next: feed.next + added.length, events: [...feed.events, ...added].slice(-FEED_MAX) }
}

/** An agent that appeared, or whose status changed, between two polls (never the main session). */
export function statusEvents(before: Record<string, HqAgent>, after: Record<string, HqAgent>, lang: Lang = 'en'): NewEvent[] {
  return Object.values(after).flatMap((agent): NewEvent[] => {
    if (agent.id === MAIN) return []
    const prior = before[agent.id]
    if (!prior) return [{ agent: agent.id, kind: 'status', text: t(lang, 'feed.started', { status: t(lang, `state.${agent.status}`) }) }]
    return prior.status === agent.status ? [] : [{ agent: agent.id, kind: 'status', text: `${t(lang, `state.${prior.status}`)} → ${t(lang, `state.${agent.status}`)}` }]
  })
}

/** Steps a TodoWrite just completed: todos done now that were not done in the list before (matched by their text). */
export function stepEvents(agent: string, before: readonly HqTodo[] | undefined, after: readonly HqTodo[], lang: Lang = 'en'): NewEvent[] {
  const wasDone = new Set((before ?? []).filter(todo => todo.status === 'completed').map(todo => todo.content))
  return after.filter(todo => todo.status === 'completed' && !wasDone.has(todo.content)).map(todo => ({ agent, kind: 'step', text: t(lang, 'feed.done', { what: todo.content }) }))
}
