// The saved task list of the approved plan (docs/specs/task-sidebar.md "Data"): `.claude/agent-hq/tasks.json` in the project.
// Written by the lead's hooks only (the guard keeps members out). Pure functions take no engine; file I/O takes `$`.

import type { EngineInterface } from 'claude-code'

import { headOf } from './cells'
import { maskSecrets } from './secrets'

export const LIST_VERSION = 1
const MAX_TITLE = 200 // a title is untrusted text from the plan file

export type TaskStatus = 'waiting' | 'working' | 'review' | 'done'
const STATUSES: readonly string[] = ['waiting', 'working', 'review', 'done']

export type TaskWork = { role: string; step: string; workMs: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; model: string | null; /** The time of the member's latest turn on this task, whatever it counted (a turn with no time or tokens still stamps it); null for a member just linked, and for a file saved before this field. */ lastAt: number | null }
/** Work was counted for a member: time, or any token of any kind. Nothing counted is a member just linked, not an unpriced one. */
export const isCounted = (w: Pick<TaskWork, 'workMs' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>) => w.workMs > 0 || w.inputTokens + w.outputTokens + w.cacheReadTokens + w.cacheWriteTokens > 0

export type TaskEvent = { at: number; kind: string; who: string | null }
export type ListTask = { n: number; title: string; status: TaskStatus; doneBy: string | null; startedAt: number | null; doneAt: number | null; work: Record<string, TaskWork>; events: TaskEvent[] }
export type TaskList = { version: 1; plan: string; approvedAt: number; tasks: ListTask[]; removed: { workMs: number; costUsd: number; isPartial?: boolean } }
export type PlanTask = { n: number; title: string; done: boolean }

// `- [ ] 3. Title` or `- [x] 3. Title`: nothing else in a plan is a task (sub-bullets are indented, prose has no box)
const CHECKLIST_LINE = /^- \[( |x|X)\] (\d{1,6})\.\s+(.+?)\s*$/
// a title is shown in a terminal: a control character in it could move the cursor or paint over other lines
const CONTROL = /[\x00-\x1f\x7f]/g

/** The tasks a plan's checklist lines name, in plan order, the first line of a number winning; a plan with none gives []. */
export function parsePlan(text: string): PlanTask[] {
  const seen = new Set<number>()
  return text.split(/\r?\n/).flatMap(line => {
    const m = CHECKLIST_LINE.exec(line)
    const n = Number(m?.[2])
    if (!m || seen.has(n)) return []
    seen.add(n)
    const masked = maskSecrets((m[3] ?? '').replace(CONTROL, ' ')) // masked first, so a cut never leaves half a secret
    const title = masked.length > MAX_TITLE ? `${headOf(masked, MAX_TITLE - 1).trimEnd()}…` : masked
    return [{ n, title, done: m[1] !== ' ' }]
  })
}

// a member who reviewed or tested a task did not build it: judged by its role and by the step it worked in
const NOT_BUILDER = /review|qa/i
const isBuilder = (w: TaskWork) => !NOT_BUILDER.test(w.role) && w.step !== 'review' && w.step !== 'tests'

/**
 * `list` with every task whose box is now ticked in `parsed` set done (at `at`, by the last member linked to it that is
 * neither a reviewer nor QA (by role and step), else the last one that built or fixed it, else the last one linked). A task already done stays as it is, and an unticked box undoes nothing.
 */
export function applyPlanTicks(list: TaskList, parsed: PlanTask[], at: number): TaskList {
  const ticked = new Set(parsed.filter(p => p.done).map(p => p.n))
  const tasks = list.tasks.map(x => {
    if (!ticked.has(x.n) || x.status === 'done') return x
    const linked = Object.entries(x.work)
    // no builder by role: whoever last built or fixed it whatever their role (a QA member may have built it), else the last linked
    const builder = linked.filter(([, w]) => isBuilder(w)).at(-1) ?? linked.filter(([, w]) => w.step === 'build' || w.step === 'fix').at(-1) ?? linked.at(-1)
    return { ...x, status: 'done' as const, doneAt: at, doneBy: builder?.[0] ?? null }
  })
  return { ...list, tasks }
}

export type MergeOptions = {
  /** The plan file the list stands for, and when it was approved. */
  plan: string
  approvedAt: number
  now: number
  /** The dollars of one work entry (prices.ts costOf), null when its model has no price. */
  price: (work: TaskWork) => number | null
}

/**
 * The list for a re-planned `parsed`: a number already in `old` keeps its work, a new one starts waiting, a ticked box makes
 * a task done (applyPlanTicks), a dropped number's time and cost move into `removed` (partial when a price was unknown).
 */
export function mergeList(old: TaskList | null, parsed: PlanTask[], options: MergeOptions): TaskList {
  const kept = new Map((old?.tasks ?? []).map(t => [t.n, t]))
  const now = new Set(parsed.map(p => p.n))
  const dropped = (old?.tasks ?? []).filter(t => !now.has(t.n)).flatMap(t => Object.values(t.work))
  const unpriced = dropped.some(w => isCounted(w) && options.price(w) === null)
  const isPartial = old?.removed.isPartial === true || unpriced
  const merged: TaskList = {
    version: LIST_VERSION,
    plan: options.plan,
    approvedAt: options.approvedAt,
    tasks: parsed.map(p => {
      const was = kept.get(p.n)
      return was ? { ...was, title: p.title } : { n: p.n, title: p.title, status: 'waiting', doneBy: null, startedAt: null, doneAt: null, work: {}, events: [] }
    }),
    removed: {
      workMs: (old?.removed.workMs ?? 0) + dropped.reduce((s, w) => s + w.workMs, 0),
      costUsd: (old?.removed.costUsd ?? 0) + dropped.reduce((s, w) => s + (options.price(w) ?? 0), 0),
      ...(isPartial ? { isPartial } : {}),
    },
  }
  return applyPlanTicks(merged, parsed, options.now)
}

// ---------- reading and writing: a file nobody can trust is "no list" with a reason ----------

type Raw = Record<string, unknown>
const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const isStamp = (v: unknown) => v === null || typeof v === 'number'
const isNameOrNull = (v: unknown) => v === null || typeof v === 'string'

/** What is wrong with a work entry, or undefined. */
function workFault(w: unknown): string | undefined {
  if (!isRaw(w)) return 'is not an object'
  if (typeof w.role !== 'string' || typeof w.step !== 'string') return 'needs a role and a step'
  if (![w.workMs, w.inputTokens, w.outputTokens, w.cacheReadTokens, w.cacheWriteTokens].every(isCount)) return 'has a time or token count that is not a number of 0 or more'
  if (w.lastAt !== undefined && !isStamp(w.lastAt)) return 'has a lastAt that is not a time or null' // missing: a file saved before the field
  return isNameOrNull(w.model) ? undefined : 'has a model that is not text'
}

/** What is wrong with a task, or undefined. */
function taskFault(t: unknown): string | undefined {
  if (!isRaw(t)) return 'is not an object'
  if (typeof t.n !== 'number' || !Number.isSafeInteger(t.n) || t.n < 1) return 'has no whole number "n" of 1 or more'
  if (typeof t.title !== 'string') return 'has no title'
  if (typeof t.status !== 'string' || !STATUSES.includes(t.status)) return 'has an unknown status'
  if (!isNameOrNull(t.doneBy) || !isStamp(t.startedAt) || !isStamp(t.doneAt)) return 'has a bad doneBy, startedAt or doneAt'
  if (!isRaw(t.work)) return 'has no "work" object'
  for (const [who, w] of Object.entries(t.work)) {
    const fault = workFault(w)
    if (fault) return `has work by ${who} that ${fault}`
  }
  const isEvent = (e: unknown) => isRaw(e) && typeof e.at === 'number' && typeof e.kind === 'string' && isNameOrNull(e.who)
  return Array.isArray(t.events) && t.events.every(isEvent) ? undefined : 'has bad "events"'
}

/** The list in a file's text, or the reason it is not one. */
export function parseList(source: string): { list: TaskList; reason?: undefined } | { list: null; reason: string } {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch (error) {
    return { list: null, reason: `not valid JSON (${error instanceof Error ? error.message : 'parse error'})` }
  }
  if (!isRaw(raw)) return { list: null, reason: 'the file must hold one JSON object' }
  if (raw.version !== LIST_VERSION) return { list: null, reason: `unknown version ${JSON.stringify(raw.version) ?? 'none'}: this reads version ${LIST_VERSION}` }
  if (typeof raw.plan !== 'string' || typeof raw.approvedAt !== 'number') return { list: null, reason: 'needs a "plan" path and an "approvedAt" time' }
  if (!isRaw(raw.removed) || !isCount(raw.removed.workMs) || !isCount(raw.removed.costUsd) || (raw.removed.isPartial !== undefined && typeof raw.removed.isPartial !== 'boolean')) return { list: null, reason: '"removed" needs workMs and costUsd of 0 or more' }
  if (!Array.isArray(raw.tasks)) return { list: null, reason: '"tasks" must be a list' }
  const numbers = new Set<number>()
  for (const [i, t] of raw.tasks.entries()) {
    const fault = taskFault(t)
    if (fault) return { list: null, reason: `task ${i + 1} ${fault}` }
    const n = (t as ListTask).n
    if (numbers.has(n)) return { list: null, reason: `task number ${n} appears twice` }
    numbers.add(n)
  }
  const tasks = (raw.tasks as ListTask[]).map(t => ({ ...t, work: Object.fromEntries(Object.entries(t.work).map(([who, w]) => [who, { ...w, lastAt: w.lastAt ?? null }])) }))
  return { list: { ...(raw as unknown as TaskList), tasks } }
}

const MISSING = /ENOENT|no such file|not found/i
const backupOf = (path: string) => `${path}.bak`

/** The file's text, null when it is not there (the normal state before a plan is saved); throws what else goes wrong. */
async function readFile($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch (error) {
    if (error instanceof Error && MISSING.test(error.message) && !(await $.fs.exists(path).catch(() => true))) return null
    throw error
  }
}

/** Why there is no list: no file yet (the normal state), a file that is not a list, or a file that could not be read. */
export type ReadKind = 'missing' | 'invalid' | 'unreadable'
export type ReadResult = { list: TaskList | null; kind?: ReadKind; reason?: string }

/**
 * The saved list. No list comes with its `kind`: `missing` (no reason), `invalid` (with a reason; the backup the last write
 * left is shown instead when it is good, with the same kind and reason) or `unreadable` (with a reason). Never throws.
 */
export async function readList($: EngineInterface, path: string): Promise<ReadResult> {
  try {
    const text = await readFile($, path)
    if (text === null) return { list: null, kind: 'missing' }
    const read = parseList(text)
    if (read.list) return read
    const backup = await readFile($, backupOf(path)) // a backup that is there but unreadable throws: unreadable, so nothing rewrites over its totals
    const saved = backup === null ? null : parseList(backup).list
    const reason = saved ? `${read.reason}; showing the backup of the last good list` : read.reason
    return { list: saved, kind: 'invalid', reason }
  } catch (error) {
    return { list: null, kind: 'unreadable', reason: `could not read ${path}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Saves `list` whole in one call (the engine has no rename). The last good file is copied to `.bak` first, so a write cut short
 * costs nothing: readList then shows the backup, and the next hq_plan rewrites the file.
 */
export async function writeList($: EngineInterface, path: string, list: TaskList): Promise<void> {
  const current = await readFile($, path).catch(() => null)
  if (current !== null && parseList(current).list) await $.fs.write(backupOf(path), current)
  await $.fs.write(path, `${JSON.stringify(list, null, 2)}\n`)
}
