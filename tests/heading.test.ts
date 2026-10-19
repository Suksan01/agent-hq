// The team's name and project folder in the sidebar's section header and on the band's first line, so two sessions
// are never mixed up: "BOOKING APP TEAM · app", the folder giving way first when the room is short.
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { cellText } from '../hooks/cells'
import { TEAM_FILE, parseTeam } from '../hooks/team'
import { MAIN, mergeAgents } from '../hooks/model'
import { folderOf, teamHeading, teamTrackLabel } from '../hooks/view'

const RAW_TEAM = {
  name: 'Booking App Team',
  purpose: 'Build the booking web app',
  lead: { title: 'Tech Lead', rules: [], skills: [] },
  roles: [{ id: 'senior-dev', title: 'Senior Developer', count: 2, mission: 'Build.', tasks: [], rules: [], skills: [] }],
}
const parsed = parseTeam(JSON.stringify(RAW_TEAM))
if (typeof parsed === 'string') throw new Error(parsed)
const TEAM = parsed
const width = (s: string) => [...cellText(s)].length

test('the folder is the last part of the path, whatever the slashes at the end', () => {
  expect(folderOf('/work/app')).toBe('app')
  expect(folderOf('/work/app/')).toBe('app')
  expect(folderOf('/Users/me/My Project')).toBe('My Project')
  expect(folderOf('/')).toBe('')
  expect(folderOf('')).toBe('')
})

test('the heading is the team name in capitals, a dot and the folder; no team is TEAM', () => {
  expect(teamHeading(TEAM, 'storefront', 60)).toBe('BOOKING APP TEAM · storefront')
  expect(teamHeading(null, 'storefront', 60)).toBe('TEAM · storefront')
  expect(teamHeading(TEAM, undefined, 60)).toBe('BOOKING APP TEAM')
  expect(teamHeading(null, '', 60)).toBe('TEAM')
})

test('in a narrow header the folder gives way first, then the name; the heading never outgrows its room', () => {
  const tight = teamHeading(TEAM, 'storefront', 24)
  expect(tight).toMatch(/^BOOKING APP TEAM · st.*…$/)
  expect(width(tight)).toBeLessThanOrEqual(24)

  expect(teamHeading(TEAM, 'storefront', 18)).toBe('BOOKING APP TEAM') // too little room for even a short folder
  const cut = teamHeading(TEAM, 'storefront', 10)
  expect(cut).toMatch(/^BOOKING.*…$/)
  expect(width(cut)).toBeLessThanOrEqual(10)
  for (let room = 4; room < 40; room++) expect(width(teamHeading(TEAM, 'storefront', room)), `room ${room}`).toBeLessThanOrEqual(room)
})

const agent: AgentInfo = { id: 'm1', name: 'senior-dev-1', type: 'agent-hq:senior-dev', description: 'Add search', status: 'running' }
const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }

/** A session in /work/app, with the Booking App team approved and loaded, or with no team file at all. */
async function session($: Engine, on: On, hasTeam: boolean) {
  mock.clock(on)
  if (hasTeam) mock.store(on, { approvedTeams: withApproval([], `/work/app/${TEAM_FILE}`, JSON.stringify(RAW_TEAM)) })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('fs.exists', (_, e) => ({ value: hasTeam && e.path === `/work/app/${TEAM_FILE}` }))
  on('fs.read', () => ({ value: hasTeam ? JSON.stringify(RAW_TEAM) : '' }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('agent.list', () => ({ value: [agent] }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'm1' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  // stands for the engine's own band: an empty Box
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as RenderElement)
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'go', subagentType: 'agent-hq:senior-dev' } as never)
}

test('the sidebar header names the team and the project folder, on both surfaces', async ($, on) => {
  await session($, on, true)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
    expect(await ui.find({ text: /BOOKING APP TEAM · app/ }), surface).toBeDefined()
    await ui.unmount()
  }
})

test('with no team the sidebar header still names the folder', async ($, on) => {
  await session($, on, false)
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  expect(await ui.find({ text: /TEAM · app/ })).toBeDefined()
  expect(await ui.find({ text: /BOOKING/ })).toBeUndefined()
  await ui.unmount()
})

test('a narrow sidebar trims the folder and keeps the team name', async ($, on) => {
  await session($, on, true)
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: { ...PANE_PROPS, bodyColumns: 34 } as never })
  expect(await ui.find({ text: /BOOKING APP TEAM/ })).toBeDefined()
  expect(await ui.find({ text: /BOOKING APP TEAM · app/ })).toBeUndefined() // no room for the folder beside "1 agent"
  await ui.unmount()
})

test('the band above the prompt starts with the team name and folder', async ($, on) => {
  await session($, on, true)
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never, viewport: { columns: 100, rows: 40, isFullscreen: true } as never })
  expect(await ui.find({ text: /BOOKING APP TEAM · app/ })).toBeDefined()
  await ui.unmount()
})

test('the band calls only working agents running, never idle or waiting teammates', () => {
  const member = (id: string, status: AgentInfo['status']): AgentInfo => ({ id, name: id, type: 'general-purpose', description: 'x', status })
  const team = (...listed: AgentInfo[]) => Object.values(mergeAgents({}, listed, 0)).filter(a => a.id !== MAIN)

  expect(teamTrackLabel(team(member('a1', 'idle'), member('a2', 'waiting')), { done: 0, active: 0, total: 2 })).toBe('Team')
  expect(teamTrackLabel(team(member('a1', 'idle'), member('a2', 'running')), { done: 0, active: 1, total: 2 })).toBe('1 running')
  expect(teamTrackLabel(team(member('a1', 'completed')), { done: 1, active: 0, total: 1 })).toBe('Done')
})
