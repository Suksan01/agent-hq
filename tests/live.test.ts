import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { MAX_PAUSED, buildSnapshot } from '../hooks/live'
import { IDLE_LIMIT_MS, buildInbox } from '../hooks/inbox'
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

const GRACE = 2 * 60_000 // the old time a finished member stayed on the page
test('a member that ended long ago stays on the page, paused, with its helper under it; folded is always zero', () => {
  const t0 = 1_000_000
  const later = t0 + GRACE + 1
  const first = mergeAgents({}, [member('o1', 'completed'), member('f1', 'failed'), member('k1', 'killed'), member('h1', 'running', 'o1')], t0)
  const data = dataOf(mergeAgents(first, [member('o1', 'completed'), member('f1', 'failed'), member('k1', 'killed'), member('h1', 'running', 'o1'), member('n1', 'completed')], later))

  const snap = buildSnapshot(data, later)

  expect(snap.agents.map(a => a.id).sort()).toEqual(['f1', 'h1', 'k1', MAIN, 'n1', 'o1'].sort())
  expect(snap.agents.find(a => a.id === 'h1')?.parentId).toBe('o1')
  expect(snap.folded).toEqual({ done: 0, failed: 0 })
  const paused = Object.fromEntries(snap.agents.map(a => [a.id, a.isPaused]))
  expect(paused).toEqual({ [MAIN]: false, o1: true, f1: true, k1: true, n1: true, h1: false })
})

test('an idle teammate stays past the old limit, paused; a working and a waiting member are not paused; the lead never is', () => {
  const data = dataOf(mergeAgents({}, [member('i1', 'idle'), member('r1', 'running'), member('w1', 'waiting')], 0))

  const snap = buildSnapshot(data, 24 * 3_600_000, null, { waitingSince: { i1: 0, w1: 0 } })

  expect(snap.agents.map(a => a.id).sort()).toEqual(['i1', MAIN, 'r1', 'w1'].sort())
  expect(Object.fromEntries(snap.agents.map(a => [a.id, a.isPaused]))).toEqual({ [MAIN]: false, i1: true, r1: false, w1: false })
})

test('an idle member the inbox still holds as waiting is not paused; once the inbox lets it go, it is', () => {
  const data = dataOf(mergeAgents({}, [member('i1', 'idle')], 0))
  const waitingSince = { i1: 1000 }
  for (const at of [1000 + IDLE_LIMIT_MS, 1000 + IDLE_LIMIT_MS + 1]) {
    const listed = buildInbox({}, data.agents, waitingSince, at).some(x => x.agent === 'i1')

    const paused = buildSnapshot(data, at, null, { waitingSince }).agents.find(a => a.id === 'i1')?.isPaused

    expect(paused).toBe(!listed) // the two never disagree
  }
  expect(buildSnapshot(data, 1000 + IDLE_LIMIT_MS, null, { waitingSince }).agents.find(a => a.id === 'i1')?.isPaused).toBe(false)
})

test('seats lists the team\'s unstarted seats only, named as hq_assign names them; empty without a team', () => {
  if (typeof TEAM === 'string') throw new Error(TEAM)
  const dev: AgentInfo = { id: 'd1', name: 'frontend-dev-1', type: 'agent-hq:frontend-dev', description: 'x', status: 'running' }
  const withTeam: HqData = { ...dataOf(mergeAgents({}, [dev], 1)), team: TEAM }

  expect(buildSnapshot(withTeam, 5).seats).toEqual([{ name: 'frontend-dev-2', role: 'frontend-dev', roleTitle: 'Frontend Developer' }])
  expect(buildSnapshot(dataOf(mergeAgents({}, [], 0)), 5).seats).toEqual([])
})

test('a member given a custom name still fills its role\'s seat: seats counts per role, not by name', () => {
  if (typeof TEAM === 'string') throw new Error(TEAM)
  const alice: AgentInfo = { id: 'a1', name: 'alice', type: 'agent-hq:frontend-dev', description: 'x', status: 'completed' }
  const data: HqData = { ...dataOf(mergeAgents({}, [alice], 1)), team: TEAM }

  expect(buildSnapshot(data, 5).seats).toEqual([{ name: 'frontend-dev-1', role: 'frontend-dev', roleTitle: 'Frontend Developer' }]) // count 2, one held
  const both: HqData = { ...data, agents: mergeAgents(data.agents, [alice, { ...alice, id: 'a2', name: 'bob' }], 2) }
  expect(buildSnapshot(both, 5).seats).toEqual([])
})

test('only the newest MAX_PAUSED paused members stay; a working one always does', () => {
  const many = Array.from({ length: MAX_PAUSED + 3 }, (_, i) => member(`p${i}`, 'completed'))
  const first = mergeAgents({}, many, 0)
  const ended = Object.fromEntries(Object.entries(first).map(([id, a]) => [id, { ...a, endedAt: 1000 + Number(id.slice(1)) }]))
  const data = dataOf(mergeAgents(ended, [...many, member('r1', 'running')], 5))

  const ids = buildSnapshot(data, 9).agents.map(a => a.id)

  expect(ids).toHaveLength(MAX_PAUSED + 2) // the lead, r1 and the newest paused
  expect(ids).toContain('r1')
  expect(ids).toContain(`p${MAX_PAUSED + 2}`)
  expect(ids).not.toContain('p0')
})

test('folded counts the paused members the cap drops, and is zero below the cap', () => {
  const some = [member('c1', 'completed'), member('f1', 'failed'), member('k1', 'killed')]
  expect(buildSnapshot(dataOf(mergeAgents({}, some, 0)), 9).folded).toEqual({ done: 0, failed: 0 })

  const many = [...Array.from({ length: MAX_PAUSED }, (_, i) => member(`n${i}`, 'completed')), ...some]
  const first = mergeAgents({}, many, 0)
  // the three oldest are the ones from `some`: ended long before the rest
  const aged = Object.fromEntries(Object.entries(first).map(([id, a]) => [id, { ...a, endedAt: some.some(s => s.id === id) ? 1 : 1000 }]))

  expect(buildSnapshot(dataOf(mergeAgents(aged, many, 5)), 9).folded).toEqual({ done: 1, failed: 2 })
})

// measured: one agent about 730 bytes, the 52 kept (50 paused, the lead, a working one) about 40.5 KB
const SNAPSHOT_BOUND = 60_000
test('a snapshot of 60 agents (59 paused, one working) keeps 52 and stays under the size bound', () => {
  const many = [...Array.from({ length: 59 }, (_, i) => member(`p${i}`, 'completed')), member('r1', 'running')]
  const data = dataOf(mergeAgents({}, many, 0))

  const snap = buildSnapshot(data, 9)

  expect(snap.agents).toHaveLength(MAX_PAUSED + 2)
  expect(JSON.stringify(snap).length).toBeLessThan(SNAPSHOT_BOUND)
})
