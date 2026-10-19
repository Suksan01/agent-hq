import assert from 'node:assert/strict'
import test from 'node:test'

import { cardRect, hit, hitDisc, inside, isChipOnly, variantsFor } from './labellayout.js'

test('cardRect puts the card on the chosen side', () => {
  assert.deepEqual(cardRect(100, 100, 40, 20, 10, [1, 0]), { x: 110, y: 90, w: 40, h: 20 })
  assert.deepEqual(cardRect(100, 100, 40, 20, 10, [-1, 0]), { x: 50, y: 90, w: 40, h: 20 })
  assert.deepEqual(cardRect(100, 100, 40, 20, 10, [0, -1]), { x: 80, y: 70, w: 40, h: 20 })
})

test('rectangles and discs: touching, margins, containment', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 }
  assert.equal(hit(a, { x: 5, y: 5, w: 10, h: 10 }), true)
  assert.equal(hit(a, { x: 12, y: 0, w: 10, h: 10 }), false)
  assert.equal(hit(a, { x: 12, y: 0, w: 10, h: 10 }, 3), true, 'a margin counts')
  assert.equal(inside(a, { x: -1, y: -1, w: 20, h: 20 }), true)
  assert.equal(inside(a, { x: 1, y: 0, w: 20, h: 20 }), false)
  assert.equal(hitDisc(a, { x: 20, y: 5, r: 9 }), false)
  assert.equal(hitDisc(a, { x: 20, y: 5, r: 11 }), true)
})

test('the kind of card an agent starts with: the lead its own, working and needs-you full, the rest compact, chips for a tiny system', () => {
  assert.deepEqual(variantsFor({ isLead: true }), ['lead', 'chip'])
  assert.equal(variantsFor({ state: 'working' })[0], 'full')
  assert.equal(variantsFor({ state: 'waiting' })[0], 'full')
  assert.equal(variantsFor({ state: 'idle', needsYou: true })[0], 'full')
  for (const state of ['idle', 'done', 'failed', 'stopped']) assert.deepEqual(variantsFor({ state }), ['compact', 'chip'])
  assert.deepEqual(variantsFor({ state: 'working' }, { narrow: true }), ['compact', 'chip'])
  assert.deepEqual(variantsFor({ isLead: true }, { narrow: true }), ['lead', 'chip'])
  assert.deepEqual(variantsFor({ isLead: true, state: 'working' }, { chipOnly: true }), ['chip'])
})

test('a system is chips only when it is tiny on screen', () => {
  assert.equal(isChipOnly(30, 1500, 950), true)
  assert.equal(isChipOnly(55, 1500, 950), false)
  assert.equal(isChipOnly(30, 420, 900), false)
  assert.equal(isChipOnly(12, 420, 900), true)
})
