// What each agent is doing, in a sentence: what it said with hq_doing, else the step it has in progress, else the first
// line of its assignment, else (the lead only) a line worked out from the team. Pure; register.tsx keeps the `says` atom.
// The sentence comes from a model, so it is read untrusted: one line, secrets masked, cut short.

import type { HqAgent, HqAssignment, HqSays, HqTask, HqTodo } from '../types'
import { MAIN, isFinished, isWorking, workingCount } from './model'
import { currentActivity } from './activity'
import { headOf } from './cells'
import { maskSecrets } from './secrets'
import { t } from './i18n'
import type { Lang } from './i18n'
import type { HqData } from './view'

export const SAYS_MAX = 90
export type Says = Record<string, HqSays>
export type Saying = { text: string; source: 'doing' | 'step' | 'assignment' | 'lead' }

const maskEach = <T>(rows: Record<string, T>, mask: (row: T) => T): Record<string, T> => Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, mask(row)]))
const maskTodo = (todo: HqTodo): HqTodo => ({ ...todo, content: maskSecrets(todo.content), activeForm: maskSecrets(todo.activeForm) })

type Work = { todos: Record<string, HqTodo[]>; tasks: Record<string, HqTask>; assignments: Record<string, HqAssignment>; says: Says }

/**
 * The work as every surface shows it (sidebar, band, live page, report, hq_status): the text an agent or the lead wrote in
 * a todo, a board task, an assignment or a step it spoke for, masked. Text with no secret comes back as it was. A
 * sentence's step is masked as its todo is, so the two still match.
 */
export function maskedWork(work: Work): Work {
  return {
    todos: maskEach(work.todos, list => list.map(maskTodo)),
    tasks: maskEach(work.tasks, task => ({ ...task, subject: maskSecrets(task.subject), ...(task.activeForm === undefined ? {} : { activeForm: maskSecrets(task.activeForm) }) })),
    assignments: maskEach(work.assignments, assignment => ({ ...assignment, task: maskSecrets(assignment.task) })),
    says: maskEach(work.says, said => (said.step === undefined ? said : { ...said, step: maskSecrets(said.step) })),
  }
}

/** What hq_doing was given (or a talk bubble's words) as one line: whitespace folded, secrets masked, at most `max` characters cut between clusters. */
export function cleanSaying(raw: unknown, max = SAYS_MAX): string {
  if (typeof raw !== 'string') return ''
  const line = maskSecrets(raw.replace(/\s+/g, ' ').trim())
  if (line.length <= max) return line
  // a Thai leading vowel (เ แ โ ใ ไ) belongs to the consonant after it: never left at the end
  return `${headOf(line, max - 1).replace(/[เ-ไ]$/, '').trimEnd()}…`
}

/** The step an agent has in progress (its todo, or the plan-progress bar it moves). */
export const currentStep = (todos: readonly HqTodo[] | undefined) => todos?.find(todo => todo.status === 'in_progress')

type SaysData = Pick<HqData, 'agents' | 'todos' | 'says' | 'assignments' | 'activity'>

/**
 * The sentence for an agent's row, or null to keep today's line. A sentence said for a step that is over is stale; an
 * agent that finished or rests (idle) says nothing; one held on an approval keeps its "needs approval".
 */
export function sayingOf(agent: HqAgent, data: SaysData, lang: Lang = 'en'): Saying | null {
  const isLead = agent.id === MAIN
  if (!isLead && !isWorking(agent.status)) return null
  const step = currentStep(data.todos[agent.id])
  const said = data.says?.[agent.id]
  if (said?.text && said.step === step?.content) return { text: said.text, source: 'doing' }
  if (step) return { text: cleanSaying(step.activeForm || step.content), source: 'step' } // a model wrote it: masked as hq_doing's
  const assigned = isLead ? '' : cleanSaying(data.assignments?.[agent.name]?.task.split('\n')[0])
  if (assigned) return { text: assigned, source: 'assignment' }
  if (!isLead) return null
  const members = Object.values(data.agents).filter(a => a.id !== MAIN).length
  const working = workingCount(data.agents)
  if (working > 0) return { text: t(lang, 'says.waiting', { n: working, total: members }), source: 'lead' }
  return currentActivity(data.activity, MAIN) ? { text: t(lang, 'says.planning'), source: 'lead' } : null
}

/** The sentences still in force: an agent that finished or rests (idle), or whose step moved on, said nothing now. The same object when none went. */
export function pruneSays(says: Says, agents: Record<string, HqAgent>, todos: Record<string, readonly HqTodo[]>): Says {
  const kept = Object.entries(says).filter(([id, said]) => {
    const agent = agents[id]
    if (id !== MAIN && (!agent || isFinished(agent.status) || agent.status === 'idle')) return false
    return said.step === currentStep(todos[id])?.content
  })
  return kept.length === Object.keys(says).length ? says : Object.fromEntries(kept)
}
