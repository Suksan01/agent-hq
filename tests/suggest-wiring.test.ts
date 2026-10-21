// Next-task suggestions end to end: after the lead's answered turn, with the live page running and the setting on, one
// detached fork drafts a recap and up to three tasks into the snapshot; never for a member, without the page or when
// off; cleared when the lead's next turn starts; a failed fork logs and leaves none; /hq web next on|off in both languages.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { suggestPrompt } from '../hooks/suggest'

const STATE = '/home/me/.claude/agent-hq/live/sess.json'
type Suggestions = { recap: string | null; items: string[]; at: number } | null
type Snapshot = { suggestions?: Suggestions }
type Reply = { isAnswered: true; text: string; usage: Record<string, number> } | { isAnswered: false; reason: string }
type Session = {
  clock: MockClock
  forks: string[]
  logs: string[]
  stored: Record<string, unknown>
  /** Holds every fork until `release` answers it (the reply given, or a throw). */
  hold: () => void
  release: (reply: Reply | Error) => void
  snapshot: () => Promise<Snapshot>
  command: (args: string) => Promise<string>
}

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answer = (text: string): Reply => ({ isAnswered: true, text, usage: USAGE })
const REPLY = answer('{"recap": "The API is done. Tests pass.", "next": ["Commit the API work", "Write the README section"]}')

async function session($: Engine, on: On, options: { web?: boolean; stored?: Record<string, unknown> } = {}): Promise<Session> {
  const clock = mock.clock(on, { now: 5_000 })
  const snaps: Snapshot[] = []
  const forks: string[] = []
  const logs: string[] = []
  const stored: Record<string, unknown> = { languageAsked: true, ...options.stored }
  let reply: Reply | Error = REPLY
  let held: ((value: Reply | Error) => void)[] | null = null
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: '' }))
  on('fs.write', (_, e) => {
    if (e.path === STATE) snaps.push(JSON.parse(e.text))
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'AGENT_HQ_URL http://127.0.0.1:4321\n' }
    await new Promise(() => {})
    return { value: { code: 0, signal: null } }
  })
  on('model.fork', async (_, e) => {
    forks.push(e.prompt)
    const got = held ? await new Promise<Reply | Error>(resolve => held?.push(resolve)) : reply
    return (got instanceof Error ? { deny: got.message } : { value: got }) as never // a deny rejects the caller's fork
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: [{ id: 'a1', name: 'dev-1', type: 'general-purpose', description: 'x', status: 'running' }] }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  for (const event of ['ui.status', 'ui.open', 'ui.toast', 'command.register'] as const) on(event, () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: false } as never)
  const command = async (args: string) => ((await $.command.run({ command: 'hq', args, origin: { kind: 'composer' }, presentation: {} } as never)) as { text: string }).text
  if (options.web !== false) await command('web')
  await clock.settle()
  return {
    clock,
    forks,
    logs,
    stored,
    hold: () => void (held = []),
    release: given => {
      reply = given
      const waiting = held ?? []
      held = null
      for (const resolve of waiting) resolve(given)
    },
    // the page's state is written at most every 50 ms: past that, the last write holds everything so far
    snapshot: async () => {
      await clock.settle()
      await clock.advance(60)
      return snaps.at(-1) ?? {}
    },
    command,
  }
}

const leadTurn = ($: Engine, turnId: string, extra: Record<string, unknown> = {}) =>
  $.turn.complete({ answer: 'Done: the API works.', durationMs: 5, isAborted: false, turnId, reason: 'answer', ...extra } as never)

test("after the lead's answered turn with the page running, one fork drafts a recap and up to three tasks into the snapshot", async ($, on) => {
  const s = await session($, on)
  expect((await s.snapshot()).suggestions).toBeNull()
  await leadTurn($, 't1')
  const got = (await s.snapshot()).suggestions
  expect(s.forks).toEqual([suggestPrompt('en')])
  expect(got).toEqual({ recap: 'The API is done. Tests pass.', items: ['Commit the API work', 'Write the README section'], at: expect.any(Number) })
})

test("in Thai the fork is asked for Thai", { options: { language: 'thai' } }, async ($, on) => {
  const s = await session($, on)
  await leadTurn($, 't1')
  await s.snapshot()
  expect(s.forks).toEqual([suggestPrompt('th')])
})

test("no fork for a member's turn, an interrupted or failed lead turn, without the page, or when off", async ($, on) => {
  const s = await session($, on)
  await leadTurn($, 'm1', { agentId: 'a1' })
  await leadTurn($, 't1', { reason: 'aborted', isAborted: true })
  await leadTurn($, 't2', { reason: 'error' })
  await s.snapshot()
  expect(s.forks).toEqual([])

  await s.command('web next off')
  await leadTurn($, 't3')
  await s.snapshot()
  expect(s.forks).toEqual([])
  expect(s.stored.nextTasksOff).toBe(true)

  await s.command('web next on')
  await leadTurn($, 't4')
  await s.snapshot()
  expect(s.forks.length).toBe(1)
})

test('no page, no fork', async ($, on) => {
  const s = await session($, on, { web: false })
  await leadTurn($, 't1')
  await s.clock.settle()
  expect(s.forks).toEqual([])
})

test("the lead's next turn start clears them; a fork still running then is ignored", async ($, on) => {
  const s = await session($, on)
  await leadTurn($, 't1')
  expect((await s.snapshot()).suggestions?.items.length).toBe(2)
  await $.turn.start({ text: 'commit it', turnId: 't2', agentId: 'a1' } as never) // a member's start changes nothing
  expect((await s.snapshot()).suggestions?.items.length).toBe(2)
  await $.turn.start({ text: 'commit it', turnId: 't2' } as never)
  expect((await s.snapshot()).suggestions).toBeNull()

  s.hold()
  await leadTurn($, 't2')
  await $.turn.start({ text: 'next', turnId: 't3' } as never)
  s.release(REPLY)
  expect((await s.snapshot()).suggestions).toBeNull()
})

test('turning it off clears what shows', async ($, on) => {
  const s = await session($, on)
  await leadTurn($, 't1')
  expect((await s.snapshot()).suggestions).not.toBeNull()
  await s.command('web next off')
  expect((await s.snapshot()).suggestions).toBeNull()
})

test('nothing blocks turn.complete, and one fork runs at a time: the latest answered turn gets the next one', async ($, on) => {
  const s = await session($, on)
  s.hold()
  expect(await leadTurn($, 't1')).toEqual({ text: 'Done: the API works.' }) // the fork never answered, the turn ended anyway
  await leadTurn($, 't2')
  await s.clock.settle()
  expect(s.forks.length).toBe(1)
  s.release(answer('{"recap": "Second.", "next": ["Push"]}'))
  const got = (await s.snapshot()).suggestions
  expect(s.forks.length).toBe(2) // t1's answer was stale: forked again for t2
  expect(got).toEqual({ recap: 'Second.', items: ['Push'], at: expect.any(Number) })
})

test('a failing fork logs and leaves no suggestion', async ($, on) => {
  const s = await session($, on)
  s.release(new Error('boom'))
  await leadTurn($, 't1')
  expect((await s.snapshot()).suggestions).toBeNull()
  expect(s.logs.some(line => line.includes('boom'))).toBe(true)

  s.release({ isAnswered: false, reason: 'api-error' })
  await leadTurn($, 't2')
  expect((await s.snapshot()).suggestions).toBeNull()
  expect(s.logs.some(line => line.includes('api-error'))).toBe(true)

  s.release(answer('no json here'))
  await leadTurn($, 't3')
  expect((await s.snapshot()).suggestions).toBeNull()
})

test('/hq web next on|off answers in English and keeps the choice; a bare one says which', async ($, on) => {
  const s = await session($, on)
  expect(await s.command('web next off')).toBe('Agent HQ will not suggest next tasks on the live page. Turn it back on with /hq web next on.')
  expect(await s.command('web next')).toBe('Agent HQ will not suggest next tasks on the live page. Turn it back on with /hq web next on.')
  expect(await s.command('web next on')).toBe("Agent HQ will suggest up to 3 next tasks on the live page after each of the lead's turns.")
  expect(s.stored.nextTasksOff).toBe(false)
  expect(await s.command('web next maybe')).toBe('Agent HQ: use /hq web next on or /hq web next off.')
})

test('/hq web next on|off answers in Thai', { options: { language: 'thai' } }, async ($, on) => {
  const s = await session($, on)
  expect(await s.command('web next off')).toBe('Agent HQ จะไม่แนะนำงานถัดไปบนหน้าเรียลไทม์ เปิดอีกครั้งด้วย /hq web next on')
  expect(await s.command('web next on')).toBe('Agent HQ จะแนะนำงานถัดไปสูงสุด 3 ข้อบนหน้าเรียลไทม์ หลังหัวหน้าตอบแต่ละรอบ')
  expect(await s.command('web next maybe')).toBe('Agent HQ: ใช้ /hq web next on หรือ /hq web next off')
})
