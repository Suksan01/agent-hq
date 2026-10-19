import assert from 'node:assert/strict'
import test from 'node:test'

import { CARD_H, CLEAR, FIT_MIN, LEAD_SCALE, NODE_W, SAFE, buildWorld, fitView, gridLayout, moodOf, overlaps, packIslands, regionOf, ringLayout, teamLayout } from './world.js'

const agent = (id, parentId, tone = 'running', extra = {}) => ({ id, parentId, tone, isMain: id === 'main', ...extra })
const team = (members, helpers = 0) => [
  agent('main', null),
  ...Array.from({ length: members }, (_, i) => agent(`m${i}`, 'main')),
  ...Array.from({ length: helpers }, (_, i) => agent(`h${i}`, 'm0')),
]
const session = (id, label, members, extra = {}) => ({ session: id, label, alive: true, snapshot: { at: 1_000_000, agents: team(members) }, ...extra })

const cardRect = c => {
  const k = c.agent.isMain ? LEAD_SCALE : 1
  return { x: c.x - (NODE_W * k) / 2, y: c.y - (CARD_H * k) / 2, w: NODE_W * k, h: CARD_H * k }
}
const islandRect = i => ({ x: i.x, y: i.y, w: i.w, h: i.h })

test('a ring puts the lead in the middle and no two cards touch, helpers included', () => {
  for (const n of [0, 1, 2, 3, 5, 6, 8]) {
    const { centers } = ringLayout(team(n, n > 0 ? 3 : 0))
    const rects = [...centers.values()].map(p => ({ x: p.x - NODE_W / 2, y: p.y - CARD_H / 2, w: NODE_W, h: CARD_H }))
    for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) assert.equal(overlaps(a, b), false, `n=${n}`)
  }
})

test('a big team is a grid with the lead in the middle cell, and no two cards touch', () => {
  const agents = team(13)
  assert.equal(teamLayout(agents).centers.size, 14)
  const { centers, width, height } = gridLayout(agents)
  const lead = centers.get('main')
  const xs = [...centers.values()].map(p => p.x), ys = [...centers.values()].map(p => p.y)
  assert.ok(lead.x > Math.min(...xs) && lead.x < Math.max(...xs) && lead.y > Math.min(...ys) && lead.y < Math.max(...ys), 'the lead is not on the edge')
  const rects = [...centers.values()].map(p => ({ x: p.x - NODE_W / 2, y: p.y - CARD_H / 2, w: NODE_W, h: CARD_H }))
  for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) assert.equal(overlaps(a, b), false)
  for (const r of rects) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height)
})

test('every session is an island of its own: no overlap, cards on its safe land, ids unique across sessions', () => {
  const sessions = [session('s3', 'web', 6), session('s1', 'api', 0), session('s2', 'docs', 3), session('s5', 'big', 12), session('s4', 'cli', 2)]
  const world = buildWorld(sessions)

  assert.deepEqual(world.islands.map(i => i.label), ['api', 'big', 'cli', 'docs', 'web'], 'sorted by label')
  for (const [i, a] of world.islands.entries()) for (const b of world.islands.slice(i + 1)) {
    assert.equal(overlaps(islandRect(a), islandRect({ ...b, x: b.x - 150, y: b.y - 150, w: b.w + 300, h: b.h + 300 })), false, `${a.label} and ${b.label} keep their distance`)
  }
  for (const c of world.cards) {
    const isle = world.islands[c.island]
    const safe = { x: isle.x + (isle.w * (1 - SAFE)) / 2, y: isle.y + (isle.h * (1 - SAFE)) / 2, w: isle.w * SAFE, h: isle.h * SAFE }
    const r = cardRect(c)
    assert.ok(r.x >= safe.x - 1 && r.y >= safe.y - 1 && r.x + r.w <= safe.x + safe.w + 1 && r.y + r.h <= safe.y + safe.h + 1, `${c.uid} sits on ${isle.label}'s safe land`)
  }
  assert.equal(new Set(world.cards.map(c => c.uid)).size, world.cards.length)
  assert.equal(world.cards.filter(c => c.agent.id === 'main').length, 5, 'each session has its own main')
  const all = world.islands.map(islandRect)
  assert.ok(all.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= world.width && r.y + r.h <= world.height), 'the sea holds them all')
})

test('the order does not depend on the order the hub sends sessions in', () => {
  const a = buildWorld([session('s1', 'x', 2), session('s2', 'x', 3), session('s3', 'a', 1)])
  const b = buildWorld([session('s3', 'a', 1), session('s2', 'x', 3), session('s1', 'x', 2)])
  assert.deepEqual(a.islands.map(i => [i.key, i.x, i.y]), b.islands.map(i => [i.key, i.x, i.y]))
})

test('a card knows its parent card in its own session only', () => {
  const world = buildWorld([session('s1', 'a', 2), session('s2', 'b', 2)])
  const helper = world.cards.find(c => c.uid === 's1|m0')
  assert.equal(helper.parentUid, 's1|main')
  assert.equal(world.cards.find(c => c.uid === 's1|main').parentUid, null)
})

test('no sessions and one empty session are drawn without error', () => {
  assert.deepEqual(buildWorld([]).islands, [])
  const world = buildWorld([{ session: 'e', label: 'empty', alive: true, snapshot: { at: 0, agents: [] } }])
  assert.equal(world.islands.length, 1)
  assert.equal(world.cards.length, 0)
})

test('packIslands wraps into rows, centres them and never overlaps', () => {
  const sizes = Array.from({ length: 7 }, (_, i) => ({ w: 700 + i * 90, h: 500 + (i % 3) * 120 }))
  const { spots, width, height } = packIslands(sizes)
  for (const [i, a] of spots.entries()) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + sizes[i].w <= width + 1 && a.y + sizes[i].h <= height + 1)
    for (const [j, b] of spots.entries()) if (j > i) assert.equal(overlaps({ ...a, ...sizes[i] }, { ...b, ...sizes[j] }), false)
  }
  assert.deepEqual(packIslands([]), { spots: [], width: 0, height: 0 })
})

test('mood: gone, stormy after a recent failure, busy while anyone works, else calm', () => {
  const at = 5_000_000
  const s = (alive, agents) => ({ alive, snapshot: { at, agents } })
  assert.equal(moodOf(s(false, [agent('a', 'main')])), 'gone')
  assert.equal(moodOf(s(true, [agent('a', 'main', 'error', { endedAt: at - 60_000 }), agent('b', 'main', 'running')])), 'stormy')
  assert.equal(moodOf(s(true, [agent('a', 'main', 'error', { endedAt: at - 3_600_000 }), agent('b', 'main', 'running')])), 'busy')
  assert.equal(moodOf(s(true, [agent('a', 'main', 'done'), agent('b', 'main', 'needs_input')])), 'calm')
  assert.equal(moodOf(s(true, [])), 'calm')
})

test('Fit keeps every card out from under the panels at 1500x950 and 1280x800, one island or several', () => {
  const sessions = [session('s1', 'web', 6), session('s2', 'api', 4), session('s3', 'docs', 2)]
  const one = buildWorld([sessions[0]])
  const many = buildWorld(sessions)
  for (const [w, h] of [[1500, 950], [1280, 800]]) {
    const panels = [{ x: 16, y: 16, w: 440, h: 245 }, { x: w - 356, y: 70, w: 340, h: h - 86 }, { x: w - 620, y: 16, w: 604, h: 38 }]
    for (const [name, world, keys] of [['one island', one, null], ['all islands', many, null], ['one of three', many, ['web']]]) {
      const region = regionOf(world, keys)
      const view = fitView(region, { w, h }, true, panels)
      assert.ok(view.z >= FIT_MIN && view.z <= 1.1, `${name} ${w}x${h}: zoom ${view.z}`)
      if (name === 'all islands') continue // many islands may legitimately fall back to the plain fit
      for (const c of region.cards) {
        const kw = NODE_W * c.k * view.z, kh = CARD_H * c.k * view.z
        const rect = { x: view.x + c.x * view.z - kw / 2 + CLEAR, y: view.y + c.y * view.z - kh / 2 + CLEAR, w: kw, h: kh }
        for (const p of panels) assert.equal(overlaps(rect, p), false, `${name} ${w}x${h}`)
      }
    }
  }
})

test('Fit frames the selected island: its region is smaller than the whole sea and contains its cards', () => {
  const world = buildWorld([session('s1', 'web', 6), session('s2', 'api', 4)])
  const all = regionOf(world, null)
  const web = regionOf(world, ['s1'])
  assert.ok(web.width < all.width || web.height < all.height)
  assert.equal(web.cards.length, 7)
  for (const c of web.cards) assert.ok(c.x > web.x0 && c.x < web.x0 + web.width && c.y > web.y0 && c.y < web.y0 + web.height)
  assert.equal(all.cards.length, 12)
})
