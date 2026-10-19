import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hit, hitDisc } from './labellayout.js'
import { createSlotKeeper, planSlots } from './slots.js'

const BOUNDS = { x: 16, y: 64, w: 1468, h: 830 }
const SIZES = { lead: { w: 280, h: 150 }, full: { w: 240, h: 190 }, compact: { w: 200, h: 80 }, chip: { w: 110, h: 30 } }
const sizeOf = (id, kind) => SIZES[kind]
const systems = () => new Map([
  ['a', { x: 330, y: 480, r: 170, starR: 30, visible: true }],
  ['b', { x: 900, y: 470, r: 230, starR: 30, visible: true }],
  ['c', { x: 1380, y: 480, r: 90, starR: 30, visible: true }],
])
const crowd = () => [
  ...['a', 'b', 'c'].map((key, i) => ({ id: `${key}|main`, key, angle: -Math.PI / 2, priority: 6, variants: ['lead', 'compact', 'chip'], planet: i })),
  ...[['a', 3], ['b', 6]].flatMap(([key, n]) => Array.from({ length: n }, (_, i) => ({ id: `${key}|m${i}`, key, angle: (i / n) * Math.PI * 2, priority: i % 2 ? 3 : 1, variants: i % 2 ? ['full', 'compact', 'chip'] : ['compact', 'chip'] }))),
]
const input = (extra = {}) => ({ systems: systems(), agents: crowd(), sizeOf, bounds: BOUNDS, titles: new Map(), ...extra })
const rectOf = (plan, sys, id) => { const s = plan.get(id); return { x: sys.x + s.dx, y: sys.y + s.dy, w: s.w, h: s.h } }

test('every card stands clear of the other cards, the stars, other systems and the screen edge', () => {
  const sys = systems()
  const plan = planSlots(input())
  const rects = []
  for (const a of crowd()) {
    const slot = plan.get(a.id)
    assert.ok(slot.kind, `${a.id} has a kind`)
    const rect = rectOf(plan, sys.get(a.key), a.id)
    assert.ok(rect.x >= BOUNDS.x && rect.y >= BOUNDS.y && rect.x + rect.w <= BOUNDS.x + BOUNDS.w && rect.y + rect.h <= BOUNDS.y + BOUNDS.h, `${a.id} is on screen`)
    for (const [key, s] of sys) {
      assert.equal(hitDisc(rect, { x: s.x, y: s.y, r: s.starR }), false, `${a.id} is clear of the star of ${key}`)
      if (key !== a.key) assert.equal(hitDisc(rect, { x: s.x, y: s.y, r: s.r * 0.8 }), false, `${a.id} is clear of system ${key}`)
    }
    for (const other of rects) assert.equal(hit(rect, other), false, `${a.id} does not overlap another card`)
    rects.push(rect)
  }
})

test('a card keeps its slot when the planets move: the plan does not depend on them', () => {
  const keeper = createSlotKeeper()
  let result
  let t = 0
  for (; t <= 3000; t += 33) keeper.update(t, input()) // the first plan, and the warm-up
  const first = keeper.update(t, input())
  for (t += 33; t <= 13_000; t += 33) result = keeper.update(t, input({ planets: Math.sin(t / 700) }))
  assert.equal(result.changes - first.changes, 0, 'ten seconds of orbit change nothing')
  assert.equal(result.planId, first.planId, 'and make no new plan')
})

test('a zoom is followed rigidly, then replanned once after the camera settles, then left alone', () => {
  const keeper = createSlotKeeper()
  for (let t = 0; t <= 4000; t += 33) keeper.update(t, input())
  const before = keeper.update(4000, input())
  const ids = []
  const zoomed = () => new Map([...systems()].map(([k, s]) => [k, { ...s, x: 750 + (s.x - 750) * 1.2, y: 480 + (s.y - 480) * 1.2, r: s.r * 1.2 }]))
  let planIdAtSettle = null
  for (let t = 4033; t <= 8000; t += 33) {
    const r = keeper.update(t, input({ systems: zoomed() }))
    if (t < 4033 + 300) assert.equal(r.planId, before.planId, 'no replan while the camera moves')
    if (r.planId !== before.planId && planIdAtSettle === null) { planIdAtSettle = t; ids.push(t) }
  }
  assert.ok(planIdAtSettle !== null && planIdAtSettle >= 4033 + 300, `replanned after the settle (${planIdAtSettle})`)
  const final = keeper.update(8000, input({ systems: zoomed() }))
  assert.equal(final.planId, before.planId + 1, 'exactly once')
})

test('a change of wanted kind waits for the hold; an agent coming or going does not', () => {
  const keeper = createSlotKeeper({ warmupMs: 0 })
  keeper.update(0, input())
  for (let t = 33; t <= 3000; t += 33) keeper.update(t, input())
  const a = keeper.update(3000, input()).planId
  const wanted = crowd().map(x => (x.id === 'b|m1' ? { ...x, variants: ['chip'] } : x))
  assert.equal(keeper.update(3100, input({ agents: wanted })).planId, a + 1, 'long since the last plan: it goes ahead')
  const wanted2 = crowd()
  assert.equal(keeper.update(3500, input({ agents: wanted2 })).planId, a + 1, 'within two seconds of a plan: it waits')
  assert.equal(keeper.update(5200, input({ agents: wanted2 })).planId, a + 2, 'then it goes ahead')
  const fewer = crowd().slice(1)
  assert.equal(keeper.update(5300, input({ agents: fewer })).planId, a + 3, 'an agent leaving is replanned at once')
})
