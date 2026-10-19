// The live page's action path, driven end to end through `/hq web`: the page's requests arrive as `AGENT_HQ_ACTION` lines
// on the server's stdout, the plugin runs each once, says the result in the snapshot and as a toast, and acknowledges
// it with `lastAction` in the state file.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, SessionSendResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { MAIN } from '../hooks/model'
import { TEAM_FILE } from '../hooks/team'

const STATE = '/home/me/.claude/agent-hq/live/sess.json'
const POLL_MS = 1000
const LIVE_COOLDOWN_MS = 50 // the plugin writes the live state at most this often

const TEAM = {
  name: 'Booking App Team',
  purpose: 'Build the booking app',
  lead: { title: 'Tech Lead', rules: [], skills: [] },
  roles: [
    { id: 'frontend-dev', title: 'Frontend Developer', count: 2, mission: 'Build pages.', tasks: [], rules: [], skills: [] },
    { id: 'qa', title: 'QA Engineer', count: 1, mission: 'Test.', tasks: [], rules: [], skills: [] },
  ],
}

const agent = (id: string, name: string, status: AgentInfo['status'] = 'running', type = 'agent-hq:frontend-dev'): AgentInfo => ({ id, name, type, description: 'work', status })

type Notice = { seq: number; ok: boolean; text: string }
type SpawnArgs = { prompt: string; description?: string; subagent_type?: string; name?: string }
type Options = {
  team?: boolean
  /** HOME is not set */
  noHome?: boolean
  /** the server never prints its URL */
  noUrl?: boolean
  /** `server.mjs --login` fails */
  loginFails?: boolean
  submitThrows?: string
  /** each prompt.submit takes this long on the mock clock */
  submitDelayMs?: number
  agents?: AgentInfo[]
  /** requests the server printed before it announced its URL (it replays the unacknowledged ones on start) */
  replay?: Record<string, unknown>[]
  /** answers each agent.spawn; default starts the agent and lists it */
  spawn?: (args: SpawnArgs, started: (info: AgentInfo) => void) => Promise<unknown> | unknown
}

/** Boots the plugin as a session does, opens the live page (`/hq web`) over a fake server child, and hands back the seams. */
async function liveSession($: Engine, on: On, options: Options = {}) {
  const clock = mock.clock(on)
  const files = new Map<string, string>()
  if (options.team) files.set(`/work/app/${TEAM_FILE}`, JSON.stringify(TEAM))
  // the project's team file is used only once approved: these sessions have approved this one
  mock.store(on, options.team ? { approvedTeams: withApproval([], `/work/app/${TEAM_FILE}`, JSON.stringify(TEAM)) } : {})
  const listed: AgentInfo[] = [...(options.agents ?? [])]
  const toasts: string[] = []
  const logs: string[] = [] // debug log lines the plugin wrote
  const snapshots: { notice: Notice | null; hideFinished: boolean; agents: { id: string; status: string }[]; lastAction: number; events: { n: number; at: number; agent: string; kind: string; text: string }[] }[] = []
  const commands: string[][] = []
  const writtenPaths: string[] = []
  const spawnArgv: string[][] = []
  const lines: string[] = [] // what the server child has printed and the plugin has not read yet
  let stopped = false
  let wake: () => void = () => {}
  const spawns: SpawnArgs[] = []
  const prompts: string[] = []
  const sends: { to: unknown; text: string }[] = []
  const stops: unknown[] = []
  const finish = () => {
    stopped = true
    wake()
  }

  on('env.get', () => ({ value: options.noHome ? undefined : '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    if (e.path === STATE) snapshots.push(JSON.parse(e.text))
    writtenPaths.push(e.path)
    return { value: undefined }
  })
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('agent.list', () => ({ value: [...listed] }))
  on('agent.spawn', async (_, e) => {
    const args = e as unknown as SpawnArgs
    spawns.push(args)
    const started = (info: AgentInfo) => void listed.push(info)
    if (options.spawn) return (await options.spawn(args, started)) as never
    const id = `s${spawns.length}`
    started(agent(id, args.name ?? id, 'running', args.subagent_type))
    return { model: 'sonnet', agentId: id }
  })
  on('prompt.submit', async (_, e) => {
    if (options.submitDelayMs) await clock.sleep(options.submitDelayMs)
    if (options.submitThrows) throw new Error(options.submitThrows)
    prompts.push(e.text)
    return { text: e.text }
  })
  on('session.send', (_, e) => {
    sends.push({ to: e.to, text: e.text })
    return sendAnswer.current
  })
  on('tool.call', (_, e) => {
    if ((e.tool as string) === 'TaskStop') {
      stops.push(e)
      return stopAnswer.current as never
    }
    return { result: {} as never }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('process.run', (_, e) => {
    commands.push([...e.argv])
    // `server.mjs --login` prints a fresh one-time link (or fails, when the test says so)
    if (e.argv.includes('--login')) {
      const failed = options.loginFails === true
      return { value: { exitCode: failed ? 1 : 0, stdout: failed ? '' : `AGENT_HQ_URL http://127.0.0.1:4321/?c=fresh${commands.length}\n`, stderr: failed ? 'agent-hq web: no page is running\n' : '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  // the page server: prints what the test queued (replayed requests come before the URL, as the real one does), its
  // URL, then more as the test posts, until the test lets go
  on('process.spawn', async function* (_, e) {
    spawnArgv.push([...e.argv])
    for (;;) {
      while (lines.length > 0) yield { stream: 'stdout' as const, text: lines.shift() as string }
      if (stopped) break
      await new Promise<void>(resolve => (wake = resolve))
    }
    return { value: { code: 0, signal: null } }
  })
  on('session.start', (_, e) => e)

  const sendAnswer: { current: SessionSendResult } = { current: { isDelivered: true } }
  const stopAnswer: { current: unknown } = { current: { result: {} } }

  const send = (...texts: string[]) => {
    lines.push(...texts)
    wake()
  }
  if (options.replay) send(...options.replay.map(a => `AGENT_HQ_ACTION ${JSON.stringify(a)}\n`))
  if (!options.noUrl) send('AGENT_HQ_URL http://127.0.0.1:4321\n')

  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  const opened = $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} } as never) as Promise<{ text: string }>
  if (!options.noUrl) await opened
  await clock.settle()

  const last = () => snapshots[snapshots.length - 1]
  return {
    clock,
    toasts,
    logs,
    spawns,
    prompts,
    sends,
    stops,
    listed,
    sendAnswer,
    stopAnswer,
    snapshots,
    commands,
    writtenPaths,
    spawnArgv,
    opened,
    /** the server prints the page's requests; `id` rises with each */
    post: (...actions: Record<string, unknown>[]) => send(...actions.map(a => `AGENT_HQ_ACTION ${JSON.stringify(a)}\n`)),
    /** whatever else the server prints, line by line as given */
    postRaw: (...texts: string[]) => send(...texts),
    /** lets the next poll run */
    poll: async (ms = POLL_MS) => {
      await clock.advance(ms)
      for (let i = 0; i < 3; i++) await clock.advance(LIVE_COOLDOWN_MS + 1) // the state writes held back by the 50 ms spacing
      await clock.settle()
    },
    notice: () => last()?.notice ?? null,
    snapshot: last,
    finish,
  }
}

test('spawn starts an agent of a team role under the next free name and says so on the page and as a toast', async ($, on) => {
  const s = await liveSession($, on, { team: true })

  s.post({ id: 1, type: 'spawn', role: 'frontend-dev', task: 'Build the search page' })
  await s.poll()

  expect(s.spawns).toHaveLength(1)
  expect(s.spawns[0]).toMatchObject({ prompt: 'Build the search page', subagent_type: 'agent-hq:frontend-dev', name: 'frontend-dev-1' })
  expect(s.notice()).toEqual({ seq: 1, ok: true, text: expect.stringMatching(/^started \S+ \(frontend-dev-1\) as Frontend Developer$/) })
  expect(s.toasts.some(t => /^Agent HQ \(live page\): started \S+ \(frontend-dev-1\) as Frontend Developer$/.test(t))).toBe(true)
  s.finish()
})

test('spawn without a team starts a general-purpose agent', async ($, on) => {
  const s = await liveSession($, on)

  s.post({ id: 1, type: 'spawn', role: 'general-purpose', task: 'Look around' })
  await s.poll()

  expect(s.spawns[0]).toMatchObject({ prompt: 'Look around', subagent_type: 'general-purpose', name: 'general-purpose-1' })
  expect(s.notice()).toMatchObject({ seq: 1, ok: true })
  s.finish()
})

test('spawn skips names already taken', async ($, on) => {
  const s = await liveSession($, on, { team: true, agents: [agent('x1', 'frontend-dev-1')] })

  s.post({ id: 1, type: 'spawn', role: 'frontend-dev', task: 'Second one' })
  await s.poll()

  expect(s.spawns[0]?.name).toBe('frontend-dev-2')
  s.finish()
})

test('lead sends the person message to the main session, framed as coming from the live page', async ($, on) => {
  const s = await liveSession($, on, { team: true })

  s.post({ id: 1, type: 'lead', text: 'Please prioritise checkout' })
  await s.poll()

  expect(s.prompts).toHaveLength(1)
  expect(s.prompts[0]).toContain('Agent HQ live page')
  expect(s.prompts[0]).toContain('Please prioritise checkout')
  expect(s.notice()).toEqual({ seq: 1, ok: true, text: 'message queued for the lead' })
  expect(s.toasts).toContain('Agent HQ (live page): message queued for the lead')
  s.finish()
})

test('message reaches the agent by id, and a refusal is reported with its reason', async ($, on) => {
  const s = await liveSession($, on, { team: true, agents: [agent('d1', 'frontend-dev-1')] })

  s.post({ id: 1, type: 'message', agent: 'd1', text: 'Use the new API' })
  await s.poll()
  expect(s.sends).toEqual([{ to: expect.anything(), text: 'Message from the person, sent from the Agent HQ live page:\n\nUse the new API' }])
  expect(JSON.stringify(s.sends[0]?.to)).toContain('d1')
  expect(s.notice()).toEqual({ seq: 1, ok: true, text: expect.stringMatching(/^message sent to \S+ \(frontend-dev-1\)$/) })

  s.sendAnswer.current = { isDelivered: false, reason: 'recipient gone' }
  s.post({ id: 2, type: 'message', agent: 'd1', text: 'Hello?' })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 2, ok: false, text: expect.stringMatching(/^\S+ \(frontend-dev-1\) did not get it: recipient gone$/) })
  s.finish()
})

test('message to an unknown agent or to main is refused without sending', async ($, on) => {
  const s = await liveSession($, on, { team: true })

  s.post({ id: 1, type: 'message', agent: 'nobody', text: 'hi' }, { id: 2, type: 'message', agent: MAIN, text: 'hi' })
  await s.poll()

  expect(s.sends).toEqual([])
  expect(s.notice()).toEqual({ seq: 2, ok: false, text: 'no such agent' })
  expect(s.toasts.filter(t => t.includes('no such agent'))).toHaveLength(2)
  s.finish()
})

test('stop asks the session TaskStop tool to end a running agent', async ($, on) => {
  const s = await liveSession($, on, { team: true, agents: [agent('d1', 'frontend-dev-1')] })

  s.post({ id: 1, type: 'stop', agent: 'd1' })
  await s.poll()

  expect(s.stops).toHaveLength(1)
  expect(s.stops[0]).toMatchObject({ tool: 'TaskStop', task_id: 'd1' })
  expect(s.notice()).toEqual({ seq: 1, ok: true, text: expect.stringMatching(/^stopped \S+ \(frontend-dev-1\)$/) })
  s.finish()
})

test('stop on a finished agent and on main is refused without calling TaskStop', async ($, on) => {
  const s = await liveSession($, on, { team: true, agents: [agent('d1', 'frontend-dev-1', 'completed')] })

  s.post({ id: 1, type: 'stop', agent: 'd1' })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 1, ok: false, text: expect.stringMatching(/^\S+ \(frontend-dev-1\) has already finished$/) })

  s.post({ id: 2, type: 'stop', agent: MAIN })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 2, ok: false, text: 'no such agent' })
  expect(s.stops).toEqual([])
  s.finish()
})

test('stop reports the session refusing TaskStop', async ($, on) => {
  const s = await liveSession($, on, { team: true, agents: [agent('d1', 'frontend-dev-1')] })
  s.stopAnswer.current = { deny: 'not allowed' }

  s.post({ id: 1, type: 'stop', agent: 'd1' })
  await s.poll()

  expect(s.notice()).toEqual({ seq: 1, ok: false, text: expect.stringMatching(/^could not stop \S+ \(frontend-dev-1\): not allowed$/) })
  s.finish()
})

test('finished hides, shows and clears done agents on the page', async ($, on) => {
  const s = await liveSession($, on, { team: true, agents: [agent('d1', 'frontend-dev-1', 'completed'), agent('d2', 'frontend-dev-2')] })
  expect(s.snapshot()?.hideFinished).toBe(false)

  s.post({ id: 1, type: 'finished', mode: 'hide' })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 1, ok: true, text: 'finished agents hidden' })
  expect(s.snapshot()?.hideFinished).toBe(true)

  s.post({ id: 2, type: 'finished', mode: 'show' })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 2, ok: true, text: 'finished agents shown' })
  expect(s.snapshot()?.hideFinished).toBe(false)

  expect(s.snapshot()?.agents.map(a => a.id)).toContain('d1')
  s.listed.splice(0, 1) // d1 leaves the list for good, so only a clear can drop its row
  s.post({ id: 3, type: 'finished', mode: 'clear' })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 3, ok: true, text: 'finished agents and tasks cleared' })
  expect(s.snapshot()?.agents.map(a => a.id)).toEqual([MAIN, 'd2'])
  s.finish()
})

test('an unknown request type is reported, not run', async ($, on) => {
  const s = await liveSession($, on, { team: true })

  s.post({ id: 1, type: 'launch-missiles' })
  await s.poll()

  expect(s.notice()).toEqual({ seq: 1, ok: false, text: 'unknown request' })
  expect(s.spawns).toEqual([])
  s.finish()
})

test('a batch of two requests runs each exactly once, even when the poll fires while the first is still starting', async ($, on) => {
  // the spawn is slow, so the 1 s poll (and the plugin own agent.spawn hook, which re-syncs) re-enter the action pass mid-batch
  let slow: Promise<void> = Promise.resolve()
  const s = await liveSession($, on, {
    team: true,
    spawn: async (args, started) => {
      await slow
      started(agent(`s${args.name}`, args.name ?? '?', 'running', args.subagent_type))
      return { model: 'sonnet', agentId: `s${args.name}` }
    },
  })
  slow = s.clock.sleep(2500)

  s.post({ id: 1, type: 'spawn', role: 'frontend-dev', task: 'First' }, { id: 2, type: 'spawn', role: 'frontend-dev', task: 'Second' })
  await s.poll(10_000)

  expect(s.spawns.map(a => a.prompt)).toEqual(['First', 'Second'])
  expect(s.spawns.map(a => a.name)).toEqual(['frontend-dev-1', 'frontend-dev-2'])
  expect(s.toasts.filter(t => t.startsWith('Agent HQ (live page)'))).toHaveLength(2)

  await s.poll(5000) // later polls find nothing new
  expect(s.spawns).toHaveLength(2)
  expect(s.notice()?.seq).toBe(2)
  s.finish()
})

test('a request already run is never run again, however many polls pass or lines are re-read', async ($, on) => {
  const s = await liveSession($, on, { team: true })

  s.post({ id: 1, type: 'lead', text: 'once' })
  await s.poll()
  await s.poll()
  await s.poll()

  expect(s.prompts).toHaveLength(1)
  s.finish()
})

test('a request at or below the last run id is skipped, a higher one runs, junk lines are ignored', async ($, on) => {
  const s = await liveSession($, on, { team: true })
  s.post({ id: 5, type: 'lead', text: 'five' })
  await s.poll()
  expect(s.prompts).toHaveLength(1)

  s.postRaw(
    `AGENT_HQ_ACTION ${JSON.stringify({ id: 3, type: 'lead', text: 'three' })}\n`,
    `AGENT_HQ_ACTION ${JSON.stringify({ id: 5, type: 'lead', text: 'five again' })}\n`,
    'AGENT_HQ_ACTION { not json\n',
    'agent-hq web: some log line\n',
    `AGENT_HQ_ACTION ${JSON.stringify({ id: 'nine', type: 'lead', text: 'string id' })}\n`,
    `AGENT_HQ_ACTION ${JSON.stringify({ type: 'lead', text: 'no id' })}\n`,
    `AGENT_HQ_ACTION ${JSON.stringify({ id: 6, type: 'lead', text: 'six' })}\n`,
  )
  await s.poll()

  expect(s.prompts).toHaveLength(2)
  expect(s.prompts[1]).toContain('six')
  expect(s.notice()?.seq).toBe(6)
  s.finish()
})

test('a request that throws is reported as failed and never retried', async ($, on) => {
  const s = await liveSession($, on, { team: true, submitThrows: 'queue is closed' })

  s.post({ id: 1, type: 'lead', text: 'hello' })
  await s.poll()
  await s.poll()

  expect(s.notice()).toMatchObject({ seq: 1, ok: false })
  expect(s.toasts.filter(t => t.startsWith('Agent HQ (live page)'))).toHaveLength(1)
  s.finish()
})

test('spawn of an unknown role, without a task, or past the role count is refused without starting anything', async ($, on) => {
  const s = await liveSession($, on, { team: true, agents: [agent('q1', 'qa-1', 'running', 'agent-hq:qa')] })

  s.post({ id: 1, type: 'spawn', role: 'ghost', task: 'x' })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 1, ok: false, text: 'no role "ghost" in the team' })

  s.post({ id: 2, type: 'spawn', role: 'frontend-dev', task: '   ' })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 2, ok: false, text: 'the request had no task' })

  s.post({ id: 3, type: 'spawn', role: 'qa', task: 'one more' })
  await s.poll()
  expect(s.notice()).toEqual({ seq: 3, ok: false, text: 'QA Engineer is fully staffed (1 of 1 at work) — ask the lead to hire another' })

  expect(s.spawns).toEqual([])
  expect(s.toasts.filter(t => t.startsWith('Agent HQ (live page)'))).toHaveLength(3)
  s.finish()
})

test('a general-purpose spawn is refused when the team does not have that role', async ($, on) => {
  const s = await liveSession($, on, { team: true })

  s.post({ id: 1, type: 'spawn', role: 'general-purpose', task: 'x' })
  await s.poll()

  expect(s.notice()).toEqual({ seq: 1, ok: false, text: 'no role "general-purpose" in the team' })
  s.finish()
})

test('a spawn that throws reports ok:false with the reason', async ($, on) => {
  const s = await liveSession($, on, {
    team: true,
    spawn: () => {
      throw new Error('out of slots')
    },
  })

  s.post({ id: 1, type: 'spawn', role: 'frontend-dev', task: 'x' })
  await s.poll()

  expect(s.notice()?.ok).toBe(false)
  expect(s.notice()?.seq).toBe(1)
  s.finish()
})

test('a spawn the session denies reports ok:false with the denial', async ($, on) => {
  const s = await liveSession($, on, { team: true, spawn: () => ({ deny: 'spawning is not allowed here' }) })

  s.post({ id: 1, type: 'spawn', role: 'frontend-dev', task: 'x' })
  await s.poll()

  expect(s.notice()?.ok).toBe(false)
  expect(s.notice()?.text).toContain('spawning is not allowed here')
  s.finish()
})

// ---- the channel itself: acknowledgement, replay, the feed, and starting the server ----

test('the state file acknowledges a handled request with lastAction, and is written with a plain write', async ($, on) => {
  const s = await liveSession($, on, { team: true })
  expect(s.snapshot()?.lastAction).toBe(0)

  s.post({ id: 4, type: 'lead', text: 'hello' })
  await s.poll()

  expect(s.snapshot()?.lastAction).toBe(4)
  expect(s.commands.filter(argv => argv[0] === 'mv')).toEqual([]) // no process per write
  expect(s.writtenPaths.every(path => path === STATE)).toBe(true)
  s.finish()
})

test('the state is written as soon as a request is handled, not on the next poll', async ($, on) => {
  const s = await liveSession($, on, { team: true })
  await s.poll() // the first poll after /hq web starts taking requests
  const before = s.snapshots.length

  s.post({ id: 1, type: 'lead', text: 'now' })
  await s.clock.settle() // no clock advance: the 1 s poll has not fired

  expect(s.prompts).toHaveLength(1)
  expect(s.snapshots.length).toBeGreaterThan(before)
  expect(s.snapshot()?.lastAction).toBe(1)
  s.finish()
})

test('the server printing the same request again and again runs it once', async ($, on) => {
  const s = await liveSession($, on, { team: true })

  for (let i = 0; i < 4; i++) {
    s.post({ id: 1, type: 'lead', text: 'once' })
    await s.poll()
  }

  expect(s.prompts).toHaveLength(1)
  s.finish()
})

test('requests the server replays before its URL are run, in order, and acknowledged once the page state exists', async ($, on) => {
  const s = await liveSession($, on, {
    team: true,
    replay: [
      { id: 1, type: 'lead', text: 'first' },
      { id: 2, type: 'lead', text: 'second' },
    ],
  })
  await s.clock.settle()
  expect(s.prompts).toEqual([]) // not while /hq web is still starting: the engine refuses a prompt.submit from that command
  await s.poll()

  expect(s.prompts.map(p => p.split('\n\n').pop())).toEqual(['first', 'second'])
  expect(s.snapshot()?.lastAction).toBe(2)
  s.finish()
})

test('the server is started with --acked set to the last request already handled', async ($, on) => {
  const s = await liveSession($, on, { team: true })

  expect(s.spawnArgv[0]?.slice(-4)).toEqual(['--state', STATE, '--acked', '0'])
  s.finish()
})

test('the activity feed numbers what happened: tools, status changes, page requests', async ($, on) => {
  const s = await liveSession($, on, { team: true, agents: [agent('d1', 'frontend-dev-1')] })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await call({ tool: 'TodoWrite', todos: [{ content: 'Read', status: 'completed', activeForm: 'Reading' }] })
  s.listed.splice(0, 1, agent('d1', 'frontend-dev-1', 'completed'))
  await s.poll()
  s.post({ id: 1, type: 'message', agent: 'd1', text: 'thanks' }, { id: 2, type: 'finished', mode: 'hide' })
  await s.poll()

  const events = s.snapshot()?.events ?? []
  expect(events.map(e => [e.agent, e.kind, e.text])).toEqual(
    expect.arrayContaining([
      [MAIN, 'tool', 'used TodoWrite'],
      [MAIN, 'step', 'done: Read'],
      ['d1', 'status', 'running → completed'],
      ['d1', 'message', expect.stringMatching(/^message sent to \S+ \(frontend-dev-1\)$/)],
      [MAIN, 'action', 'finished agents hidden'],
    ]),
  )
  const ns = events.map(e => e.n)
  expect(ns).toEqual([...ns].sort((a, b) => a - b))
  expect(new Set(ns).size).toBe(ns.length)
  s.finish()
})

test('without HOME the live page is refused, naming the cause', async ($, on) => {
  const s = await liveSession($, on, { team: true, noHome: true, noUrl: true })
  const answer = await s.opened

  expect(answer.text).toContain('HOME is not set')
  expect(s.spawnArgv).toEqual([])
  s.finish()
})

test('a server that never prints its URL is given up on after 10 seconds, and its child is let go', async ($, on) => {
  const s = await liveSession($, on, { team: true, noUrl: true })
  await s.clock.advance(9_000)
  let settled = false
  void s.opened.then(() => (settled = true))
  await s.clock.settle()
  expect(settled).toBe(false)

  await s.clock.advance(2_000)
  const answer = await s.opened

  expect(answer.text).toContain('did not start within 10 seconds')
  s.finish()
})

const lineOf = (action: Record<string, unknown>) => `AGENT_HQ_ACTION ${JSON.stringify(action)}\n`
const lead = (id: number) => ({ id, type: 'lead', text: `msg-${id}` })
const textsOf = (prompts: string[]) => prompts.map(p => p.split('\n\n').pop())

test('a request printed while a pass is still running is not lost, and its repeats run nothing', async ($, on) => {
  let slow: Promise<void> = Promise.resolve()
  const s = await liveSession($, on, {
    team: true,
    spawn: async (args, started) => {
      await slow
      started(agent('slow1', args.name ?? '?', 'running', args.subagent_type))
      return { model: 'sonnet', agentId: 'slow1' }
    },
  })
  await s.poll()
  slow = s.clock.sleep(3000)

  s.post({ id: 1, type: 'spawn', role: 'frontend-dev', task: 'Slow one' })
  await s.clock.settle() // request 1 is now in flight, waiting on its slow spawn
  expect(s.spawns).toHaveLength(1)
  s.post(lead(2)) // arrives mid-pass
  await s.clock.settle()
  s.postRaw(lineOf({ id: 1, type: 'spawn', role: 'frontend-dev', task: 'Slow one' }), lineOf(lead(2))) // the server repeats both, mid-pass
  await s.clock.settle()
  expect(s.prompts).toEqual([]) // request 2 waits its turn: ids run in order

  await s.poll(10_000)

  expect(s.spawns).toHaveLength(1)
  expect(textsOf(s.prompts)).toEqual(['msg-2'])
  expect(s.snapshot()?.lastAction).toBe(2)
  expect(s.notice()?.seq).toBe(2)
  s.finish()
})

test('the same request twice in one stdout piece, or cut across pieces, runs once', async ($, on) => {
  const s = await liveSession($, on, { team: true })
  const second = lineOf(lead(2))

  s.postRaw(lineOf(lead(1)) + lineOf(lead(1)) + second.slice(0, 20)) // a repeat in the same piece, then half of the next line
  await s.clock.settle()
  s.postRaw(second.slice(20) + lineOf(lead(2))) // the rest of it, and its repeat in the same piece
  await s.poll()

  expect(textsOf(s.prompts)).toEqual(['msg-1', 'msg-2'])
  expect(s.snapshot()?.lastAction).toBe(2)
  s.finish()
})

test('30 requests, each printed up to three times, in pieces cut anywhere while handling is slow: every one runs once, in order', async ($, on) => {
  const s = await liveSession($, on, { team: true, submitDelayMs: 20 })
  await s.poll()

  // a fixed pseudo-random stream: request n, now and then a repeat of an earlier one, cut into odd pieces
  let seed = 12345
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
  let text = ''
  for (let id = 1; id <= 30; id++) {
    text += lineOf(lead(id))
    if (id > 1 && rand(2) === 0) text += lineOf(lead(1 + rand(id - 1)))
    if (id > 2 && rand(3) === 0) text += lineOf(lead(1 + rand(id - 1)))
  }
  for (let at = 0; at < text.length; ) {
    const size = 1 + rand(90)
    s.postRaw(text.slice(at, at + size))
    at += size
    await s.clock.advance(1 + rand(12)) // handlers (20 ms each) overlap the next pieces
  }
  await s.poll(10_000)

  expect(textsOf(s.prompts)).toEqual(Array.from({ length: 30 }, (_, i) => `msg-${i + 1}`))
  expect(s.snapshot()?.lastAction).toBe(30)
  expect(s.notice()?.seq).toBe(30)
  s.finish()
})

test('a burst of state changes ends with the last state on disk, in far fewer writes', async ($, on) => {
  const s = await liveSession($, on, { team: true })
  await s.poll()
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  const before = s.snapshots.length

  for (let i = 1; i <= 30; i++) await call({ tool: 'TodoWrite', todos: [{ content: `step ${i}`, status: 'in_progress', activeForm: `Doing step ${i}` }] })
  await s.poll(0)

  expect(JSON.stringify(s.snapshot())).toContain('Doing step 30')
  expect(s.snapshots.length - before).toBeLessThan(10)
  s.finish()
})

test('/hq web run again opens a fresh one-time link (the first is spent), asked of the hub with --login', async ($, on) => {
  const s = await liveSession($, on, { team: true })
  const run = () => $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} } as never) as Promise<{ text: string }>

  const again = await run()
  const third = await run()

  const logins = s.commands.filter(argv => argv.includes('--login'))
  expect(logins).toHaveLength(2)
  expect(logins[0]).toEqual(['node', expect.stringMatching(/web\/server\.mjs$/), '--login', '--state', '/home/me/.claude/agent-hq/live/sess.json'])
  expect(again.text).toMatch(/^Agent HQ live page opened: http:\/\/127\.0\.0\.1:4321\/\?c=fresh\d+$/)
  expect(third.text).not.toBe(again.text) // every run mints its own
  expect(s.commands.filter(argv => argv[0] === 'open').at(-1)?.[1]).toContain('?c=fresh') // and opens that one
  s.finish()
})

test('/hq web run again says so when the hub cannot give a new link, instead of opening a dead one', async ($, on) => {
  const s = await liveSession($, on, { team: true, loginFails: true })

  const again = (await $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} } as never)) as { text: string }

  expect(again.text).toContain('could not start its live page')
  expect(again.text).toContain('no page is running')
  expect(s.commands.filter(argv => argv[0] === 'open')).toHaveLength(1) // only the first run opened a page
  s.finish()
})

test('the server\'s repeated prints of a request wait once, and run once, in id order', async ($, on) => {
  const printed = (id: number) => ({ id, type: 'lead', text: `request ${id}` })
  const s = await liveSession($, on, { team: true, replay: [printed(3), printed(1), printed(2), printed(1), printed(3), printed(2), printed(3), printed(1)] })

  await s.poll()
  expect(s.prompts.map(p => p.split('\n\n').pop())).toEqual(['request 1', 'request 2', 'request 3'])
  await s.poll()
  expect(s.prompts).toHaveLength(3)
  s.finish()
})

// a hot reload ends the module and its page server, then runs session.start again with the session's state kept
test('after /hq web, a session.start (a hot reload) starts the live page again without opening another tab', async ($, on) => {
  const s = await liveSession($, on)
  expect(s.spawnArgv).toHaveLength(1)
  const opensBefore = s.commands.filter(argv => argv[0] === 'open').length

  s.finish() // the server's output ends, as when the reload killed it
  await s.clock.settle()
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  await s.clock.settle()

  expect(s.spawnArgv).toHaveLength(2)
  expect(s.spawnArgv[1].some(arg => arg.endsWith('/web/server.mjs'))).toBe(true)
  expect(s.commands.filter(argv => argv[0] === 'open')).toHaveLength(opensBefore)
})

test('a session that never ran /hq web starts no page on session.start', async ($, on) => {
  const s = await liveSession($, on, { noUrl: true })
  s.finish()
  await s.clock.settle()
  const before = s.spawnArgv.length
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  await s.clock.settle()
  expect(s.spawnArgv).toHaveLength(before)
})
