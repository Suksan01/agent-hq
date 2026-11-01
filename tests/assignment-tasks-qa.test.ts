// QA gaps for the assignment rows (docs/specs/task-sidebar.md F1b): title cuts on other clusters, turn accounting on an assignments row
// (the member's and then the reviewer's turns land on one row), and a row stuck for good when its reviewer never reports.
import { expect, test } from 'claude-code/testing'

import type { HqAgent } from '../types'
import { addAssignmentRow, linkMember } from '../hooks/assign'
import { titleOfAssignment } from '../hooks/tasklist'
import { addTurnToTask, settleAssignmentRows, settleForNewSession } from '../hooks/taskwork'

const AT = 1_761_300_000_000
const agent = (id: string, name: string, status: HqAgent['status']): HqAgent => ({ id, name, role: 'agent-hq:dev', description: name, status, startedAt: 0, tools: 0 })
const agentsOf = (...list: HqAgent[]) => Object.fromEntries(list.map(a => [a.id, a]))
const turn = { durationMs: 1000, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40, model: 'claude-sonnet-5-5' } }

test('a 60-unit cut never splits a flag, a skin-tone emoji or a keycap', () => {
  for (const cluster of ['🇹🇭', '👍🏽', '1️⃣', '🧑🏽‍💻']) {
    for (let pad = 54; pad <= 59; pad++) {
      const title = titleOfAssignment(`${'a'.repeat(pad)}${cluster}${cluster}${cluster} tail`)
      expect(title.length, `${cluster} pad ${pad}`).toBeLessThanOrEqual(60)
      const body = title.replace(/…$/, '')
      expect([...body.slice(pad)].join(''), `${cluster} pad ${pad}`).toMatch(new RegExp(`^(${cluster})*$`, 'u'))
    }
  }
})

test('titleOfAssignment of a task with no text falls back to an empty title, CRLF and tabs are cut as line ends', () => {
  expect(titleOfAssignment('')).toBe('')
  expect(titleOfAssignment('first\r\nsecond')).toBe('first')
  expect(titleOfAssignment('\tindented\tline')).toBe('indented line')
})

test('the member\'s turns and then the reviewer\'s turns add up on the one assignments row', () => {
  let list = addAssignmentRow(null, { who: 'dev-1', role: 'dev', task: 'Build it', at: AT })
  list = addTurnToTask(list, 'dev-1', turn, AT + 1)
  list = linkMember(list, 1, { status: 'review', who: 'reviewer-1', role: 'reviewer', step: 'review', kind: 'review', at: AT + 2 })
  list = addTurnToTask(list, 'reviewer-1', turn, AT + 3)
  list = addTurnToTask(list, 'reviewer-1', turn, AT + 4)

  const row = list.tasks[0]!
  expect(row.status).toBe('review')
  expect(row.work['dev-1']).toMatchObject({ workMs: 1000, inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 })
  expect(row.work['reviewer-1']).toMatchObject({ workMs: 2000, inputTokens: 20, outputTokens: 40, step: 'review' })
})

test('a lead turn and a turn of an unlinked member change nothing on an assignments list', () => {
  const list = addAssignmentRow(null, { who: 'dev-1', role: 'dev', task: 'Build it', at: AT })
  expect(addTurnToTask(list, undefined, turn, AT)).toBe(list)
  expect(addTurnToTask(list, 'stranger', turn, AT)).toBe(list)
})

test('full life of a row: working, review, done, with new-session settling in between', () => {
  let list = addAssignmentRow(null, { who: 'dev-1', role: 'dev', task: 'Build it', at: AT })
  const dev = agent('d1', 'dev-1', 'running')
  expect(settleAssignmentRows(list, agentsOf(dev), AT + 1)).toBe(list)

  list = linkMember(list, 1, { status: 'review', who: 'reviewer-1', role: 'reviewer', step: 'review', kind: 'review', at: AT + 2 })
  const both = agentsOf(agent('d1', 'dev-1', 'completed'), agent('r1', 'reviewer-1', 'running'))
  expect(settleAssignmentRows(list, both, AT + 3)).toBe(list) // reviewer still runs: stays review even though the builder ended
  expect(settleForNewSession(list).tasks[0]?.status).toBe('review') // only working rows go back to waiting

  const done = settleAssignmentRows(list, agentsOf(agent('d1', 'dev-1', 'completed'), agent('r1', 'reviewer-1', 'completed')), AT + 4)
  expect(done.tasks[0]).toMatchObject({ status: 'done', doneAt: AT + 4 })
})

test('a stopped reviewer leaves the row in review (reported: nothing ever moves it on)', () => {
  let list = addAssignmentRow(null, { who: 'dev-1', role: 'dev', task: 'Build it', at: AT })
  list = linkMember(list, 1, { status: 'review', who: 'reviewer-1', role: 'reviewer', step: 'review', kind: 'review', at: AT + 2 })
  const stopped = settleAssignmentRows(list, agentsOf(agent('d1', 'dev-1', 'completed'), agent('r1', 'reviewer-1', 'killed')), AT + 3)
  expect(stopped.tasks[0]?.status).toBe('review')
})
