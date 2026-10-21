// `/hq report`: the session as one Markdown file, per agent, the task board, review outcomes and what is left.
// `buildReport` is pure (the tests read it); `createReport` adds the file and, when a model answers, the summary.

import type { EngineInterface } from 'claude-code'

import type { HqAgent, HqStatus, HqTask } from '../types'
import { MAIN, agentWork, elapsed, isFinished, progressOf } from './model'
import type { Progress } from './model'
import { labelOf } from './view'
import type { HqData } from './view'
import { t } from './i18n'
import type { Lang } from './i18n'

export const REPORTS_DIR = '.claude/agent-hq/reports'
const SUMMARY_MODEL = 'haiku'
const SUMMARY_MAX_TOKENS = 300
const SUMMARY_TIMEOUT_MS = 20_000
const TEXT_MAX = 200
const REVIEW_ROLE = /review|qa|test|audit|fact.?check|a11y|accessib/i

const statusWord = (lang: Lang, status: HqStatus) => t(lang, `report.state.${status}`)
const taskWord = (lang: Lang, status: HqTask['status']) => t(lang, `taskStatus.${status}`)
const langOf = (data: HqData): Lang => data.lang ?? 'en'

const pad = (n: number) => String(n).padStart(2, '0')
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** One line of text for a list or table cell: whitespace folded, cut, and the pipe escaped. */
const cell = (text: string) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return (one.length > TEXT_MAX ? `${one.slice(0, TEXT_MAX - 1)}…` : one).replace(/\|/g, '\\|')
}

/** `<cwd>/.claude/agent-hq/reports/<date>-<time>.md`, to the second so two reports never share a name. */
export function reportPath(cwd: string, at: number): string {
  const d = new Date(at)
  return `${cwd}/${REPORTS_DIR}/${day(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`
}

const members = (data: HqData) => Object.values(data.agents).filter(a => a.id !== MAIN)

/** The board's progress, else the todos' when nothing is on the board. */
function taskProgress(data: HqData): Progress {
  const board = Object.values(data.tasks)
  return board.length > 0 ? progressOf(board) : progressOf(Object.values(data.todos).flat())
}

const ownedBy = (agent: HqAgent, tasks: Record<string, HqTask>) => Object.values(tasks).filter(t => t.owner === agent.name || t.owner === agent.id)

function agentSection(agent: HqAgent, data: HqData, at: number): string {
  const lang = langOf(data)
  const label = labelOf(agent, data.team, lang)
  const work = agentWork(agent, data.todos, data.tasks)
  const owned = ownedBy(agent, data.tasks)
  const total = (work.todos?.total ?? 0) + owned.length
  const done = (work.todos?.done ?? 0) + owned.filter(t => t.status === 'completed').length
  const head = agent.id === MAIN ? `${label.name} (${label.role})` : `${agent.name} (${label.role})`
  return [
    `### ${agent.nickname ? `${agent.nickname} · ` : ''}${head}`,
    t(lang, 'report.status', { status: statusWord(lang, agent.status) }),
    t(lang, 'report.time', { time: elapsed((agent.endedAt ?? at) - agent.startedAt, lang) }),
    t(lang, 'report.tasksDone', { tasks: total === 0 ? t(lang, 'report.noneTracked') : `${done}/${total}` }),
    t(lang, 'report.lastResult', { result: work.last ? cell(work.last) : t(lang, 'report.nothingYet') }),
  ].join('\n')
}

function boardSection(data: HqData): string {
  const lang = langOf(data)
  const tasks = Object.values(data.tasks).sort((a, b) => Number(a.id) - Number(b.id))
  if (tasks.length === 0) return t(lang, 'report.noBoard')
  return [t(lang, 'report.boardHeader'), '| --- | --- | --- | --- |', ...tasks.map(task => `| ${cell(task.id)} | ${cell(task.subject)} | ${taskWord(lang, task.status)} | ${cell(task.owner ?? '-')} |`)].join('\n')
}

function reviewSection(data: HqData): string {
  const lang = langOf(data)
  const reviewers = members(data).filter(a => REVIEW_ROLE.test(`${labelOf(a, data.team).role} ${a.role}`))
  if (reviewers.length === 0) return t(lang, 'report.noReview')
  return reviewers
    .map(a => {
      const last = agentWork(a, data.todos, data.tasks).last
      return `- ${a.nickname ?? a.name} (${labelOf(a, data.team, lang).role}): ${statusWord(lang, a.status)}${last ? t(lang, 'report.lastResultInline', { result: cell(last) }) : ''}`
    })
    .join('\n')
}

function leftSection(data: HqData): string {
  const lang = langOf(data)
  const lines: string[] = []
  for (const task of Object.values(data.tasks).filter(task => task.status !== 'completed')) {
    lines.push(t(lang, 'report.leftTask', { id: cell(task.id), subject: cell(task.subject), status: taskWord(lang, task.status), owner: task.owner ? `, ${cell(task.owner)}` : '' }))
  }
  for (const a of members(data)) {
    const open = (data.todos[a.id] ?? []).filter(todo => todo.status !== 'completed')
    for (const todo of open) lines.push(`- ${a.name}: ${cell(todo.content)}`)
    if (a.status === 'failed') lines.push(t(lang, 'report.leftFailed', { name: a.name }))
    else if (a.status === 'killed') lines.push(t(lang, 'report.leftStopped', { name: a.name }))
    else if (!isFinished(a.status)) {
      const how = a.status === 'running' || a.status === 'pending' ? 'report.leftRunning' : a.status === 'waiting' ? 'report.leftWaiting' : 'report.leftIdle'
      lines.push(t(lang, how, { name: a.name }))
    }
  }
  return lines.length > 0 ? lines.join('\n') : t(lang, 'report.nothingLeft')
}

/** The whole report. `summary`, when given, opens it as a quote. */
export function buildReport(data: HqData, at: number, summary?: string): string {
  const lang = langOf(data)
  const d = new Date(at)
  const agents = [data.agents[MAIN], ...members(data).sort((a, b) => a.startedAt - b.startedAt)].filter((a): a is HqAgent => a !== undefined)
  const progress = taskProgress(data)
  const running = members(data).filter(a => !isFinished(a.status)).length
  const quote = summary?.trim() ? summary.trim().split('\n').map(l => `> ${l}`).join('\n') : ''
  return [
    t(lang, 'report.title', { name: data.team ? data.team.name : t(lang, 'report.session') }),
    quote,
    [
      t(lang, 'report.generated', { date: `${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}` }),
      data.team?.purpose ? t(lang, 'report.purpose', { purpose: cell(data.team.purpose) }) : '',
      t(lang, 'report.agents', { n: members(data).length, running }),
      progress.total === 0 ? t(lang, 'report.tasksNone') : t(lang, 'report.tasks', progress),
    ]
      .filter(Boolean)
      .map(l => `- ${l}`)
      .join('\n'),
    `${t(lang, 'report.agentsHeading')}\n\n${agents.map(a => agentSection(a, data, at)).join('\n\n')}`,
    `${t(lang, 'report.boardHeading')}\n\n${boardSection(data)}`,
    `${t(lang, 'report.reviewHeading')}\n\n${reviewSection(data)}`,
    `${t(lang, 'report.leftHeading')}\n\n${leftSection(data)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n')
}

/** What the model is asked for the report's top. */
export const summaryPrompt = (report: string, lang: Lang = 'en') =>
  `Below is a report of an agent team's work. Write an executive summary of exactly three sentences: what got done, what went wrong or is blocked, and what is left. Plain text only, no lists, no headings, no preamble.${lang === 'th' ? ' Write it in Thai, with no polite particles (ครับ/ค่ะ).' : ''}\n\n${report}`

/** The toast after a report: the file (relative to the project when inside it) and the headline counts. */
export function reportToast(data: HqData, path: string, cwd: string): string {
  const lang = langOf(data)
  const progress = taskProgress(data)
  const shown = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
  const tasks = progress.total === 0 ? t(lang, 'report.toastNoTasks') : t(lang, 'report.toastTasks', progress)
  return t(lang, 'report.toast', { path: shown, n: members(data).length, tasks })
}

// no model (a session without one, a refused call) means no summary, never a failed report
async function summarise($: EngineInterface, report: string, lang: Lang): Promise<string> {
  try {
    const answer = await $.model.complete({ model: SUMMARY_MODEL, prompt: summaryPrompt(report, lang), maxTokens: SUMMARY_MAX_TOKENS, timeoutMs: SUMMARY_TIMEOUT_MS })
    return answer.isAnswered ? answer.text.trim() : ''
  } catch {
    return ''
  }
}

/** Writes the report under the project (`cwd`) and returns where; the model's summary tops it only when one came back. */
export async function createReport($: EngineInterface, data: HqData, cwd: string, at: number): Promise<{ path: string; hasSummary: boolean }> {
  const path = reportPath(cwd, at)
  const summary = await summarise($, buildReport(data, at), langOf(data))
  await $.fs.write(path, buildReport(data, at, summary))
  return { path, hasSummary: summary !== '' }
}
