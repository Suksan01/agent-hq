// Talk bubbles: when the lead and its members speak to each other (SendMessage, a hand-back, an assignment, a last
// answer), a short line of it shows over the card of the party that is not the lead for a few seconds. Pure;
// register.tsx keeps the `bubbles` atom, the page draws the snapshot's `bubbles`, the sidebars show it on line 3.
// The words come from a model, so they are read untrusted: one line, secrets masked, cut short.

import type { HqAgent, HqBubble } from '../types'
import { MAIN } from './model'
import { fitText } from './cells'
import { cleanSaying } from './says'
import { t } from './i18n'
import type { Lang } from './i18n'

export const BUBBLE_MS = 6000 // how long a bubble shows
export const BUBBLES_MAX = 4 // at most this many at once in a team; the oldest goes first
export const BUBBLE_MAX = 80 // columns

// a line that only heads or fences what follows says nothing yet
const HEADING = /^\s*(#|```)/
// list, quote and emphasis marks around the words
const MARKS = /^[\s>*-]+|\*\*|__|`/g
// a sentence ends at . ! or ? before a space or the line's end (so "api.ts" ends nothing)
const SENTENCE = /^.*?[.!?](?=\s|$)/

/** What a bubble says: the first sentence of the first line that says something, secrets masked, at most BUBBLE_MAX columns. */
export function bubbleText(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const line = raw.split('\n').find(l => l.trim() !== '' && !HEADING.test(l))?.replace(MARKS, '').trim() ?? ''
  return cleanSaying(line.match(SENTENCE)?.[0] ?? line, BUBBLE_MAX)
}

/** Where a message from `from` to `to` shows: on the member's card, or between members on the sender's; null for none. */
export function placeTalk(from: string, to: string): Pick<HqBubble, 'agent' | 'other' | 'dir'> | null {
  if (from === to) return null
  return from === MAIN ? { agent: to, other: MAIN, dir: 'from' } : { agent: from, other: to, dir: 'to' }
}

// what SendMessage calls the lead: "main", or "team-lead" among teammates; "user" is the person, whose talk is not the team's
const LEAD_NAMES = new Set([MAIN, 'team-lead'])
const PERSON = 'user'

/** The agent a SendMessage recipient names (the lead, a name as listed, or an id), or null for none here (the person, another session). */
export function recipientOf(to: string, agents: Record<string, HqAgent>): string | null {
  const listed = to.replace(/\s*\[[^\]]*\]$/, '') // a listing's " [ref]"
  if (agents[listed]) return listed // an id (a teammate's is its address)
  const name = listed.replace(/@[^@\s]+$/, '') // a teammate address, <name>@<team>
  if (LEAD_NAMES.has(name)) return MAIN
  if (name === PERSON) return null
  if (agents[name]) return name
  return Object.values(agents).find(a => a.id !== MAIN && a.name === name)?.id ?? null
}

/** The bubbles with this one added: it replaces the one on its card, and the oldest go past BUBBLES_MAX. */
export function addBubble(all: readonly HqBubble[], bubble: HqBubble): HqBubble[] {
  return [...all.filter(b => b.agent !== bubble.agent), bubble].slice(-BUBBLES_MAX)
}

/** The bubbles still showing at `at`; the same list when none ended. */
export function liveBubbles(all: readonly HqBubble[], at: number): readonly HqBubble[] {
  const kept = all.filter(b => at - b.at < BUBBLE_MS)
  return kept.length === all.length ? all : kept
}

/** "→ Sam: can you check?" / "← Lead: fix the old API": the other party by nickname, the lead by its word; the words cut to `room`. */
export function talkLine(bubble: HqBubble, agents: Record<string, HqAgent>, lang: Lang, room?: number): string {
  const other = agents[bubble.other]
  const who = bubble.other === MAIN ? t(lang, 'talk.lead') : other ? (other.nickname ?? other.name) : bubble.other
  const words = `${who}: ${bubble.text}`
  return `${bubble.dir === 'to' ? '→' : '←'} ${room === undefined ? words : fitText(words, Math.max(1, room - 2))}`
}
