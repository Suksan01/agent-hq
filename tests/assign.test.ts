// Spec for hooks/assign.ts: the lead's hq_assign (parseAssign) and hq_status (statusSummary) tools. Decisions pinned:
//  - the brief is markdown sections in this order: "## Goal", "## Files", "## Done when", "## Do not touch"; a section whose
//    input was left out is left out;
//  - a name defaults to the next free `<role>-<n>` across ALL agents, finished ones included (as the live page does);
//    an explicit name must be letters, digits, _ or - (up to 48) and not taken;
//  - a role is full when its live (unfinished) agents of type `agent-hq:<id>` reach its count; without a team the only
//    role is general-purpose (count 10), type `general-purpose`;
//  - limits: task 4000 chars, done 1000, limits 1000, files 50 globs of at most 200 chars;
//  - a glob is relative, one line, no `..` segment, not absolute, not empty;
//  - the status text is at most 40 lines: the lead first, then running agents before finished ones (the rest folded into a "+N more"
//    line), then the Agents line (counts exclude the lead), the Tasks line and one "Blocked:" line per blocked task, which are never cut.
import { describe, expect, test } from 'claude-code/testing'

import type { HqAgent, HqStatus, HqTask, HqTodo } from '../types'
import { parseAssign, statusSummary } from '../hooks/assign'
import { parseTeam } from '../hooks/team'
import type { HqData } from '../hooks/view'

const parsed = parseTeam(
  JSON.stringify({
    name: 'Booking App Team',
    purpose: 'Build',
    lead: { title: 'Tech Lead', rules: [], skills: [] },
    roles: [
      { id: 'frontend-dev', title: 'Frontend Developer', count: 2, mission: 'Build pages.', tasks: [], rules: [], skills: [] },
      { id: 'qa', title: 'QA Engineer', count: 1, mission: 'Test.', tasks: [], rules: [], skills: [] },
    ],
  }),
)
if (typeof parsed === 'string') throw new Error(parsed)
const TEAM = parsed

const agent = (id: string, name: string, status: HqStatus, role = 'agent-hq:frontend-dev', over: Partial<HqAgent> = {}): HqAgent => ({
  id,
  name,
  role,
  description: `work of ${name}`,
  status,
  startedAt: 0,
  tools: 0,
  ...over,
})
const roster = (...list: HqAgent[]) => Object.fromEntries(list.map(a => [a.id, a]))

describe('parseAssign', () => {
  const ok = (input: unknown, team = TEAM as typeof TEAM | null, agents: Record<string, HqAgent> = {}) => {
    const result = parseAssign(input, team, agents)
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
    return result
  }
  const error = (input: unknown, team = TEAM as typeof TEAM | null, agents: Record<string, HqAgent> = {}) => {
    const result = parseAssign(input, team, agents)
    if (result.ok) throw new Error('expected an error')
    return result.error
  }

  test('a team member that can write is told where its full report goes; no team, or report: false, adds none', () => {
    expect(ok({ role: 'frontend-dev', task: 'Build it' }).prompt).toContain('## Report\nWrite your full report to `.claude/agent-hq/reports/frontend-dev/frontend-dev-1.md`, then reply in at most 15 lines')
    expect(ok({ role: 'general-purpose', task: 'Build it' }, null).prompt).not.toContain('## Report') // a general agent has no role prompt to follow
    const review = parseAssign({ role: 'qa', task: 'Review it' }, TEAM, {}, [], { report: false })
    const rooted = parseAssign({ role: 'frontend-dev', task: 'Build it' }, TEAM, {}, [], { root: '/work/app' })
    expect(rooted.ok && rooted.prompt).toContain('to `/work/app/.claude/agent-hq/reports/frontend-dev/frontend-dev-1.md`') // absolute when the project is known
    expect(review.ok && review.prompt).not.toContain('## Report')
  })

  test('a full assignment becomes a brief with Goal, Files, Done when and Do not touch', () => {
    const result = ok({ role: 'frontend-dev', task: 'Build the search page', files: ['app/search/**', 'components/Search*.tsx'], done: 'Tests pass and the page renders', limits: 'Leave the checkout alone' })
    expect(result.role).toBe('frontend-dev')
    expect(result.name).toBe('frontend-dev-1')
    const { prompt } = result
    for (const part of ['## Goal', 'Build the search page', '## Files', '- app/search/**', '- components/Search*.tsx', '## Done when', 'Tests pass and the page renders', '## Do not touch', 'Leave the checkout alone']) {
      expect(prompt, part).toContain(part)
    }
    const at = ['## Goal', '## Files', '## Done when', '## Do not touch'].map(h => prompt.indexOf(h))
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  test('only the task is required; the other sections are left out, and the task is trimmed', () => {
    const { prompt } = ok({ role: 'qa', task: '  Check the booking flow \n' })
    expect(prompt).toContain('## Goal')
    expect(prompt).toContain('Check the booking flow')
    expect(prompt).not.toContain('Check the booking flow \n')
    for (const heading of ['## Files', '## Done when', '## Do not touch']) expect(prompt).not.toContain(heading)
    const bare = ok({ role: 'qa', task: 'x', files: [], done: '', limits: ' ' }).prompt
    for (const heading of ['## Files', '## Done when', '## Do not touch']) expect(bare).not.toContain(heading)
  })

  test('the name is the next free role-n, counting finished agents, unless one is given', () => {
    const agents = roster(agent('a1', 'frontend-dev-1', 'completed'))
    expect(ok({ role: 'frontend-dev', task: 'x' }, TEAM, agents).name).toBe('frontend-dev-2')
    expect(ok({ role: 'frontend-dev', task: 'x', name: 'search-bot' }, TEAM, agents).name).toBe('search-bot')
    expect(error({ role: 'frontend-dev', task: 'x', name: 'frontend-dev-1' }, TEAM, agents)).toMatch(/name/i)
    expect(error({ role: 'frontend-dev', task: 'x', name: 'bad name!' })).toMatch(/name/i)
    expect(error({ role: 'frontend-dev', task: 'x', name: 'x'.repeat(49) })).toMatch(/name/i)
    expect(error({ role: 'frontend-dev', task: 'x', name: 7 })).toMatch(/name/i)
  })

  test('an unknown role and a full role are refused with the role named', () => {
    expect(error({ role: 'ghost', task: 'x' })).toMatch(/no role "ghost"/)
    expect(error({ role: 'general-purpose', task: 'x' })).toMatch(/no role "general-purpose"/)
    expect(error({ task: 'x' })).toMatch(/role/)
    expect(error({ role: 3, task: 'x' })).toMatch(/role/)

    const full = roster(agent('a1', 'frontend-dev-1', 'running'), agent('a2', 'frontend-dev-2', 'waiting'))
    expect(error({ role: 'frontend-dev', task: 'x' }, TEAM, full)).toMatch(/Frontend Developer is fully staffed \(2 of 2 at work\).*hq_hire/)
    const oneFree = roster(agent('a1', 'frontend-dev-1', 'running'), agent('a2', 'frontend-dev-2', 'completed'), agent('a3', 'frontend-dev-3', 'failed'))
    expect(ok({ role: 'frontend-dev', task: 'x' }, TEAM, oneFree).name).toBe('frontend-dev-4')
    const otherRole = roster(agent('q1', 'qa-1', 'running', 'agent-hq:qa'))
    expect(ok({ role: 'frontend-dev', task: 'x' }, TEAM, otherRole).name).toBe('frontend-dev-1')
    expect(error({ role: 'qa', task: 'x' }, TEAM, otherRole)).toMatch(/fully staffed \(1 of 1 at work\)/)
  })

  test('without a team the only role is general-purpose, up to ten at once', () => {
    const result = ok({ role: 'general-purpose', task: 'Look around' }, null)
    expect(result).toMatchObject({ role: 'general-purpose', name: 'general-purpose-1' })
    expect(error({ role: 'qa', task: 'x' }, null)).toMatch(/no role "qa"/)
    const ten = roster(...Array.from({ length: 10 }, (_, i) => agent(`g${i}`, `general-purpose-${i + 1}`, 'running', 'general-purpose')))
    expect(error({ role: 'general-purpose', task: 'x' }, null, ten)).toMatch(/fully staffed \(10 of 10 at work\)/)
  })

  test('the task must be there, not blank and not too long', () => {
    expect(error({ role: 'qa' })).toMatch(/task/)
    expect(error({ role: 'qa', task: '   ' })).toMatch(/task/)
    expect(error({ role: 'qa', task: 42 })).toMatch(/task/)
    expect(error({ role: 'qa', task: 'x'.repeat(4001) })).toMatch(/too long/)
    expect(ok({ role: 'qa', task: 'x'.repeat(4000) }).prompt).toContain('x'.repeat(4000))
    expect(error({ role: 'qa', task: 'x', done: 'y'.repeat(1001) })).toMatch(/done.*too long|too long.*done/i)
    expect(error({ role: 'qa', task: 'x', limits: 'y'.repeat(1001) })).toMatch(/limits.*too long|too long.*limits/i)
    expect(error({ role: 'qa', task: 'x', done: 5 })).toMatch(/done/)
    expect(error({ role: 'qa', task: 'x', limits: {} })).toMatch(/limits/)
  })

  test('files must be a list of plain relative globs, at most 50', () => {
    for (const bad of ['../secret.ts', 'src/../../etc', '/etc/passwd', '', '  ', 'src/\nlib', 'x'.repeat(201)]) {
      expect(error({ role: 'qa', task: 'x', files: ['ok/**', bad] }), JSON.stringify(bad)).toMatch(/files|glob/i)
    }
    expect(error({ role: 'qa', task: 'x', files: 'src/**' })).toMatch(/files/i)
    expect(error({ role: 'qa', task: 'x', files: [7] })).toMatch(/files|glob/i)
    expect(error({ role: 'qa', task: 'x', files: Array.from({ length: 51 }, (_, i) => `d${i}/**`) })).toMatch(/files/i)
    expect(ok({ role: 'qa', task: 'x', files: Array.from({ length: 50 }, (_, i) => `d${i}/**`) }).prompt).toContain('- d49/**')
    const braces = ok({ role: 'qa', task: 'x', files: ['./src/a.ts', 'src/{a,b}.ts', 'src/[ab]*.ts'] }).prompt
    for (const glob of ['- ./src/a.ts', '- src/{a,b}.ts', '- src/[ab]*.ts']) expect(braces).toContain(glob)
  })

  test('input that is not an object is refused', () => {
    for (const bad of [null, undefined, 'build it', 42, ['qa']]) expect(error(bad)).toMatch(/\S/)
  })
})

describe('statusSummary', () => {
  const data = (agents: HqAgent[], over: Partial<HqData> = {}): HqData => ({
    agents: roster(...agents),
    todos: {},
    tasks: {},
    now: 10_000,
    hideFinished: false,
    columns: 0,
    isLight: false,
    team: TEAM,
    ...over,
  })
  const lead = agent('main', 'main', 'running', 'orchestrator', { nickname: 'Captain Ramen' })
  const task = (id: string, subject: string, status: HqTask['status'], blockedBy: string[] = []): HqTask => ({ id, subject, status, blockedBy })

  test('each agent gets a line with nickname, name, role title, status, what it does now and what is next', () => {
    const dev = agent('d1', 'frontend-dev-1', 'running', 'agent-hq:frontend-dev', { nickname: 'Mochi-chan' })
    const todos: Record<string, HqTodo[]> = {
      d1: [
        { content: 'Read the code', status: 'completed', activeForm: 'Reading the code' },
        { content: 'Build the page', status: 'in_progress', activeForm: 'Building the page' },
        { content: 'Write tests', status: 'pending', activeForm: 'Writing tests' },
      ],
    }
    const lines = statusSummary(data([lead, dev], { todos })).split('\n')
    const row = lines.find(l => l.includes('Mochi-chan'))
    expect(row).toBeDefined()
    for (const part of ['frontend-dev-1', 'Frontend Developer', 'running', 'Building the page', 'Write tests']) expect(row, part).toContain(part)
    expect(lines.some(l => l.includes('Captain Ramen'))).toBe(true)
  })

  test('the counts line, the tasks line and each blocked task close the summary', () => {
    const agents = [lead, agent('d1', 'frontend-dev-1', 'running'), agent('d2', 'frontend-dev-2', 'running'), agent('d3', 'frontend-dev-3', 'completed'), agent('d4', 'qa-1', 'failed', 'agent-hq:qa')]
    const tasks = Object.fromEntries([task('1', 'Plan', 'completed'), task('2', 'Build', 'in_progress', ['1']), task('3', 'Ship', 'pending', ['2'])].map(t => [t.id, t]))
    const lines = statusSummary(data(agents, { tasks })).split('\n')
    const text = lines.join('\n')
    expect(text).toMatch(/Agents: .*2 running/)
    expect(text).toMatch(/Agents: .*1 done/)
    expect(text).toMatch(/Agents: .*1 failed/)
    expect(text).toMatch(/Tasks: .*1\/3/)
    const blocked = lines.filter(l => l.startsWith('Blocked:'))
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toContain('#3')
    expect(blocked[0]).toContain('Ship')
    expect(blocked[0]).toContain('#2')
    expect(lines.indexOf(blocked[0] as string)).toBeGreaterThan(lines.findIndex(l => l.startsWith('Agents:')))
  })

  test('never more than 40 lines: running agents first, the rest folded into "+N more", the closing lines kept', () => {
    const many = Array.from({ length: 45 }, (_, i) => agent(`r${i}`, `frontend-dev-${i + 1}`, 'running', 'agent-hq:frontend-dev', { nickname: `Runner${i}` }))
    const done = Array.from({ length: 20 }, (_, i) => agent(`f${i}`, `qa-${i + 1}`, 'completed', 'agent-hq:qa', { nickname: `Finisher${i}` }))
    const tasks = Object.fromEntries(Array.from({ length: 5 }, (_, i) => task(`${i + 2}`, `Blocked job ${i}`, 'pending', ['1'])).concat([task('1', 'Gate', 'in_progress')]).map(t => [t.id, t]))
    const lines = statusSummary(data([lead, ...many, ...done], { tasks })).split('\n')
    expect(lines.length).toBeLessThanOrEqual(40)
    expect(lines.some(l => /\+\d+ more/.test(l))).toBe(true)
    expect(lines.filter(l => l.startsWith('Blocked:'))).toHaveLength(5)
    expect(lines.some(l => /Agents: .*45 running/.test(l))).toBe(true)
    expect(lines.some(l => l.startsWith('Tasks:'))).toBe(true)
    expect(lines.filter(l => l.includes('Finisher'))).toHaveLength(0) // 45 running fill every row there is room for
  })

  test('running agents are all listed before any finished one when the list is cut', () => {
    const running = Array.from({ length: 30 }, (_, i) => agent(`r${i}`, `frontend-dev-${i + 1}`, 'running', 'agent-hq:frontend-dev', { nickname: `Runner${i}` }))
    const done = Array.from({ length: 30 }, (_, i) => agent(`f${i}`, `qa-${i + 1}`, 'completed', 'agent-hq:qa', { nickname: `Finisher${i}` }))
    const text = statusSummary(data([lead, ...done, ...running])).split('\n').join('\n')
    for (let i = 0; i < 30; i++) expect(text).toContain(`Runner${i}`)
  })

  test('an empty team still gets a short, well-formed answer', () => {
    const lines = statusSummary(data([lead])).split('\n')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThanOrEqual(40)
    expect(lines.some(l => l.startsWith('Agents:'))).toBe(true)
  })
})
