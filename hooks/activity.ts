// What each agent is doing right now: a short, safe line for the tool call it is in ("Editing view.tsx", "Running npm
// test"), set when the call starts and marked when it ends. Never a full path, never more than a command's first words.

import type { HqActivity, HqAgent } from '../types'
import { PLAN_TOOL, isFinished } from './model'

const ARG_MAX = 24 // a pattern, a command's words, a name: cut to this
const TEXT_MAX = 48 // the whole line

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)
const arg = (v: unknown) => (typeof v === 'string' ? cut(oneLine(v), ARG_MAX) : '')
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

const withArg = (verb: string, what: string, fallback: string) => (what ? `${verb} ${what}` : fallback)

/** The line for a tool call as it starts, from the tool's name and input (read untrusted). */
export function describeCall(tool: string, input: Record<string, unknown>): string {
  const text = (() => {
    switch (tool) {
      case 'Edit':
      case 'MultiEdit':
        return withArg('Editing', cut(baseName(input.file_path), ARG_MAX), 'Editing a file')
      case 'NotebookEdit':
        return withArg('Editing', cut(baseName(input.notebook_path), ARG_MAX), 'Editing a notebook')
      case 'Write':
        return withArg('Writing', cut(baseName(input.file_path), ARG_MAX), 'Writing a file')
      case 'Read':
        return withArg('Reading', cut(baseName(input.file_path), ARG_MAX), 'Reading a file')
      case 'Grep':
      case 'Glob':
        return withArg('Searching for', arg(input.pattern), 'Searching')
      case 'Bash':
        return withArg('Running', commandWords(input.command), 'Running a command')
      case 'Agent':
      case 'Task':
        return withArg('Starting', arg(input.name) || arg(input.subagent_type) || arg(input.description), 'Starting an agent')
      case 'WebFetch':
        return withArg('Reading', cut(hostOf(input.url), ARG_MAX), 'Reading a web page')
      case 'TodoWrite':
      case PLAN_TOOL:
        return 'Planning'
      case 'SendMessage':
        return withArg('Messaging', arg(input.to), 'Sending a message')
    }
    const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
    if (mcp) return `Using ${cut(mcp[1] ?? '', ARG_MAX)} ${cut(mcp[2] ?? '', ARG_MAX)}`
    return `Using ${cut(tool, ARG_MAX)}`
  })()
  return cut(text, TEXT_MAX)
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
