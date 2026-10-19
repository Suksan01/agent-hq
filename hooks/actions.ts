// What the live page's requests do, apart from how they arrive: `handlePageAction` runs one checked request,
// `runFreshActions` runs a list once each (by id). Reading them off a transport is the caller's job (see ./channel).

import type { EngineInterface } from 'claude-code'

import type { HqAgent } from '../types'
import type { NewEvent } from './feed'
import { rolesOf } from './live'
import { withLock } from './lock'
import { MAIN, isFinished, who } from './model'
import type { HqData } from './view'

// a request the server checked (web/server.mjs checkAction), read back untrusted all the same
export type PageAction = { id?: unknown; type?: unknown; role?: unknown; task?: unknown; text?: unknown; agent?: unknown; mode?: unknown }
export type ActionResult = { ok: boolean; text: string }

/** What the page shows for a request. `seq` is the request's id (the page's field name from before ids existed). */
export type Notice = ActionResult & { seq: number }

/**
 * What the handlers need from register.tsx, as plain calls bound to its `$` and its state: a hooks module may
 * neither pass `$` on nor read state it does not own, and the tests stand these in with memory.
 */
export type ActionDeps = {
  getAgent: (id: string) => Promise<HqAgent | undefined>
  lastId: () => Promise<number>
  setLastId: (id: number) => Promise<void>
  report: (notice: Notice) => Promise<void>
  record: (event: NewEvent) => Promise<void>
  setHideFinished: (hide: boolean) => Promise<void>
  readData: () => Promise<HqData>
  syncAgents: () => Promise<void>
  clearDone: () => Promise<void>
}

// the typed `$.tool.call` is too deep for the compiler with TaskStop's input; the call is untyped and the answer read as untrusted
type StopCall = (call: { tool: 'TaskStop'; task_id: string }) => Promise<{ deny?: string; isError?: boolean; text?: string }>

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Runs the requests whose id is above the last one run, in order, each once; the result shows on the page and as a toast. */
export async function runFreshActions($: EngineInterface, actions: readonly PageAction[], deps: ActionDeps) {
  const done = await deps.lastId()
  for (const action of actions.filter(a => typeof a.id === 'number' && Number.isFinite(a.id) && a.id > done)) {
    const id = action.id as number
    if (id <= (await deps.lastId())) continue // already run (by an earlier pass), never twice
    await deps.setLastId(id) // first, so a failure below is never retried
    const notice = await handlePageAction($, action, deps).catch((error: unknown) => ({ ok: false, text: error instanceof Error ? error.message : String(error) }))
    await deps.report({ seq: id, ...notice })
    const isMessage = notice.ok && (action.type === 'lead' || action.type === 'message')
    await deps.record({ agent: str(action.agent) || MAIN, kind: isMessage ? 'message' : 'action', text: notice.ok ? notice.text : `failed: ${notice.text}` })
    $.ui.toast(`Agent HQ (live page): ${notice.text}`)
  }
}

/** What one request from the live page does; every result is said on the page and as a toast. */
export async function handlePageAction($: EngineInterface, action: PageAction, deps: ActionDeps): Promise<ActionResult> {
  const agentId = str(action.agent)
  const agent = agentId ? await deps.getAgent(agentId) : undefined
  switch (action.type) {
    case 'spawn':
      return spawnFromPage($, str(action.role), str(action.task), deps)
    case 'lead': {
      // framed as Agent HQ's message, so the transcript shows it came from the live page; it runs once Claude is idle
      await $.prompt.submit({ text: `Message from the person, sent from the Agent HQ live page:\n\n${str(action.text)}` })
      return { ok: true, text: 'message queued for the lead' }
    }
    case 'message': {
      if (!agent || agentId === MAIN) return { ok: false, text: 'no such agent' }
      // framed like a message to the lead, so the agent can tell the person is speaking, from where
      const sent = await $.session.send({ to: { agentId }, text: `Message from the person, sent from the Agent HQ live page:\n\n${str(action.text)}` })
      return sent.isDelivered ? { ok: true, text: `message sent to ${who(agent)}` } : { ok: false, text: `${who(agent)} did not get it: ${sent.reason}` }
    }
    case 'stop': {
      if (!agent || agentId === MAIN) return { ok: false, text: 'no such agent' }
      if (isFinished(agent.status)) return { ok: false, text: `${who(agent)} has already finished` }
      // the session's own TaskStop tool, so its checks and permission rules apply as to Claude's own call
      const stopped = await ($.tool.call as unknown as StopCall)({ tool: 'TaskStop', task_id: agentId })
      if (stopped.deny || stopped.isError) return { ok: false, text: `could not stop ${who(agent)}: ${stopped.deny ?? stopped.text ?? 'refused'}` }
      await deps.syncAgents()
      return { ok: true, text: `stopped ${who(agent)}` }
    }
    case 'finished': {
      if (action.mode === 'clear') {
        await deps.clearDone()
        return { ok: true, text: 'finished agents and tasks cleared' }
      }
      await deps.setHideFinished(action.mode === 'hide')
      return { ok: true, text: action.mode === 'hide' ? 'finished agents hidden' : 'finished agents shown' }
    }
    default:
      return { ok: false, text: 'unknown request' }
  }
}

/** What starting an agent came to: its id, or why not. */
export type SpawnOutcome = { ok: true; agentId?: string } | { ok: false; error: string }

/** Starts one agent through `$.agent.spawn`: the one path the page and the lead's tools both use. */
export async function spawnAgent($: EngineInterface, spec: { subagentType: string; name: string; prompt: string; description: string }): Promise<SpawnOutcome> {
  const result = await $.agent.spawn(spec).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
  // a hook or permission rule can refuse the spawn without throwing
  if ('error' in result) return { ok: false, error: result.error }
  if (result.deny) return { ok: false, error: result.deny }
  return { ok: true, agentId: result.agentId }
}

/** Starts one agent of a role the page asked for, under the next free `<role>-<n>` name, within the role's count. */
async function spawnFromPage($: EngineInterface, roleId: string, task: string, deps: ActionDeps): Promise<ActionResult> {
  // name, count and spawn under one lock with hq_assign: the agent is listed (syncAgents) before the next run reads the roster
  const outcome = await withLock(async () => {
    const data = await deps.readData()
    const role = rolesOf(data).find(r => r.id === roleId)
    if (!role) return { ok: false as const, text: `no role "${roleId}" in the team` }
    if (!task.trim()) return { ok: false as const, text: 'the request had no task' }
    if (role.active >= role.count) return { ok: false as const, text: `${role.title} is fully staffed (${role.active} of ${role.count} at work) — ask the lead to hire another` }
    const taken = new Set(Object.values(data.agents).map(a => a.name))
    let n = 1
    while (taken.has(`${roleId}-${n}`)) n++
    const name = `${roleId}-${n}`
    const started = await spawnAgent($, { prompt: task, description: task.slice(0, 60), subagentType: data.team ? `agent-hq:${roleId}` : roleId, name })
    if (!started.ok) return { ok: false as const, text: `could not start ${name}: ${started.error}` }
    await deps.syncAgents()
    return { ok: true as const, name, title: role.title }
  }, { label: `starting a ${roleId}` })
  if (!outcome.ok) return outcome
  const row = Object.values((await deps.readData()).agents).find(a => a.name === outcome.name) // listed now, with its nickname
  return { ok: true, text: `started ${row ? who(row) : outcome.name} as ${outcome.title}` }
}
