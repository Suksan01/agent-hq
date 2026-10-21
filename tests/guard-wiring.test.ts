// The rule guard on the engine: a subagent's tool call is checked against its team role and what the lead scoped it to.
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
  roles: [
    { id: 'frontend-dev', title: 'Frontend Developer', count: 2, mission: 'Build pages.', tasks: [], rules: ['Never push or merge'], skills: [] },
    { id: 'reviewer', title: 'Code Reviewer', count: 1, mission: 'Review.', tasks: [], rules: [], skills: [], tools: ['Read', 'Grep'] },
  ],
})

const info = (id: string, name: string, type: string): AgentInfo => ({ id, name, type, description: 'work', status: 'running' })

async function boot($: Engine, on: On, roster: AgentInfo[] = []) {
  const toasts: string[] = []
  const logs: string[] = []
  const reached: string[] = [] // tool calls that got past the plugin to the engine
  const listed = roster // the test may add to it later: an agent started after the last poll
  const clock = mock.clock(on)
  const snapshots: { events?: { agent: string; kind: string; text: string; failed?: boolean }[] }[] = []
  mock.store(on, { approvedTeams: withApproval([], PROJECT_FILE, TEAM), languageAsked: true })
  // the live page, when a test starts it (/hq web): its state writes caught
  on('fs.write', (_, e) => {
    if (e.path === '/home/me/.claude/agent-hq/live/sess.json') snapshots.push(JSON.parse(e.text))
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'AGENT_HQ_URL http://127.0.0.1:4321\n' }
    await new Promise(() => {})
    return { value: { code: 0, signal: null } }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', (_, e) => ({ value: e.path === PROJECT_FILE }))
  on('fs.read', () => ({ value: TEAM }))
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  // what the test makes fail: the roster listing, or writes of these state keys
  const failing = { list: false, keys: new Set<string>() }
  on('agent.list', () => {
    if (failing.list) throw new Error('roster unavailable')
    return { value: [...listed] }
  })
  on('state.set', (_, e, next) => {
    // a write refused, so $.state.set rejects (a throwing test hook would only be skipped)
    if (failing.keys.has(String((e as { key?: unknown }).key))) return { deny: 'disk full' } as never
    return (next as unknown as (input: unknown) => unknown)(e) as never
  })
  on('agent.spawn', (_, e) => {
    const name = String((e as { name?: string }).name)
    listed.push(info('s9', name, String((e as { subagent_type?: string }).subagent_type)))
    return { model: 'sonnet', agentId: 's9' }
  })
  on('tool.register', (_, e) => ({ value: { tool: `mcp__agent-hq__${e.name}` } }) as never)
  on('tool.call', (_, e) => {
    reached.push(String(e.tool))
    return e.tool === 'TaskCreate' ? ({ result: { task: { id: '1' } } } as never) : ({ result: {} as never })
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined } as never
  })
  for (const event of ['ui.status', 'ui.open', 'command.register'] as const) on(event, () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<{ deny?: string; isError?: boolean; result?: unknown }>
  return { toasts, logs, reached, call, clock, snapshots, failing }
}

test('a role without the tool is refused, with a toast naming the agent and the reason', async ($, on) => {
  const s = await boot($, on, [info('r1', 'reviewer-1', 'agent-hq:reviewer')])

  const refused = await s.call({ tool: 'Edit', file_path: 'app/page.tsx', old_string: 'a', new_string: 'b', agentId: 'r1' })

  expect(refused.deny).toContain('Edit is not one of this role')
  expect(s.reached).not.toContain('Edit')
  expect(s.toasts.at(-1)).toMatch(/^Agent HQ blocked .+ \(reviewer-1\): Edit is not one of this role's tools \(Code Reviewer\)$/)
  expect(s.toasts.at(-1)).not.toContain('Agent HQ: ')
})

test('a role told never to push cannot run git push, and an ordinary command goes through', async ($, on) => {
  const s = await boot($, on, [info('d1', 'frontend-dev-1', 'agent-hq:frontend-dev')])

  const refused = await s.call({ tool: 'Bash', command: 'git add . && git push origin main', agentId: 'd1' })
  const allowed = await s.call({ tool: 'Bash', command: 'npm test', agentId: 'd1' })

  expect(refused.deny).toContain('pushing')
  expect(allowed.deny).toBeUndefined()
  expect(s.reached).toEqual(['Bash'])
})

test('the main session is never blocked, whatever it runs', async ($, on) => {
  const s = await boot($, on)

  const ran = await s.call({ tool: 'Bash', command: 'git push origin main' })

  expect(ran.deny).toBeUndefined()
  expect(s.toasts.filter(t => t.includes('blocked'))).toEqual([])
})

test('an agent the roster does not list yet is found by syncing it, and still guarded', async ($, on) => {
  const roster: AgentInfo[] = []
  const s = await boot($, on, roster)
  roster.push(info('r2', 'reviewer-2', 'agent-hq:reviewer')) // started after the last poll

  const refused = await s.call({ tool: 'Write', file_path: 'x.ts', content: 'x', agentId: 'r2' })

  expect(refused.deny).toContain('Write is not one of this role')
})

test('files scoped by hq_assign keep the agent inside them from its very first call', async ($, on) => {
  const s = await boot($, on)
  await s.call({ tool: 'mcp__agent-hq__hq_assign', role: 'frontend-dev', task: 'Build search', files: ['app/search/**'] })

  const inside = await s.call({ tool: 'Edit', file_path: 'app/search/page.tsx', old_string: 'a', new_string: 'b', agentId: 's9' })
  const outside = await s.call({ tool: 'Edit', file_path: 'app/cart/page.tsx', old_string: 'a', new_string: 'b', agentId: 's9' })

  expect(inside.deny).toBeUndefined()
  expect(outside.deny).toContain('app/search/**')
  expect(s.toasts.at(-1)).toContain('blocked')
})

test('an agent the roster still does not list after a sync is judged as a non-member: no role guard, a debug line, no toast, but never a team file', async ($, on) => {
  const s = await boot($, on, [info('r1', 'reviewer-1', 'agent-hq:reviewer')])

  const edit = await s.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'a', new_string: 'b', agentId: 'ghost' }) // a reviewer role would be refused this
  const bash = await s.call({ tool: 'Bash', command: 'git push origin main', agentId: 'ghost' })

  expect([edit.deny, bash.deny]).toEqual([undefined, undefined])
  expect(s.reached).toEqual(expect.arrayContaining(['Edit', 'Bash']))
  expect(s.toasts.filter(t => t.includes('blocked'))).toEqual([])
  expect(s.logs).toContain('Agent HQ: unlisted agent ghost judged as non-member')

  const team = await s.call({ tool: 'Write', file_path: '.claude/agent-hq/team.json', content: '{}', agentId: 'ghost' })
  expect(team.deny).toBe('Agent HQ: the team file may only be changed by the person')
  expect(s.toasts.at(-1)).toBe('Agent HQ blocked ghost: the team file may only be changed by the person')
})

test('an agent a guarded role started is held to that role\'s rules (and one that only reads is not asked for more)', async ($, on) => {
  const s = await boot($, on, [info('d1', 'frontend-dev-1', 'agent-hq:frontend-dev'), { ...info('x1', 'explorer-1', 'Explore'), parentId: 'd1' }])

  const pushed = await s.call({ tool: 'Bash', command: 'git push origin main', agentId: 'x1' }) // frontend-dev: never push
  const read = await s.call({ tool: 'Bash', command: 'ls', agentId: 'x1' })

  expect(pushed.deny).toContain('pushing')
  expect(read.deny).toBeUndefined()
})

test('a block is a feed event flagged failed, so the page tells it in any language; other events are not', { options: { language: 'thai' } }, async ($, on) => {
  const s = await boot($, on, [info('r1', 'reviewer-1', 'agent-hq:reviewer')])
  await $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} } as never)
  await s.call({ tool: 'Edit', file_path: 'app/page.tsx', old_string: 'a', new_string: 'b', agentId: 'r1' })
  await s.clock.advance(1_000) // the next poll writes the page's state
  const events = s.snapshots.at(-1)?.events ?? []
  const blocked = events.find(e => e.kind === 'action')
  expect(blocked?.text).toMatch(/^ไม่อนุญาต Edit/)
  expect(blocked?.failed).toBe(true)
  expect(events.filter(e => e !== blocked).length).toBeGreaterThan(0)
  expect(events.filter(e => e !== blocked).every(e => e.failed === false)).toBe(true)
})

test('a decided block still refuses when telling about it fails (the feed write throws)', async ($, on) => {
  const s = await boot($, on, [info('r1', 'reviewer-1', 'agent-hq:reviewer')])
  s.failing.keys.add('feed')
  const refused = await s.call({ tool: 'Edit', file_path: 'app/page.tsx', old_string: 'a', new_string: 'b', agentId: 'r1' })
  expect(refused.deny).toContain('Edit is not one of this role')
  expect(s.reached).not.toContain('Edit')
})

test('an unlisted agent whose roster sync fails is refused: the guard cannot tell a new member from a stranger', async ($, on) => {
  const s = await boot($, on, [])
  s.failing.list = true
  const refused = await s.call({ tool: 'Edit', file_path: 'app/page.tsx', old_string: 'a', new_string: 'b', agentId: 'x9' })
  expect(refused.deny).toMatch(/^Agent HQ: the rule guard could not tell/)
  expect(s.reached).not.toContain('Edit')
})

test("a guard hook that fails refuses a member's call and never the lead's", async ($, on) => {
  const s = await boot($, on, [info('r1', 'reviewer-1', 'agent-hq:reviewer')])
  await s.call({ tool: 'Read', file_path: 'app/page.tsx', agentId: 'r1' }) // lists the reviewer, so the guard knows its role
  const before = s.reached.length
  s.failing.keys.add('agents') // now the hook's own bookkeeping throws after the guard let the call through, before it runs
  const member = await s.call({ tool: 'Read', file_path: 'app/page.tsx', agentId: 'r1' })
  expect(member.deny).toBe('Agent HQ: the rule guard could not run; nothing was done')
  expect(s.reached.length).toBe(before)
  const lead = await s.call({ tool: 'Read', file_path: 'app/page.tsx' })
  expect(lead.deny).toBeUndefined()
  expect(s.reached.length).toBe(before + 1)
})
