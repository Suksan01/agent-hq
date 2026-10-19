import assert from 'node:assert/strict'
import test from 'node:test'

import { boardTotals, orderTasks } from './panels.js'
import { pickRole, rolesFor } from './spacekit.js'

test('a board reads in progress, then pending, then done, by task number, without changing the list it was given', () => {
  const tasks = [
    { id: '10', status: 'completed' }, { id: '2', status: 'pending' }, { id: '3', status: 'in_progress' },
    { id: '1', status: 'completed' }, { id: '11', status: 'pending' }, { id: '9', status: 'in_progress' },
  ]
  const before = JSON.stringify(tasks)
  assert.deepEqual(orderTasks(tasks).map(t => t.id), ['3', '9', '2', '11', '1', '10'])
  assert.equal(JSON.stringify(tasks), before)
  assert.deepEqual(orderTasks([]), [])
})

test('the title counts done and total over every team', () => {
  assert.deepEqual(boardTotals([{ progress: { done: 2, total: 5 } }, { progress: { done: 1, total: 1 } }]), { done: 3, total: 6 })
  assert.deepEqual(boardTotals([]), { done: 0, total: 0 })
})

test('the add-agent roles follow the team: one list for one team, or a list per team; a missing role falls back to one with room', () => {
  const booking = [{ id: 'frontend', count: 2, active: 2 }, { id: 'qa', count: 1, active: 0 }]
  const docs = [{ id: 'writer', count: 1, active: 0 }]
  assert.equal(rolesFor(booking, 'any'), booking)
  assert.equal(rolesFor({ booking, docs }, 'docs'), docs)
  assert.deepEqual(rolesFor({ booking }, 'gone'), [])
  assert.deepEqual(rolesFor(undefined, 'x'), [])
  assert.equal(pickRole(booking, undefined).id, 'qa', 'the first role with room')
  assert.equal(pickRole(booking, 'frontend').id, 'frontend', 'a chosen role stays chosen')
  assert.equal(pickRole(docs, 'qa').id, 'writer', 'switching team drops a role it does not have')
  assert.equal(pickRole([{ id: 'a', count: 1, active: 1 }], undefined).id, 'a', 'all full: the first')
  assert.equal(pickRole([], 'a'), undefined)
})
