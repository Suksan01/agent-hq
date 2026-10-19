import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { MAIN, barIdsIn, clearFinished, countTool, createTask, mergeAgents, mergeTodos, overallProgress, planSteps, updateTask, who, workingCount } from './model'
import type { HqTeam, HqTodo } from '../types'
import { MEMORY_SCOPE, SELF_EVAL_SKILL, TEAM_FILE, leadModelWarning, leadPrompt, parseTeam, rolePrompt } from './team'
import { runFreshActions } from './actions'
import type { ActionDeps, PageAction } from './actions'
import { hasOldRecord, isApproved, withApproval } from './approval'
import { lineBuffer, parseChannelLine } from './channel'
import { EMPTY_FEED, addEvents, statusEvents, stepEvents } from './feed'
import type { NewEvent } from './feed'
import { buildSnapshot } from './live'
import { configureLock } from './lock'
import { createReport, reportToast } from './report'
import { soundsForChanges } from './sounds'
import type { Sound } from './sounds'
import { soundsOn, themeOf } from './themes'
import { agentRoles, guardToolCall } from './guard'
import { addTurn } from './usage'
import { describeCall, endActivity, hasRunningCall, liveActivities, startActivity } from './activity'
import { addAsk, buildInbox, describeAsk, removeAsk, statusText, trackWaiting } from './inbox'
import { announceXp, createLedger, creditActivity, creditTestRun, xpStoreOf, xpSummaries } from './xpstore'
import { ASSIGN_TOOL, HIRE_TOOL, LEAD_TOOLS_NOTE, REVIEW_TOOL, STATUS_TOOL, TOOL_SPECS, hqAssign, hqHire, hqReview, hqStatus, keepResult, textOfContent } from './tools'
import type { ToolAnswer, ToolDeps } from './tools'
import { BandView, SidebarView, bandRasters, bandTrackWidth, folderOf, hasBand, sidebarRasters, textTrack } from './view'
import type { BandActions, HqActions, HqData, Raster } from './view'

const PANE = 'agent-hq'
const TITLE = 'Agent HQ'
const SIDEBAR_COLUMNS = 46 // the dock's width beside a fullscreen transcript
const POLL_MS = 1000
const FRAME_MS = 125 // the twinkle's frame rate; plan-progress runs 30 fps, 8 is plenty here
const LIVE_COOLDOWN_MS = 50 // at most one write to the live state file per this long
const START_TIMEOUT_MS = 10_000 // the live page's server prints its URL within this long, or it is stopped
const APPROVED_TEAMS = 'approvedTeams' // $.store key: project team files the person approved
const REFUSED_MAX = 6 // blits refused in a row (site closed or redrawn at another size) drop that site

const agents = atom({ plugin: 'agent-hq', key: 'agents' } as const, {})
const todos = atom({ plugin: 'agent-hq', key: 'todos' } as const, {})
const tasks = atom({ plugin: 'agent-hq', key: 'tasks' } as const, {})
const now = atom({ plugin: 'agent-hq', key: 'now' } as const, 0)
const hideFinished = atom({ plugin: 'agent-hq', key: 'hideFinished' } as const, false)
const wasAutoOpened = atom({ plugin: 'agent-hq', key: 'wasAutoOpened' } as const, false)
const isBandHidden = atom({ plugin: 'agent-hq', key: 'isBandHidden' } as const, false)
const barOwners = atom({ plugin: 'agent-hq', key: 'barOwners' } as const, {})
const team = atom({ plugin: 'agent-hq', key: 'team' } as const, null)
const teamSource = atom({ plugin: 'agent-hq', key: 'teamSource' } as const, null)
const lastAction = atom({ plugin: 'agent-hq', key: 'lastAction' } as const, 0)
const liveNotice = atom({ plugin: 'agent-hq', key: 'liveNotice' } as const, null)
const isWebWanted = atom({ plugin: 'agent-hq', key: 'isWebWanted' } as const, false)
const feed = atom({ plugin: 'agent-hq', key: 'feed' } as const, EMPTY_FEED)
const usage = atom({ plugin: 'agent-hq', key: 'usage' } as const, {})
const asks = atom({ plugin: 'agent-hq', key: 'asks' } as const, {})
const waitingSince = atom({ plugin: 'agent-hq', key: 'waitingSince' } as const, {})
const assignments = atom({ plugin: 'agent-hq', key: 'assignments' } as const, {})
const results = atom({ plugin: 'agent-hq', key: 'results' } as const, {})
const activity = atom({ plugin: 'agent-hq', key: 'activity' } as const, {})

/** The team.json in force: the project's, else the home folder's (for every project); null when neither exists. */
async function findTeamFile($: EngineInterface): Promise<{ path: string; isProject: boolean } | null> {
  const home = await $.env.get('HOME')
  const homeFile = home ? `${home}/${TEAM_FILE}` : null
  const places = [`${await $.session.cwd()}/${TEAM_FILE}`, ...(homeFile ? [homeFile] : [])]
  for (const path of places) if (await $.fs.exists(path).catch(() => false)) return { path, isProject: path !== homeFile }
  return null
}

const HOME_MIGRATED = 'homeTeamTrustMigrated' // $.store key: the home team file present at the first run was trusted

/** The home folder's team file path, or null without HOME. */
async function homeTeamFile($: EngineInterface): Promise<string | null> {
  const home = await $.env.get('HOME')
  return home ? `${home}/${TEAM_FILE}` : null
}

/** Once, when this version first runs: the home team file already there is trusted as it stands (it was yours before trust existed). */
async function migrateHomeTrust($: EngineInterface) {
  if (await $.store.get(HOME_MIGRATED)) return
  const path = await homeTeamFile($)
  if (path && (await $.fs.exists(path).catch(() => false))) {
    await $.store.set(APPROVED_TEAMS, withApproval(await $.store.get(APPROVED_TEAMS), path, await $.fs.read(path).catch(() => '')))
  }
  await $.store.set(HOME_MIGRATED, true)
}

/**
 * Reads the team file, keeps it in state and registers each role as an agent type `agent-hq:<id>`. A team file decides
 * which agents run and what they are told, so it is used only while its text is the one the person trusted: `/hq trust`
 * records it, and so does `approve` here, which the caller sets only for the main session's own write (an agent's
 * write is never trusted). Your own file in the home folder is held to the same rule, so a change made outside the
 * session, or by an agent, is not used until you trust it. A project's file says so in a toast on every load.
 */
async function loadTeam($: EngineInterface, options: { approve?: boolean; expect?: string } = {}): Promise<HqTeam | null> {
  const file = await findTeamFile($)
  if (!file) {
    // the last trusted team stays in force (a deleted file must not switch the guard off); only the pointer to a file goes
    await update($, teamSource, () => null)
    return await read($, team)
  }
  const { path } = file
  const source = await $.fs.read(path).catch(() => '')
  const parsed = parseTeam(source)
  if (typeof parsed === 'string') {
    await update($, teamSource, () => ({ path, error: parsed }))
    $.ui.toast(`Agent HQ: team file ignored, ${parsed} (${path})`)
    return await read($, team)
  }
  const approved = await $.store.get(APPROVED_TEAMS)
  // `approve` trusts the text read just now, but only when it is the text the caller expects (what it wrote): a file that
  // changed after the write is not trusted by it
  if (options.approve === true && (options.expect === undefined || options.expect === source)) await $.store.set(APPROVED_TEAMS, withApproval(approved, path, source))
  else if (!isApproved(approved, path, source)) {
    // the last trusted team stays in force (its guard and lead section) until the person trusts this text
    await update($, teamSource, () => ({ path, error: 'not trusted yet, run /hq trust to use it', needsApproval: true }))
    $.ui.toast(
      hasOldRecord(approved, path)
        ? `Agent HQ: trust records from an older version were reset for ${path} — run /hq trust to use it`
        : file.isProject
          ? `Agent HQ: project team ${parsed.name} found at ${path} — run /hq trust to use it`
          : 'Agent HQ: your team file changed outside this session — run /hq trust to use it',
    )
    return await read($, team)
  }
  // the engine ignores an agent's `memory` when auto memory is off; members then keep lessons in the team notes.
  // shortcut: only the environment variable is seen, not `autoMemoryEnabled: false` in settings.
  const hasMemory = !/^(1|true|yes|on)$/i.test((await $.env.get('CLAUDE_CODE_DISABLE_AUTO_MEMORY').catch(() => undefined)) ?? '')
  // shortcut: a role removed from the file stays registered until the session restarts (there is no unregister).
  for (const role of parsed.roles) {
    await $.agent.register({
      name: role.id,
      description: `${role.title} on the ${parsed.name} team. ${role.mission}`.slice(0, 1000),
      prompt: rolePrompt(parsed, role, hasMemory),
      ...(role.tools ? { tools: role.tools } : {}),
      ...(role.model ? { model: role.model } : {}),
      ...(role.effort ? { effort: role.effort } : {}),
      skills: [...new Set([...role.skills, SELF_EVAL_SKILL])],
      memory: MEMORY_SCOPE,
    })
  }
  await update($, team, () => parsed)
  await update($, teamSource, () => ({ path }))
  if (file.isProject && !options.approve) $.ui.toast(`Agent HQ: using project team ${parsed.name} from ${path}`)
  await warnLeadModel($, parsed).catch(() => {}) // advice only: a session whose model cannot be read is not warned
  return parsed
}

let saidLeadModel: string | undefined // the last lead-model warning shown, so one mismatch is said once

/** Toasts when the session runs on another model than the team's lead asks for, once per change. */
async function warnLeadModel($: EngineInterface, current: HqTeam | null): Promise<void> {
  const warning = leadModelWarning(current?.lead.model, await $.session.model())
  if (warning && warning !== saidLeadModel) $.ui.toast(warning)
  saidLeadModel = warning
}

const isTeamFile = (path: unknown) => typeof path === 'string' && path.endsWith(TEAM_FILE)

/** A path with `.`, `..` and doubled slashes resolved (no file system call: the paths are only compared). */
function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '' && part !== '.') parts.push(part)
  }
  return `/${parts.join('/')}`
}

/** `text` with an Edit applied the way the Edit tool does (the first match, or all of them), or null when it cannot be told. */
function applyEdit(text: string, oldString: unknown, newString: unknown, replaceAll: unknown): string | null {
  if (typeof oldString !== 'string' || oldString === '' || typeof newString !== 'string' || !text.includes(oldString)) return null
  return replaceAll === true ? text.split(oldString).join(newString) : text.replace(oldString, () => newString)
}

type TeamWrite = { tool: unknown; agentId?: string; file_path?: unknown; content?: unknown; old_string?: unknown; new_string?: unknown; replace_all?: unknown }

/** The absolute, normalised path a tool call names. */
async function pathOf($: EngineInterface, given: string): Promise<string> {
  return normalizePath(given.startsWith('/') ? given : `${await $.session.cwd()}/${given}`)
}

/**
 * The text the team file in force must hold after the main session's own Write or Edit of it, or null when this is no such
 * write (an agent's, or of another file that merely ends the same way). `before` is the file as it was just before an Edit.
 * Only a file that reads back exactly this text is trusted at once (the reload compares): a change made in between, or an
 * edit whose result cannot be worked out, is left for the person's /hq trust.
 */
async function expectedOwnTeamText($: EngineInterface, e: TeamWrite, before: string | null): Promise<string | null> {
  if (e.agentId !== undefined || typeof e.file_path !== 'string') return null
  const inForce = await findTeamFile($)
  if (!inForce || normalizePath(inForce.path) !== (await pathOf($, e.file_path))) return null
  if (e.tool === 'Write') return typeof e.content === 'string' ? e.content : null
  return before === null ? null : applyEdit(before, e.old_string, e.new_string, e.replace_all)
}

// plan-progress's stored bars, read (never written) as another plugin's value; its contract is not ours, so the
// call is untyped and what comes back is parsed as untrusted. Reading it while drawing redraws us when it changes.
type ForeignGet = (ref: { plugin: 'plan-progress'; key: 'plans' }) => Promise<{ value?: unknown }>
async function readPlanBars($: EngineInterface): Promise<Record<string, HqTodo[]>> {
  const got = await ($.state.get as unknown as ForeignGet)({ plugin: 'plan-progress', key: 'plans' }).catch(() => ({ value: undefined }))
  return planSteps(got.value)
}

/** Every loop's todos: its own TodoWrite list, else the plan-progress bar it moved last. */
async function readTeamTodos($: EngineInterface): Promise<Record<string, HqTodo[]>> {
  return mergeTodos(await read($, todos), await readPlanBars($), await read($, barOwners), await read($, agents))
}

// ---------- animation: each terminal site that drew Rasters is re-blitted while agents work ----------
// module state for the animation only; a reload starts it empty and the next draw sets it again
let isLight = false
let isMuted = false // the `sounds` option, read when the module registers
let nameTheme = themeOf(undefined) // the `nicknameTheme` option, read when the module registers
const xpLedger = createLedger() // what each agent has earned this session, on top of what the store held
type Site = { requestId: string; data: HqData; draw: (t: number) => Raster[]; refused: number }
const sites = new Map<'band' | 'sidebar', Site>()
let frames: { cancel: () => void } | null = null

const hasLiveAgents = (data: HqData) => workingCount(data.agents) > 0

function syncFrames($: EngineInterface) {
  const isWanted = [...sites.values()].some(s => hasLiveAgents(s.data))
  if (isWanted && !frames) frames = $.clock.every(FRAME_MS, () => void animate($))
  if (!isWanted && frames) {
    frames.cancel()
    frames = null
  }
}

async function animate($: EngineInterface) {
  const t = await $.clock.now()
  await Promise.all(
    [...sites].map(async ([name, site]) => {
      const answers = await Promise.all(
        site.draw(t).map(r => $.ui.blit({ requestId: site.requestId, key: r.key, cells: r.cells, columns: r.columns, rows: r.rows }).catch(() => ({ deny: 'failed' }))),
      )
      if (!answers.some(a => a.deny)) site.refused = 0
      else if (++site.refused >= REFUSED_MAX && sites.get(name) === site) sites.delete(name)
    }),
  )
  syncFrames($)
}

function seat($: EngineInterface, name: 'band' | 'sidebar', site: Omit<Site, 'refused'>) {
  sites.set(name, { ...site, refused: 0 })
  syncFrames($)
}

// ---------- state ----------

async function syncAgents($: EngineInterface) {
  const [listed, t] = await Promise.all([$.agent.list(), $.clock.now()])
  const before = await read($, agents)
  const after = mergeAgents(before, listed, t, nameTheme)
  let heard: Sound | null = null
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    await update($, agents, () => after)
    await recordEvents($, statusEvents(before, after))
    heard = soundsForChanges(before, after, { muted: isMuted })
  }
  // XP from what changed, then the one clip of this poll: a status change's, or a level up's when that is louder
  const earned = await creditActivity(xpStoreOf($), xpLedger, { agents: after, todos: await readTeamTodos($), tasks: await read($, tasks) }, t).catch(() => [])
  await announceXp($, earned, heard, isMuted)
  const waits = trackWaiting(await read($, waitingSince), after, t)
  if (JSON.stringify(waits) !== JSON.stringify(await read($, waitingSince))) await update($, waitingSince, () => waits)
  // ticks the clock only while someone works or a call runs (the lead's too), so elapsed times and live lines move and
  // an idle view stays still
  if (hasRunningCall(await read($, activity), after) || workingCount(after) > 0) await update($, now, () => t)
  await syncStatus($)
  await requestLive($)
}

/** A test command's result as XP for the agent that ran it; never fails the tool call it follows. */
async function creditBash($: EngineInterface, loop: string, command: string, failed: boolean) {
  try {
    const nickname = (await read($, agents))[loop]?.nickname
    await announceXp($, await creditTestRun(xpStoreOf($), xpLedger, nickname, command, failed, await $.clock.now()), null, isMuted)
  } catch {
    // XP is a bonus
  }
}

/** Adds to the activity feed the live page shows. */
async function recordEvents($: EngineInterface, items: readonly NewEvent[]) {
  if (items.length === 0) return
  const at = await $.clock.now()
  await update($, feed, current => addEvents(current, at, items))
}

// ---------- the live browser page (/hq web): a local server child, fed one state file ----------
// module state: a reload drops it with the child the engine kills, and /hq web starts a fresh one
let web: { url: string; statePath: string } | null = null
let webStarting: Promise<string> | null = null
let lastLive = ''
let inbox: PageAction[] = [] // requests read off the server's stdout, not run yet
let canRunActions = false // set by the poll, a dispatch of its own: while /hq web is still starting, the engine refuses a request's prompt.submit
let isRunningActions = false // one pass at a time: an action's own syncAgents must not start another
let isWritingLive = false
let liveCooldown: { cancel: () => void } | null = null
let isLiveDirty = false

/** Runs the page's requests that arrived on the server's stdout, in order, each once; the result shows on the page and as a toast. */
async function runPageActions($: EngineInterface) {
  if (isRunningActions) return
  isRunningActions = true
  try {
    // what the page-action handlers (./actions) reach back into
    const deps: ActionDeps = {
      getAgent: async id => (await read($, agents))[id],
      lastId: () => read($, lastAction),
      setLastId: async id => void (await update($, lastAction, () => id)),
      report: async notice => void (await update($, liveNotice, () => notice)),
      record: event => recordEvents($, [event]),
      setHideFinished: async hide => void (await update($, hideFinished, () => hide)),
      readData: () => readData($, 0),
      syncAgents: () => syncAgents($),
      clearDone: () => clearDone($),
    }
    while (inbox.length > 0) {
      const batch = [...inbox].sort((a, b) => Number(a.id) - Number(b.id)) // in id order, whatever order they came in
      inbox = []
      await runFreshActions($, batch, deps)
    }
  } finally {
    isRunningActions = false
  }
}

/** The server printed a request: run it, then write the state that acknowledges it (`lastAction`) at once. */
async function handleIncoming($: EngineInterface) {
  await runPageActions($).catch(error => $.ui.log(`Agent HQ: a page request failed (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))
  await requestLive($)
}

/** What the lead's tools (./tools) reach back into. */
const toolDeps = ($: EngineInterface): ToolDeps => ({
  readData: () => readData($, 0),
  syncAgents: () => syncAgents($),
  now: () => $.clock.now(),
  assignmentOf: async name => (await read($, assignments))[name],
  recordAssignment: async (name, assignment) => void (await update($, assignments, all => ({ ...all, [name]: assignment }))),
  dropAssignment: async name => void (await update($, assignments, all => Object.fromEntries(Object.entries(all).filter(([key]) => key !== name)))),
  resultOf: async id => (await read($, results))[id],
  record: event => recordEvents($, [event]),
  readTeamFile: async () => {
    const source = await read($, teamSource)
    if (!source || source.error || source.needsApproval || !(await read($, team))) return null
    const text = await $.fs.read(source.path).catch(() => null)
    return text === null ? null : { path: source.path, source: text }
  },
  confirm: async question => {
    try {
      return (await $.ui.ask(question, { options: ['Yes, rewrite it', 'No'], header: 'Team file' })) === 'Yes, rewrite it' ? 'yes' : 'no'
    } catch {
      return 'unavailable' // dismissed, or a run with no one to ask (-p)
    }
  },
  // the lead's own rewrite of the file it works from, written only after the person said yes: trusted, and the team is loaded again at once
  writeTeam: async (path, text) => {
    await $.fs.write(path, text)
    const loaded = await loadTeam($, { approve: true, expect: text })
    const now = await read($, teamSource)
    return now?.needsApproval || now?.error ? null : loaded // the file changed after it was written: not loaded, not trusted
  },
})

/** Answers a call of one of the lead's tools; a subagent may not use them. */
async function answerLeadTool($: EngineInterface, e: { agentId?: string }, run: (deps: ToolDeps) => Promise<ToolAnswer>) {
  if (e.agentId) return { result: 'Only the lead (the main session) may use the team tools.', isError: true as const }
  const answer = await run(toolDeps($)).catch(error => ({ text: `Agent HQ: the tool failed (${error instanceof Error ? error.message : String(error)})`, isError: true as const }))
  return answer.isError ? { result: answer.text, isError: true as const } : { result: answer.text }
}

/**
 * The team's rule guard for a subagent's call: the reason it is refused, or null. The role comes from the agent's row
 * (a poll may not have listed a brand-new agent yet, so the roster is synced once if the row is missing); the files it
 * was scoped to by hq_assign come from its assignment. The lead (no agentId) is never asked.
 */
async function blockedByGuard($: EngineInterface, e: { agentId?: string; tool: unknown }): Promise<string | null> {
  if (!e.agentId) return null
  let found = agentRoles(await read($, agents), e.agentId)
  if (found.unknown) {
    // a poll may not have listed a brand-new agent yet: sync once. Still unknown, it is judged as a non-member (no role
    // guard), though no subagent may change a team file
    await syncAgents($)
    found = agentRoles(await read($, agents), e.agentId)
    if (found.unknown) $.ui.log(`Agent HQ: unlisted agent ${e.agentId} judged as non-member`, { to: 'debug' })
  }
  const row = (await read($, agents))[e.agentId]
  const verdict = guardToolCall({
    team: await read($, team),
    role: found.roles[0] ?? null,
    inherited: found.roles.slice(1), // an agent a guarded role started is held to that role's rules too
    subagent: true, // this function only runs for a call made inside a subagent
    inheritsGuard: true,
    tool: String(e.tool),
    input: e as unknown as Record<string, unknown>,
    assignment: row ? ((await read($, assignments))[row.name] ?? null) : null,
    cwd: await $.session.cwd().catch(() => undefined), // without it the guard compares paths as given
  })
  if (!verdict) return null
  const reason = verdict.deny.replace(/^Agent HQ: /, '')
  $.ui.toast(`Agent HQ blocked ${row ? who(row) : e.agentId}: ${reason}`)
  await recordEvents($, [{ agent: e.agentId, kind: 'action', text: `blocked ${String(e.tool)}: ${reason}` }])
  return verdict.deny
}

/** Drops finished agents (never main) and completed tasks: the sidebar's `c` and the page's Clear. */
async function clearDone($: EngineInterface) {
  const cleared = clearFinished(await read($, agents), await read($, tasks), await read($, todos))
  await update($, agents, () => cleared.agents)
  await update($, tasks, () => cleared.tasks)
  await update($, todos, () => cleared.todos)
  await syncStatus($)
}

/** Writes the page's snapshot when it changed; the server pushes each write to open pages at once. */
async function writeLive($: EngineInterface) {
  if (!web) return
  const extras = { lastAction: await read($, lastAction), events: (await read($, feed)).events, inbox: await readInbox($), usage: await read($, usage) }
  const snapshot = buildSnapshot(await readData($, 0), await $.clock.now(), await read($, liveNotice), extras)
  const { at: _at, ...content } = snapshot
  const key = JSON.stringify(content)
  if (key === lastLive) return
  // a plain write: the server reads a half-written file again until it parses and never shows it
  await $.fs.write(web.statePath, JSON.stringify(snapshot))
  lastLive = key // only once written, so a failed write is tried again
}

/**
 * Writes the live state: at once when nothing was written lately, else when the last write is LIVE_COOLDOWN_MS old, and
 * then always the latest state, so a burst of changes costs a few writes and ends with the last one. Calls never
 * overlap and never throw.
 */
async function requestLive($: EngineInterface) {
  if (!web) return
  if (isWritingLive || liveCooldown) {
    isLiveDirty = true
    return
  }
  isWritingLive = true
  isLiveDirty = false
  try {
    await writeLive($)
  } catch (error) {
    $.ui.log(`Agent HQ: could not write the live state (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' })
  } finally {
    isWritingLive = false
    liveCooldown = $.clock.after(LIVE_COOLDOWN_MS, () => {
      liveCooldown = null
      if (isLiveDirty) void requestLive($)
    })
  }
}

/** Starts the local server once per session and resolves its URL (it prints `AGENT_HQ_URL <url>` when listening). */
function startWeb($: EngineInterface): Promise<string> {
  if (web) return Promise.resolve(web.url)
  if (webStarting) return webStarting
  webStarting = (async () => {
    const home = await $.env.get('HOME')
    if (!home) throw new Error('HOME is not set, so there is nowhere to keep the page state')
    // shortcut: one small state file per session is left in ~/.claude/agent-hq/live/; nothing cleans old ones up yet
    const statePath = `${home}/.claude/agent-hq/live/${await $.session.id()}.json`
    lastLive = ''
    // --acked: requests up to this id were handled before (a reload keeps it), so the server's ids go on above it
    const acked = String(await read($, lastAction))
    const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/web/server.mjs`, '--state', statePath, '--acked', acked] })
    return await new Promise<string>((resolve, reject) => {
      const lines = lineBuffer()
      let errors = ''
      const timeout = $.clock.after(START_TIMEOUT_MS, () => {
        if (web) return
        reject(new Error(`the local server did not start within ${START_TIMEOUT_MS / 1000} seconds`))
        void child.return({ code: null, signal: null }) // leaving the loop kills the child
      })
      void (async () => {
        try {
          // the loop is the child's life: it runs on after this command returns, until the session or module ends
          for await (const piece of child) {
            if (piece.stream === 'stderr') {
              errors = (errors + piece.text).slice(-4000)
              continue
            }
            for (const line of lines.push(piece.text)) {
              const heard = parseChannelLine(line)
              if (heard?.kind === 'action') {
                // the server prints a request again every 2 s until it is acknowledged: one copy of each id waits here
                if (!inbox.some(waiting => waiting.id === heard.action.id)) inbox.push(heard.action)
                if (canRunActions) void handleIncoming($)
              } else if (heard?.kind === 'url' && !web) {
                web = { url: heard.url, statePath }
                timeout.cancel()
                await requestLive($)
                resolve(heard.url)
              }
            }
          }
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
        timeout.cancel()
        web = null
        canRunActions = false
        webStarting = null
        reject(new Error(errors.trim().split('\n').pop() || 'the local server stopped'))
      })()
    })
  })()
  webStarting.catch(() => {
    webStarting = null
  })
  return webStarting
}

/** A new one-time login link for the page that is already running (`server.mjs --login` asks the hub for it). */
async function freshLoginUrl($: EngineInterface, statePath: string): Promise<string> {
  const ran = await $.process.run(['node', `${$.plugin.root}/web/server.mjs`, '--login', '--state', statePath], { timeoutMs: 10_000 })
  const line = ran.stdout.split('\n').map(parseChannelLine).find(heard => heard?.kind === 'url')
  if (ran.exitCode !== 0 || line?.kind !== 'url') throw new Error(ran.stderr.trim().split('\n').pop() || 'the page did not give a new link')
  return line.url
}

/** Opens a URL in the default browser: `open` on macOS, `xdg-open` elsewhere. */
async function openInBrowser($: EngineInterface, url: string): Promise<boolean> {
  for (const opener of ['open', 'xdg-open']) {
    const result = await $.process.run([opener, url], { timeoutMs: 5000 }).catch(() => null)
    if (result?.exitCode === 0) return true
  }
  return false
}

/** `/hq report`: the session as a Markdown file in the project, said in a toast and in the command's answer. */
async function runReport($: EngineInterface): Promise<{ text: string }> {
  try {
    await syncAgents($)
    const data = await readData($, 0)
    const cwd = await $.session.cwd()
    const made = await createReport($, data, cwd, await $.clock.now())
    const text = reportToast(data, made.path, cwd)
    $.ui.toast(text)
    return { text: `${text}${made.hasSummary ? '' : '. (No summary: no model answered.)'}` }
  } catch (error) {
    return { text: `Agent HQ could not write the report (${error instanceof Error ? error.message : String(error)})` }
  }
}

/** `/hq trust`: use the project team file that was waiting for the person's say-so (a changed file asks again). */
async function approveTeam($: EngineInterface): Promise<{ text: string }> {
  const source = await read($, teamSource)
  if (!source?.needsApproval) return { text: 'Agent HQ: no project team file is waiting to be trusted.' }
  const loaded = await loadTeam($, { approve: true })
  await syncAgents($)
  return { text: loaded ? `Agent HQ: trusted. Team "${loaded.name}" is loaded, ${loaded.roles.length} roles.` : `Agent HQ: could not use ${source.path} (${(await read($, teamSource))?.error ?? 'error'}).` }
}

/** Everything waiting on the person right now (see ./inbox). */
async function readInbox($: EngineInterface) {
  return buildInbox(await read($, asks), await read($, agents), await read($, waitingSince))
}

async function syncStatus($: EngineInterface) {
  const p = overallProgress(await read($, tasks), await readTeamTodos($))
  $.ui.status(statusText(workingCount(await read($, agents)), (await readInbox($)).length, p))
}

async function readData($: EngineInterface, columns: number): Promise<HqData> {
  return {
    agents: await read($, agents),
    todos: await readTeamTodos($),
    tasks: await read($, tasks),
    now: await read($, now),
    hideFinished: await read($, hideFinished),
    columns,
    isLight,
    team: await read($, team),
    xp: await xpSummaries(xpStoreOf($), xpLedger, await read($, agents)),
    project: folderOf(await $.session.cwd().catch(() => '')),
    activity: liveActivities(await read($, activity), await read($, agents)),
    assignments: await read($, assignments),
  }
}

// Escape closes it as the person's close does, without asking for the keyboard (no `focus`)
const openSidebar = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE, columns: SIDEBAR_COLUMNS, closeOnEscape: true })
// a surface that cannot list panes reads as closed, so `/hq` opens
const isSidebarOpen = async ($: EngineInterface) => (await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE)
const CLOSED_TEXT = 'Agent HQ sidebar closed — /hq to open it again'

/** `/hq close` and the toggle: closes the pane (its ui.close hook then keeps it from opening again by itself). */
async function closeSidebar($: EngineInterface): Promise<{ text: string }> {
  if (await isSidebarOpen($)) await $.ui.close({ id: PANE })
  $.ui.toast(CLOSED_TEXT)
  return { text: CLOSED_TEXT }
}

export const register: Register = (on, options) => {
  isMuted = !soundsOn(options.sounds)
  nameTheme = themeOf(options.nicknameTheme)
  on('session.start', async ($, e, next) => {
    configureLock((ms, fn) => $.clock.after(ms, fn)) // times the roster lock (hooks/lock.ts)
    await $.command.register({
      name: 'hq',
      description: 'Open or close the Agent HQ sidebar (or `/hq web` for the live browser overview): agent tree, progress, task board',
      argumentHint: '[open|close|web|report|trust]',
    })
    // shortcut: a light theme name picks the light tint; "auto" is read as dark (plan-progress also probes macOS appearance).
    const theme = (await $.config.list().catch(() => [])).find(row => row.key === 'theme')
    isLight = /light/i.test(String(theme?.value ?? 'dark'))
    // shortcut: polls $.agent.list() every second, since status changes raise no event; fine for a handful of agents.
    $.clock.every(POLL_MS, () => {
      syncAgents($).catch(() => {}) // a failed poll (e.g. during shutdown) is retried next tick
      if (web && !canRunActions) canRunActions = true // the live page is up: requests the server printed meanwhile run now
      if (canRunActions && inbox.length > 0) void handleIncoming($)
    })
    // awaited, so the team's agent types are listed from the first turn; a bad file is reported, never fatal
    await migrateHomeTrust($).catch(() => {}) // a store that cannot be read just means the home file asks for trust
    await loadTeam($).catch(error => $.ui.toast(`Agent HQ: could not load the team (${error instanceof Error ? error.message : 'error'})`))
    for (const spec of TOOL_SPECS) await $.tool.register(spec).catch(error => $.ui.log(`Agent HQ: could not offer ${spec.name} (${error instanceof Error ? error.message : 'error'})`, { to: 'debug' }))
    // a hot reload ends the module and the page server with it: bring the page back (same hub port and secret, so an open tab reconnects)
    if (await read($, isWebWanted)) void startWeb($).catch(error => $.ui.log(`Agent HQ: could not restart the live page (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))

    return next(e)
  })

  on('command.run', { command: 'hq' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'report') return runReport($)
    if (e.args.trim().toLowerCase() === 'trust') return approveTeam($)
    if (e.args.trim().toLowerCase() === 'web') {
      await loadTeam($).catch(() => null)
      await syncAgents($)
      try {
        // the first link of a started server is single-use and spent by the first visit: a repeated /hq web asks the hub for a new one
        const url = web ? await freshLoginUrl($, web.statePath) : await startWeb($)
        await update($, isWebWanted, () => true)
        const opened = await openInBrowser($, url)
        return { text: opened ? `Agent HQ live page opened: ${url}` : `Agent HQ live page is running; open it at ${url}` }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return { text: `Agent HQ could not start its live page (${reason}). It needs Node.js on your PATH.` }
      }
    }
    const arg = e.args.trim().toLowerCase()
    // `/hq` alone toggles; `close` and `open` say which
    if (arg === 'close' || (arg === '' && (await isSidebarOpen($)))) return closeSidebar($)
    await update($, isBandHidden, () => false)
    const loaded = await loadTeam($)
    await openSidebar($)
    await syncAgents($)
    const source = await read($, teamSource)
    if (source?.error) return { text: `Agent HQ sidebar opened. The team file at ${source.path} was ignored: ${source.error}` }

    return { text: loaded ? `Agent HQ sidebar opened. Team "${loaded.name}" is loaded.` : 'Agent HQ sidebar opened. No team yet: run /agent-hq:team to create one.' }
  })

  // the main session plays the team's lead: its role, rules and roster ride in the system prompt while a team exists
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const current = await read($, team)
    if (!current || e.traits.includes('teammate') || e.traits.includes('bare') || e.traits.includes('lean')) return composed

    return { sections: [...composed.sections, { id: 'agent-hq:team', text: `${leadPrompt(current)}\n\n${LEAD_TOOLS_NOTE}`, scope: 'session' as const }] }
  })

  // a /model switch raises no event a mod sees: check the lead's model as each prompt goes in
  on('prompt.submit', async ($, e, next) => {
    await read($, team).then(current => warnLeadModel($, current)).catch(() => {}) // advice only, never in the prompt's way
    return next(e)
  })

  // once the person (or /hq close) closes the sidebar it never opens by itself again this session: only /hq brings it back
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) {
      sites.delete('sidebar')
      if (e.origin.kind !== 'unload') await update($, wasAutoOpened, () => true).catch(() => {})
    }
    return closed
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    // bookkeeping after the agent started: whatever goes wrong here must not turn a started agent into an Agent-tool error
    await (async () => {
      await syncAgents($)
      await update($, isBandHidden, () => false)
      if (!(await read($, wasAutoOpened))) {
        await update($, wasAutoOpened, () => true)
        openSidebar($).catch(() => {}) // unasked opening is best-effort: no surface (e.g. -p) just means no sidebar
      }
    })().catch(error => $.ui.log(`Agent HQ: could not note a started agent (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))

    return spawned
  })

  on('tool.call', async ($, e, next) => {
    // the lead's own tools are answered here (a matcher per tool name makes the compiler's tool union too deep)
    if (String(e.tool) === ASSIGN_TOOL) return answerLeadTool($, e, deps => hqAssign($, e, deps))
    if (String(e.tool) === STATUS_TOOL) return answerLeadTool($, e, deps => hqStatus(deps))
    if (String(e.tool) === REVIEW_TOOL) return answerLeadTool($, e, deps => hqReview($, e, deps))
    if (String(e.tool) === HIRE_TOOL) return answerLeadTool($, e, deps => hqHire(e, deps))

    const blocked = await blockedByGuard($, e)
    if (blocked) return { deny: blocked }

    const loop = e.agentId ?? MAIN
    const t = await $.clock.now()
    await update($, agents, rows => countTool(rows, loop, String(e.tool), t))
    await recordEvents($, [{ agent: loop, kind: 'tool', text: `used ${String(e.tool)}` }])
    // what it does right now: the sidebar and band redraw on the write; the page gets it without waiting for the poll
    const callId = e.tool_use_id || `${loop}:${t}`
    const doing = { text: describeCall(String(e.tool), e as unknown as Record<string, unknown>), since: t, callId }
    await update($, activity, all => startActivity(all, loop, doing))
      .then(() => requestLive($))
      .catch(() => {}) // the live line is a nicety: never fail the call over it

    // an Edit of the team file: its text before, to work out what the file must hold after (see expectedOwnTeamText)
    const teamBefore =
      e.tool === 'Edit' && e.agentId === undefined && isTeamFile((e as TeamWrite).file_path) ? await $.fs.read(await pathOf($, String((e as TeamWrite).file_path))).catch(() => null) : null

    let ran
    try {
      ran = await next(e)
    } finally {
      const ended = await $.clock.now().catch(() => t)
      await update($, activity, all => endActivity(all, loop, callId, ended))
        .then(() => requestLive($))
        .catch(() => {})
      // whatever the person answered, the call is decided now: it no longer waits on them
      if (e.tool_use_id && (await read($, asks))[e.tool_use_id]) {
        const toolUseId = e.tool_use_id
        await update($, asks, all => removeAsk(all, toolUseId))
          .then(() => syncStatus($))
          .then(() => requestLive($))
          .catch(() => {}) // the status and the page catch up on the next poll
      }
    }
    if (e.tool === 'Bash' && ran.deny === undefined) await creditBash($, loop, e.command, ran.isError === true)
    if (ran.deny !== undefined || ran.isError === true) return ran

    // bookkeeping after the tool ran: whatever goes wrong here must not turn a finished tool call into a failed one
    await (async () => {
      if (e.tool === 'TodoWrite') {
        const before = (await read($, todos))[loop]
        await update($, todos, all => ({ ...all, [loop]: e.todos.map(todo => ({ ...todo })) }))
        await recordEvents($, stepEvents(loop, before, e.todos))
      } else if (e.tool === 'TaskCreate' && ran.result) {
        const id = (ran.result as { task?: { id?: string } }).task?.id
        if (id) await update($, tasks, all => createTask(all, id, e.subject, e.activeForm))
      } else if (e.tool === 'TaskUpdate') {
        await update($, tasks, all =>
          updateTask(all, e.taskId, {
            subject: e.subject,
            activeForm: e.activeForm,
            status: e.status,
            owner: e.owner,
            addBlockedBy: e.addBlockedBy,
          }),
        )
        if (e.status === 'completed') await recordEvents($, [{ agent: loop, kind: 'step', text: `done: ${(await read($, tasks))[e.taskId]?.subject ?? `task ${e.taskId}`}` }])
      } else if ((e.tool === 'Write' || e.tool === 'Edit') && isTeamFile((e as { file_path?: unknown }).file_path)) {
        // the team skill (or the person) just wrote the team file: load it now, so its roles can be used this turn.
        // Only the main session's own write of the file in force is trusted; anything else waits for the person's /hq trust.
        const expected = await expectedOwnTeamText($, e as TeamWrite, teamBefore)
        const loaded = await loadTeam($, expected === null ? {} : { approve: true, expect: expected })
        const trusted = expected !== null && (await read($, teamSource))?.needsApproval !== true
        if (loaded && trusted) $.ui.toast(`Agent HQ: team "${loaded.name}" loaded, ${loaded.roles.length} roles`)
      }
      await syncStatus($)
      await requestLive($)
    })().catch(error => $.ui.log(`Agent HQ: could not note a ${String(e.tool)} call (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))

    return ran
  })

  // what each agent used: the engine reports tokens and time at the end of every turn (no price, so no cost)
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const loop = e.agentId ?? MAIN
    await update($, usage, all => ({ ...all, [loop]: addTurn(all[loop], e) }))
      .then(() => requestLive($))
      .catch(error => $.ui.log(`Agent HQ: could not note a turn (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))
    return done
  })

  // a call the engine puts to the person (a permission dialog) waits in the inbox until its tool.call ends
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision === 'ask' && e.tool_use_id) {
      const toolUseId = e.tool_use_id
      await $.clock
        .now()
        .then(since => update($, asks, all => addAsk(all, toolUseId, { agent: e.agentId ?? MAIN, since, what: describeAsk(e.tool, e.input) })))
        .then(() => syncStatus($))
        .then(() => requestLive($))
        .catch(error => $.ui.log(`Agent HQ: could not note a permission ask (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))
    }
    return verdict
  })

  // which agent moves which plan-progress bar: its response row names the bar; every plugin sees every row,
  // whatever order the plugins stand in (plan-progress answers its tool itself, so tool.call may never reach us)
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door !== 'response') return stored
    // the row is stored already: a failure noting it here must not fail the append
    await (async () => {
      const answer = e.agentId ? textOfContent(e.message.content) : ''
      if (e.agentId && answer) await update($, results, all => keepResult(all, e.agentId as string, answer))
      const ids = barIdsIn(e.message.content)
      if (ids.length > 0) {
        const owner = e.agentId ?? MAIN
        const at = await $.clock.now()
        await update($, barOwners, all => ({ ...all, ...Object.fromEntries(ids.map(id => [id, { owner, at }])) }))
      }
    })().catch(error => $.ui.log(`Agent HQ: could not note a message (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))

    return stored
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined) isLight = /light/i.test(String(r.value))

    return r
  })

  // the band above the prompt: plan-progress style Team and Tasks tracks, stacked over whatever else draws there
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await readData($, Math.max(30, e.props.bodyColumns || 100))
    if (e.props.hasSurvey || !hasBand(data) || (await read($, isBandHidden))) {
      sites.delete('band')
      return next(e)
    }
    const hasClicks = e.surface !== 'terminal' || e.viewport?.isFullscreen === true
    const W = bandTrackWidth(data.columns, hasClicks)
    const actions: BandActions = {
      onOpenSidebar: () => void openSidebar($),
      onHide: () => void update($, isBandHidden, () => true),
    }
    const els = $.ui.resolve(e)
    let tree
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const drawn = bandRasters(data, W, data.now, isLight)
      seat($, 'band', { requestId: e.requestId, data, draw: t => bandRasters(data, W, t, isLight) })
      const draw = (key: string) => {
        const r = drawn.find(x => x.key === key)
        return r ? <Raster key={r.key} columns={r.columns} rows={r.rows} cells={r.cells} /> : null
      }
      tree = BandView(els, data, actions, draw, hasClicks)
    } else {
      tree = BandView(els, data, actions, textTrack(els, bandRasters(data, W, data.now, isLight), data), hasClicks)
    }
    // other mods' bands (plan-progress's bars) keep drawing under ours; asked last, as plan-progress does
    const below = await next(e)
    const { Box } = els
    return below ? (
      <Box flexDirection="column">
        {tree}
        {below}
      </Box>
    ) : (
      tree
    )
  })

  // the sidebar: agent tree, what each agent does now and next, its todo track, the task board
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // the sidebar pads one column each side on its dark panel
    const data = await readData($, Math.max(20, e.props.bodyColumns - 2))
    const actions: HqActions = {
      onView: agentId => void $.ui.view(agentId === MAIN ? {} : { agentId }),
      onToggleHide: () => void update($, hideFinished, v => !v),
      onClear: () => clearDone($),
      onClose: () => void closeSidebar($).catch(() => {}),
    }
    if (e.surface !== 'terminal') {
      const els = $.ui.resolve(e)
      return SidebarView(els, data, actions, textTrack(els, sidebarRasters(data, data.now), data))
    }
    const els = $.ui.resolve(e)
    const { Raster } = els
    const drawn = sidebarRasters(data, data.now)
    seat($, 'sidebar', { requestId: e.requestId, data, draw: t => sidebarRasters(data, t) })
    const draw = (key: string) => {
      const r = drawn.find(x => x.key === key)
      return r ? <Raster key={r.key} columns={r.columns} rows={r.rows} cells={r.cells} /> : null
    }
    return SidebarView(els, data, actions, draw)
  })
}
