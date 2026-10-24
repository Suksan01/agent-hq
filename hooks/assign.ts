// The lead's hq_assign and hq_status tools, apart from how they reach the engine (see ./tools): `parseAssign` checks an
// assignment and writes the agent's brief, `statusSummary` tells the lead where the team stands in at most 40 lines.
// tests/assign.test.ts is the spec.

import type { HqAgent, HqStatus, HqTeam, HqTeamRole } from '../types'
import { MAIN, agentWork, isFinished } from './model'
import { REPLY_LINES, isReadOnlyRole, reportPathOf } from './team'
import { labelOf, nowLine } from './view'
import type { HqData } from './view'

/** `task` and `files` are the checked input again, for whoever records the assignment. */
export type AssignResult = { ok: true; role: string; name: string; prompt: string; task: string; files: string[]; model?: string } | { ok: false; error: string }

const GENERAL = { id: 'general-purpose', title: 'General agent', count: 10 }
const NAME = /^[A-Za-z0-9_-]{1,48}$/
const MODEL = /^[A-Za-z0-9._[\]-]{1,80}$/ // an alias (haiku) or an id (claude-opus-5-5[1m])
const SKILL = /^[A-Za-z0-9._:-]{1,80}$/ // a skill name, plugin-scoped or not (superpowers:systematic-debugging)
const MAX_SKILLS = 5
const MAX_TASK = 4000
const MAX_NOTE = 1000 // `done` and `limits`
const MAX_FILES = 50
const MAX_GLOB = 200
const MAX_LINES = 40
const MAX_LINE = 220
const MAX_BLOCKED = 25 // more than this many blocked tasks are counted in one line, so the answer stays within MAX_LINES

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A glob the lead may scope an agent to: one line, relative, going nowhere above the project. */
const isPlainGlob = (glob: string) =>
  glob.trim() !== '' && glob.length <= MAX_GLOB && !/[\r\n]/.test(glob) && !/^([/\\~]|[A-Za-z]:)/.test(glob) && !glob.split(/[/\\]/).includes('..')

/** The optional text field `key`: trimmed, absent when blank, or the reason it is refused. */
function note(input: Record<string, unknown>, key: 'done' | 'limits'): { text?: string } | { error: string } {
  const value = input[key]
  if (value === undefined || value === null) return {}
  if (typeof value !== 'string') return { error: `"${key}" must be text` }
  const text = value.trim()
  return text.length > MAX_NOTE ? { error: `"${key}" is too long (at most ${MAX_NOTE} characters)` } : text ? { text } : {}
}

/** Validates hq_assign's input `{ role, task, files?, done?, limits?, name? }` and writes the structured brief. `reserved` names are taken like a listed agent's. */
export function parseAssign(input: unknown, team: HqTeam | null, agents: Record<string, HqAgent>, reserved: readonly string[] = [], options: { report?: boolean; maxTask?: number; root?: string } = {}): AssignResult {
  if (!isRecord(input)) return { ok: false, error: 'hq_assign needs an object like { role, task }' }
  const roles = team ? team.roles : [GENERAL]
  if (typeof input.role !== 'string' || input.role === '') return { ok: false, error: `give the "role" to assign (${roles.map(r => r.id).join(', ')})` }
  const role = roles.find(r => r.id === input.role)
  if (!role) return { ok: false, error: `no role "${input.role}" in the team (${roles.map(r => r.id).join(', ')})` }

  if (typeof input.task !== 'string' || input.task.trim() === '') return { ok: false, error: 'give the "task": what the agent is to do (or a "brief_file" the team assistant wrote)' }
  const task = input.task.trim()
  const maxTask = options.maxTask ?? MAX_TASK
  if (task.length > maxTask) return { ok: false, error: `"task" is too long (at most ${maxTask} characters)` }

  const done = note(input, 'done')
  if ('error' in done) return { ok: false, error: done.error }
  const limits = note(input, 'limits')
  if ('error' in limits) return { ok: false, error: limits.error }

  let files: string[] = []
  if (input.files !== undefined && input.files !== null) {
    if (!Array.isArray(input.files)) return { ok: false, error: '"files" must be a list of globs' }
    if (input.files.length > MAX_FILES) return { ok: false, error: `"files" has too many entries (at most ${MAX_FILES})` }
    const bad = input.files.find(glob => typeof glob !== 'string' || !isPlainGlob(glob))
    if (bad !== undefined) return { ok: false, error: `"files" must be plain relative globs, not ${JSON.stringify(bad).slice(0, 60)}` }
    files = input.files as string[]
  }

  let model: string | undefined
  if (input.model !== undefined && input.model !== null) {
    if (typeof input.model !== 'string' || !MODEL.test(input.model.trim())) return { ok: false, error: 'the "model" must be an alias such as "haiku" or a model id' }
    model = input.model.trim()
  }

  let skills: string[] = []
  if (input.skills !== undefined && input.skills !== null) {
    if (!Array.isArray(input.skills) || input.skills.length > MAX_SKILLS || !input.skills.every(x => typeof x === 'string' && SKILL.test(x))) {
      return { ok: false, error: `"skills" must be a list of at most ${MAX_SKILLS} skill names, such as ["tdd"]` }
    }
    skills = [...new Set(input.skills as string[])]
  }

  const everyone = Object.values(agents)
  const live = everyone.filter(a => a.id !== MAIN && !isFinished(a.status) && a.role === (team ? `agent-hq:${role.id}` : role.id))
  if (live.length >= role.count) return { ok: false, error: `${role.title} is fully staffed (${live.length} of ${role.count} at work); hire another with hq_hire, or wait for one to finish` }

  let name = `${role.id}-1`
  if (input.name !== undefined && input.name !== null) {
    if (typeof input.name !== 'string' || !NAME.test(input.name)) return { ok: false, error: 'the "name" must be letters, digits, _ or - (up to 48)' }
    if (everyone.some(a => a.name === input.name) || reserved.includes(input.name)) return { ok: false, error: `the name "${input.name}" is taken` }
    name = input.name
  } else {
    const taken = new Set([...everyone.map(a => a.name), ...reserved])
    for (let n = 1; taken.has(name); n++) name = `${role.id}-${n + 1}`
  }

  const sections = [
    // members did not load their skills on their own in a real run: the lead names the ones this task needs, up front
    ...(skills.length > 0 ? [`## Load first\nBefore anything else, load ${skills.length > 1 ? 'these skills' : 'this skill'} with the Skill tool and follow ${skills.length > 1 ? 'them' : 'it'}: ${skills.join(', ')}.`] : []),
    `## Goal\n${task}`,
    ...(files.length > 0 ? [`## Files\nChange only these (globs, relative to the project):\n${files.map(f => `- ${f}`).join('\n')}`] : []),
    ...(done.text ? [`## Done when\n${done.text}`] : []),
    ...(limits.text ? [`## Do not touch\n${limits.text}`] : []),
    // a team member that can write keeps its full report in a file, so its reply to the lead stays short
    ...(team && options.report !== false && !isReadOnlyRole(role as HqTeamRole) ? [`## Report\nWrite your full report to \`${options.root ? `${options.root}/` : ''}${reportPathOf(role.id, name)}\`, then reply in at most ${REPLY_LINES} lines as your role's reporting rules say.`] : []),
  ]
  return { ok: true, role: role.id, name, prompt: sections.join('\n\n'), task, files, ...(model ? { model } : {}) }
}

const clip = (text: string) => (text.length > MAX_LINE ? `${text.slice(0, MAX_LINE - 1)}…` : text)

/** hq_status's answer: at most 40 lines. */
export function statusSummary(data: HqData): string {
  const rows = Object.values(data.agents).map(agent => {
    const label = labelOf(agent, data.team)
    const work = agentWork(agent, data.todos, data.tasks)
    const nick = agent.nickname ?? label.name
    const now = nowLine(agent, work, data.now).text
    const next = !isFinished(agent.status) && work.next ? ` · next: ${work.next}` : ''
    const line =
      agent.id === MAIN ? `${nick} · ${label.name} (lead): ${now}${next}` : `${nick} · ${label.name} · ${label.role} · ${agent.status}: ${now}${next}`
    return { agent, line: clip(line) }
  })
  const lead = rows.filter(r => r.agent.id === MAIN)
  const members = rows.filter(r => r.agent.id !== MAIN)
  const byStart = (a: { agent: HqAgent }, b: { agent: HqAgent }) => a.agent.startedAt - b.agent.startedAt
  const ordered = [...members.filter(r => !isFinished(r.agent.status)).sort(byStart), ...members.filter(r => isFinished(r.agent.status)).sort(byStart)]

  const countOf = (...statuses: HqStatus[]) => members.filter(r => statuses.includes(r.agent.status)).length
  const groups: [string, number][] = [
    ['running', countOf('running', 'pending')],
    ['waiting', countOf('waiting', 'idle')],
    ['done', countOf('completed')],
    ['failed', countOf('failed')],
    ['stopped', countOf('killed')],
  ]
  const agentsLine = `Agents: ${groups.filter(([, n]) => n > 0).map(([label, n]) => `${n} ${label}`).join(', ') || 'none'}`

  const tasks = Object.values(data.tasks)
  const finishedTasks = tasks.filter(t => t.status === 'completed').length
  const active = tasks.filter(t => t.status === 'in_progress').length
  const tasksLine = tasks.length === 0 ? 'Tasks: none' : `Tasks: ${finishedTasks}/${tasks.length} done${active > 0 ? `, ${active} in progress` : ''}`
  const open = new Set(tasks.filter(t => t.status !== 'completed').map(t => t.id))
  const blocked = tasks
    .filter(t => t.status !== 'completed' && t.blockedBy.some(id => open.has(id)))
    .map(t => `Blocked: #${t.id} ${t.subject}, waiting on ${t.blockedBy.filter(id => open.has(id)).map(id => `#${id}`).join(', ')}`)
  const blockedLines = blocked.length > MAX_BLOCKED ? [...blocked.slice(0, MAX_BLOCKED - 1), `Blocked: +${blocked.length - MAX_BLOCKED + 1} more tasks`] : blocked

  const closing = [agentsLine, tasksLine, ...blockedLines.map(clip)]
  const room = Math.max(0, MAX_LINES - closing.length - lead.length)
  const shown = ordered.length > room ? ordered.slice(0, Math.max(0, room - 1)) : ordered
  const more = ordered.length - shown.length
  return [...lead.map(r => r.line), ...shown.map(r => r.line), ...(more > 0 ? [`+${more} more agents (${ordered.slice(shown.length).filter(r => isFinished(r.agent.status)).length} finished)`] : []), ...closing].join('\n')
}
