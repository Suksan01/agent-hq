import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { FINISHED_GRACE_MS, buildSnapshot } from '../hooks/live'
import { IDLE_LIMIT_MS } from '../hooks/inbox'
import { MAIN, createTask, mergeAgents, updateTask } from '../hooks/model'
import { parseTeam } from '../hooks/team'
import type { HqData } from '../hooks/view'

const TEAM = parseTeam(
  JSON.stringify({
    name: 'Booking App Team',
    purpose: 'Build the booking app',
    lead: { title: 'Tech Lead', rules: [], skills: [] },
    roles: [{ id: 'frontend-dev', title: 'Frontend Developer', count: 2, mission: 'Build pages.', tasks: [], rules: [], skills: [] }],
  }),
)

test('the live snapshot carries the tree, labels, mascots, progress and the board', () => {
  if (typeof TEAM === 'string') throw new Error(TEAM)
  const dev: AgentInfo = { id: 'd1', name: 'frontend-dev-1', type: 'agent-hq:frontend-dev', description: 'Search page', status: 'running' }
  const helper: AgentInfo = { id: 'h1', name: 'helper', type: 'Explore', description: 'Find files', status: 'completed', parentId: 'd1' }
  const tasks = updateTask(createTask({}, '1', 'Search page', 'Building search'), '1', { status: 'in_progress', owner: 'frontend-dev-1' })
  const data: HqData = {
    agents: mergeAgents({}, [dev, helper], 1000),
    todos: { d1: [{ content: 'Read', status: 'completed', activeForm: 'Reading' }, { content: 'Build', status: 'in_progress', activeForm: 'Building' }] },
    tasks,
    now: 5000,
    hideFinished: false,
    columns: 0,
    isLight: false,
    team: TEAM,
  }

  const snap = buildSnapshot(data, 5000)
  const byId = Object.fromEntries(snap.agents.map(a => [a.id, a]))

  expect(snap.team).toEqual({ name: 'Booking App Team', purpose: 'Build the booking app', lead: 'Tech Lead' })
  expect(byId[MAIN]?.name).toBe('Tech Lead')
  expect(byId[MAIN]?.parentId).toBeNull()
  expect(byId.d1?.role).toBe('Frontend Developer')
  expect(byId.d1?.parentId).toBe(MAIN)
  expect(byId.h1?.parentId).toBe('d1')
  expect(byId.d1?.now).toContain('Building')
  expect(byId.d1?.todos).toEqual({ done: 1, active: 1, total: 2 })
  expect(byId.h1?.tone).toBe('done')
  expect(byId.d1?.mascot.state).toBe('working')
  expect(byId.d1?.mascot.frames.length).toBeGreaterThan(2)
  expect(byId[MAIN]?.mascot).toMatchObject({ type: 'star', hat: 'crown' })
  expect(snap.tasks[0]).toEqual({ id: '1', subject: 'Search page', status: 'in_progress', owner: 'frontend-dev-1', blockedBy: [] })
  expect(JSON.parse(JSON.stringify(snap))).toEqual(snap) // plain JSON, nothing lost on the wire
})

test('the snapshot carries the acknowledged request id and the activity feed, empty by default', () => {
  const data: HqData = { agents: mergeAgents({}, [], 0), todos: {}, tasks: {}, now: 0, hideFinished: false, columns: 0, isLight: false, team: null }

  expect(buildSnapshot(data, 1)).toMatchObject({ lastAction: 0, events: [] })
  const events = [{ n: 4, at: 9, agent: 'a1', kind: 'tool' as const, text: 'used Bash' }]
  const snap = buildSnapshot(data, 1, null, { lastAction: 12, events })
  expect(snap.lastAction).toBe(12)
  expect(snap.events).toEqual(events)
  expect(snap.events).not.toBe(events)
})

const member = (id: string, status: AgentInfo['status'], parentId?: string): AgentInfo => ({ id, name: id, type: 'general-purpose', description: 'work', status, ...(parentId ? { parentId } : {}) })
const dataOf = (agents: HqData['agents']): HqData => ({ agents, todos: {}, tasks: {}, now: 0, hideFinished: false, columns: 0, isLight: false, team: null })

test('a member that ended more than the grace ago leaves the page and is only counted; a running helper of it hangs on the lead', () => {
  const t0 = 1_000_000
  const later = t0 + FINISHED_GRACE_MS + 1
  const first = mergeAgents({}, [member('o1', 'completed'), member('f1', 'failed'), member('k1', 'killed'), member('h1', 'running', 'o1')], t0)
  const data = dataOf(mergeAgents(first, [member('o1', 'completed'), member('f1', 'failed'), member('k1', 'killed'), member('h1', 'running', 'o1'), member('n1', 'completed')], later))

  const within = buildSnapshot(data, t0 + FINISHED_GRACE_MS - 1)
  expect(within.agents.map(a => a.id).sort()).toEqual(['f1', 'h1', 'k1', MAIN, 'n1', 'o1'].sort())
  expect(within.folded).toEqual({ done: 0, failed: 0 })

  const snap = buildSnapshot(data, later)
  expect(snap.agents.map(a => a.id).sort()).toEqual(['h1', MAIN, 'n1'].sort()) // n1 ended just now: still shown
  expect(snap.agents.find(a => a.id === 'h1')?.parentId).toBe(MAIN)
  expect(snap.folded).toEqual({ done: 1, failed: 2 }) // a killed member counts as failed, as the page counts it
})

test('an idle teammate leaves the page once it has been idle past the limit; a held one stays however long', () => {
  const data = dataOf(mergeAgents({}, [member('i1', 'idle'), member('i2', 'idle'), member('w1', 'waiting')], 0))
  const waitingSince = { i1: 0, i2: 5000, w1: 0 }

  expect(buildSnapshot(data, IDLE_LIMIT_MS, null, { waitingSince }).agents.map(a => a.id)).toContain('i1')
  const snap = buildSnapshot(data, IDLE_LIMIT_MS + 1, null, { waitingSince })
  expect(snap.agents.map(a => a.id).sort()).toEqual(['i2', MAIN, 'w1'].sort())
  expect(snap.folded).toEqual({ done: 0, failed: 0 })
})
