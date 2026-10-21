// What the live page's requests do, apart from how they arrive: `handlePageAction` runs one checked request,
// `runFreshActions` runs a list once each (by id). Reading them off a transport is the caller's job (see ./channel).

import type { EngineInterface } from 'claude-code'

import type { HqAgent } from '../types'
import type { NewEvent } from './feed'
import { rolesOf } from './live'
import { withLock } from './lock'
import { MAIN, isFinished, who } from './model'
import type { HqData } from './view'
import { t } from './i18n'
import type { Lang } from './i18n'

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
  /** The person's language, for every result they read; English when left out. */
  lang?: Lang
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
    const lang = deps.lang ?? 'en'
    const said = notice.ok ? { text: notice.text } : { text: t(lang, 'feed.failed', { text: notice.text }), failed: true }
    await deps.record({ agent: str(action.agent) || MAIN, kind: isMessage ? 'message' : 'action', ...said })
    $.ui.toast(t(lang, 'page.toast', { text: notice.text }))
  }
}

/** How the person's message from the live page is framed, so an agent can tell the person is speaking, from where. */
export const PERSON_FRAME = 'Message from the person, sent from the Agent HQ live page:'

/** What one request from the live page does; every result is said on the page and as a toast. */
export async function handlePageAction($: EngineInterface, action: PageAction, deps: ActionDeps): Promise<ActionResult> {
  const agentId = str(action.agent)
  const agent = agentId ? await deps.getAgent(agentId) : undefined
  const lang = deps.lang ?? 'en'
  switch (action.type) {
    case 'spawn':
      return spawnFromPage($, str(action.role), str(action.task), deps)
    case 'lead': {
      // framed as Agent HQ's message, so the transcript shows it came from the live page; it runs once Claude is idle
      await $.prompt.submit({ text: `${PERSON_FRAME}\n\n${str(action.text)}` })
      return { ok: true, text: t(lang, 'page.queued') }
    }
    case 'message': {
      if (!agent || agentId === MAIN) return { ok: false, text: t(lang, 'page.noAgent') }
      // framed like a message to the lead, so the agent can tell the person is speaking, from where
      const sent = await $.session.send({ to: { agentId }, text: `${PERSON_FRAME}\n\n${str(action.text)}` })
      return sent.isDelivered ? { ok: true, text: t(lang, 'page.sent', { who: who(agent) }) } : { ok: false, text: t(lang, 'page.notDelivered', { who: who(agent), reason: sent.reason }) }
    }
    case 'stop': {
      if (!agent || agentId === MAIN) return { ok: false, text: t(lang, 'page.noAgent') }
      if (isFinished(agent.status)) return { ok: false, text: t(lang, 'page.alreadyFinished', { who: who(agent) }) }
      // the session's own TaskStop tool, so its checks and permission rules apply as to Claude's own call
      const stopped = await ($.tool.call as unknown as StopCall)({ tool: 'TaskStop', task_id: agentId })
      if (stopped.deny || stopped.isError) return { ok: false, text: t(lang, 'page.couldNotStop', { who: who(agent), reason: stopped.deny ?? stopped.text ?? t(lang, 'page.refused') }) }
      await deps.syncAgents()
      return { ok: true, text: t(lang, 'page.stopped', { who: who(agent) }) }
    }
    case 'finished': {
      if (action.mode === 'clear') {
        await deps.clearDone()
        return { ok: true, text: t(lang, 'page.cleared') }
      }
      await deps.setHideFinished(action.mode === 'hide')
      return { ok: true, text: t(lang, action.mode === 'hide' ? 'page.hidden' : 'page.shown') }
    }
    default:
      return { ok: false, text: t(lang, 'page.unknown') }
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

/** Names the person is starting from the live page, while the start runs: its task is their words, not the team's talk. */
export const personStarts = new Set<string>()

/** Starts one agent of a role the page asked for, under the next free `<role>-<n>` name, within the role's count. */
async function spawnFromPage($: EngineInterface, roleId: string, task: string, deps: ActionDeps): Promise<ActionResult> {
  const lang = deps.lang ?? 'en'
  // name, count and spawn under one lock with hq_assign: the agent is listed (syncAgents) before the next run reads the roster
  const outcome = await withLock(async () => {
    const data = await deps.readData()
    const role = rolesOf(data).find(r => r.id === roleId)
    if (!role) return { ok: false as const, text: t(lang, 'page.noRole', { role: roleId }) }
    if (!task.trim()) return { ok: false as const, text: t(lang, 'page.noTask') }
    if (role.active >= role.count) return { ok: false as const, text: t(lang, 'page.fullyStaffed', { title: role.title, active: role.active, count: role.count }) }
    // a recorded assignment's name is taken too: a start handed to the lead is not listed until the lead makes the call
    const taken = new Set([...Object.values(data.agents).map(a => a.name), ...Object.keys(data.assignments ?? {})])
    let n = 1
    while (taken.has(`${roleId}-${n}`)) n++
    const name = `${roleId}-${n}`
    personStarts.add(name)
    const started = await spawnAgent($, { prompt: task, description: task.slice(0, 60), subagentType: data.team ? `agent-hq:${roleId}` : roleId, name }).finally(() =>
      personStarts.delete(name),
    )
    if (!started.ok) return { ok: false as const, text: t(lang, 'page.couldNotStart', { name, reason: started.error }) }
    await deps.syncAgents()
    return { ok: true as const, name, title: role.title }
  }, { label: `starting a ${roleId}` })
  if (!outcome.ok) return outcome
  const row = Object.values((await deps.readData()).agents).find(a => a.name === outcome.name) // listed now, with its nickname
  return { ok: true, text: t(lang, 'page.started', { who: row ? who(row) : outcome.name, title: outcome.title }) }
}
