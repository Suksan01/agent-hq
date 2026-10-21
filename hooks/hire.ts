// Taking on staff: raising a role's headcount, or adding a role, in the team file's own text. Pure: the file's text and
// the lead's request in, the new text (checked by parseTeam) or the reason it cannot be done out.

import { MAX_COUNT, MAX_ROLES, parseTeam } from './team'
import { t } from './i18n'
import type { Lang } from './i18n'

export type HirePlan =
  | { ok: true; source: string; roleId: string; title: string; before: number; after: number; hired: number; created: boolean; capped: boolean; roster: string; card: string }
  | { ok: false; error: string }

const ID = /^[A-Za-z0-9_-]{1,48}$/
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// read against the id too: a title may be in Thai (ผู้ตรวจ is an inspector), the id stays ASCII
const READ_ONLY_TITLE = /review|audit|inspect|ตรวจ|รีวิว/i
const LIST_FIELDS = ['tasks', 'rules', 'skills', 'tools'] as const
const TEXT_FIELDS = ['model', 'effort', 'playbook'] as const
const CARD_FIELDS = [...LIST_FIELDS, ...TEXT_FIELDS]
const strings = (v: unknown) => (Array.isArray(v) ? v.flatMap(x => (typeof x === 'string' && x.trim() !== '' ? [x.trim()] : [])) : [])
// a playbook is a file the role is told to read and follow at every start (rolePrompt), so only a Markdown file by full path
const PLAYBOOK = /^(\/|[A-Za-z]:[\\/]).*\.md$/i

/** The role card fields a new role was given: lists without blanks or non-strings, texts trimmed, empty ones left out. */
function cardOf(input: Record<string, unknown>): Record<string, string | string[]> {
  const lists = LIST_FIELDS.flatMap(f => (strings(input[f]).length > 0 ? [[f, strings(input[f])] as const] : []))
  const texts = TEXT_FIELDS.flatMap(f => (typeof input[f] === 'string' && input[f].trim() !== '' ? [[f, input[f].trim()] as const] : []))
  return Object.fromEntries([...lists, ...texts])
}

/** One line for the person's confirmation: what the new role was given. */
function describeCard(role: Record<string, unknown>, lang: Lang): string {
  const list = (f: string) => strings(role[f])
  const tasks = list('tasks').length
  const rules = list('rules').length
  return [
    tasks > 0 ? t(lang, tasks === 1 ? 'card.task' : 'card.tasks', { n: tasks }) : '',
    rules > 0 ? t(lang, rules === 1 ? 'card.rule' : 'card.rules', { n: rules }) : '',
    list('skills').length > 0 ? t(lang, 'card.skills', { list: list('skills').join(', ') }) : '',
    list('tools').length > 0 ? t(lang, 'card.tools', { list: list('tools').join(', ') }) : '',
    typeof role.model === 'string' ? t(lang, 'card.model', { value: role.model }) : '',
    typeof role.effort === 'string' ? t(lang, 'card.effort', { value: role.effort }) : '',
    typeof role.playbook === 'string' ? t(lang, 'card.playbook', { value: role.playbook }) : '',
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * `input` is hq_hire's `{ role, add?, title?, mission?, tasks?, rules?, skills?, tools?, model?, effort?, playbook? }`.
 * An existing role's count rises by `add` (default 1) up to the team's limit of 10 per role; a role that does not exist
 * is created (title and mission needed, at most 12 roles) with the role card it was given, and a reviewer-like title or id
 * makes it read-only. Everything else in the file is kept as it is.
 */
export function planHire(source: string, input: unknown, lang: Lang = 'en'): HirePlan {
  if (!isRecord(input)) return { ok: false, error: 'needs an object like { role, add }' }
  const id = typeof input.role === 'string' ? input.role.trim() : ''
  if (!ID.test(id)) return { ok: false, error: 'give the "role" to add staff to: its id (letters, digits, _ or -)' }
  const add = input.add === undefined || input.add === null ? 1 : input.add
  if (typeof add !== 'number' || !Number.isInteger(add) || add < 1 || add > MAX_COUNT) return { ok: false, error: `"add" must be a whole number from 1 to ${MAX_COUNT}` }

  const current = parseTeam(source)
  if (typeof current === 'string') return { ok: false, error: `the team file is not usable (${current})` }
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return { ok: false, error: 'the team file is not valid JSON' }
  }
  if (!isRecord(raw) || !Array.isArray(raw.roles)) return { ok: false, error: 'the team file has no roles list' }

  const known = current.roles.find(r => r.id === id)
  let roles: unknown[]
  let before = 0
  let after: number
  if (known) {
    // an existing role's card belongs to the team file and the person: a hire only changes its headcount
    if (CARD_FIELDS.some(f => input[f] !== undefined)) return { ok: false, error: `the role "${id}" already exists, so only "add" applies; change its tasks, rules, skills or model with /agent-hq:team` }
    before = known.count
    if (before >= MAX_COUNT) return { ok: false, error: `${known.title} is already at the limit of ${MAX_COUNT} on staff` }
    after = Math.min(MAX_COUNT, before + add)
    roles = raw.roles.map(r => (isRecord(r) && String(r.id).trim() === id ? { ...r, count: after } : r))
  } else {
    if (current.roles.length >= MAX_ROLES) return { ok: false, error: `the team already has ${MAX_ROLES} roles, the most a team can have` }
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const mission = typeof input.mission === 'string' ? input.mission.trim() : ''
    if (!title || !mission) return { ok: false, error: `there is no role "${id}" yet: to create it give its "title" and "mission" too (roles now: ${current.roles.map(r => r.id).join(', ')})` }
    after = add
    const readOnly = READ_ONLY_TITLE.test(title) || READ_ONLY_TITLE.test(id)
    const card = cardOf(input)
    if (typeof card.playbook === 'string' && !PLAYBOOK.test(card.playbook)) return { ok: false, error: `"playbook" must be the absolute path of a Markdown file the role reads and follows (got "${card.playbook.slice(0, 80)}")` }
    const rules = [...(readOnly ? ['Do not edit files; report findings only.'] : []), ...((card.rules as string[] | undefined) ?? [])]
    roles = [
      ...raw.roles,
      { id, title, count: add, mission, tasks: [], skills: [], ...card, rules, ...(readOnly ? { guard: { readOnly: true } } : {}) },
    ]
  }

  const next = `${JSON.stringify({ ...raw, roles }, null, 2)}\n`
  const checked = parseTeam(next)
  if (typeof checked === 'string') return { ok: false, error: `that would make the team file invalid (${checked})` }
  const role = checked.roles.find(r => r.id === id)
  return {
    ok: true,
    source: next,
    roleId: id,
    title: role?.title ?? id,
    before,
    after: role?.count ?? after,
    hired: (role?.count ?? after) - before,
    created: !known,
    capped: known !== undefined && before + add > MAX_COUNT,
    roster: checked.roles.map(r => `${r.title} x${r.count}`).join(', '),
    card: known ? '' : describeCard(roles.at(-1) as Record<string, unknown>, lang),
  }
}
