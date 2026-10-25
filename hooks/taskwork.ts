// What a turn does to the saved task list (docs/specs/task-sidebar.md AC6, AC8, F2 step 4, F3 step 3, F5). Pure: each function
// returns a new list and leaves the one it was given as it was. Plan ticks are applyPlanTicks (./tasklist).

import type { ListTask, TaskList, TaskWork } from './tasklist'
import type { TurnReport } from './usage'

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

/** The number of the task a member is linked to: the one holding its latest event (a member given a new task moves its link). */
export function linkedTask(list: TaskList, member: string): number | undefined {
  let found: { n: number; at: number } | undefined
  for (const task of list.tasks) {
    for (const event of task.events) {
      if (event.who === member && (!found || event.at >= found.at)) found = { n: task.n, at: event.at }
    }
  }
  return found?.n
}

const NO_WORK: TaskWork = { role: '', step: 'build', workMs: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: null, lastAt: null }

/** A task's status after a member's turn on it: a waiting task starts, a builder reopens a task in review, a reviewer's turn keeps it. */
function statusAfter(task: ListTask, work: TaskWork): ListTask['status'] {
  if (task.status === 'waiting') return 'working'
  return task.status === 'review' && work.step !== 'review' ? 'working' : task.status
}

/**
 * The list with one turn's time and tokens added to the member's row on its linked task. The lead (no member) and a member
 * linked to no task count on none: the list itself comes back. Numbers are read as untrusted (usage.ts).
 */
export function addTurnToTask(list: TaskList, member: string | undefined, turn: TurnReport, at: number): TaskList {
  const n = member === undefined ? undefined : linkedTask(list, member)
  if (member === undefined || n === undefined) return list
  const usage = turn.usage
  const tasks = list.tasks.map(task => {
    if (task.n !== n) return task
    const before = task.work[member] ?? NO_WORK
    const row: TaskWork = {
      ...before,
      workMs: before.workMs + count(turn.durationMs),
      inputTokens: before.inputTokens + count(usage?.input_tokens),
      outputTokens: before.outputTokens + count(usage?.output_tokens),
      cacheReadTokens: before.cacheReadTokens + count(usage?.cache_read_input_tokens),
      cacheWriteTokens: before.cacheWriteTokens + count(usage?.cache_creation_input_tokens),
      model: typeof usage?.model === 'string' && usage.model ? usage.model : before.model,
      lastAt: at,
    }
    const status = statusAfter(task, before)
    return { ...task, status, startedAt: task.startedAt ?? at, work: { ...task.work, [member]: row } }
  })
  return { ...list, tasks }
}

/** The saved list for a new session: nobody works yet, so a working task waits for a new turn; every total is kept. */
export function settleForNewSession(list: TaskList): TaskList {
  return { ...list, tasks: list.tasks.map(task => (task.status === 'working' ? { ...task, status: 'waiting' as const } : task)) }
}
