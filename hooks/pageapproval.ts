// Page approvals (/hq web approvals on): a permission ask the engine would put in its dialog is first offered on the
// live page, and tool.check waits while web/approve.mjs waits for the person's answer there (at most a minute). Pure:
// when an ask may be held, the request the helper reads on stdin, and what its answer means; register.tsx holds.
// Only an `ask` is ever held, and only the person's own Allow or Deny on the page changes it.

import { maskSecrets } from './secrets'
import type { Lang } from './i18n'

export const APPROVAL_MS = 60_000 // how long the page offers the card
export const LINK_NOTICE_MS = 60_000 // a login link's notice: the longest a toast may stay (the link works two minutes)
export const HELPER_TIMEOUT_MS = 65_000 // the helper is killed past this: its own wait and a margin
export const INPUT_MAX_BYTES = 20 * 1024 // a larger input is not shown in full on a card: the dialog asks
export const ALLOWED = 'Allowed by the person on the Agent HQ live page'
export const DENIED = 'Denied by the person on the Agent HQ live page'

// the modes whose ask is the person's to answer; in auto, plan, dontAsk and bypassPermissions the mode decides
const HOLDABLE_MODES: ReadonlySet<string> = new Set(['default', 'acceptEdits'])
// a hook only tightens these: the person answers them in the engine's own dialog, whatever the page says
const PERSON_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** What decides whether an ask is held: the verdict, the setting, open pages, the call, its loop's mode, its input. */
export type HoldFacts = {
  decision: string
  /** Who answers the ask where it is not a dialog here (`host`: an SDK or -p permission callback, a served call). */
  decider?: string
  isOn: boolean
  /** Pages open on the hub; 0 when this session's page server is not running. */
  pages: number
  toolUseId?: string
  tool: string
  /** The organization's ceiling on the tool: any keeps the call off the page. */
  ceiling?: string
  /** The permission mode last seen for the call's loop; undefined when never seen. */
  mode?: string
  input: unknown
  /** Why the engine asked, as the card shows it (masked): counted in the size cap. */
  reason?: string
}

export function canHold(f: HoldFacts): boolean {
  return (
    f.decision === 'ask' &&
    f.decider === undefined &&
    f.isOn &&
    f.pages > 0 &&
    Boolean(f.toolUseId) &&
    !PERSON_TOOLS.has(f.tool) &&
    f.ceiling === undefined &&
    f.mode !== undefined &&
    HOLDABLE_MODES.has(f.mode) &&
    isShowable(f.input, f.reason)
  )
}

function utf8Bytes(text: string): number {
  let bytes = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

/** Can the card show this input whole and safely: JSON with nothing that reads as a secret, at most 20 KB with `reason`. */
export function isShowable(input: unknown, reason = ''): boolean {
  let json: string | undefined
  try {
    json = JSON.stringify(input)
  } catch {
    return false // a cycle, a BigInt: nothing the card could show
  }
  // the size first: masking a huge input costs more than refusing it
  return json !== undefined && utf8Bytes(json) + utf8Bytes(reason) <= INPUT_MAX_BYTES && maskSecrets(json) === json
}

export type Answer = 'allow' | 'deny' | 'ask'

/** The helper's answer, its stdout's first line; null for anything else. */
export function answerOf(stdout: string): Answer | null {
  const line = stdout.split('\n')[0]?.trim()
  return line === 'allow' || line === 'deny' || line === 'ask' ? line : null
}

/** The request web/approve.mjs reads on stdin. */
export function approvalRequest(r: {
  id: string
  agent: string
  role: string | null
  tool: string
  input: unknown
  /** Why the engine asked (masked), and the setting or classic hook behind the ask; null when it named none. */
  reason: string | null
  setting: string | null
  hook: string | null
  cwd: string
  lang: Lang
  at: number
}): string {
  return JSON.stringify({ ...r, timeoutMs: APPROVAL_MS })
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
