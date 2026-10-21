// The lead's tools through the engine: registered at session start, answered by the plugin, lead only.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { TEAM_FILE } from '../hooks/team'

const PROJECT_FILE = `/work/app/${TEAM_FILE}`
const TEAM = JSON.stringify({
  name: 'Booking App Team',
  purpose: 'Build',
  lead: { title: 'Tech Lead', rules: [], skills: [] },
  roles: [{ id: 'frontend-dev', title: 'Frontend Developer', count: 2, mission: 'Build pages.', tasks: [], rules: [], skills: [] }],
})

async function boot($: Engine, on: On) {
  const dialog = { answer: 'Yes, rewrite it' as string | 'throws', asked: [] as string[] } // what $.ui.ask (an AskUserQuestion call) is asked and answers
  const registered: { name: string }[] = []
  const written: { path: string; text: string }[] = []
  let agentRegistrations = 0
  let teamText = TEAM
  const race: { text: string | null } = { text: null }
  const spawns: Record<string, unknown>[] = []
  const listed: AgentInfo[] = []
  const board: Record<string, unknown>[] = []
  mock.clock(on)
  mock.store(on, { approvedTeams: withApproval([], PROJECT_FILE, TEAM), languageAsked: true })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', (_, e) => ({ value: e.path === PROJECT_FILE }))
  on('fs.read', () => ({ value: teamText }))
  on('fs.write', (_, e) => {
    written.push({ path: e.path, text: e.text })
    teamText = race.text ?? e.text // `race.text`: someone else changes the file right after it was written
    return { value: undefined }
  })
  on('agent.register', (_, e) => {
    agentRegistrations += 1
    return { value: { agent: `agent-hq:${e.name}` } }
  })
  on('agent.list', () => ({ value: [...listed] }))
  on('agent.spawn', (_, e) => {
    spawns.push(e as unknown as Record<string, unknown>)
    listed.push({ id: 's1', name: String((e as { name?: string }).name), type: 'agent-hq:frontend-dev', description: 'x', status: 'running' })
    return { model: 'sonnet', agentId: 's1' }
  })
  on('tool.register', (_, e) => {
    registered.push({ name: e.name })
    return { value: { tool: `mcp__agent-hq__${e.name}` } } as never
  })
  on('tool.call', (_, e) => {
    if ((e.tool as string) === 'AskUserQuestion') {
      const questions = (e as unknown as { questions: { question: string }[] }).questions
      dialog.asked.push(questions[0]?.question ?? '')
      if (dialog.answer === 'throws') throw new Error('dismissed')
      return { result: { questions, answers: { [questions[0]?.question ?? '']: dialog.answer } } } as never
    }
    if ((e.tool as string) === 'TaskCreate') {
      board.push(e as unknown as Record<string, unknown>)
      return { result: { task: { id: '3' } } } as never
    }
    if ((e.tool as string) === 'TaskUpdate') board.push(e as unknown as Record<string, unknown>)
    return { result: {} as never }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'engine', text: 'base', scope: 'shared' as const }] }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<{ result?: unknown; isError?: boolean }>
  return { race, dialog, registered, written, get agentRegistrations() { return agentRegistrations }, spawns, board, call, compose: () => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never) }
}

test('the team tools and hq_doing are offered at session start and named in the lead prompt', async ($, on) => {
  const s = await boot($, on)

  expect(s.registered.map(t => t.name)).toEqual(['hq_assign', 'hq_status', 'hq_hire', 'hq_review', 'hq_doing'])
  const lead = (await s.compose()).sections.find(x => x.id === 'agent-hq:team')?.text ?? ''
  for (const tool of ['mcp__agent-hq__hq_assign', 'mcp__agent-hq__hq_status', 'mcp__agent-hq__hq_review', 'mcp__agent-hq__hq_hire', 'mcp__agent-hq__hq_doing']) expect(lead).toContain(tool)
})

test('hq_assign through a tool call starts the agent and puts it on the board; hq_status then lists it', async ($, on) => {
  const s = await boot($, on)

  const assigned = await s.call({ tool: 'mcp__agent-hq__hq_assign', role: 'frontend-dev', task: 'Build the search page', files: ['app/search/**'] })

  expect(assigned.isError).toBeUndefined()
  expect(String(assigned.result)).toMatch(/^Started \S+ \(frontend-dev-1\) as Frontend Developer\./)
  expect(s.spawns[0]).toMatchObject({ subagent_type: 'agent-hq:frontend-dev', name: 'frontend-dev-1' })
  expect(s.board.map(b => b.tool)).toEqual(['TaskCreate', 'TaskUpdate'])
  const status = await s.call({ tool: 'mcp__agent-hq__hq_status' })
  expect(String(status.result)).toContain('frontend-dev-1')
  expect(String(status.result)).toContain('Agents: 1 running')
})

test('a bad hq_assign comes back as an error result the model can read', async ($, on) => {
  const s = await boot($, on)

  const refused = await s.call({ tool: 'mcp__agent-hq__hq_assign', role: 'ghost', task: 'x' })

  expect(refused.isError).toBe(true)
  expect(String(refused.result)).toContain('no role "ghost"')
  expect(s.spawns).toEqual([])
})

test('a subagent may not use the lead tools', async ($, on) => {
  const s = await boot($, on)

  const refused = await s.call({ tool: 'mcp__agent-hq__hq_assign', agentId: 'sub1', role: 'frontend-dev', task: 'x' })

  expect(refused.isError).toBe(true)
  expect(String(refused.result)).toContain('Only the lead')
  expect(s.spawns).toEqual([])
})

test('hq_hire through a tool call rewrites the team file, registers the new staff and shows in the lead prompt', async ($, on) => {
  const s = await boot($, on)
  const before = s.agentRegistrations

  const hired = await s.call({ tool: 'mcp__agent-hq__hq_hire', role: 'frontend-dev', add: 2 })

  expect(hired.isError).toBeUndefined()
  expect(String(hired.result)).toContain('now has 4 on staff (was 2)')
  expect(s.dialog.asked).toEqual([`Rewrite ${PROJECT_FILE} to add 2 Frontend Developers (Frontend Developer 2 -> 4 on staff)?`])
  expect(String(hired.result)).toContain(`Changed ${PROJECT_FILE}.`)
  expect(s.written).toHaveLength(1)
  expect(s.written[0]?.path).toBe(PROJECT_FILE)
  expect(JSON.parse(s.written[0]?.text ?? '{}').roles[0].count).toBe(4)
  expect(s.agentRegistrations).toBeGreaterThan(before) // the team was loaded again
  const lead = (await s.compose()).sections.find(x => x.id === 'agent-hq:team')?.text ?? ''
  expect(lead).toContain('Frontend Developer (4 on staff)')
  expect(lead).toContain('hq_hire')
  expect((await s.call({ tool: 'mcp__agent-hq__hq_hire', agentId: 'sub1', role: 'frontend-dev' })).isError).toBe(true) // lead only
  expect(s.written).toHaveLength(1)
})

test('hq_hire writes nothing when the person answers No or the dialog cannot be shown', async ($, on) => {
  const s = await boot($, on)

  s.dialog.answer = 'No'
  const declined = await s.call({ tool: 'mcp__agent-hq__hq_hire', role: 'frontend-dev' })
  s.dialog.answer = 'throws'
  const nobody = await s.call({ tool: 'mcp__agent-hq__hq_hire', role: 'frontend-dev' })

  expect(declined.isError).toBe(true)
  expect(String(declined.result)).toContain('did not confirm')
  expect(nobody.isError).toBe(true)
  expect(String(nobody.result)).toContain('nobody could be asked')
  expect(s.written).toEqual([])
})

test('hq_hire does not trust a team file that changed right after it wrote it, and says it could not load it', async ($, on) => {
  const s = await boot($, on)
  s.race.text = TEAM.replace('Build pages.', 'Hijacked.')

  const hired = await s.call({ tool: 'mcp__agent-hq__hq_hire', role: 'frontend-dev', add: 2 })

  expect(hired.isError).toBe(true)
  expect(String(hired.result)).toContain('could not load the team')
  const lead = (await s.compose()).sections.find(x => x.id === 'agent-hq:team')?.text ?? ''
  expect(lead).toContain('Frontend Developer (2 on staff)') // the trusted team, unchanged
  expect(lead).not.toContain('Hijacked')
})
