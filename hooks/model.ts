import type { HqAgent, HqStatus, HqTask, HqTaskStatus, HqTodo } from '../types'
import { SPECIES } from './cells'

export const MAIN = 'main'
const FINISHED: readonly HqStatus[] = ['completed', 'failed', 'killed']

export type ListedAgent = {
  id: string
  name?: string
  type: string
  description: string
  status: HqStatus
  parentId?: string
}

export const isFinished = (status: HqStatus) => FINISHED.includes(status)

export const mainAgent = (now: number): HqAgent => ({
  id: MAIN,
  name: 'main',
  role: 'orchestrator',
  description: 'Lead session',
  status: 'running',
  startedAt: now,
  tools: 0,
})

/** Folds `$.agent.list()` into the rows, keeping tool stats and timings. Agents that left the list stay, marked done. */
export function mergeAgents(
  rows: Record<string, HqAgent>,
  listed: readonly ListedAgent[],
  now: number,
): Record<string, HqAgent> {
  const seen = new Set(listed.map(a => a.id))
  const next: Record<string, HqAgent> = { [MAIN]: rows[MAIN] ?? mainAgent(now) }

  for (const [id, row] of Object.entries(rows)) {
    if (id === MAIN || seen.has(id)) continue
    next[id] = isFinished(row.status) ? row : { ...row, status: 'completed', endedAt: row.endedAt ?? now }
  }

  for (const a of listed) {
    const old = rows[a.id]
    const finished = isFinished(a.status)
    const mascot = old?.mascot ?? pickMascot({ ...rows, ...next }, a.id)
    next[a.id] = {
      id: a.id,
      name: a.name ?? old?.name ?? shortName(a.description, a.type),
      role: a.type,
      description: a.description,
      status: a.status,
      parentId: a.parentId,
      startedAt: old?.startedAt ?? now,
      endedAt: finished ? (old?.endedAt ?? now) : undefined,
      tools: old?.tools ?? 0,
      lastTool: old?.lastTool,
      mascot,
    }
  }

  return next
}

/** A species no present agent has, starting from one the id hashes to; once all are taken, the hashed one. */
export function pickMascot(rows: Record<string, HqAgent>, id: string): number {
  const used = new Set(Object.values(rows).map(r => r.mascot))
  let start = 0
  for (const ch of id) start = (start * 31 + ch.charCodeAt(0)) >>> 0
  for (let i = 0; i < SPECIES.length; i++) {
    const pick = (start + i) % SPECIES.length
    if (!used.has(pick)) return pick
  }
  return start % SPECIES.length
}

const shortName = (description: string, type: string) =>
  description.trim().split(/\s+/).slice(0, 3).join(' ') || type

export function countTool(rows: Record<string, HqAgent>, loop: string, tool: string, now: number): Record<string, HqAgent> {
  const row = rows[loop] ?? (loop === MAIN ? mainAgent(now) : { ...stubAgent(loop, now), mascot: pickMascot(rows, loop) })
  return { ...rows, [loop]: { ...row, tools: row.tools + 1, lastTool: tool } }
}

const stubAgent = (id: string, now: number): HqAgent => ({
  id,
  name: id.slice(0, 8),
  role: 'agent',
  description: '',
  status: 'running',
  startedAt: now,
  tools: 0,
})

export function createTask(tasks: Record<string, HqTask>, id: string, subject: string, activeForm?: string) {
  return { ...tasks, [id]: { id, subject, status: 'pending' as const, activeForm, blockedBy: [] } }
}

export type TaskPatch = {
  subject?: string
  activeForm?: string
  status?: HqTaskStatus | 'deleted'
  owner?: string
  addBlockedBy?: readonly string[]
}

export function updateTask(tasks: Record<string, HqTask>, id: string, patch: TaskPatch): Record<string, HqTask> {
  if (patch.status === 'deleted') {
    const { [id]: _gone, ...rest } = tasks
    return rest
  }
  const old = tasks[id] ?? { id, subject: `Task #${id}`, status: 'pending' as const, blockedBy: [] }
  return {
    ...tasks,
    [id]: {
      ...old,
      subject: patch.subject ?? old.subject,
      activeForm: patch.activeForm ?? old.activeForm,
      status: patch.status ?? old.status,
      owner: patch.owner ?? old.owner,
      blockedBy: [...new Set([...old.blockedBy, ...(patch.addBlockedBy ?? [])])],
    },
  }
}

export type Progress = { done: number; active: number; total: number }

export function progressOf(items: readonly { status: HqTaskStatus }[]): Progress {
  return {
    done: items.filter(i => i.status === 'completed').length,
    active: items.filter(i => i.status === 'in_progress').length,
    total: items.length,
  }
}

export type AgentWork = { now?: string; next?: string; last?: string; todos?: Progress }

/** What an agent works on now, what comes next and what it finished last: its own todos first, then board tasks it owns (by name or id). */
export function agentWork(agent: HqAgent, todos: Record<string, HqTodo[]>, tasks: Record<string, HqTask>): AgentWork {
  const list = todos[agent.id] ?? []
  const owned = Object.values(tasks)
    .filter(t => t.owner !== undefined && (t.owner === agent.name || t.owner === agent.id))
    .sort((a, b) => Number(a.id) - Number(b.id))
  const current = list.find(t => t.status === 'in_progress')
  const currentTask = owned.find(t => t.status === 'in_progress')
  const after = current ? list.slice(list.indexOf(current) + 1) : list
  const nextTodo = after.find(t => t.status === 'pending') ?? list.find(t => t.status === 'pending')
  const nextTask = owned.find(t => t.status === 'pending')
  // completion times are not tracked: the last finished todo in list order, else the highest-numbered finished task
  const lastTodo = list.filter(t => t.status === 'completed').at(-1)
  const lastTask = owned.filter(t => t.status === 'completed').at(-1)
  return {
    now: current?.activeForm ?? (currentTask ? (currentTask.activeForm ?? currentTask.subject) : undefined),
    next: nextTodo?.content ?? nextTask?.subject,
    last: lastTodo?.content ?? lastTask?.subject,
    todos: list.length > 0 ? progressOf(list) : undefined,
  }
}

// ---------- plan-progress bars as todo lists ----------

export const PLAN_TOOL = 'mcp__plan-progress__plan_progress'
export type BarOwner = { owner: string; at: number }
type Raw = Record<string, unknown>
const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null

// plan-progress's own id rules, so a call's id names the bar it stores
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, '').trimEnd() : '')
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'plan'
export const barIdOf = (input: Raw) => slug(str(input.id, 60) || str(input.title, 80))

/** The bar ids a model response row asks plan-progress to create or move. */
export function barIdsIn(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content.filter(b => isRaw(b) && b.type === 'tool_use' && b.name === PLAN_TOOL && isRaw(b.input)).map(b => barIdOf((b as Raw).input as Raw))
}

const STEP_STATUS: Record<string, HqTaskStatus> = { done: 'completed', skipped: 'completed', active: 'in_progress', error: 'in_progress', pending: 'pending' }

/** plan-progress's stored bars (its `plans` value, read untrusted) as one todo list per bar id. */
export function planSteps(value: unknown): Record<string, HqTodo[]> {
  if (!Array.isArray(value)) return {}
  const out: Record<string, HqTodo[]> = {}
  for (const plan of value) {
    if (!isRaw(plan) || typeof plan.id !== 'string' || !Array.isArray(plan.stages)) continue
    const isDone = plan.state === 'done'
    const steps = plan.stages
      .flatMap(s => (isRaw(s) && Array.isArray(s.steps) ? s.steps : []))
      .filter((st): st is Raw => isRaw(st) && typeof st.title === 'string')
      .map(st => ({
        content: String(st.title),
        activeForm: String(st.title),
        status: isDone ? ('completed' as const) : (STEP_STATUS[String(st.status)] ?? 'pending'),
      }))
    if (steps.length > 0) out[plan.id] = steps
  }
  return out
}

/** Each agent's todo list: its own TodoWrite list wins, else the plan-progress bar it moved last. */
export function mergeTodos(
  todos: Record<string, HqTodo[]>,
  bars: Record<string, HqTodo[]>,
  owners: Record<string, BarOwner>,
  agents: Record<string, HqAgent>,
): Record<string, HqTodo[]> {
  const latest: Record<string, { at: number; steps: HqTodo[] }> = {}
  for (const [id, { owner, at }] of Object.entries(owners)) {
    const steps = bars[id]
    const held = latest[owner]
    if (!steps || !(owner in agents) || (held && held.at > at)) continue
    latest[owner] = { at, steps }
  }
  const fromBars = Object.fromEntries(Object.entries(latest).map(([owner, { steps }]) => [owner, steps]))
  return { ...fromBars, ...todos }
}

/** Board tasks plus every loop's todos: the whole team's progress. */
export function overallProgress(tasks: Record<string, HqTask>, todos: Record<string, HqTodo[]>): Progress {
  return progressOf([...Object.values(tasks), ...Object.values(todos).flat()])
}

/** Drops finished agents (never main) and completed tasks/todos. */
export function clearFinished(
  agents: Record<string, HqAgent>,
  tasks: Record<string, HqTask>,
  todos: Record<string, HqTodo[]>,
) {
  const keptAgents = Object.fromEntries(
    Object.entries(agents).filter(([id, a]) => id === MAIN || !isFinished(a.status)),
  )
  return {
    agents: keptAgents,
    tasks: Object.fromEntries(Object.entries(tasks).filter(([, t]) => t.status !== 'completed')),
    todos: Object.fromEntries(
      Object.entries(todos).filter(([loop, list]) => loop in keptAgents && list.some(t => t.status !== 'completed')),
    ),
  }
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** Children of each parent, main's children being agents with no (known) parent. */
export function teamTree(agents: Record<string, HqAgent>): Record<string, HqAgent[]> {
  const tree: Record<string, HqAgent[]> = {}
  for (const a of Object.values(agents)) {
    if (a.id === MAIN) continue
    const parent = a.parentId && agents[a.parentId] ? a.parentId : MAIN
    tree[parent] = [...(tree[parent] ?? []), a].sort((x, y) => x.startedAt - y.startedAt)
  }
  return tree
}
