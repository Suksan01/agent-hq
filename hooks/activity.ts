// What each agent is doing right now: a short, safe line for the tool call it is in ("Editing view.tsx", "Running npm
// test"), set when the call starts and marked when it ends. Never a full path, never more than a command's first words.

import type { HqActivity, HqAgent } from '../types'
import { PLAN_TOOL, isFinished } from './model'
import { headOf } from './cells'
import { maskSecrets } from './secrets'
import { t } from './i18n'
import type { Key, Lang } from './i18n'

const ARG_MAX = 24 // a pattern, a command's words, a name: cut to this
const TEXT_MAX = 48 // the whole line

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const cut = (s: string, max: number) => (s.length > max ? `${headOf(s, max - 1).trimEnd()}…` : s)
// masked before it is cut, so no part of a long key shows
const arg = (v: unknown) => (typeof v === 'string' ? cut(maskSecrets(oneLine(v)), ARG_MAX) : '')
export const baseName = (v: unknown) => (typeof v === 'string' ? (v.split(/[\\/]/).filter(Boolean).at(-1) ?? '') : '')

// a command word worth showing: plain letters, digits, dots and dashes, never a flag, a path, a URL or an assignment
const PLAIN_WORD = /^[A-Za-z0-9][\w.-]*$/

// tools whose second word is a subcommand (`git push`), not an argument: for any other command (`echo ghp_…`) only its name is shown
const SUBCOMMAND_TOOLS = new Set(['git', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'cargo', 'go', 'docker', 'kubectl', 'gh', 'make', 'claude', 'pip', 'uv', 'deno'])

/** A command's name, and its subcommand for a tool that has them: `npm test`, `git status`, `curl`; never flags, values or anything after. */
export function commandWords(command: unknown): string {
  if (typeof command !== 'string') return ''
  const words = oneLine(command)
    .split(' ')
    .filter(w => w !== '')
  const start = words.findIndex(w => !/^\w+=/.test(w)) // `TOKEN=… cmd`: the assignment is not shown
  if (start < 0) return ''
  const rest = words.slice(start)
  const first = baseName(rest[0]?.replace(/^["']|["']$/g, ''))
  if (!first || !PLAIN_WORD.test(first)) return ''
  const second = SUBCOMMAND_TOOLS.has(first) && rest[1] && PLAIN_WORD.test(rest[1]) ? ` ${rest[1]}` : ''
  return cut(`${first}${second}`, ARG_MAX)
}

export function hostOf(url: unknown): string {
  try {
    return typeof url === 'string' ? new URL(url).host : ''
  } catch {
    return ''
  }
}

/** Its words with `what` when the call names something, else the fallback's. */
const withArg = (lang: Lang, key: Key, what: string, fallback: Key) => (what ? t(lang, key, { what }) : t(lang, fallback))

/** The line for a tool call as it starts, from the tool's name and input (read untrusted). */
export function describeCall(tool: string, input: Record<string, unknown>, lang: Lang = 'en'): string {
  const text = (() => {
    switch (tool) {
      case 'Edit':
      case 'MultiEdit':
        return withArg(lang, 'call.editing', cut(baseName(input.file_path), ARG_MAX), 'call.editingFile')
      case 'NotebookEdit':
        return withArg(lang, 'call.editing', cut(baseName(input.notebook_path), ARG_MAX), 'call.editingNotebook')
      case 'Write':
        return withArg(lang, 'call.writing', cut(baseName(input.file_path), ARG_MAX), 'call.writingFile')
      case 'Read':
        return withArg(lang, 'call.reading', cut(baseName(input.file_path), ARG_MAX), 'call.readingFile')
      case 'Grep':
      case 'Glob':
        return withArg(lang, 'call.searchingFor', arg(input.pattern), 'call.searching')
      case 'Bash':
        return withArg(lang, 'call.running', commandWords(input.command), 'call.runningCommand')
      case 'Agent':
      case 'Task':
        return withArg(lang, 'call.starting', arg(input.name) || arg(input.subagent_type) || arg(input.description), 'call.startingAgent')
      case 'WebFetch':
        return withArg(lang, 'call.reading', cut(hostOf(input.url), ARG_MAX), 'call.readingPage')
      case 'TodoWrite':
      case PLAN_TOOL:
        return t(lang, 'call.planning')
      case 'SendMessage':
        return withArg(lang, 'call.messaging', arg(input.to), 'call.sendingMessage')
    }
    const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
    if (mcp) return t(lang, 'call.using', { what: `${cut(mcp[1] ?? '', ARG_MAX)} ${cut(mcp[2] ?? '', ARG_MAX)}` })
    return t(lang, 'call.using', { what: cut(tool, ARG_MAX) })
  })()
  return cut(maskSecrets(text), TEXT_MAX) // a pattern or a start's name is the model's words: no secret on the live line
}

export type Activities = Record<string, HqActivity>

/** The agent is in this call now. */
export const startActivity = (all: Activities, agent: string, activity: HqActivity): Activities => ({ ...all, [agent]: activity })

/** The call ended: marked, unless a later call of the same agent took its place already. */
export function endActivity(all: Activities, agent: string, callId: string, at: number): Activities {
  const current = all[agent]
  return current?.callId === callId ? { ...all, [agent]: { ...current, endedAt: at } } : all
}

/** Activities of agents still at work: a finished agent's (or one cleared away) is dropped. */
export function liveActivities(all: Activities, agents: Record<string, HqAgent>): Activities {
  return Object.fromEntries(Object.entries(all).filter(([id]) => agents[id] !== undefined && !isFinished(agents[id].status)))
}

/** Whether any agent still at work (the lead included) is inside a call: the clock ticks for its live line only then. */
export const hasRunningCall = (all: Activities, agents: Record<string, HqAgent>) => Object.values(liveActivities(all, agents)).some(a => a.endedAt === undefined)

/** The activity a call is in right now, or undefined between calls. */
export const currentActivity = (all: Activities | undefined, agent: string): HqActivity | undefined => {
  const a = all?.[agent]
  return a && a.endedAt === undefined ? a : undefined
}
