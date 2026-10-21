// Next-task suggestions on the live page: after each of the lead's answered turns a fork of the session drafts a short
// recap and up to three tasks the person could send the lead next. Pure: what the fork is asked, and what of its reply
// may reach the page; register.tsx forks and keeps the `suggestions` atom. The reply comes from a model that read
// untrusted text, so each line is cut to one line, stripped of control characters, masked and capped.

import { cleanSaying } from './says'
import type { Lang } from './i18n'

export const NEXT_COUNT = 3 // tasks at most
export const NEXT_MAX = 120 // characters per task
export const RECAP_MAX = 240 // characters for the recap ("at most 2 short sentences")

const LANGUAGE_NAME: Record<Lang, string> = { en: 'English', th: 'Thai' }

/** The one message the fork answers. */
export function suggestPrompt(lang: Lang): string {
  return [
    'Do not continue the task and do not use any tool. Look at where this conversation stands now and suggest what the person could ask you to do next.',
    'Answer with ONLY a JSON object, no prose and no code fence:',
    '{"recap": "<at most 2 short sentences: where the work stands>", "next": ["<task>", "<task>", "<task>"]}',
    `"next" holds up to ${NEXT_COUNT} tasks, the most useful first. Each is one instruction the person could send you as their next message, specific to this conversation (name the file, test or follow-up), at most ${NEXT_MAX} characters. Leave "next" empty when the work is finished or nothing useful comes to mind.`,
    `Write the recap and the tasks in ${LANGUAGE_NAME[lang]}; code words, file names and commands stay as they are.`,
  ].join('\n')
}

// terminal escape sequences, then every control and format character (bidi overrides, zero-width marks) left after
// whitespace was folded to spaces
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const UNSEEN = /[\p{Cc}\p{Cf}]/gu

/** One line of the reply as the page may show it: one line, unseen characters gone, secrets masked, cut to `max`. */
const cleanLine = (raw: unknown, max: number): string =>
  typeof raw === 'string' ? cleanSaying(raw.replace(ESCAPES, '').replace(/\s+/g, ' ').replace(UNSEEN, ''), max) : ''

/** The recap and tasks in the fork's reply, or null when it holds no JSON object with either. */
export function parseSuggestions(reply: string): { recap: string | null; items: string[] } | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const { recap, next } = parsed as { recap?: unknown; next?: unknown }
  const cleaned = (Array.isArray(next) ? next : []).map(item => cleanLine(item, NEXT_MAX)).filter(item => item !== '')
  // the first of each, whatever its case
  const items = cleaned.filter((item, i) => cleaned.findIndex(other => other.toLowerCase() === item.toLowerCase()) === i).slice(0, NEXT_COUNT)
  const said = cleanLine(recap, RECAP_MAX)
  if (said === '' && items.length === 0) return null
  return { recap: said === '' ? null : said, items }
}
