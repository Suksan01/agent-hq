import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import { DOING_TOOL, MAIN, barIdsIn, clearFinished, countTool, createTask, mergeAgents, mergeTodos, overallProgress, planSteps, updateTask, who, workingCount } from './model'
import { cleanSaying, currentStep, maskedWork, pruneSays } from './says'
import type { HqTeam, HqTodo } from '../types'
import { MEMORY_SCOPE, NO_TEAM_PROMPT, SELF_EVAL_SKILL, TEAM_FILE, languageSection, leadModelWarning, leadPrompt, parseTeam, rolePrompt } from './team'
import { LANGUAGE_CHOICES, LANGUAGE_HEADER, LANGUAGE_OPTION, LANGUAGE_QUESTION, langOf, languageOfAnswer, t } from './i18n'
import type { Key, Lang } from './i18n'
import { PERSON_FRAME, personStarts, runFreshActions } from './actions'
import type { ActionDeps, PageAction } from './actions'
import { hasOldRecord, isApproved, withApproval } from './approval'
import { lineBuffer, parseChannelLine } from './channel'
import { EMPTY_FEED, addEvents, statusEvents, stepEvents } from './feed'
import type { NewEvent } from './feed'
import { buildSnapshot } from './live'
import { parseSuggestions, suggestPrompt } from './suggest'
import { ALLOWED, APPROVAL_MS, DENIED, HELPER_TIMEOUT_MS, LINK_NOTICE_MS, answerOf, approvalRequest, canHold, isApprovalsReleased, pageCount } from './pageapproval'
import { maskSecrets } from './secrets'
import { addBubble, bubbleText, liveBubbles, placeTalk, recipientOf, talkLine } from './talk'
import { configureLock } from './lock'
import { createReport, reportToast } from './report'
import { soundsForChanges } from './sounds'
import type { Sound } from './sounds'
import { soundsOn, themeOf } from './themes'
import { agentRoles, guardToolCall } from './guard'
import { addTurn } from './usage'
import { describeCall, endActivity, hasRunningCall, liveActivities, startActivity } from './activity'
import { addAsk, buildInbox, describeAsk, dropAsksOf, removeAsk, statusText, trackWaiting } from './inbox'
import { announceXp, createLedger, creditActivity, creditTestRun, xpStoreOf, xpSummaries } from './xpstore'
import { ASSIGN_TOOL, HIRE_TOOL, LEAD_TOOLS_NOTE, REVIEW_TOOL, STATUS_TOOL, TOOL_SPECS, hqAssign, hqHire, hqReview, hqStatus, keepResult, textOfContent } from './tools'
import type { ToolAnswer, ToolDeps } from './tools'
import { BandView, SidebarView, bandRasters, bandTrackWidth, folderOf, hasBand, labelOf, sidebarRasters, textTrack, withAside } from './view'
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
const isTreeExpanded = atom({ plugin: 'agent-hq', key: 'isTreeExpanded' } as const, false)
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
const says = atom({ plugin: 'agent-hq', key: 'says' } as const, {})
const bubbles = atom({ plugin: 'agent-hq', key: 'bubbles' } as const, [])
const suggestions = atom({ plugin: 'agent-hq', key: 'suggestions' } as const, null)

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
async function loadTeam($: EngineInterface, options: { approve?: boolean; expect?: string; isQuiet?: boolean } = {}): Promise<HqTeam | null> {
  const toast = (text: string) => void (options.isQuiet ? undefined : $.ui.toast(text)) // quiet: a reload that only refreshes what is known
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
    toast(t(lang, 'team.ignored', { reason: parsed, path }))
    return await read($, team)
  }
  const approved = await $.store.get(APPROVED_TEAMS)
  // `approve` trusts the text read just now, but only when it is the text the caller expects (what it wrote): a file that
  // changed after the write is not trusted by it
  if (options.approve === true && (options.expect === undefined || options.expect === source)) await $.store.set(APPROVED_TEAMS, withApproval(approved, path, source))
  else if (!isApproved(approved, path, source)) {
    // the last trusted team stays in force (its guard and lead section) until the person trusts this text
    await update($, teamSource, () => ({ path, error: t(lang, 'team.notTrustedYet'), needsApproval: true }))
    toast(
      hasOldRecord(approved, path)
        ? t(lang, 'team.resetTrust', { path })
        : file.isProject
          ? t(lang, 'team.projectFound', { name: parsed.name, path })
          : t(lang, 'team.changedOutside'),
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
      prompt: rolePrompt(parsed, role, hasMemory, lang),
      ...(role.tools ? { tools: role.tools } : {}),
      ...(role.model ? { model: role.model } : {}),
      ...(role.effort ? { effort: role.effort } : {}),
      skills: [...new Set([...role.skills, SELF_EVAL_SKILL])],
      memory: MEMORY_SCOPE,
    })
  }
  await update($, team, () => parsed)
  await update($, teamSource, () => ({ path }))
  if (file.isProject && !options.approve) toast(t(lang, 'team.usingProject', { name: parsed.name, path }))
  await warnLeadModel($, parsed).catch(() => {}) // advice only: a session whose model cannot be read is not warned
  return parsed
}

let saidLeadModel: string | undefined // the last lead-model warning shown, so one mismatch is said once

/** Toasts when the session runs on another model than the team's lead asks for, once per change. */
async function warnLeadModel($: EngineInterface, current: HqTeam | null): Promise<void> {
  const warning = leadModelWarning(current?.lead.model, await $.session.model(), lang)
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
let lang: Lang = 'en' // the `language` option, read when the module registers; /hq lang sets it at once, before the reload
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
  const [listed, at, session] = await Promise.all([$.agent.list(), $.clock.now(), $.session.id().catch(() => '')]) // no id just means no lead seed
  const before = await read($, agents)
  const after = mergeAgents(before, listed, at, nameTheme, session)
  let heard: Sound | null = null
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    await update($, agents, () => after)
    await recordEvents($, statusEvents(before, after, lang))
    heard = soundsForChanges(before, after, { muted: isMuted })
  }
  // XP from what changed, then the one clip of this poll: a status change's, or a level up's when that is louder
  const earned = await creditActivity(xpStoreOf($), xpLedger, { agents: after, todos: await readTeamTodos($), tasks: await read($, tasks) }, at).catch(() => [])
  await announceXp($, earned, heard, isMuted, lang)
  const waits = trackWaiting(await read($, waitingSince), after, at)
  if (JSON.stringify(waits) !== JSON.stringify(await read($, waitingSince))) await update($, waitingSince, () => waits)
  await pruneSaid($)
  await expireBubbles($, at)
  // ticks the clock only while someone works or a call runs (the lead's too), so elapsed times and live lines move and
  // an idle view stays still
  if (hasRunningCall(await read($, activity), after) || workingCount(after) > 0) await update($, now, () => at)
  await syncStatus($)
  await requestLive($)
}

/** Drops the sentences no longer in force: an agent finished, or its step moved on (hooks/says.ts); writes only when one went. */
async function pruneSaid($: EngineInterface) {
  const before = await read($, says)
  const after = pruneSays(before, await read($, agents), await readTeamTodos($))
  if (after !== before) await update($, says, () => after)
}

/** Ends the talk bubbles past their time (hooks/talk.ts); writes only when one went. */
async function expireBubbles($: EngineInterface, at: number) {
  const before = await read($, bubbles)
  const after = liveBubbles(before, at)
  if (after !== before) await update($, bubbles, () => [...after])
}

/**
 * Something said between two parties, as a talk bubble on the member's card (hooks/talk.ts) and a feed `message`.
 * Nothing when it says nothing, or the card is not an agent listed here (another session, the engine's own forks).
 */
async function talk($: EngineInterface, from: string, to: string, raw: unknown) {
  const text = bubbleText(raw)
  const placed = placeTalk(from, to)
  const rows = await read($, agents)
  if (!text || !placed || !rows[placed.agent]) return
  const bubble = { ...placed, text, at: await $.clock.now() }
  await update($, bubbles, all => addBubble(all, bubble))
  await recordEvents($, [{ agent: bubble.agent, kind: 'message', text: talkLine(bubble, rows, lang) }])
  await requestLive($)
}

/**
 * hq_doing, for the lead and every member alike: what the caller says it is doing, kept for the step it has in progress
 * (one line, secrets masked, cut short; empty clears it). The answer is the model's, so it stays English.
 */
async function answerDoing($: EngineInterface, e: { agentId?: string }) {
  const given = (e as { text?: unknown }).text
  if (given !== undefined && typeof given !== 'string') return { result: 'hq_doing: "text" must be a string.', isError: true as const }
  const loop = e.agentId ?? MAIN
  const text = cleanSaying(given)
  const step = currentStep((await readTeamTodos($))[loop])?.content
  const at = await $.clock.now()
  await update($, says, all => {
    const { [loop]: _old, ...rest } = all
    return text ? { ...rest, [loop]: { text, at, ...(step === undefined ? {} : { step }) } } : rest
  })
  await requestLive($)
  return { result: text ? `Shown beside your name: "${text}"` : 'Cleared.' }
}

/** A test command's result as XP for the agent that ran it; never fails the tool call it follows. */
async function creditBash($: EngineInterface, loop: string, command: string, failed: boolean) {
  try {
    const nickname = (await read($, agents))[loop]?.nickname
    await announceXp($, await creditTestRun(xpStoreOf($), xpLedger, nickname, command, failed, await $.clock.now()), null, isMuted, lang)
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
      lang,
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
  readData: () => readData($, 0, false),
  syncAgents: () => syncAgents($),
  now: () => $.clock.now(),
  assignmentOf: async name => (await read($, assignments))[name],
  recordAssignment: async (name, assignment) => void (await update($, assignments, all => ({ ...all, [name]: assignment }))),
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
      const yes = t(lang, 'hire.yes') // the answer comes back as the label shown, so it is compared in the same words
      return (await $.ui.ask(question, { options: [yes, t(lang, 'dialog.no')], header: t(lang, 'dialog.teamFile') })) === yes ? 'yes' : 'no'
    } catch {
      return 'unavailable' // dismissed, or a run with no one to ask (-p)
    }
  },
  lang,
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
    // guard), though no subagent may change a team file. A sync that failed tells nothing: a new member of a guarded
    // role cannot be told from a stranger, so the call is refused (the next poll lists it, and a retry is judged)
    const isSynced = await syncAgents($)
      .then(() => true)
      .catch(error => {
        $.ui.log(`Agent HQ: could not list the agents (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' })
        return false
      })
    found = agentRoles(await read($, agents), e.agentId)
    if (found.unknown && !isSynced) return GUARD_UNSURE
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
  const agentId = e.agentId
  // telling the person is best-effort: it never costs a decided deny. The reason is the guard's, which the model reads
  // too: it stays English inside the person's words
  await (async () => {
    $.ui.toast(t(lang, 'guard.blocked', { who: row ? who(row) : agentId, reason }))
    await recordEvents($, [{ agent: agentId, kind: 'action', text: t(lang, 'feed.blocked', { tool: String(e.tool), reason }), failed: true }])
  })().catch(() => {})
  return verdict.deny
}

// what a member's call gets when its guard cannot decide (the model reads it)
const GUARD_UNSURE = 'Agent HQ: the rule guard could not tell which role this agent has; nothing was done, try again'
const GUARD_FAILED = 'Agent HQ: the rule guard could not run; nothing was done'

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
  const extras = { lastAction: await read($, lastAction), events: (await read($, feed)).events, inbox: await readInbox($), usage: await read($, usage), waitingSince: await read($, waitingSince), suggestions: await read($, suggestions) }
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

// ---------- the page's settings, and how many pages are open ----------
type Setting = { key: string; isDefaultOn: boolean; on: Key; off: Key; usage: Key }
// $.store keys, each a boolean the person set; unset means its default
const NEXT_TASKS: Setting = { key: 'nextTasks', isDefaultOn: true, on: 'web.nextOn', off: 'web.nextOff', usage: 'web.nextUsage' }
const PAGE_APPROVALS: Setting = { key: 'pageApprovals', isDefaultOn: false, on: 'web.approvalsOn', off: 'web.approvalsOff', usage: 'web.approvalsUsage' }
const WEB_SETTINGS: Readonly<Record<string, Setting>> = { next: NEXT_TASKS, approvals: PAGE_APPROVALS } // /hq web <word> [on|off]

/** Page approvals ship in 0.8.0 (hooks/pageapproval.ts): until then, never in force. */
const areApprovalsReleased = async ($: EngineInterface) => isApprovalsReleased(await $.session.id().catch(() => ''))

async function isSettingOn($: EngineInterface, setting: Setting): Promise<boolean> {
  if (setting === PAGE_APPROVALS && !(await areApprovalsReleased($))) return false
  const stored = await $.store.get(setting.key)
  return typeof stored === 'boolean' ? stored : setting.isDefaultOn
}

/** `/hq web next|approvals [on|off]`: sets it, and says which is in force. */
async function settingCommand($: EngineInterface, setting: Setting, word: string): Promise<{ text: string }> {
  if (word !== '' && word !== 'on' && word !== 'off') return { text: t(lang, setting.usage) }
  if (word !== '') await $.store.set(setting.key, word === 'on')
  return { text: t(lang, (await isSettingOn($, setting)) ? setting.on : setting.off) }
}

/** Pages open on the hub (its pages.json beside this session's state file); 0 without the page server, or unreadable. */
async function openPages($: EngineInterface): Promise<number> {
  if (!web) return 0
  const text = await $.fs.read(`${web.statePath.slice(0, web.statePath.lastIndexOf('/'))}/pages.json`).catch(() => '')
  return pageCount(text)
}

// ---------- next-task suggestions on the live page (hooks/suggest.ts) ----------
let suggestFor: string | null = null // the lead's answered turn the next fork drafts for; null once its next turn started
let isSuggesting = false // one fork at a time

/**
 * Forks the session for the lead's last answered turn, detached from the hook that asked, while the page runs and the
 * setting is on. An answer that went stale meanwhile is dropped: a newer answered turn is forked for next, a started one
 * gets nothing. Never throws: a failed fork is logged and leaves no suggestion.
 */
async function suggestNext($: EngineInterface) {
  if (isSuggesting) return
  isSuggesting = true
  try {
    while (suggestFor !== null) {
      const turnId = suggestFor
      if (!(await isSettingOn($, NEXT_TASKS)) || (await openPages($)) === 0) break
      const reply = await $.model.fork({ prompt: suggestPrompt(lang) })
      if (suggestFor !== turnId) continue
      if (!reply.isAnswered) $.ui.log(`Agent HQ: no next-task suggestions (${reply.reason})`, { to: 'debug' })
      const parsed = reply.isAnswered ? parseSuggestions(reply.text) : null
      if (parsed) {
        const at = await $.clock.now()
        // the lead's next turn may start while this is written: only a draft still current lands
        await update($, suggestions, current => (suggestFor === turnId ? { ...parsed, at } : current))
        await requestLive($)
      }
      if (suggestFor === turnId) suggestFor = null // else a newer answered turn waits: the loop forks for it
    }
  } catch (error) {
    $.ui.log(`Agent HQ: could not suggest next tasks (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' })
  } finally {
    isSuggesting = false
  }
}

/** Takes the suggestions off the page, and drops the answer of a fork still running for them. */
async function clearSuggestions($: EngineInterface) {
  suggestFor = null
  if ((await read($, suggestions)) === null) return
  await update($, suggestions, () => null)
  await requestLive($)
}

// ---------- page approvals (hooks/pageapproval.ts) ----------
// the permission mode each loop was last seen in (main, or an agent id), from the classic hooks that carry it; a mod's
// classic.PreToolUse gets no mode. shortcut: a switch mid-turn is seen once the next tool call ends
const modes = new Map<string, string>()
let isApprovalOpen = false // one approval at a time

function noteMode(e: { permission_mode?: string; agent_id?: string }) {
  if (typeof e.permission_mode === 'string') modes.set(e.agent_id ?? MAIN, e.permission_mode)
}

type Ask = { tool: string; input: unknown; tool_use_id?: string; agentId?: string; ceiling?: string }
type Verdict = { decision: 'allow' | 'ask' | 'deny'; reason?: string; setting?: string; hook?: string; decider?: 'host' }

/**
 * An ask offered on the live page first: tool.check waits while web/approve.mjs waits for the person's answer there.
 * Only an ask is held, one at a time; only their Allow or Deny changes it. No answer, "Ask in terminal now", a helper
 * that failed or timed out, and Esc (which aborts the run) all leave the ask, so the engine's dialog follows.
 */
async function askOnPage<V extends Verdict>($: EngineInterface, e: Ask, verdict: V): Promise<V | Verdict> {
  if (verdict.decision !== 'ask' || isApprovalOpen) return verdict
  isApprovalOpen = true // taken before the first await, so a second ask meanwhile goes to the dialog
  try {
    if (!(await areApprovalsReleased($))) return verdict
    const loop = e.agentId ?? MAIN
    const reason = verdict.reason ? maskSecrets(verdict.reason) : undefined
    const facts = {
      decision: verdict.decision,
      decider: verdict.decider,
      isOn: await isSettingOn($, PAGE_APPROVALS),
      pages: await openPages($),
      toolUseId: e.tool_use_id,
      tool: e.tool,
      ceiling: e.ceiling,
      mode: modes.get(loop),
      input: e.input,
      reason,
    }
    if (!canHold(facts) || !web || !e.tool_use_id) return verdict
    const row = (await read($, agents))[loop]
    const current = await read($, team)
    const role = loop === MAIN ? (current?.lead.title ?? null) : row ? labelOf(row, current, lang).role : null
    const request = approvalRequest({
      id: e.tool_use_id,
      agent: row ? who(row) : loop,
      role,
      tool: e.tool,
      input: e.input,
      reason: reason ?? null,
      setting: verdict.setting ?? null,
      hook: verdict.hook ?? null,
      cwd: await $.session.cwd(),
      lang,
      at: await $.clock.now(),
    })
    $.ui.toast(t(lang, 'approval.waiting'), { timeoutMs: APPROVAL_MS })
    const ran = await $.process.run(['node', `${$.plugin.root}/web/approve.mjs`, '--state', web.statePath], { stdin: request, timeoutMs: HELPER_TIMEOUT_MS })
    const answer = ran.exitCode === 0 ? answerOf(ran.stdout) : null
    if (answer === 'allow') return { decision: 'allow', reason: ALLOWED }
    if (answer === 'deny') return { decision: 'deny', reason: DENIED }
    return verdict
  } catch (error) {
    $.ui.log(`Agent HQ: the page approval ended without an answer (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' })
    return verdict
  } finally {
    isApprovalOpen = false
  }
}

/** A new one-time login link for the running page, and how many pages are open (`server.mjs --login` asks the hub). */
async function freshLogin($: EngineInterface, statePath: string): Promise<{ url: string; pages: number }> {
  const ran = await $.process.run(['node', `${$.plugin.root}/web/server.mjs`, '--login', '--state', statePath], { timeoutMs: 10_000 })
  const heard = ran.stdout.split('\n').map(parseChannelLine)
  const line = heard.find(h => h?.kind === 'url')
  if (ran.exitCode !== 0 || line?.kind !== 'url') throw new Error(ran.stderr.trim().split('\n').pop() || 'the page did not give a new link')
  const pages = heard.find(h => h?.kind === 'pages')
  return { url: line.url, pages: pages?.kind === 'pages' ? pages.count : 0 } // a hub that does not say: none open
}

// what each /hq web reply says instead of its link, while page approvals are on
const NO_LINK: Record<'web.alreadyOpen' | 'web.opened' | 'web.running', Key> = { 'web.alreadyOpen': 'web.alreadyOpenNoLink', 'web.opened': 'web.openedNoLink', 'web.running': 'web.runningNoLink' }

/** A /hq web reply; while page approvals are on, its login link goes in a notice instead (a browser already opened needs none). */
function linkReply($: EngineInterface, isGuarded: boolean, key: keyof typeof NO_LINK, params: Record<string, string>): { text: string } {
  if (!isGuarded) return { text: t(lang, key, params) }
  if (key !== 'web.opened') $.ui.toast(t(lang, 'web.linkNotice', { url: params.url ?? '' }), { timeoutMs: LINK_NOTICE_MS })
  return { text: t(lang, NO_LINK[key], params) }
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
    return { text: `${text}${made.hasSummary ? '' : t(lang, 'report.noSummary')}` }
  } catch (error) {
    return { text: t(lang, 'report.failed', { reason: error instanceof Error ? error.message : String(error) }) }
  }
}

/**
 * `/hq trust`: use the project team file that was waiting for the person's say-so (a changed file asks again). `expect`
 * is the text the person was shown: a file that changed since is not trusted by their yes.
 */
async function approveTeam($: EngineInterface, expect?: string): Promise<{ text: string }> {
  const source = await read($, teamSource)
  if (!source?.needsApproval) return { text: t(lang, 'trust.nothingWaiting') }
  const loaded = await loadTeam($, { approve: true, expect })
  await syncAgents($)
  const now = await read($, teamSource)
  // still waiting, or unreadable: what `loaded` holds then is the last trusted team, not this file
  if (!loaded || now?.needsApproval || now?.error) return { text: t(lang, 'trust.couldNotUse', { path: source.path, error: now?.error ?? t(lang, 'trust.error') }) }
  return { text: t(lang, 'trust.done', { name: loaded.name, n: loaded.roles.length }) }
}

// runs the engine attests as the person's own: they may trust a team file at once
const PERSON_ORIGINS: ReadonlySet<PromptOrigin['kind']> = new Set(['composer', 'bridge', 'sdk', 'slack-ping'])
// runs it cannot attest (unstamped, or made by a program): they may trust only through the dialog the person answers.
// Every other run (a plugin's `$.command.run`, a scheduled prompt a model can set up, a message another session or agent
// wrote) may not trust at all
const ASKING_ORIGINS: ReadonlySet<PromptOrigin['kind']> = new Set(['unclassified', 'auto-continuation'])
const notYours = (origin: PromptOrigin) => ({ text: t(lang, 'trust.notYours', { origin: origin.kind === 'plugin' ? t(lang, 'trust.aPlugin') : origin.kind }) })
/** The team file text the person answered No to in this session, by path: plain `/hq` does not ask about it again. */
const declinedTrust = new Map<string, string>()

/**
 * Asks the person, in the engine's own dialog, to trust the team file waiting for it: an app's command menu runs `/hq`
 * before `trust` can be typed. The question names the team as the file parses. The answer after a yes; null when nothing
 * was asked (nothing waits, or plain `/hq` already got a No for this text) or the answer was not yes (No, dismissed, or
 * nobody to ask). `isExplicit` (`/hq trust`) asks even after a No.
 */
async function askTrust($: EngineInterface, isExplicit: boolean): Promise<{ text: string } | null> {
  await loadTeam($, { isQuiet: true }).catch(() => null) // a file changed mid-session is asked about on the first /hq
  const source = await read($, teamSource)
  if (!source?.needsApproval) return null
  const text = await $.fs.read(source.path).catch(() => null)
  const parsed = text === null ? 'unreadable' : parseTeam(text)
  if (text === null || typeof parsed === 'string') return null
  if (!isExplicit && declinedTrust.get(source.path) === text) return null
  const count = parsed.roles.length === 1 ? t(lang, 'trust.oneRole') : t(lang, 'trust.roles', { n: parsed.roles.length })
  const roles = `${count}: ${parsed.roles.map(r => r.id).join(', ')}`
  const question = t(lang, 'trust.question', { name: JSON.stringify(parsed.name), path: source.path, roles })
  // "No" first: a stray Enter must not trust. The answer is the label shown, so it is compared in the same words
  const [no, yes] = [t(lang, 'dialog.no'), t(lang, 'trust.yes')]
  const answer = await $.ui.ask(question, { options: [no, yes], header: t(lang, 'dialog.teamFile') }).catch(() => null)
  if (answer === no) declinedTrust.set(source.path, text)
  return answer === yes ? approveTeam($, text) : null
}

/**
 * `/hq web approvals on` from a run that is not the person's own: through the engine's dialog (No first) where the engine
 * cannot attest the run, never from a plugin, a schedule or another session. Turning them off is open to every run.
 */
async function approvalsOnFrom($: EngineInterface, origin: PromptOrigin): Promise<{ text: string }> {
  if (!ASKING_ORIGINS.has(origin.kind)) return { text: t(lang, 'approvals.notYours', { origin: origin.kind === 'plugin' ? t(lang, 'trust.aPlugin') : origin.kind }) }
  const [no, yes] = [t(lang, 'dialog.no'), t(lang, 'approvals.yes')]
  const answer = await $.ui.ask(t(lang, 'approvals.question'), { options: [no, yes], header: t(lang, 'approvals.header') }).catch(() => null)
  return answer === yes ? settingCommand($, PAGE_APPROVALS, 'on') : { text: t(lang, PAGE_APPROVALS.off) }
}

/** `/hq trust`: at once from the person's own run, through the dialog from a run the engine cannot attest, never otherwise. */
async function trustCommand($: EngineInterface, origin: PromptOrigin): Promise<{ text: string }> {
  if (PERSON_ORIGINS.has(origin.kind)) return approveTeam($)
  if (!ASKING_ORIGINS.has(origin.kind)) return notYours(origin)
  return (await askTrust($, true)) ?? { text: t(lang, (await read($, teamSource))?.needsApproval ? 'trust.notTrusted' : 'trust.nothingWaiting') }
}

/** Everything waiting on the person right now (see ./inbox). */
async function readInbox($: EngineInterface) {
  return buildInbox(await read($, asks), await read($, agents), await read($, waitingSince), await $.clock.now(), lang)
}

async function syncStatus($: EngineInterface) {
  const p = overallProgress(await read($, tasks), await readTeamTodos($))
  $.ui.status(statusText(workingCount(await read($, agents)), (await readInbox($)).length, p, lang))
}

async function readData($: EngineInterface, columns: number, isForPerson = true): Promise<HqData> {
  // every surface the person sees reads the work through here: a secret a model wrote in it is masked once, for all of
  // them. The lead's own tools (hq_status) read it as the lead and its members wrote it
  const written = { todos: await readTeamTodos($), tasks: await read($, tasks), assignments: await read($, assignments), says: await read($, says) }
  const work = isForPerson ? maskedWork(written) : written
  return {
    agents: await read($, agents),
    todos: work.todos,
    tasks: work.tasks,
    now: await read($, now),
    hideFinished: await read($, hideFinished),
    isTreeExpanded: await read($, isTreeExpanded),
    columns,
    isLight,
    team: await read($, team),
    xp: await xpSummaries(xpStoreOf($), xpLedger, await read($, agents)),
    project: folderOf(await $.session.cwd().catch(() => '')),
    activity: liveActivities(await read($, activity), await read($, agents)),
    says: work.says,
    assignments: work.assignments,
    bubbles: await read($, bubbles),
    lang,
  }
}

// Escape closes it as the person's close does, without asking for the keyboard (no `focus`)
const openSidebar = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE, columns: SIDEBAR_COLUMNS, closeOnEscape: true })
// a surface that cannot list panes reads as closed, so `/hq` opens
const isSidebarOpen = async ($: EngineInterface) => (await $.ui.panes().catch(() => [])).some(pane => pane.id === PANE)
/** `/hq close` and the toggle: closes the pane (its ui.close hook then keeps it from opening again by itself). */
async function closeSidebar($: EngineInterface): Promise<{ text: string }> {
  if (await isSidebarOpen($)) await $.ui.close({ id: PANE })
  const closed = t(lang, 'hq.closed')
  $.ui.toast(closed)
  return { text: closed }
}

const LANGUAGE_ASKED = 'languageAsked' // $.store key: the first-run language question was asked (or nobody could be)

/** Sets the `language` option, which reloads the plugin with it; this module speaks it from now on too. The refusal, or null. */
async function setLanguage($: EngineInterface, next: Lang): Promise<string | null> {
  await $.store.set(LANGUAGE_ASKED, true) // a language chosen (here or by /hq lang) is the answer: never asked after it
  const set = await $.config.set({ key: `${$.plugin.name}.language`, value: LANGUAGE_OPTION[next] }).catch((error: unknown) => ({ deny: error instanceof Error ? error.message : String(error) }))
  if (set.deny !== undefined) return set.deny
  lang = next
  return null
}

let languageAsk: Promise<Lang | null> | null = null // the question being asked: a client joining and /hq at once ask it once

/** Thai, as the person chose it: the setting reloads the plugin; a refusal is said in a toast. */
async function chooseThai($: EngineInterface) {
  const denied = await setLanguage($, 'th')
  if (denied !== null) $.ui.toast(t('th', 'lang.failed', { reason: denied }))
}

/**
 * Once: which language Agent HQ speaks, asked in both where a person can answer: at a REPL start, when a client joins
 * later (the desktop app starts with nobody to ask), or on the first plain /hq. Dismissed means English; either way it is
 * not asked again. The caller makes sure someone can answer: nothing is marked where nobody could be asked. Resolves
 * to Thai when Thai was chosen now. The setting reloads the plugin, so it is made just after, never inside a hook
 * still running (a /hq that joined the question).
 */
function askLanguageOnce($: EngineInterface): Promise<Lang | null> {
  languageAsk ??= (async (): Promise<Lang | null> => {
    if (await $.store.get(LANGUAGE_ASKED)) return null
    if (lang !== 'en') {
      await $.store.set(LANGUAGE_ASKED, true) // chosen in /config
      return null
    }
    const answer = await $.ui.ask(LANGUAGE_QUESTION, { options: [...LANGUAGE_CHOICES], header: LANGUAGE_HEADER }).catch(() => null)
    await $.store.set(LANGUAGE_ASKED, true) // before the setting, which reloads the plugin
    if (languageOfAnswer(answer) !== 'th') return null
    $.clock.after(0, () => void chooseThai($).catch(logLanguageAsk($)))
    return 'th'
  })().finally(() => {
    languageAsk = null
  })
  return languageAsk
}

const logLanguageAsk = ($: EngineInterface) => (error: unknown) =>
  $.ui.log(`Agent HQ: could not ask for the language (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' })

const LANGUAGE_WORD = /^(thai|th|ไทย|ภาษาไทย|english|en)$/i

/** `/hq lang [thai|english]`: says the language in force, or sets it and answers in the new one. */
async function langCommand($: EngineInterface, word: string): Promise<{ text: string }> {
  if (word === '') return { text: t(lang, 'lang.current') }
  if (!LANGUAGE_WORD.test(word)) return { text: t(lang, 'lang.unknown') }
  const next = languageOfAnswer(word)
  const denied = await setLanguage($, next)
  return { text: denied === null ? t(next, 'lang.changed') : t(lang, 'lang.failed', { reason: denied }) }
}

export const register: Register = (on, options) => {
  isMuted = !soundsOn(options.sounds)
  nameTheme = themeOf(options.nicknameTheme)
  lang = langOf(options.language)
  on('session.start', async ($, e, next) => {
    configureLock((ms, fn) => $.clock.after(ms, fn)) // times the roster lock (hooks/lock.ts)
    await $.command.register({
      name: 'hq',
      description: t(lang, 'hq.description'),
      argumentHint: '[open|close|web [next on|off]|report|trust|lang]',
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
    await loadTeam($).catch(error => $.ui.toast(t(lang, 'team.couldNotLoad', { reason: error instanceof Error ? error.message : t(lang, 'trust.error') })))
    for (const spec of TOOL_SPECS) await $.tool.register(spec).catch(error => $.ui.log(`Agent HQ: could not offer ${spec.name} (${error instanceof Error ? error.message : 'error'})`, { to: 'debug' }))
    // a hot reload ends the module and the page server with it: bring the page back (same hub port and secret, so an open tab reconnects)
    if (await read($, isWebWanted)) void startWeb($).catch(error => $.ui.log(`Agent HQ: could not restart the live page (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))
    // not awaited: the first start is awaited before the first prompt, and a dialog must not hold it. Only the REPL has
    // someone to ask at the start; the desktop app, the SDK and -p start with nobody (a client joining later asks)
    if (e.isInteractive) void askLanguageOnce($).catch(logLanguageAsk($))

    return next(e)
  })

  on('command.run', { command: 'hq' }, async ($, e) => {
    const [verb, ...words] = e.args.trim().split(/\s+/)
    if (verb?.toLowerCase() === 'lang') return langCommand($, words.join(' '))
    const setting = verb?.toLowerCase() === 'web' ? WEB_SETTINGS[words[0]?.toLowerCase() ?? ''] : undefined
    if (setting === PAGE_APPROVALS && !(await areApprovalsReleased($))) return { text: t(lang, 'web.approvalsComing') }
    if (setting) {
      const word = (words[1] ?? '').toLowerCase()
      if (setting === PAGE_APPROVALS && word === 'on' && !PERSON_ORIGINS.has(e.origin.kind)) return approvalsOnFrom($, e.origin)
      const answer = await settingCommand($, setting, word)
      if (setting === NEXT_TASKS && word === 'off') await clearSuggestions($)
      return answer
    }
    if (e.args.trim().toLowerCase() === 'report') return runReport($)
    if (e.args.trim().toLowerCase() === 'trust') return trustCommand($, e.origin)
    if (e.args.trim().toLowerCase() === 'web') {
      await loadTeam($).catch(() => null)
      await syncAgents($)
      try {
        const isFirstRun = web === null
        const startUrl = await startWeb($)
        await update($, isWebWanted, () => true)
        // every run asks the hub for a fresh link (a link works once) and how many pages are open: one page shows every
        // session, so while one is open another tab would only cost memory
        if (!web) throw new Error('the local server stopped')
        const { url, pages } = await freshLogin($, web.statePath).catch(error => {
          if (isFirstRun) return { url: startUrl, pages: 0 } // the link the new server printed is unused yet
          throw error
        })
        // with page approvals on, a login link must not reach the model: a reply lands in the transcript, and an agent with
        // a browser could log in and allow its own ask. The link then shows in a notice only (toasts never reach it)
        const isGuarded = await isSettingOn($, PAGE_APPROVALS)
        const tabs = pages === 1 ? t(lang, 'web.oneTab') : t(lang, 'web.tabs', { n: pages })
        if (pages > 0) return linkReply($, isGuarded, 'web.alreadyOpen', { tabs, url })
        return linkReply($, isGuarded, (await openInBrowser($, url)) ? 'web.opened' : 'web.running', { url })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return { text: t(lang, 'web.failed', { reason }) }
      }
    }
    const arg = e.args.trim().toLowerCase()
    const canAsk = PERSON_ORIGINS.has(e.origin.kind) || ASKING_ORIGINS.has(e.origin.kind)
    // the language first, where no client was asked yet (its join was missed) and someone can answer: before the trust
    // dialog. Thai reloads the plugin, so this run ends here and the setting follows once it returned
    if (arg === '' && canAsk && (await $.session.surfaces().catch(() => [])).length > 0) {
      if ((await askLanguageOnce($).catch(logLanguageAsk($))) === 'th') return { text: t('th', 'lang.changedReopen') }
    }
    const trusted = (arg === '' || arg === 'open') && canAsk ? await askTrust($, false) : null
    if (trusted) {
      await update($, isBandHidden, () => false)
      await openSidebar($)
      return trusted
    }
    // `/hq` alone toggles; `close` and `open` say which
    if (arg === 'close' || (arg === '' && (await isSidebarOpen($)))) return closeSidebar($)
    await update($, isBandHidden, () => false)
    const loaded = await loadTeam($)
    await openSidebar($)
    await syncAgents($)
    const source = await read($, teamSource)
    if (source?.error) return { text: t(lang, 'hq.openedIgnored', { path: source.path, error: source.error }) }

    return { text: loaded ? t(lang, 'hq.openedTeam', { name: loaded.name }) : t(lang, 'hq.openedNoTeam') }
  })

  // the main session plays the team's lead: its role, rules and roster ride in the system prompt while a team exists; the
  // person's language rides there too, team or not
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const current = await read($, team)
    if (e.traits.includes('teammate') || e.traits.includes('bare')) return composed
    const language = languageSection(lang)
    const spoken = language ? [{ id: 'agent-hq:language', text: language, scope: 'session' as const }] : []
    if (!current) {
      // no file at all: offer to make one; a file that is untrusted or ignored has its own toast pointing at the fix
      if ((await read($, teamSource)) !== null) return spoken.length > 0 ? { sections: [...composed.sections, ...spoken] } : composed
      return { sections: [...composed.sections, { id: 'agent-hq:no-team', text: NO_TEAM_PROMPT, scope: 'session' as const }, ...spoken] }
    }

    return { sections: [...composed.sections, { id: 'agent-hq:team', text: `${leadPrompt(current)}\n\n${LEAD_TOOLS_NOTE}`, scope: 'session' as const }, ...spoken] }
  })

  // a client that joins later (the desktop app, whose session started with nobody to ask) is asked the language then
  on('session.attach', async ($, e, next) => {
    const joined = await next(e)
    void askLanguageOnce($).catch(logLanguageAsk($)) // beside the join, never in its way
    return joined
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
      // what it was given to do, from whoever started it: an hq_assign task's first line, else the Agent call's
      // description; never the prompt, nor the person's own words (a start from the live page)
      const started = (spawned as { agentId?: string }).agentId
      if (started && !e.resume && !(e.name !== undefined && personStarts.has(e.name))) await talk($, e.parentAgentId ?? MAIN, started, (e.name ? (await read($, assignments))[e.name]?.task : undefined) ?? e.description)
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
    // anyone's, lead or member: a coordination tool the guard never refuses
    if (String(e.tool) === DOING_TOOL) return answerDoing($, e).catch(error => ({ result: `hq_doing failed (${error instanceof Error ? error.message : String(error)})`, isError: true as const }))

    const blocked = await blockedByGuard($, e)
    if (blocked) return { deny: blocked }

    const loop = e.agentId ?? MAIN
    const at = await $.clock.now()
    await update($, agents, rows => countTool(rows, loop, String(e.tool), at))
    await recordEvents($, [{ agent: loop, kind: 'tool', text: t(lang, 'feed.used', { tool: String(e.tool) }) }])
    // what it does right now: the sidebar and band redraw on the write; the page gets it without waiting for the poll
    const callId = e.tool_use_id || `${loop}:${at}`
    const doing = { text: describeCall(String(e.tool), e as unknown as Record<string, unknown>, lang), since: at, callId }
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
      const ended = await $.clock.now().catch(() => at)
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
        await recordEvents($, stepEvents(loop, before, e.todos, lang))
        await pruneSaid($) // a new step in progress retires the sentence said for the last one
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
        if (e.status === 'completed') {
          const what = (await read($, tasks))[e.taskId]?.subject ?? t(lang, 'feed.task', { id: e.taskId })
          await recordEvents($, [{ agent: loop, kind: 'step', text: t(lang, 'feed.done', { what }) }])
        }
      } else if ((e.tool === 'Write' || e.tool === 'Edit') && isTeamFile((e as { file_path?: unknown }).file_path)) {
        // the team skill (or the person) just wrote the team file: load it now, so its roles can be used this turn.
        // Only the main session's own write of the file in force is trusted; anything else waits for the person's /hq trust.
        const expected = await expectedOwnTeamText($, e as TeamWrite, teamBefore)
        const loaded = await loadTeam($, expected === null ? {} : { approve: true, expect: expected })
        const trusted = expected !== null && (await read($, teamSource))?.needsApproval !== true
        if (loaded && trusted) $.ui.toast(t(lang, 'team.loaded', { name: loaded.name, n: loaded.roles.length }))
      }
      await syncStatus($)
      await requestLive($)
    })().catch(error => $.ui.log(`Agent HQ: could not note a ${String(e.tool)} call (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))

    return ran
  }).catch(($, e, next) =>
    // the hook failed (threw or overran): the call it already let through stands; one not yet decided runs only for the
    // lead, who is never guarded. A member's is refused, so the rule guard never fails open
    next.called ? next(e) : e.agentId ? { deny: GUARD_FAILED } : next(e),
  )

  // what each agent used: the engine reports tokens and time at the end of every turn (no price, so no cost)
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // the lead answered: next-task suggestions are drafted beside the turn's end, never in its way
    if (e.agentId === undefined && e.reason === 'answer') {
      suggestFor = e.turnId
      void suggestNext($)
    }
    const loop = e.agentId ?? MAIN
    await update($, usage, all => ({ ...all, [loop]: addTurn(all[loop], e) }))
      .then(() => requestLive($))
      .catch(error => $.ui.log(`Agent HQ: could not note a turn (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))
    // the loop's turn is over (the lead's or a member's), and so is what it said it was doing
    if ((await read($, says))[loop]) {
      await update($, says, ({ [loop]: _said, ...rest }) => rest)
        .then(() => requestLive($))
        .catch(() => {}) // the next turn's sentence replaces it anyway
    }
    // a member's run ended: what reached whoever started it (the engine's delivered copy: a hand-back's report, made safe,
    // else its last answer) shows on its card. A teammate's turn text reaches nobody: it reports with SendMessage
    if (e.agentId !== undefined && e.reason === 'answer') {
      const member = e.agentId
      await (async () => {
        if ((await $.agent.list()).some(a => a.id === member && a.teammateId !== undefined)) return
        await talk($, member, (await read($, agents))[member]?.parentId ?? MAIN, e.answer)
      })().catch(error => $.ui.log(`Agent HQ: could not note an answer (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))
    }
    // the loop's turn is over, so none of its calls waits on a dialog now: also an ask whose tool.call never reached
    // this mod (an Agent call made through $.agent.spawn), which would otherwise wait in the inbox forever
    if (Object.values(await read($, asks)).some(ask => ask.agent === loop)) {
      await update($, asks, all => dropAsksOf(all, loop))
        .then(() => syncStatus($))
        .then(() => requestLive($))
        .catch(() => {}) // the status and the page catch up on the next poll
    }
    return done
  })

  // the lead's next turn starts: the suggestions drafted after its last one are spent
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    if (e.agentId === undefined) await clearSuggestions($).catch(error => $.ui.log(`Agent HQ: could not clear the suggestions (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))
    return started
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
    return askOnPage($, e, verdict)
  }).catch(($, e, next) => next(e)) // the hook failed: the engine's own verdict stands (next replays it)

  // the permission mode each loop runs in, for page approvals: these classic events carry it, a mod's PreToolUse does not
  on('classic.UserPromptSubmit', async ($, e, next) => {
    noteMode(e)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PostToolUse', async ($, e, next) => {
    noteMode(e)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PostToolUseFailure', async ($, e, next) => {
    noteMode(e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // a message between the lead and a member, or between members, shows over the member's card (hooks/talk.ts); the
  // person's own message from the live page is theirs, not the team's talk
  on('session.send', async ($, e, next) => {
    const sent = await next(e)
    if (!sent.isDelivered || (e.origin.kind === 'plugin' && e.text.startsWith(PERSON_FRAME))) return sent
    await (async () => {
      const to = recipientOf(e.to, await read($, agents))
      if (to) await talk($, e.agentId ?? MAIN, to, e.text)
    })().catch(error => $.ui.log(`Agent HQ: could not note a message (${error instanceof Error ? error.message : String(error)})`, { to: 'debug' }))
    return sent
  }).catch(($, e, next) => next(e)) // the bubble is a nicety: whatever failed, the message still goes (or its first send stands)

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
        return r ? withAside(els, r, <Raster key={r.key} columns={r.columns} rows={r.rows} cells={r.cells} />) : null
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
      onBuildTeam: () => void $.command.run({ command: 'agent-hq:team' }).catch(() => $.ui.toast(t(lang, 'team.buildHint'))),
      onToggleExpand: () => void update($, isTreeExpanded, v => !v),
    }
    if (e.surface !== 'terminal') {
      const els = $.ui.resolve(e)
      return SidebarView(els, { ...data, isAppDrawn: true }, actions, textTrack(els, sidebarRasters(data, data.now), data))
    }
    const els = $.ui.resolve(e)
    const { Raster } = els
    const drawn = sidebarRasters(data, data.now)
    seat($, 'sidebar', { requestId: e.requestId, data, draw: t => sidebarRasters(data, t) })
    const draw = (key: string) => {
      const r = drawn.find(x => x.key === key)
      return r ? withAside(els, r, <Raster key={r.key} columns={r.columns} rows={r.rows} cells={r.cells} />) : null
    }
    return SidebarView(els, data, actions, draw)
  })
}
