// The inbox on the engine: a permission ask waits in the live snapshot and the status line until the call is decided.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const STATE = '/home/me/.claude/agent-hq/live/sess.json'

async function boot($: Engine, on: On, roster: AgentInfo[] = []) {
  const statuses: (string | undefined)[] = []
  const snapshots: { inbox: { agent: string; since: number; what: string }[] }[] = []
  const toasts: string[] = []
  const listed = roster
  let decision: 'allow' | 'ask' = 'ask'
  let release: () => void = () => {}
  const clock = mock.clock(on)
  mock.store(on, {})
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', (_, e) => {
    if (e.path === STATE || e.path === `${STATE}.tmp`) snapshots.push(JSON.parse(e.text))
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'AGENT_HQ_URL http://127.0.0.1:4321\n' }
    await new Promise<void>(resolve => (release = resolve))
    return { value: { code: 0, signal: null } }
  })
  on('agent.list', () => ({ value: [...listed] }))
  on('tool.check', () => ({ decision, reason: 'needs a look' }))
  on('tool.call', () => ({ result: {} as never }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined } as never
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  for (const event of ['ui.open', 'ui.log', 'command.register'] as const) on(event, () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  await $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} } as never)
  await clock.settle()
  return { statuses, snapshots, toasts, clock, listed, ask: (v: 'allow' | 'ask') => void (decision = v), finish: () => release() }
}

const info = (id: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, name: id, type: 'general-purpose', description: 'x', status })
const last = <T,>(list: T[]) => list[list.length - 1]

test('an agent held on an approval is in the inbox and the status line counts it', async ($, on) => {
  const s = await boot($, on, [info('a1'), info('a2', 'waiting'), info('a3')])

  await s.clock.advance(1000)

  expect(last(s.snapshots)?.inbox).toEqual([{ agent: 'a2', since: expect.any(Number), what: expect.stringContaining('waiting') }])
  expect(last(s.statuses)).toBe('🪐 2 working · 1 needs you')
  s.listed.splice(1, 1, info('a2', 'running'))
  await s.clock.advance(1000)
  expect(last(s.snapshots)?.inbox).toEqual([])
  expect(last(s.statuses)).toBe('🪐 3 working')
  s.finish()
})

test('the status line is cleared when nothing is left to show', async ($, on) => {
  const s = await boot($, on, [])

  await s.clock.advance(1000)

  expect(last(s.statuses)).toBeUndefined()
  s.finish()
})

test('a permission ask waits in the inbox until the tool call is decided, then leaves it', async ($, on) => {
  const s = await boot($, on, [info('a1')])
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  // the engine asks first (tool.check), and the call that raised it ends once the person has answered
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'u1', agentId: 'a1' } as never)
  await s.clock.advance(1000)

  expect(verdict.decision).toBe('ask')
  expect(last(s.snapshots)?.inbox).toEqual([{ agent: 'a1', since: expect.any(Number), what: 'Bash: rm' }])
  expect(last(s.statuses)).toContain('1 needs you')

  await call({ tool: 'Bash', command: 'rm -rf build', agentId: 'a1', tool_use_id: 'u1' })
  await s.clock.advance(1000)

  expect(last(s.snapshots)?.inbox).toEqual([])
  expect(last(s.statuses)).not.toContain('needs you')
  s.finish()
})

test('a query that is not a real call (no tool_use_id) and an ask of the lead are handled', async ($, on) => {
  const s = await boot($, on, [info('a1')])

  await $.tool.check({ tool: 'Bash', input: { command: 'ls' } } as never) // a $.tool.check query
  await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' }, tool_use_id: 'u7' } as never) // the lead's own ask
  await s.clock.advance(1000)

  expect(last(s.snapshots)?.inbox).toEqual([{ agent: 'main', since: expect.any(Number), what: 'Edit: a.ts' }])
  s.finish()
})

test('a call the engine allows outright never reaches the inbox', async ($, on) => {
  const s = await boot($, on, [info('a1')])
  s.ask('allow')

  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'u2', agentId: 'a1' } as never)
  await s.clock.advance(1000)

  expect(last(s.snapshots)?.inbox).toEqual([])
  s.finish()
})

// hq_assign starts its agent through $.agent.spawn: the engine asks about that Agent call (tool.check), but no tool.call
// of it ever reaches the mod, so the ask cannot leave the way a model's own call's does
test('an ask whose call the mod never sees leaves the inbox when its loop\'s turn ends; another loop\'s ask stays', async ($, on) => {
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const s = await boot($, on, [info('a1')])

  await $.tool.check({ tool: 'Agent', input: { prompt: 'Build it' }, tool_use_id: 'u9' } as never)
  await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'u8', agentId: 'a1' } as never)
  await s.clock.advance(1000)
  expect(last(s.snapshots)?.inbox.map(item => item.agent)).toEqual(['main', 'a1'])

  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  await s.clock.advance(1000)

  expect(last(s.snapshots)?.inbox.map(item => item.agent)).toEqual(['a1'])
  expect(last(s.statuses)).toBe('🪐 1 working · 1 needs you')
  s.finish()
})
