// 0.7.0 ships page approvals dormant (they come in 0.8.0): nothing is ever held, `/hq web approvals ...` turns nothing
// on and says so in both languages, the command hint does not offer it, and /hq web replies keep the login link as before.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { APPROVALS_RELEASED, APPROVALS_TEST_SESSION, isApprovalsReleased } from '../hooks/pageapproval'

const PAGES = '/home/me/.claude/agent-hq/live/pages.json'

/** Everything a hold needs is in place (a stored "on" left from a dev build, a page open, default mode): only the gate is shut. */
async function boot($: Engine, on: On) {
  const clock = mock.clock(on, { now: 9_000 })
  const stored: Record<string, unknown> = { languageAsked: true, pageApprovals: true }
  const runs: string[][] = []
  const hints: string[] = []
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_, e) => ({ value: e.path === PAGES ? JSON.stringify({ count: 1, at: 1 }) : '' }))
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const stdout = e.argv.includes('--login') ? 'AGENT_HQ_PAGES 0\nAGENT_HQ_URL http://127.0.0.1:4321/?c=fresh\n' : 'allow\n'
    return { value: { exitCode: e.argv[0] === 'open' ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'AGENT_HQ_URL http://127.0.0.1:4321/?c=first\n' }
    await new Promise(() => {})
    return { value: { code: 0, signal: null } }
  })
  on('agent.list', () => ({ value: [] }))
  on('tool.check', () => ({ decision: 'ask' as const, reason: 'needs a look' }))
  on('command.register', (_, e) => {
    hints.push(e.argumentHint ?? '')
    return { value: undefined } as never
  })
  for (const event of ['ui.status', 'ui.open', 'ui.toast', 'ui.log'] as const) on(event, () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('classic.UserPromptSubmit', () => ({}))
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: false } as never)
  await $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: 'default' } as never)
  const command = async (args: string) => ((await $.command.run({ command: 'hq', args, origin: { kind: 'composer' }, presentation: {} } as never)) as { text: string }).text
  await clock.settle()
  return { command, hints, runs, stored }
}

test('page approvals are not released in 0.7.0', () => {
  expect(APPROVALS_RELEASED).toBe(false)
  expect(isApprovalsReleased('6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(false) // a real session's id: a UUID
  expect(isApprovalsReleased('')).toBe(false)
  expect(isApprovalsReleased(APPROVALS_TEST_SESSION)).toBe(true) // the 0.8.0 tests' seam
})

test('nothing is held, whatever is stored; /hq web keeps its login link in the reply', async ($, on) => {
  const s = await boot($, on)
  const reply = await s.command('web')
  expect(reply).toContain('?c=')
  expect(await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'u1' } as never)).toEqual({ decision: 'ask', reason: 'needs a look' })
  expect(s.runs.some(argv => argv.some(arg => arg.endsWith('/web/approve.mjs')))).toBe(false)
})

test('/hq web approvals turns nothing on and says they come in the next release; the hint does not offer it', async ($, on) => {
  const s = await boot($, on)
  delete s.stored.pageApprovals
  const coming = 'Agent HQ: page approvals are off. Answering permission asks on the live page comes in the next release; until then they go to the usual dialog.'
  for (const args of ['web approvals on', 'web approvals', 'web approvals off']) expect([args, await s.command(args)]).toEqual([args, coming])
  expect(s.stored.pageApprovals).toBeUndefined()
  expect(s.hints.length).toBeGreaterThan(0)
  for (const hint of s.hints) expect(hint).not.toContain('approvals')
})

test('in Thai too', { options: { language: 'thai' } }, async ($, on) => {
  const s = await boot($, on)
  expect(await s.command('web approvals on')).toBe('Agent HQ: การอนุมัติบนหน้าเรียลไทม์ยังปิดอยู่ จะมาในเวอร์ชันถัดไป ระหว่างนี้คำขออนุญาตจะถามในกล่องถามตามปกติ')
})
