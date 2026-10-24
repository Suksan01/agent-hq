// Page approvals on the engine: with `/hq web approvals on`, a live page open and the loop in default or acceptEdits mode,
// an `ask` waits in tool.check while web/approve.mjs asks the person on the page; Allow or Deny there decide, anything
// else leaves the ask (the engine's dialog follows). An allow or deny verdict is never touched.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { ALLOWED, APPROVALS_TEST_SESSION, APPROVAL_MS, DENIED, HELPER_TIMEOUT_MS } from '../hooks/pageapproval'

// these tests are for 0.8.0, where page approvals ship: a session with the test-only id runs as if released

const ROOT_STATE = `/home/me/.claude/agent-hq/live/${APPROVALS_TEST_SESSION}.json`
const PAGES = '/home/me/.claude/agent-hq/live/pages.json'
const MEMBER: AgentInfo = { id: 'a1', name: 'dev-1', type: 'general-purpose', description: 'x', status: 'running' }
type Run = { argv: readonly string[]; init?: { stdin?: string; timeoutMs?: number } }
type Helper = { stdout: string; exitCode?: number } | 'rejects' | 'waits'
type Verdict = { decision: 'allow' | 'ask' | 'deny'; reason?: string; setting?: string; hook?: string }
type Box = { verdict: Verdict; pages: string | null; helper: Helper; release: () => void; login: string; opens: boolean; answer: string | null }
type Origin = { kind: string; name?: string }

type Boot = { approvals?: boolean; web?: boolean; mode?: string | null }

async function boot($: Engine, on: On, options: Boot = {}) {
  const clock = mock.clock(on, { now: 9_000 })
  const stored: Record<string, unknown> = { languageAsked: true }
  const runs: Run[] = []
  const toasts: string[] = []
  const toastTimes: (number | undefined)[] = []
  const logs: string[] = []
  const asked: string[] = []
  const box: Box = {
    verdict: { decision: 'ask', reason: 'needs a look' },
    pages: JSON.stringify({ count: 1, at: 1 }),
    helper: { stdout: 'allow\n' },
    release: () => {},
    login: 'AGENT_HQ_PAGES 0\nAGENT_HQ_URL http://127.0.0.1:4321/?c=fresh\n',
    opens: true,
    answer: null,
  }
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: APPROVALS_TEST_SESSION }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_, e) => (e.path === PAGES ? (box.pages === null ? { deny: 'ENOENT: no such file' } : { value: box.pages }) : { value: '' }) as never)
  on('fs.write', () => ({ value: undefined }))
  const ran = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', async (_, e) => {
    if (e.argv[0] === 'open' || e.argv[0] === 'xdg-open') return ran(box.opens ? 0 : 1, '')
    if (e.argv.includes('--login')) return ran(0, box.login)
    if (!e.argv[1]?.endsWith('/web/approve.mjs')) return ran(0, '')
    runs.push({ argv: e.argv, init: e.init })
    const helper = box.helper
    if (helper === 'rejects') return { deny: 'the child was killed' } as never
    if (helper === 'waits') await new Promise<void>(resolve => (box.release = resolve))
    const done = typeof helper === 'string' ? { stdout: 'allow\n' } : helper
    return { value: { exitCode: done.exitCode ?? 0, stdout: done.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'AGENT_HQ_URL http://127.0.0.1:4321/?c=first\n' }
    await new Promise(() => {})
    return { value: { code: 0, signal: null } }
  })
  on('agent.list', () => ({ value: [MEMBER] }))
  // the engine's own dialog call is not the ask under test: a plugin ask nobody can answer (no approver) is denied, so let it through
  on('tool.check', (_, e) => {
    const isDialog = (e.tool as string) === 'AskUserQuestion' && ((e.input as { questions?: unknown[] }).questions?.length ?? 0) > 0
    return isDialog ? { decision: 'allow' as const } : box.verdict
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    toastTimes.push(e.timeoutMs)
    return { value: undefined } as never
  })
  // the engine's own dialog ($.ui.ask) is an AskUserQuestion call: box.answer is what the person picks (null dismisses)
  on('tool.call', async (_, e) => {
    if ((e.tool as string) !== 'AskUserQuestion') return { result: {} as never }
    const questions = (e as unknown as { questions: { question: string }[] }).questions
    asked.push(questions[0]?.question ?? '')
    if (box.answer === null) throw new Error('dismissed')
    return { result: { questions, answers: { [questions[0]?.question ?? '']: box.answer } } } as never
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined } as never
  })
  for (const event of ['ui.status', 'ui.open', 'command.register'] as const) on(event, () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.PostToolUseFailure', () => ({}))
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: false } as never)
  const command = async (args: string, origin: Origin = { kind: 'composer' }) => ((await $.command.run({ command: 'hq', args, origin, presentation: {} } as never)) as { text: string }).text
  if (options.web !== false) await command('web')
  if (options.approvals !== false) await command('web approvals on')
  const prompt = (mode: string, agentId?: string) =>
    agentId === undefined
      ? $.classic.UserPromptSubmit({ prompt: 'go', permission_mode: mode } as never)
      : $.classic.PostToolUse({ tool_name: 'Read', tool_input: {}, tool_response: {}, tool_use_id: 'r0', permission_mode: mode, agent_id: agentId } as never)
  if (options.mode !== null) await prompt(options.mode ?? 'default')
  await clock.settle()
  const check = (input: Record<string, unknown> = {}) =>
    $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'u1', ...input } as never) as Promise<Verdict & Record<string, unknown>>
  return { asked, box, check, clock, command, logs, prompt, runs, stored, toasts, toastTimes }
}

const ASKED = { decision: 'ask', reason: 'needs a look' }

test("an ask is held while the page asks; the person's Allow allows, with the request on the helper's stdin", async ($, on) => {
  const s = await boot($, on)
  expect(await s.check()).toEqual({ decision: 'allow', reason: ALLOWED })
  expect(s.runs.length).toBe(1)
  const [run] = s.runs
  expect(run?.argv).toEqual(['node', expect.stringMatching(/\/web\/approve\.mjs$/), '--state', ROOT_STATE])
  expect(run?.init?.timeoutMs).toBe(HELPER_TIMEOUT_MS)
  expect(JSON.parse(run?.init?.stdin ?? '')).toEqual({ id: 'u1', agent: expect.any(String), role: null, tool: 'Bash', input: { command: 'rm -rf build' }, reason: 'needs a look', setting: null, hook: null, cwd: '/work/app', lang: 'en', at: expect.any(Number), timeoutMs: APPROVAL_MS })
  expect(s.toasts).toContain('Agent HQ: waiting for your answer on the live page (up to 60 s). Esc cancels.')
  expect(s.toastTimes[s.toasts.indexOf('Agent HQ: waiting for your answer on the live page (up to 60 s). Esc cancels.')]).toBe(APPROVAL_MS)
})

test('the card says why the engine asked: the reason, masked, and the setting or hook behind it', async ($, on) => {
  const s = await boot($, on)
  s.box.verdict = { decision: 'ask', reason: 'curl -H "Authorization: Bearer abcdef123456" needs a look', hook: 'PreToolUse', setting: 'permissions.blockReadsOutsideWorkingDirectories' }
  expect((await s.check()).decision).toBe('allow')
  const sent = JSON.parse(s.runs[0]?.init?.stdin ?? '')
  expect(sent.reason).toBe('curl -H "Authorization: Bearer *** needs a look')
  expect(sent.hook).toBe('PreToolUse')
  expect(sent.setting).toBe('permissions.blockReadsOutsideWorkingDirectories')
  s.box.verdict = { decision: 'ask' }
  expect((await s.check({ tool_use_id: 'u2' })).decision).toBe('allow')
  expect(JSON.parse(s.runs[1]?.init?.stdin ?? '')).toMatchObject({ reason: null, hook: null, setting: null })
})

test('an ask a host answers (approver host: an SDK or -p permission callback, a served call) is never held', async ($, on) => {
  const s = await boot($, on)
  expect(await s.check({ approver: 'host' })).toEqual(ASKED)
  expect(s.runs).toEqual([])
})

test("the person's Deny denies", async ($, on) => {
  const s = await boot($, on)
  s.box.helper = { stdout: 'deny\n' }
  expect(await s.check()).toEqual({ decision: 'deny', reason: DENIED })
})

test('"Ask in terminal now", junk, a failed helper, a timeout or Esc leave the ask, and free the slot for the next', async ($, on) => {
  const s = await boot($, on)
  const fallbacks: Helper[] = [{ stdout: 'ask\n' }, { stdout: 'yes please\n' }, { stdout: '' }, { stdout: 'allow\n', exitCode: 1 }, 'rejects']
  for (const helper of fallbacks) {
    s.box.helper = helper
    expect([helper, await s.check()]).toEqual([helper, ASKED])
  }
  expect(s.runs.length).toBe(fallbacks.length) // each was held: the slot was free again every time
  expect(s.logs.some(line => line.includes('the child was killed'))).toBe(true)
})

test('an allow or a deny verdict is never held or changed', async ($, on) => {
  const s = await boot($, on)
  s.box.verdict = { decision: 'allow', reason: 'rule' }
  expect(await s.check()).toEqual({ decision: 'allow', reason: 'rule' })
  s.box.verdict = { decision: 'deny', reason: 'a PreToolUse hook said no' }
  expect(await s.check()).toEqual({ decision: 'deny', reason: 'a PreToolUse hook said no' })
  expect(s.runs).toEqual([])
})

test('off by default: no hold until /hq web approvals on', async ($, on) => {
  const s = await boot($, on, { approvals: false })
  expect(await s.check()).toEqual(ASKED)
  expect(s.runs).toEqual([])
  expect(s.stored.pageApprovals).toBeUndefined()
})

test('no page server, or no page open (count 0, pages.json missing or unreadable): no hold', async ($, on) => {
  const s = await boot($, on)
  for (const pages of [JSON.stringify({ count: 0, at: 1 }), null, 'not json', JSON.stringify({ count: 'many' })]) {
    s.box.pages = pages
    expect([pages, await s.check()]).toEqual([pages, ASKED])
  }
  expect(s.runs).toEqual([])
})

test('no page server: no hold', async ($, on) => {
  const s = await boot($, on, { web: false })
  expect(await s.check()).toEqual(ASKED)
  expect(s.runs).toEqual([])
})

test('a query (no tool_use_id), AskUserQuestion, ExitPlanMode, a ceiling, a secret or a large input: no hold', async ($, on) => {
  const s = await boot($, on)
  const cases = [
    { tool_use_id: undefined },
    { tool: 'AskUserQuestion', input: { questions: [] } },
    { tool: 'ExitPlanMode', input: { plan: 'x' } },
    { ceiling: 'ask' },
    { input: { command: 'deploy --token=abc123def456' } },
    { input: { command: 'x'.repeat(21 * 1024) } },
    { input: { command: 'x'.repeat(19 * 1024) }, reasonSize: 2 * 1024 },
  ]
  for (const { reasonSize, ...change } of cases as (Record<string, unknown> & { reasonSize?: number })[]) {
    s.box.verdict = { decision: 'ask', reason: reasonSize ? 'r'.repeat(reasonSize) : 'needs a look' } // a long reason counts in the cap
    const { decision } = await s.check(change) // the engine stamps its ceiling on every verdict
    expect([change, decision]).toEqual([change, 'ask'])
  }
  expect(s.runs).toEqual([])
})

test("held only in default or acceptEdits mode, as last seen for that loop; a member's first call (mode never seen) is not held", async ($, on) => {
  const s = await boot($, on, { mode: null })
  expect(await s.check()).toEqual(ASKED) // the lead's mode never seen
  for (const mode of ['auto', 'plan', 'dontAsk', 'bypassPermissions']) {
    await s.prompt(mode)
    expect([mode, await s.check()]).toEqual([mode, ASKED])
  }
  expect(s.runs).toEqual([])
  await s.prompt('acceptEdits')
  expect((await s.check()).decision).toBe('allow')

  // a member: never seen, then seen in its own loop (the lead's mode is not its)
  expect(await s.check({ tool_use_id: 'm1', agentId: 'a1' })).toEqual(ASKED)
  expect(s.runs.length).toBe(1)
  await s.prompt('default', 'a1')
  expect((await s.check({ tool_use_id: 'm2', agentId: 'a1' })).decision).toBe('allow')
  await $.classic.PostToolUseFailure({ tool_name: 'Bash', tool_input: {}, tool_use_id: 'r1', error: 'x', permission_mode: 'auto', agent_id: 'a1' } as never)
  expect(await s.check({ tool_use_id: 'm3', agentId: 'a1' })).toEqual(ASKED)
  expect(s.runs.length).toBe(2)
})

test('one approval at a time: a second ask while one waits goes to the dialog at once', async ($, on) => {
  const s = await boot($, on)
  s.box.helper = 'waits'
  const first = s.check()
  await s.clock.settle()
  expect(await s.check({ tool_use_id: 'u2' })).toEqual(ASKED)
  expect(s.runs.length).toBe(1)
  s.box.helper = { stdout: 'allow\n' }
  s.box.release()
  expect((await first).decision).toBe('allow')
})

test('/hq web approvals on|off in English: stored, default off, a bare one says which', async ($, on) => {
  const s = await boot($, on, { approvals: false })
  expect(await s.command('web approvals')).toBe('Agent HQ: permission asks go to the usual dialog only. Turn page approvals on with /hq web approvals on.')
  expect(await s.command('web approvals on')).toBe('Agent HQ: while a live page is open, permission asks go to it first (up to 60 s), then to the usual dialog.')
  expect(s.stored.pageApprovals).toBe(true)
  expect(await s.command('web approvals off')).toBe('Agent HQ: permission asks go to the usual dialog only. Turn page approvals on with /hq web approvals on.')
  expect(s.stored.pageApprovals).toBe(false)
  expect(await s.command('web approvals please')).toBe('Agent HQ: use /hq web approvals on or /hq web approvals off.')
})

test('only the person turns approvals on: a plugin, a schedule or another session cannot; off and the status are open to all', async ($, on) => {
  const s = await boot($, on, { approvals: false })
  for (const origin of [{ kind: 'plugin', name: 'other' }, { kind: 'scheduled-trigger' }, { kind: 'peer' }]) {
    expect([origin.kind, await s.command('web approvals on', origin)]).toEqual([origin.kind, expect.stringContaining('only you can turn page approvals on')])
  }
  expect(s.stored.pageApprovals).toBeUndefined()
  expect(await s.command('web approvals on', { kind: 'bridge' })).toContain('permission asks go to it first')
  expect(await s.command('web approvals', { kind: 'plugin', name: 'other' })).toContain('permission asks go to it first')
  expect(await s.command('web approvals off', { kind: 'plugin', name: 'other' })).toContain('usual dialog only')
  expect(s.stored.pageApprovals).toBe(false)
})

test('a run the engine cannot attest turns approvals on only through the dialog, No first; a No or a dismissal keeps them off', async ($, on) => {
  const s = await boot($, on, { approvals: false })
  s.box.answer = 'No'
  expect(await s.command('web approvals on', { kind: 'unclassified' })).toContain('usual dialog only')
  s.box.answer = null
  expect(await s.command('web approvals on', { kind: 'unclassified' })).toContain('usual dialog only')
  expect(s.stored.pageApprovals).toBeUndefined()
  s.box.answer = 'Yes, turn them on'
  expect(await s.command('web approvals on', { kind: 'auto-continuation' })).toContain('permission asks go to it first')
  expect(s.stored.pageApprovals).toBe(true)
  expect(s.asked.length).toBe(3)
  expect(s.asked[0]).toContain('Turn on page approvals?')
})

test('with approvals on, no /hq web reply carries a login link: it shows in a notice only', async ($, on) => {
  const s = await boot($, on, { web: false })
  s.box.opens = false
  const running = await s.command('web') // first run, the browser could not be opened
  s.box.login = 'AGENT_HQ_PAGES 1\nAGENT_HQ_URL http://127.0.0.1:4321/?c=second\n'
  const already = await s.command('web') // a page is open
  s.box.login = 'AGENT_HQ_PAGES 0\nAGENT_HQ_URL http://127.0.0.1:4321/?c=third\n'
  s.box.opens = true
  const opened = await s.command('web')
  for (const reply of [running, already, opened]) expect([reply, reply.includes('?c=')]).toEqual([reply, false])
  expect(running).toContain('the link is in the notice')
  expect(already).toContain('the link is in the notice')
  expect(s.toasts.filter(text => text.includes('?c=')).length).toBe(2)
})

test('with approvals off, /hq web still says the link in its reply', async ($, on) => {
  const s = await boot($, on, { web: false, approvals: false })
  s.box.opens = false
  expect(await s.command('web')).toContain('?c=')
})

test('in Thai: the command replies, the toast and the request say Thai', { options: { language: 'thai' } }, async ($, on) => {
  const s = await boot($, on, { approvals: false })
  expect(await s.command('web approvals on')).toBe('Agent HQ: ขณะหน้าเรียลไทม์เปิดอยู่ คำขออนุญาตจะไปที่หน้านั้นก่อน (สูงสุด 60 วิ) แล้วจึงถามในกล่องถามตามปกติ')
  expect(await s.command('web approvals off')).toBe('Agent HQ: คำขออนุญาตจะถามในกล่องถามตามปกติเท่านั้น เปิดการอนุมัติบนหน้าเรียลไทม์ด้วย /hq web approvals on')
  expect(await s.command('web approvals please')).toBe('Agent HQ: ใช้ /hq web approvals on หรือ /hq web approvals off')
  await s.command('web approvals on')
  expect((await s.check()).decision).toBe('allow')
  expect(s.toasts).toContain('Agent HQ: รอคำตอบของคุณบนหน้าเรียลไทม์ (สูงสุด 60 วิ) กด Esc เพื่อยกเลิก')
  expect(JSON.parse(s.runs[0]?.init?.stdin ?? '').lang).toBe('th')
})
