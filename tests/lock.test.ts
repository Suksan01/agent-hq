// The roster lock: hq_assign and the live page's spawn share it, so concurrent starts never share a name or overfill a role.
import { expect, test } from 'claude-code/testing'

import { handlePageAction } from '../hooks/actions'
import type { ActionDeps } from '../hooks/actions'
import { LOCK_TIMEOUT_MS, LockTimeout, configureLock, withLock } from '../hooks/lock'
import { MAIN } from '../hooks/model'
import { parseTeam } from '../hooks/team'
import { hqAssign } from '../hooks/tools'
import type { ToolDeps } from '../hooks/tools'
import type { HqAgent, HqAssignment } from '../types'

const TEAM = parseTeam(
  JSON.stringify({
    name: 'T',
    purpose: 'p',
    lead: { title: 'Lead', rules: [], skills: [] },
    roles: [{ id: 'dev', title: 'Developer', count: 3, mission: 'Build.', tasks: [], rules: [], skills: [] }],
  }),
)
if (typeof TEAM === 'string') throw new Error(TEAM)
const team = TEAM

const tick = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

/** One roster, one slow spawn, and a sync that lists what was started: the gap where a second run could read a stale roster. */
function setup(spawnHangs = false) {
  const rows: Record<string, HqAgent> = { [MAIN]: { id: MAIN, name: 'main', role: 'orchestrator', description: '', status: 'running', startedAt: 0, tools: 0 } }
  const started: string[] = []
  const pending: string[] = []
  const assignments: Record<string, HqAssignment> = {}
  const $ = {
    agent: {
      spawn: async (spec: { name: string }) => {
        started.push(spec.name)
        pending.push(spec.name)
        await tick() // the engine takes a moment to start the agent
        if (spawnHangs) await new Promise<never>(() => {})
        return { model: 'm', agentId: `id-${spec.name}` }
      },
    },
    tool: { call: async () => ({ result: {} }) },
  } as never
  const syncAgents = async () => {
    await tick()
    for (const name of pending.splice(0)) rows[`id-${name}`] = { id: `id-${name}`, name, role: 'agent-hq:dev', description: '', status: 'running', startedAt: 1, tools: 0 }
  }
  const readData = async () => ({ agents: rows, todos: {}, tasks: {}, now: 0, hideFinished: false, columns: 0, isLight: false, team })
  const toolDeps: ToolDeps = {
    readData,
    syncAgents,
    now: async () => 1,
    assignmentOf: async name => assignments[name],
    recordAssignment: async (name, assignment) => void (assignments[name] = assignment),
    resultOf: async () => undefined,
    record: async () => {},
    readTeamFile: async () => null,
    writeTeam: async () => null,
    confirm: async () => 'yes',
  }
  const pageDeps: ActionDeps = {
    getAgent: async id => rows[id],
    lastId: async () => 0,
    setLastId: async () => {},
    record: async () => {},
    report: async () => {},
    setHideFinished: async () => {},
    readData,
    syncAgents,
    clearDone: async () => {},
  }
  return { $, toolDeps, pageDeps, started }
}

test('concurrent hq_assign and page spawns never share a name', async () => {
  const s = setup()

  await Promise.all([
    hqAssign(s.$, { role: 'dev', task: 'one' }, s.toolDeps),
    handlePageAction(s.$, { type: 'spawn', role: 'dev', task: 'two' }, s.pageDeps),
    hqAssign(s.$, { role: 'dev', task: 'three' }, s.toolDeps),
  ])

  expect([...s.started].sort()).toEqual(['dev-1', 'dev-2', 'dev-3'])
})

test('concurrent starts never exceed the role count', async () => {
  const s = setup()

  const results = await Promise.all([
    hqAssign(s.$, { role: 'dev', task: 'a' }, s.toolDeps),
    handlePageAction(s.$, { type: 'spawn', role: 'dev', task: 'b' }, s.pageDeps),
    hqAssign(s.$, { role: 'dev', task: 'c' }, s.toolDeps),
    handlePageAction(s.$, { type: 'spawn', role: 'dev', task: 'd' }, s.pageDeps),
    hqAssign(s.$, { role: 'dev', task: 'e' }, s.toolDeps),
  ])

  expect(s.started.length).toBe(3) // count is 3
  expect(new Set(s.started).size).toBe(3)
  const refused = results.filter(r => ('ok' in r ? !r.ok : r.isError === true))
  expect(refused.length).toBe(2)
})

test('withLock runs its work one at a time, in order, and a failure does not block the next', async () => {
  const order: string[] = []
  const slow = withLock(async () => (await tick(), order.push('slow')))
  const failing = withLock(async () => Promise.reject(new Error('boom')))
  const last = withLock(async () => order.push('last'))

  await expect(failing).rejects.toThrow('boom')
  await Promise.all([slow, last])
  expect(order).toEqual(['slow', 'last'])
})

/** A clock the test turns by hand: timers wait until `fire()`. */
function fakeClock() {
  const timers: { ms: number; fn: () => void; live: boolean }[] = []
  configureLock((ms, fn) => {
    const timer = { ms, fn, live: true }
    timers.push(timer)
    return { cancel: () => void (timer.live = false) }
  })
  return { timers, fire: (at = 0) => timers[at]?.fn() }
}

test('a run that hangs is cut off after the timeout: the caller gets a clear error and the next run goes ahead, once', async () => {
  const clock = fakeClock()
  try {
    const ran: string[] = []
    let finishLate: () => void = () => {}
    const hung = withLock(
      async () => {
        ran.push('hung')
        await new Promise<void>(resolve => (finishLate = resolve))
        ran.push('hung finished late')
      },
      { label: 'starting dev-1' },
    )
    const next = withLock(async () => (ran.push('next'), 'next done'))
    await tick()
    expect(clock.timers.map(t => t.ms)).toEqual([LOCK_TIMEOUT_MS])
    expect(ran).toEqual(['hung']) // the second waits for the first

    clock.fire()

    const failure = await hung.catch(error => error)
    expect(failure).toBeInstanceOf(LockTimeout)
    expect((failure as Error).message).toBe('Agent HQ: starting dev-1 took too long; check the sidebar before retrying')
    expect(await next).toBe('next done')
    finishLate() // the abandoned work ends later: nothing is run twice
    await tick()
    expect(ran).toEqual(['hung', 'next', 'hung finished late'])
  } finally {
    configureLock(null)
  }
})

test('a run that finishes in time cancels its timer and keeps its own result or error', async () => {
  const clock = fakeClock()
  try {
    expect(await withLock(async () => 'ok')).toBe('ok')
    await expect(withLock(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    expect(clock.timers.map(t => t.live)).toEqual([false, false])
    clock.fire(0) // a timer that was cancelled but fires anyway changes nothing already settled
  } finally {
    configureLock(null)
  }
})

test('a custom timeout is used, and a run is not timed without a clock', async () => {
  const clock = fakeClock()
  try {
    await withLock(async () => 1, { timeoutMs: 5 })
    expect(clock.timers[0]?.ms).toBe(5)
  } finally {
    configureLock(null)
  }
  expect(await withLock(async () => 2)).toBe(2)
})

test('hq_assign answers with the timeout when the spawn hangs, and the lock is free for the next assignment', async () => {
  const clock = fakeClock()
  try {
    const s = setup(true)
    const first = hqAssign(s.$, { role: 'dev', task: 'one', name: 'dev-1' }, s.toolDeps)
    await tick()

    clock.fire()

    expect(await first).toEqual({ text: 'Agent HQ: starting dev-1 took too long; check the sidebar before retrying', isError: true })
    expect(await withLock(async () => 'free')).toBe('free')
  } finally {
    configureLock(null)
  }
})
