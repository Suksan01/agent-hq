// Secrets in todo and task text never reach a surface: what an agent or the lead wrote in a step, a todo or a board task
// is masked where the surfaces read it, so the sidebar (terminal and desktop), the band, the live page's snapshot and
// the session report all show `***` in its place.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { TEAM_FILE } from '../hooks/team'
import { DOING_TOOL } from '../hooks/model'

type Call = (input: Record<string, unknown>) => Promise<{ result?: unknown; isError?: boolean; deny?: string }>
type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const TEAM = { name: 'Web', purpose: 'Ship it', lead: { title: 'Tech Lead', rules: [], skills: [] }, roles: [{ id: 'dev', title: 'Developer', count: 2, mission: 'Build.' }] }
const LISTED: AgentInfo[] = [{ id: 'd1', name: 'dev-1', type: 'agent-hq:dev', description: 'x', status: 'running' }]
const STATE = '/home/me/.claude/agent-hq/live/sess.json'
const SECRETS = /abc12345|glpat-xYz|hunter2now/
const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

/** A member at work whose step, next todo, last done todo and board tasks each hold a secret; the live page running. */
async function session($: Engine, on: On): Promise<{ clock: MockClock; snaps: unknown[]; files: Map<string, string> }> {
  const clock = mock.clock(on, { now: 1_000 })
  const snaps: unknown[] = []
  const files = new Map<string, string>()
  mock.store(on, { approvedTeams: withApproval([], `/work/app/${TEAM_FILE}`, JSON.stringify(TEAM)), languageAsked: true })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', (_, e) => ({ value: e.path === `/work/app/${TEAM_FILE}` }))
  on('fs.read', () => ({ value: JSON.stringify(TEAM) }))
  on('fs.write', (_, e) => {
    if (e.path === STATE) snaps.push(JSON.parse(e.text))
    else files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'AGENT_HQ_URL http://127.0.0.1:4321\n' }
    await new Promise(() => {})
    return { value: { code: 0, signal: null } }
  })
  for (const event of ['ui.status', 'ui.open', 'ui.log', 'ui.toast', 'command.register'] as const) on(event, () => ({ value: undefined }) as never)
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('agent.list', () => ({ value: LISTED }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'd1' }))
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as RenderElement)
  let taskId = 0
  on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: String(++taskId), subject: 'x' } } } : { result: {} as never }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'go', subagentType: 'agent-hq:dev' } as never)
  await $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} } as never)

  const call = $.tool.call as unknown as Call
  await call({
    tool: 'TodoWrite',
    agentId: 'd1',
    todos: [
      { content: 'Read the config with --password hunter2now', status: 'completed', activeForm: 'Reading the config' },
      { content: 'Deploy with token=abc12345', status: 'in_progress', activeForm: 'Deploying with token=abc12345' },
      { content: 'Rotate glpat-xYz12AbCdEfGhIjKlMn', status: 'pending', activeForm: 'Rotating the key' },
    ],
  })
  await call({ tool: DOING_TOOL, agentId: 'd1', text: 'Shipping the release' }) // its sentence on line 2: the step shows on line 3
  await call({ tool: 'TaskCreate', subject: 'Ship with token=abc12345', description: 'x', activeForm: 'Shipping with token=abc12345' })
  await call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', owner: 'dev-1', activeForm: 'Shipping with token=abc12345' })
  await call({ tool: 'TaskCreate', subject: 'Clean up glpat-xYz12AbCdEfGhIjKlMn', description: 'x' })
  return { clock, snaps, files }
}

/** Every character a drawn tree shows: its props as text, and each Raster's cells decoded. */
function shown(node: unknown): string {
  if (typeof node === 'string') return node
  const el = node as Drawn
  const cells =
    el.type === 'Raster'
      ? (() => {
          const words = new Uint32Array(Uint8Array.from(atob(String(el.props?.cells)), c => c.charCodeAt(0)).buffer)
          return Array.from({ length: words.length / 3 }, (_, i) => String.fromCodePoint(words[i * 3] ?? 32)).join('')
        })()
      : ''
  const { children: _children, cells: _cells, ...props } = el.props ?? {}
  return [JSON.stringify(props), cells, ...(el.children ?? []).map(shown)].join('\n')
}

test('a secret in a step, a todo or a board task shows masked on the sidebar, the band, the snapshot and the report', async ($, on) => {
  const { clock, snaps, files } = await session($, on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
    const lines = (await pane.findAll({ type: 'Text' })).map(t => t.text ?? '')
    expect(lines.some(l => l.endsWith('▸ Shipping the release')), surface).toBe(true) // its sentence still matches its masked step
    expect(lines.some(l => l.endsWith('task: Deploying with token=***')), surface).toBe(true) // line 3, the step
    expect(lines.some(l => l.endsWith('○ next: Rotate ***')), surface).toBe(true)
    expect(lines.some(l => l.includes('Shipping with token=***')), surface).toBe(true) // the task board
    expect(lines.some(l => l.endsWith('Clean up ***')), surface).toBe(true)
    expect(shown(await pane.drawn()), surface).not.toMatch(SECRETS)
    await pane.unmount()

    const band = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'AbovePrompt', props: BAND_PROPS as never, viewport: { columns: 100, rows: 40, isFullscreen: true } as never })
    const drawn = shown(await band.drawn())
    expect(drawn, surface).not.toMatch(SECRETS)
    if (surface === 'terminal') expect(drawn).toContain('Shipping with token=***') // the tasks track's pill
    await band.unmount()
  }

  await clock.advance(60) // past the page's write cooldown
  const snapshot = snaps.at(-1) as { agents: { id: string; now: string; next: string | null; last: string | null }[]; tasks: { subject: string }[] }
  const d1 = snapshot.agents.find(a => a.id === 'd1')
  expect(d1?.now).toMatch(/^▸ Deploying with token=\*\*\*( · |$)/)
  expect([d1?.next, d1?.last]).toEqual(['Rotate ***', 'Read the config with --password ***'])
  expect(snapshot.tasks.map(t => t.subject)).toEqual(['Ship with token=***', 'Clean up ***'])
  expect(JSON.stringify(snapshot)).not.toMatch(SECRETS)

  // the lead's own hq_status reads the work as the lead and its members wrote it: it is the lead's, not the person's
  const status = await ($.tool.call as unknown as Call)({ tool: 'mcp__agent-hq__hq_status' })
  expect(String(status.result)).toContain('Deploying with token=abc12345')

  await $.command.run({ command: 'hq', args: 'report', origin: { kind: 'composer' }, presentation: {} } as never)
  const report = [...files].find(([path]) => path.endsWith('.md'))?.[1] ?? ''
  expect(report).toContain('token=***')
  expect(report).not.toMatch(SECRETS)
})
