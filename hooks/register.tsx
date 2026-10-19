import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { MAIN, barIdsIn, clearFinished, countTool, createTask, isFinished, mergeAgents, mergeTodos, overallProgress, planSteps, updateTask } from './model'
import type { HqTodo } from '../types'
import { BandView, SidebarView, bandRasters, bandTrackWidth, hasBand, sidebarRasters, textTrack } from './view'
import type { BandActions, HqActions, HqData, Raster } from './view'

const PANE = 'agent-hq'
const TITLE = 'Agent HQ'
const SIDEBAR_COLUMNS = 46 // the dock's width beside a fullscreen transcript
const POLL_MS = 1000
const FRAME_MS = 125 // the twinkle's frame rate; plan-progress runs 30 fps, 8 is plenty here
const REFUSED_MAX = 6 // blits refused in a row (site closed or redrawn at another size) drop that site

const agents = atom({ plugin: 'agent-hq', key: 'agents' } as const, {})
const todos = atom({ plugin: 'agent-hq', key: 'todos' } as const, {})
const tasks = atom({ plugin: 'agent-hq', key: 'tasks' } as const, {})
const now = atom({ plugin: 'agent-hq', key: 'now' } as const, 0)
const hideFinished = atom({ plugin: 'agent-hq', key: 'hideFinished' } as const, false)
const wasAutoOpened = atom({ plugin: 'agent-hq', key: 'wasAutoOpened' } as const, false)
const isBandHidden = atom({ plugin: 'agent-hq', key: 'isBandHidden' } as const, false)
const barOwners = atom({ plugin: 'agent-hq', key: 'barOwners' } as const, {})

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
type Site = { requestId: string; data: HqData; draw: (t: number) => Raster[]; refused: number }
const sites = new Map<'band' | 'sidebar', Site>()
let frames: { cancel: () => void } | null = null

const hasLiveAgents = (data: HqData) => Object.values(data.agents).some(a => a.id !== MAIN && !isFinished(a.status))

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
        site.draw(t).map(r => $.ui.blit({ requestId: site.requestId, key: r.key, cells: r.cells, columns: r.columns, rows: 1 }).catch(() => ({ deny: 'failed' }))),
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
  const after = mergeAgents(before, listed, t)
  if (JSON.stringify(after) !== JSON.stringify(before)) await update($, agents, () => after)
  // ticks the clock only while someone works, so elapsed times move and an idle view stays still
  if (Object.values(after).some(a => a.id !== MAIN && !isFinished(a.status))) await update($, now, () => t)
  await syncStatus($)
}

async function syncStatus($: EngineInterface) {
  const rows = Object.values(await read($, agents)).filter(a => a.id !== MAIN)
  const p = overallProgress(await read($, tasks), await readTeamTodos($))
  if (rows.length === 0 && p.total === 0) return $.ui.status(undefined)
  const running = rows.filter(a => !isFinished(a.status)).length
  $.ui.status(`◆ HQ ● ${running} running${p.total ? ` · ${p.done}/${p.total} tasks` : ''}`)
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
  }
}

const openSidebar = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE, columns: SIDEBAR_COLUMNS })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hq', description: 'Open the Agent HQ sidebar: agent tree, what each works on next, task board' })
    // shortcut: a light theme name picks the light tint; "auto" is read as dark (plan-progress also probes macOS appearance).
    const theme = (await $.config.list().catch(() => [])).find(row => row.key === 'theme')
    isLight = /light/i.test(String(theme?.value ?? 'dark'))
    // shortcut: polls $.agent.list() every second, since status changes raise no event; fine for a handful of agents.
    $.clock.every(POLL_MS, () => {
      syncAgents($).catch(() => {}) // a failed poll (e.g. during shutdown) is retried next tick
    })

    return next(e)
  })

  on('command.run', { command: 'hq' }, async $ => {
    await update($, isBandHidden, () => false)
    await openSidebar($)
    await syncAgents($)

    return { text: 'Agent HQ sidebar opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await syncAgents($)
    await update($, isBandHidden, () => false)
    if (!(await read($, wasAutoOpened))) {
      await update($, wasAutoOpened, () => true)
      openSidebar($).catch(() => {}) // unasked opening is best-effort: no surface (e.g. -p) just means no sidebar
    }

    return spawned
  })

  on('tool.call', async ($, e, next) => {
    const loop = e.agentId ?? MAIN
    const t = await $.clock.now()
    await update($, agents, rows => countTool(rows, loop, String(e.tool), t))

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    if (e.tool === 'TodoWrite') {
      await update($, todos, all => ({ ...all, [loop]: e.todos.map(todo => ({ ...todo })) }))
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
    }
    await syncStatus($)

    return ran
  })

  // which agent moves which plan-progress bar: its response row names the bar; every plugin sees every row,
  // whatever order the plugins stand in (plan-progress answers its tool itself, so tool.call may never reach us)
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door !== 'response') return stored
    const ids = barIdsIn(e.message.content)
    if (ids.length > 0) {
      const owner = e.agentId ?? MAIN
      const at = await $.clock.now()
      await update($, barOwners, all => ({ ...all, ...Object.fromEntries(ids.map(id => [id, { owner, at }])) }))
    }

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
        return r ? <Raster key={r.key} columns={r.columns} rows={1} cells={r.cells} /> : null
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
      onClear: async () => {
        const cleared = clearFinished(await read($, agents), await read($, tasks), await read($, todos))
        await update($, agents, () => cleared.agents)
        await update($, tasks, () => cleared.tasks)
        await update($, todos, () => cleared.todos)
        await syncStatus($)
      },
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
      return r ? <Raster key={r.key} columns={r.columns} rows={1} cells={r.cells} /> : null
    }
    return SidebarView(els, data, actions, draw)
  })
}
