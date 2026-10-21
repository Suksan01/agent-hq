// The page-action handlers on their own, with no transport: `handlePageAction` runs one request,
// `runFreshActions` runs a list once each by id. Whatever carries the requests in (file, stdout) leans on these.
import { expect, test } from 'claude-code/testing'
import type { AgentInfo, SessionSendResult } from 'claude-code'

import { handlePageAction, runFreshActions } from '../hooks/actions'
import type { ActionDeps, Notice, PageAction } from '../hooks/actions'
import { MAIN, mergeAgents, who } from '../hooks/model'
import { parseTeam } from '../hooks/team'

const TEAM = parseTeam(
  JSON.stringify({
    name: 'T',
    purpose: 'p',
    lead: { title: 'Lead', rules: [], skills: [] },
    roles: [{ id: 'dev', title: 'Developer', count: 2, mission: 'Build.', tasks: [], rules: [], skills: [] }],
  }),
)
if (typeof TEAM === 'string') throw new Error(TEAM)
const team = TEAM

const info = (id: string, name: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, name, type: 'agent-hq:dev', description: 'x', status })

/** A hand-made `$` (just the calls the handlers make) and in-memory deps over a fixed roster; every call is recorded. */
function setup(roster: AgentInfo[] = [], options: { team?: boolean } = {}) {
  const rows = mergeAgents({}, roster, 0)
  const memory = { lastId: 0, hide: false, notice: null as Notice | null }
  const calls = { spawn: [] as unknown[], prompts: [] as string[], sends: [] as unknown[], stops: [] as unknown[], toasts: [] as string[], events: [] as unknown[], synced: 0, cleared: 0 }
  const answers = { spawn: { model: 'm', agentId: 'n1' } as unknown, send: { isDelivered: true } as SessionSendResult, stop: { result: {} } as unknown, submitThrows: false }
  const $ = {
    agent: { spawn: async (e: unknown) => (calls.spawn.push(e), answers.spawn) },
    prompt: {
      submit: async (e: { text: string }) => {
        if (answers.submitThrows) throw new Error('queue closed')
        calls.prompts.push(e.text)
      },
    },
    session: { send: async (e: unknown) => (calls.sends.push(e), answers.send) },
    tool: { call: async (e: unknown) => (calls.stops.push(e), answers.stop) },
    ui: { toast: (text: string) => void calls.toasts.push(text) },
  } as never
  const deps: ActionDeps = {
    getAgent: async id => rows[id],
    lastId: async () => memory.lastId,
    setLastId: async id => void (memory.lastId = id),
    record: async event => void calls.events.push(event),
    report: async notice => void (memory.notice = notice),
    setHideFinished: async hide => void (memory.hide = hide),
    readData: async () => ({ agents: rows, todos: {}, tasks: {}, now: 0, hideFinished: false, columns: 0, isLight: false, team: options.team === false ? null : team }),
    syncAgents: async () => void calls.synced++,
    clearDone: async () => void calls.cleared++,
  }
  /** how a result names this agent: its nickname, then its name */
  const called = (id: string) => who(rows[id] as never)
  return { $, deps, calls, answers, memory, called }
}

test('handlePageAction spawn names the agent after its role and passes the team type', async () => {
  const s = setup([info('d1', 'dev-1')])

  const result = await handlePageAction(s.$, { type: 'spawn', role: 'dev', task: 'Build it' }, s.deps)

  expect(result).toEqual({ ok: true, text: 'started dev-2 as Developer' }) // not listed yet in this fake roster, so no nickname
  expect(s.calls.spawn[0]).toMatchObject({ prompt: 'Build it', subagentType: 'agent-hq:dev', name: 'dev-2' })
  expect(s.calls.synced).toBe(1)
})

test('handlePageAction spawn skips a name whose start is pending with the lead (recorded, not listed yet)', async () => {
  const s = setup()
  const deps: ActionDeps = { ...s.deps, readData: async () => ({ ...(await s.deps.readData()), assignments: { 'dev-1': { role: 'dev', name: 'dev-1', task: 'the lead\'s job', at: 1 } } }) }

  const result = await handlePageAction(s.$, { type: 'spawn', role: 'dev', task: 'Build it' }, deps)

  expect(result).toEqual({ ok: true, text: 'started dev-2 as Developer' })
  expect(s.calls.spawn[0]).toMatchObject({ name: 'dev-2' })
})

test('handlePageAction spawn refuses a denied or failed start and an unknown role', async () => {
  const s = setup()

  s.answers.spawn = { deny: 'not here' }
  expect(await handlePageAction(s.$, { type: 'spawn', role: 'dev', task: 'x' }, s.deps)).toEqual({ ok: false, text: 'could not start dev-1: not here' })
  expect(s.calls.synced).toBe(0)

  expect(await handlePageAction(s.$, { type: 'spawn', role: 'ghost', task: 'x' }, s.deps)).toEqual({ ok: false, text: 'no role "ghost" in the team' })
  expect(await handlePageAction(s.$, { type: 'spawn', role: 'dev', task: ' ' }, s.deps)).toEqual({ ok: false, text: 'the request had no task' })
})

test('handlePageAction message, stop and finished follow the agent rules', async () => {
  const s = setup([info('d1', 'dev-1'), info('d2', 'dev-2', 'completed')])

  expect(await handlePageAction(s.$, { type: 'message', agent: 'd1', text: 'hi' }, s.deps)).toEqual({ ok: true, text: `message sent to ${s.called('d1')}` })
  expect(await handlePageAction(s.$, { type: 'message', agent: MAIN, text: 'hi' }, s.deps)).toEqual({ ok: false, text: 'no such agent' })
  s.answers.send = { isDelivered: false, reason: 'gone' }
  expect(await handlePageAction(s.$, { type: 'message', agent: 'd1', text: 'hi' }, s.deps)).toEqual({ ok: false, text: `${s.called('d1')} did not get it: gone` })

  expect(await handlePageAction(s.$, { type: 'stop', agent: 'd2' }, s.deps)).toEqual({ ok: false, text: `${s.called('d2')} has already finished` })
  expect(await handlePageAction(s.$, { type: 'stop', agent: MAIN }, s.deps)).toEqual({ ok: false, text: 'no such agent' })
  expect(s.calls.stops).toEqual([])
  expect(await handlePageAction(s.$, { type: 'stop', agent: 'd1' }, s.deps)).toEqual({ ok: true, text: `stopped ${s.called('d1')}` })
  expect(s.calls.stops[0]).toMatchObject({ tool: 'TaskStop', task_id: 'd1' })

  expect(await handlePageAction(s.$, { type: 'finished', mode: 'hide' }, s.deps)).toEqual({ ok: true, text: 'finished agents hidden' })
  expect(s.memory.hide).toBe(true)
  expect(await handlePageAction(s.$, { type: 'finished', mode: 'show' }, s.deps)).toEqual({ ok: true, text: 'finished agents shown' })
  expect(s.memory.hide).toBe(false)
  expect(await handlePageAction(s.$, { type: 'finished', mode: 'clear' }, s.deps)).toEqual({ ok: true, text: 'finished agents and tasks cleared' })
  expect(s.calls.cleared).toBe(1)

  expect(await handlePageAction(s.$, { type: 'lead', text: 'go' }, s.deps)).toEqual({ ok: true, text: 'message queued for the lead' })
  expect(s.calls.prompts[0]).toContain('go')
  expect(await handlePageAction(s.$, { type: 'nope' }, s.deps)).toEqual({ ok: false, text: 'unknown request' })
})

test('runFreshActions runs each request once, in order, saying each on the page and as a toast', async () => {
  const s = setup()
  const list: PageAction[] = [
    { id: 1, type: 'lead', text: 'one' },
    { id: 2, type: 'lead', text: 'two' },
  ]

  await runFreshActions(s.$, list, s.deps)
  await runFreshActions(s.$, list, s.deps) // the same list again: nothing runs

  expect(s.calls.prompts).toHaveLength(2)
  expect(s.calls.prompts[0]).toContain('one')
  expect(s.calls.prompts[1]).toContain('two')
  expect(s.memory.lastId).toBe(2)
  expect(s.memory.notice).toEqual({ seq: 2, ok: true, text: 'message queued for the lead' })
  expect(s.calls.toasts).toEqual(['Agent HQ (live page): message queued for the lead', 'Agent HQ (live page): message queued for the lead'])
})

test('runFreshActions skips an id at or below the last run, and ones with no numeric id', async () => {
  const s = setup()
  await runFreshActions(s.$, [{ id: 5, type: 'lead', text: 'five' }], s.deps)

  await runFreshActions(
    s.$,
    [
      { id: 3, type: 'lead', text: 'three' },
      { id: 5, type: 'lead', text: 'five again' },
      { id: '9', type: 'lead', text: 'string id' },
      { type: 'lead', text: 'no id' },
      { id: 6, type: 'lead', text: 'six' },
    ],
    s.deps,
  )

  expect(s.calls.prompts).toHaveLength(2)
  expect(s.calls.prompts[1]).toContain('six')
})

test('runFreshActions re-entered by a handler (its own sync re-reads the list) still runs each request once', async () => {
  const s = setup([info('d1', 'dev-1')])
  const list: PageAction[] = [
    { id: 1, type: 'stop', agent: 'd1' },
    { id: 2, type: 'lead', text: 'two' },
  ]
  let reentered = 0
  const syncAgents = s.deps.syncAgents
  const deps: ActionDeps = {
    ...s.deps,
    syncAgents: async () => {
      await syncAgents()
      if (reentered++ === 0) await runFreshActions(s.$, list, deps) // the poll that follows a stop sees the same list
    },
  }

  await runFreshActions(s.$, list, deps)

  expect(s.calls.stops).toHaveLength(1)
  expect(s.calls.prompts).toHaveLength(1)
  expect(s.memory.lastId).toBe(2)
})

test('runFreshActions reports a throwing handler as failed and does not retry it', async () => {
  const s = setup()
  s.answers.submitThrows = true
  const list: PageAction[] = [{ id: 1, type: 'lead', text: 'x' }]

  await runFreshActions(s.$, list, s.deps)
  await runFreshActions(s.$, list, s.deps)

  expect(s.memory.notice).toEqual({ seq: 1, ok: false, text: 'queue closed' })
  expect(s.calls.toasts).toEqual(['Agent HQ (live page): queue closed'])
})

test('a message to an agent is framed like one to the lead, naming the live page', async () => {
  const s = setup([info('d1', 'dev-1')])

  await handlePageAction(s.$, { type: 'message', agent: 'd1', text: 'Use the new API' }, s.deps)

  const sent = s.calls.sends[0] as { text: string }
  expect(sent.text).toContain('Agent HQ live page')
  expect(sent.text.endsWith('Use the new API')).toBe(true)
})

test('runFreshActions records one feed event per request: a message, or an action with its result', async () => {
  const s = setup([info('d1', 'dev-1')])

  await runFreshActions(
    s.$,
    [
      { id: 1, type: 'message', agent: 'd1', text: 'hi' },
      { id: 2, type: 'lead', text: 'status?' },
      { id: 3, type: 'finished', mode: 'hide' },
      { id: 4, type: 'stop', agent: 'ghost' },
    ],
    s.deps,
  )

  expect(s.calls.events).toEqual([
    { agent: 'd1', kind: 'message', text: `message sent to ${s.called('d1')}` },
    { agent: MAIN, kind: 'message', text: 'message queued for the lead' },
    { agent: MAIN, kind: 'action', text: 'finished agents hidden' },
    { agent: 'ghost', kind: 'action', text: 'failed: no such agent' },
  ])
})
