import assert from 'node:assert/strict'
import test from 'node:test'

import { badgesOf, levelOf, timelineOf } from './drawer.js'

test('the timeline is the agent\'s own events, newest first, capped', () => {
  const events = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, at: i * 10, agent: i % 3 === 0 ? 'a' : 'b', kind: 'status', text: `e${i + 1}` }))
  const rows = timelineOf(events, 'a')
  assert.equal(rows.length, 10)
  assert.deepEqual(rows.slice(0, 3).map(e => e.n), [28, 25, 22])
  assert.equal(timelineOf(events, 'a', 3).length, 3)
  assert.deepEqual(timelineOf(undefined, 'a'), [])
  assert.deepEqual(timelineOf(events, 'nobody'), [])
})

test('no xp data means no level section', () => {
  assert.equal(levelOf(undefined), null)
  assert.equal(levelOf(null), null)
  assert.equal(levelOf({}), null)
  assert.equal(levelOf({ xp: 'lots' }), null)
})

test('the level is floor(sqrt(xp / 50)) + 1, with how far through it the agent is', () => {
  assert.deepEqual(levelOf({ xp: 0 }), { level: 1, xp: 0, into: 0, need: 50, pct: 0, badges: [] })
  const l2 = levelOf({ xp: 50, badges: ['first_task'] })
  assert.equal(l2.level, 2)
  assert.equal(l2.into, 0)
  assert.equal(l2.need, 150) // 200 - 50
  assert.equal(levelOf({ xp: 125 }).pct, 50)
  assert.equal(levelOf({ xp: 199 }).level, 2)
  assert.equal(levelOf({ xp: 200 }).level, 3)
  assert.equal(levelOf({ xp: -5 }).level, 1)
})

test('badges come from ids or objects, with a title for any id', () => {
  assert.deepEqual(badgesOf(['speedy']), [{ id: 'speedy', title: 'Speedy', hint: 'Finish a task in under 2 minutes' }])
  assert.deepEqual(badgesOf([{ id: 'new_one', title: 'Shiny', hint: 'Be shiny' }, { id: 'night_owl' }, 7, null]), [
    { id: 'new_one', title: 'Shiny', hint: 'Be shiny' },
    { id: 'night_owl', title: 'Night owl', hint: '' },
  ])
  assert.deepEqual(badgesOf(undefined), [])
})
