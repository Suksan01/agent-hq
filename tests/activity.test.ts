import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { commandWords, describeCall, endActivity, hasRunningCall, liveActivities, startActivity } from '../hooks/activity'
import { buildSnapshot } from '../hooks/live'
import { MAIN, PLAN_TOOL, mergeAgents } from '../hooks/model'
import { SMALL_W } from '../hooks/sprites'
import { bandActivity } from '../hooks/view'
import type { HqData } from '../hooks/view'

const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

const agent = (id: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, name: id, type: 'general-purpose', description: `do ${id}`, status })
type Call = (input: Record<string, unknown>) => Promise<unknown>

test('each tool reads as a short line; files by their base name only', () => {
  expect(describeCall('Edit', { file_path: '/Users/me/app/hooks/view.tsx' })).toBe('Editing view.tsx')
  expect(describeCall('Write', { file_path: 'src/x.ts' })).toBe('Writing x.ts')
  expect(describeCall('Read', { file_path: '/home/me/secret-project/notes/y.md' })).toBe('Reading y.md')
  expect(describeCall('NotebookEdit', { notebook_path: '/a/b/nb.ipynb' })).toBe('Editing nb.ipynb')
  expect(describeCall('Grep', { pattern: 'function\\s+describeCallWithAVeryLongName' })).toBe('Searching for function\\s+describeCall…')
  expect(describeCall('Glob', { pattern: '**/*.ts' })).toBe('Searching for **/*.ts')
  expect(describeCall('Agent', { name: 'reviewer', description: 'Review it', subagent_type: 'x' })).toBe('Starting reviewer')
  expect(describeCall('WebFetch', { url: 'https://docs.example.com/a/b?token=abc' })).toBe('Reading docs.example.com')
  expect(describeCall('WebFetch', { url: 'not a url' })).toBe('Reading a web page')
  expect(describeCall('TodoWrite', { todos: [] })).toBe('Planning')
  expect(describeCall(PLAN_TOOL, {})).toBe('Planning')
  expect(describeCall('SendMessage', { to: 'team-lead', message: 'hi' })).toBe('Messaging team-lead')
  expect(describeCall('mcp__github__create_issue', {})).toBe('Using github create_issue')
  expect(describeCall('WebSearch', { query: 'x' })).toBe('Using WebSearch')
  expect(describeCall('Edit', {})).toBe('Editing a file') // input read untrusted
  for (const tool of ['Edit', 'Write', 'Read']) expect(describeCall(tool, { file_path: '/very/deep/path/file.ts' })).not.toContain('/')
})

test('a command shows its name, and a subcommand only for a tool that has them: never flags, values, URLs or assignments', () => {
  expect(commandWords('echo ghp_abcdef123456')).toBe('echo')
  expect(commandWords('printf sk-live-123 | tee x')).toBe('printf')
  expect(commandWords('curl secrettoken https://x.dev')).toBe('curl')
  expect(commandWords('git push origin main')).toBe('git push')
  expect(commandWords('npm test')).toBe('npm test')
  expect(commandWords('docker compose up')).toBe('docker compose')
  expect(describeCall('Bash', { command: 'npm test -- --watch' })).toBe('Running npm test')
  expect(describeCall('Bash', { command: 'git commit -m "my secret message"' })).toBe('Running git commit')
  expect(describeCall('Bash', { command: 'API_KEY=sk-123 curl -H "Authorization: Bearer xyz" https://api.x.dev' })).toBe('Running curl')
  expect(describeCall('Bash', { command: 'mysql -psecret prod' })).toBe('Running mysql')
  expect(describeCall('Bash', { command: 'curl https://user:pass@host/x' })).toBe('Running curl')
  expect(describeCall('Bash', { command: '/usr/local/bin/node script.mjs' })).toBe('Running node')
  expect(describeCall('Bash', { command: 'TOKEN=abc/def' })).toBe('Running a command')
  expect(describeCall('Bash', { command: 'averyveryverylongcommandname subcommandthatislong' })).toBe('Running averyveryverylongcomman…')
  expect(describeCall('Bash', {})).toBe('Running a command')
  for (const command of ['echo one two three four', 'a b c d e f', 'export SECRET=1 && run it']) {
    expect(commandWords(command).split(' ').length).toBeLessThanOrEqual(2)
  }
  expect(commandWords('export SECRET=1 && run it')).not.toContain('SECRET')
})

test('an activity starts, ends only for its own call, and is dropped once the agent finishes', () => {
  const started = startActivity({}, 'a1', { text: 'Reading x.md', since: 10, callId: 'u1' })
  expect(started.a1).toEqual({ text: 'Reading x.md', since: 10, callId: 'u1' })

  const later = startActivity(started, 'a1', { text: 'Running npm test', since: 20, callId: 'u2' })
  expect(endActivity(later, 'a1', 'u1', 30)).toBe(later) // an older call ending leaves the newer one live
  const ended = endActivity(later, 'a1', 'u2', 30)
  expect(ended.a1?.endedAt).toBe(30)
  expect(later.a1?.endedAt).toBeUndefined() // immutable

  const agents = mergeAgents({}, [agent('a1'), agent('a2', 'completed')], 0)
  const all = startActivity(ended, 'a2', { text: 'x', since: 1, callId: 'u3' })
  expect(Object.keys(liveActivities({ ...all, gone: { text: 'y', since: 1, callId: 'u4' } }, agents))).toEqual(['a1'])
})

type Mounted = { find: (query: { text?: RegExp; key?: string }) => Promise<{ text: string } | undefined> }
type Probe = (tool: string, ui: Mounted) => Promise<void>

/** Agents listed, and the engine's tool runner looking at the drawing while each call is still running (no poll ticks: the clock is mocked). */
async function seed($: Engine, on: On, listed: AgentInfo[]) {
  const box: { ui?: Mounted; probe?: Probe } = {}
  mock.clock(on)
  on('session.cwd', () => ({ value: '/work/app' })) // the rule guard reads it on every subagent call
  on('agent.list', () => ({ value: listed }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: listed[0]?.id ?? 'x' }))
  on('tool.call', async (_, e) => {
    if (box.ui && box.probe) await box.probe(String(e.tool), box.ui)
    return { result: {} as never }
  })
  await $.agent.spawn({ prompt: 'go', description: 'seed' } as never)
  return box
}

test('a tool call shows on the sidebar while it runs, with no poll in between, then the line moves on', async ($, on) => {
  const box = await seed($, on, [agent('a1'), agent('a2', 'idle')])
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  let during: { live?: string; idle?: string; lead?: string } = {}
  box.ui = ui
  box.probe = async tool => {
    if (tool !== 'Read') return
    during = {
      live: (await ui.find({ text: /Reading view\.tsx · \d+s$/ }))?.text,
      idle: (await ui.find({ key: 'agent-a2' }))?.text,
      lead: (await ui.find({ text: /1 of 2 working/ }))?.text,
    }
  }
  await ($.tool.call as unknown as Call)({ tool: 'Read', file_path: '/repo/hooks/view.tsx', agentId: 'a1', tool_use_id: 'u1' })

  expect(during.live).toMatch(/^[▸▹] Reading view\.tsx · 0s$/)
  expect(during.idle).not.toContain('Reading') // one-line rows keep their status, not the live line
  expect(during.lead).toBeDefined()
  expect(await ui.find({ text: /Reading view\.tsx · / })).toBeUndefined() // the call ended
  await ui.unmount()
})

test('the lead row shows its own call live, and a working agent its task under the live line', async ($, on) => {
  const box = await seed($, on, [agent('a1')])
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  const call = $.tool.call as unknown as Call
  let lead: string | undefined
  let task: string | undefined
  box.ui = ui
  box.probe = async tool => {
    if (tool === 'Bash') lead = (await ui.find({ text: /^[▸▹] Running npm test · \d+s$/ }))?.text
    if (tool === 'Grep') task = (await ui.find({ text: /^task: Wiring the band$/ }))?.text
  }
  await call({ tool: 'Bash', command: 'npm test -- --token=abc', tool_use_id: 'm1' })
  await call({ tool: 'TodoWrite', todos: [{ content: 'Wire the band', status: 'in_progress', activeForm: 'Wiring the band' }], agentId: 'a1' })
  await call({ tool: 'Grep', pattern: 'bandActivity', agentId: 'a1', tool_use_id: 'g1' })

  expect(lead).toMatch(/^[▸▹] Running npm test · 0s$/)
  expect(task).toBe('task: Wiring the band')
  await ui.unmount()
})

test('at a narrow width the live line keeps its seconds and cuts the words', async ($, on) => {
  const box = await seed($, on, [agent('a1')])
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: { ...PANE_PROPS, bodyColumns: 30 } as never })
  let line: string | undefined
  box.ui = ui
  box.probe = async () => {
    line = (await ui.find({ text: /^[▸▹] .* · 0s$/ }))?.text
  }
  await ($.tool.call as unknown as Call)({ tool: 'Edit', file_path: 'src/components/booking-calendar.tsx', agentId: 'a1', tool_use_id: 'e1' })

  expect(line).toBeDefined()
  expect(line).toContain('…')
  expect([...(line ?? '')].length).toBeLessThanOrEqual(30 - 3 - SMALL_W - 1) // the room beside the tree prefix and a member's sprite
  await ui.unmount()
})

test('the band names the most recently active working agents, newest first, three at most', () => {
  const agents = mergeAgents({}, ['a', 'b', 'c', 'd'].map(id => agent(id)).concat(agent('z', 'completed')), 0)
  const at = (text: string, since: number) => ({ text, since, callId: `${since}` })
  const data: HqData = {
    agents,
    todos: {},
    tasks: {},
    now: 0,
    hideFinished: false,
    columns: 100,
    isLight: false,
    team: null,
    activity: { a: at('Reading a.md', 1), b: at('Running npm test', 4), c: { ...at('Editing c.ts', 3), endedAt: 5 }, d: at('Planning', 2), z: at('Writing z.ts', 9) },
  }
  const nick = (id: string) => agents[id]?.nickname
  expect(bandActivity(data)).toBe(`${nick('b')}: Running npm test · ${nick('c')}: Editing c.ts · ${nick('d')}: Planning`)
  expect(buildSnapshot(data, 0).agents.find(a => a.id === 'b')?.activity).toEqual({ text: 'Running npm test', since: 4 })
  expect(buildSnapshot(data, 0).agents.find(a => a.id === 'c')?.activity).toBeNull() // its call ended
  expect(buildSnapshot(data, 0).agents.find(a => a.id === MAIN)?.activity).toBeNull()
})

test('the band shows the activity line while an agent works', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as RenderElement)
  const box = await seed($, on, [agent('a1')])
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never, viewport: { columns: 100, rows: 40, isFullscreen: true } as never })
  let line: string | undefined
  box.ui = ui
  box.probe = async () => {
    line = (await ui.find({ text: /^▸ [^▸]*: Running npm test$/ }))?.text
  }
  await ($.tool.call as unknown as Call)({ tool: 'Bash', command: 'npm test', agentId: 'a1', tool_use_id: 'b1' })

  expect(line).toMatch(/^▸ .+: Running npm test$/)
  await ui.unmount()
})

test('a long lead-only call ticks its seconds every second, and the clock stops once nothing runs', async ($, on) => {
  const clock = mock.clock(on)
  const seen: string[] = []
  let ui: Mounted | undefined
  on('session.start', (_, e) => e)
  on('session.cwd', () => ({ value: '/work/app' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.list', () => ({ value: [] }))
  on('tool.call', async (_, e) => {
    if (String(e.tool) !== 'Bash' || !ui) return { result: {} as never }
    for (let s = 0; s <= 3; s++) {
      seen.push((await ui.find({ text: /^[▸▹] Running npm test · \d+s$/ }))?.text ?? 'none')
      if (s < 3) {
        await clock.advance(1000)
        await clock.settle()
      }
    }
    return { result: {} as never }
  })
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  await ($.tool.call as unknown as Call)({ tool: 'Bash', command: 'npm test', tool_use_id: 'long' })

  expect(seen.map(line => line.replace(/^[▸▹] /, ''))).toEqual(['Running npm test · 0s', 'Running npm test · 1s', 'Running npm test · 2s', 'Running npm test · 3s'])
  expect(new Set(seen.map(line => line[0])).size).toBe(2) // the cursor blinks with the seconds
})

test('the clock ticks for a running call of any agent still at work, the lead included, and not otherwise', () => {
  const agents = mergeAgents({}, [agent('a1', 'idle'), agent('done', 'completed')], 0)
  const call = (callId: string) => ({ text: 'Running npm test', since: 0, callId })
  expect(hasRunningCall({}, agents)).toBe(false)
  expect(hasRunningCall({ [MAIN]: call('m') }, agents)).toBe(true)
  expect(hasRunningCall({ a1: call('i') }, agents)).toBe(true) // an idle agent inside a call (e.g. waiting on a permission)
  expect(hasRunningCall({ [MAIN]: { ...call('m'), endedAt: 5 } }, agents)).toBe(false)
  expect(hasRunningCall({ done: call('d'), gone: call('g') }, agents)).toBe(false)
})

/** A session with these agents listed and its 1 s poll running on the mocked clock; the sidebar mounted. */
async function polledSession($: Engine, on: On, listed: AgentInfo[]) {
  const clock = mock.clock(on)
  on('session.start', (_, e) => e)
  on('session.cwd', () => ({ value: '/work/app' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.list', () => ({ value: listed }))
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  const seconds = async (ms: number) => {
    await clock.advance(ms)
    await clock.settle()
  }
  return { ui, seconds }
}

// an agent's elapsed time reads the clock `now`: it moves only when the poll ticks it
test('an idle or waiting subagent alone does not tick the clock: nothing redraws while nobody works', async ($, on) => {
  const { ui, seconds } = await polledSession($, on, [agent('a1', 'idle'), agent('a2', 'waiting')])
  await seconds(1000) // the first poll lists them
  await seconds(3000)
  expect((await ui.find({ key: 'agent-a1' }))?.text).toMatch(/0s$/)
  expect((await ui.find({ key: 'agent-a2' }))?.text).toMatch(/0s$/)
  await ui.unmount()
})

test('a working subagent ticks the clock every second', async ($, on) => {
  const { ui, seconds } = await polledSession($, on, [agent('a1', 'running')])
  await seconds(1000)
  await seconds(3000)
  expect(await ui.find({ text: /^3s$/ })).toBeDefined()
  await ui.unmount()
})
