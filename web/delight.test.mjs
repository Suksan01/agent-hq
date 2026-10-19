import assert from 'node:assert/strict'
import test from 'node:test'

import { CONFETTI_COLORS, completedTasks, confettiPieces, delightSummary, levelUps, skyAt } from './delight.js'

const at = (h, m = 0) => new Date(2026, 5, 15, h, m)
const sess = (tasks = [], agents = [], session = 's1') => ({ session, snapshot: { tasks, agents } })
const task = (id, status, owner) => ({ id, status, owner })

test('the sea is pale by day, peach at dusk and deep blue at night, blending in between', () => {
  assert.equal(skyAt(at(12)).sea, '#ddf3f0')
  assert.equal(skyAt(at(12)).night, 0)
  assert.equal(skyAt(at(2)).sea, '#2f4272')
  assert.ok(skyAt(at(2)).night > 0.99)
  assert.equal(skyAt(at(18, 30)).sea, '#f2c4a0')
  const mid = skyAt(at(19, 30))
  assert.ok(mid.night > 0.2 && mid.night < 0.9, `dusk goes dark gradually: ${mid.night}`)
  assert.notEqual(mid.sea, '#f2c4a0')
  assert.notEqual(mid.sea, '#2f4272')
  for (let h = 0; h < 24; h++) for (const k of ['sea', 'shallow']) assert.match(skyAt(at(h, 17))[k], /^#[0-9a-f]{6}$/)
})

test('midnight is the same sea at either end of the day', () => {
  assert.equal(skyAt(at(0)).sea, skyAt(at(23, 59)).sea)
  assert.ok(skyAt(at(23, 59)).night > 0.99)
})

test('a task completed since the last look is news; the first look and a task seen finished are not', () => {
  const before = delightSummary([sess([task('1', 'in_progress', 'dev'), task('2', 'completed'), task('3', 'pending')])])
  const after = delightSummary([sess([task('1', 'completed', 'dev'), task('2', 'completed'), task('3', 'pending'), task('4', 'completed')])])
  assert.deepEqual(completedTasks(before, after), [{ session: 's1', task: '1', owner: 'dev' }])
  assert.deepEqual(completedTasks(undefined, after), [])
  assert.deepEqual(completedTasks(after, after), [])
  assert.deepEqual(completedTasks(before, delightSummary([sess([task('1', 'completed', 'dev')], [], 's2')])), [], 'a new island is not news')
})

test('a level that rose is news; no xp, a new agent or a first look are not', () => {
  const lv = (id, level) => ({ id, xp: { xp: 0, level } })
  const before = delightSummary([sess([], [lv('a', 1), lv('b', 2), { id: 'c' }])])
  const after = delightSummary([sess([], [lv('a', 2), lv('b', 2), { id: 'c' }, lv('new', 5)])])
  assert.deepEqual(levelUps(before, after), [{ session: 's1', agent: 'a', level: 2 }])
  assert.deepEqual(levelUps(undefined, after), [])
  assert.deepEqual(levelUps(after, before), [], 'a level never goes down as news')
})

test('a burst of confetti is the same for the same seed, flies every way and uses the palette', () => {
  const a = confettiPieces('s1|3'), b = confettiPieces('s1|3'), c = confettiPieces('s1|4')
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
  assert.equal(a.length, 28)
  assert.ok(a.some(p => p.dx > 100) && a.some(p => p.dx < -100) && a.some(p => p.dy < -100))
  for (const p of a) { assert.ok(CONFETTI_COLORS.includes(p.color)); assert.ok(p.size >= 10 && p.size <= 20); assert.ok(p.delay >= 0 && p.delay <= 120) }
  assert.equal(confettiPieces('x', 5).length, 5)
})
