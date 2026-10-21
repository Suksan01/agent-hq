// The two ways the live page's server talks to the mod, and nothing else: its stdout lines (read here) and the live
// state file (written here). `AGENT_HQ_URL <url>` says where the page is; `AGENT_HQ_PAGES <n>` (from `--login`) how many
// pages are open; `AGENT_HQ_ACTION <json>` carries one request the page made, until the mod acknowledges it with
// `lastAction` in the state file (see web/server.mjs).

import type { PageAction } from './actions'

export const URL_PREFIX = 'AGENT_HQ_URL '
export const PAGES_PREFIX = 'AGENT_HQ_PAGES '
export const ACTION_PREFIX = 'AGENT_HQ_ACTION '
const MAX_PENDING_LINE = 64 * 1024 // a "line" with no end this long is not the server's; drop it

export type ChannelLine = { kind: 'url'; url: string } | { kind: 'pages'; count: number } | { kind: 'action'; action: PageAction & { id: number } }

/** Pieces of a stream in, whole lines out: a line may span two pieces and one piece may hold several. */
export function lineBuffer() {
  let rest = ''
  return {
    push(text: string): string[] {
      const parts = (rest + text).split('\n')
      rest = (parts.pop() ?? '').slice(0, MAX_PENDING_LINE)
      return parts.map(line => line.replace(/\r$/, ''))
    },
  }
}

/** What one stdout line of the server means to the mod, or null for any other line (logs, noise, a bad action). */
export function parseChannelLine(line: string): ChannelLine | null {
  if (line.startsWith(URL_PREFIX)) {
    const url = line.slice(URL_PREFIX.length).trim()
    return /^\S+$/.test(url) ? { kind: 'url', url } : null
  }
  if (line.startsWith(PAGES_PREFIX)) {
    const count = line.slice(PAGES_PREFIX.length).trim()
    return /^\d{1,6}$/.test(count) ? { kind: 'pages', count: Number(count) } : null
  }
  if (!line.startsWith(ACTION_PREFIX)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(line.slice(ACTION_PREFIX.length))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const id = (parsed as { id?: unknown }).id
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return null
  return { kind: 'action', action: { ...(parsed as PageAction), id } }
}
