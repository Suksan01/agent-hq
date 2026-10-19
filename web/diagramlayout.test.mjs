import assert from 'node:assert/strict'
import test from 'node:test'

import { bestPacking, GAP_X, GAP_Y, GROUP_PAD, HEADER_H, GUESS, diagramWorld, edgePath, fitTransform, groupLayout, guessSize, isCompact, regionOf } from './diagramlayout.js'
import { overlaps } from './world.js'

const lead = { id: 'main', isLead: true, status: 'running' }
const member = (id, status = 'running', parentId = 'main', extra = {}) => ({ id, parentId, status, ...extra })
const team = (n, helpers = 0) => [lead, ...Array.from({ length: n }, (_, i) => member(`m${i}`, ['running', 'idle', 'waiting', 'failed', 'completed'][i % 5])), ...Array.from({ length: helpers }, (_, i) => member(`h${i}`, 'running', 'm0'))]
const rects = nodes => [...nodes].map(([id, n]) => ({ id, x: n.x, y: n.y, w: n.w, h: n.h }))

test('compact is for agents not at work; the lead and anything needing the person are full', () => {
  assert.equal(isCompact(member('a', 'idle')), true)
  assert.equal(isCompact(member('a', 'completed')), true)
  assert.equal(isCompact(member('a', 'killed')), true)
  for (const s of ['running', 'waiting', 'failed']) assert.equal(isCompact(member('a', s)), false)
  assert.equal(isCompact(member('a', 'idle', 'main', { needsYou: true })), false)
  assert.equal(isCompact({ ...lead, status: 'idle' }), false)
  assert.deepEqual(guessSize(lead), GUESS.lead)
})

test('no two cards overlap, with a gap between them, whatever the team looks like', () => {
  for (const [n, h] of [[0, 0], [1, 0], [2, 1], [5, 0], [6, 3], [9, 4], [13, 6]]) {
    const { nodes } = groupLayout(team(n, h))
    assert.equal(nodes.size, 1 + n + h, `n=${n} h=${h}`)
    const list = rects(nodes)
    for (const [i, a] of list.entries()) for (const b of list.slice(i + 1)) {
      assert.equal(overlaps({ x: a.x - 8, y: a.y - 8, w: a.w + 16, h: a.h + 16 }, b), false, `${a.id} and ${b.id} (n=${n}, h=${h})`)
    }
  }
})

test('the lead is in the middle and the members split across both sides, level by height', () => {
  const { nodes, width } = groupLayout(team(6))
  const lead = nodes.get('main')
  const side = which => [...nodes.values()].filter(n => n.parent === 'main' && n.side === which)
  const height = list => list.reduce((h, n) => h + n.h + GAP_Y, -GAP_Y)
  assert.ok(side('left').length > 0 && side('right').length > 0)
  assert.equal(side('left').length + side('right').length, 6)
  assert.ok(Math.abs(height(side('left')) - height(side('right'))) <= GUESS.full.h, 'the stacks are about as tall')
  for (const n of nodes.values()) {
    if (n.side === 'left') assert.ok(n.x + n.w + GAP_X <= lead.x + 0.5)
    if (n.side === 'right') assert.ok(n.x >= lead.x + lead.w + GAP_X - 0.5)
  }
  assert.ok(Math.abs(lead.x + lead.w / 2 - width / 2) < GUESS.full.w, 'about centred')
})

test('helpers branch outward from their parent, in the next column and level with it', () => {
  const { nodes } = groupLayout(team(2, 2))
  const parent = nodes.get('m0')
  for (const id of ['h0', 'h1']) {
    const h = nodes.get(id)
    assert.equal(h.parent, 'm0')
    assert.equal(h.side, parent.side)
    if (parent.side === 'right') assert.ok(h.x >= parent.x + parent.w + GAP_X - 0.5)
    else assert.ok(h.x + h.w <= parent.x - GAP_X + 0.5)
  }
  const ys = ['h0', 'h1'].map(id => nodes.get(id).y + nodes.get(id).h / 2)
  assert.ok(Math.abs((ys[0] + ys[1]) / 2 - (parent.y + parent.h / 2)) < 1, 'the helpers are stacked round their parent\'s level')
})

test('an edge runs from the parent\'s edge to the child\'s near edge, never inside a card', () => {
  const { nodes, edges } = groupLayout(team(7, 3))
  assert.equal(edges.length, nodes.size - 1)
  for (const e of edges) {
    const p = nodes.get(e.from), c = nodes.get(e.to)
    assert.ok(e.x1 === p.x || e.x1 === p.x + p.w)
    assert.ok(e.x2 === c.x || e.x2 === c.x + c.w)
    assert.equal(e.y1, p.y + p.h / 2)
    assert.equal(e.y2, c.y + c.h / 2)
    assert.match(edgePath(e), /^M[\d.-]+ [\d.-]+C/)
  }
})

test('measured sizes are used: taller cards push their neighbours apart', () => {
  const tall = groupLayout(team(4), a => (a.isLead ? GUESS.lead : { w: 316, h: 500 }))
  const short = groupLayout(team(4), a => (a.isLead ? GUESS.lead : { w: 316, h: 100 }))
  assert.ok(tall.height > short.height)
  const list = rects(tall.nodes)
  for (const [i, a] of list.entries()) for (const b of list.slice(i + 1)) assert.equal(overlaps(a, b), false)
})

test('odd data is tolerated: no lead marked, a parent that is not there, a parent loop', () => {
  assert.equal(groupLayout([]).nodes.size, 0)
  const plain = groupLayout([{ id: 'a', status: 'idle' }, { id: 'b', parentId: 'a', status: 'idle' }])
  assert.equal(plain.lead, 'a')
  assert.equal(plain.nodes.size, 2)
  const orphan = groupLayout([lead, member('x', 'idle', 'ghost')])
  assert.equal(orphan.nodes.get('x').parent, 'main')
  const loop = groupLayout([lead, member('p', 'idle', 'q'), member('q', 'idle', 'p')])
  assert.ok(loop.nodes.size >= 1)
})

test('groups are packed without overlap, inside the canvas, every card inside its group', () => {
  const groups = [
    { session: 's1', team: 'Booking App Team', folder: 'booking-app', agents: team(6, 2) },
    { session: 's2', team: 'API Team', folder: 'api', agents: team(3) },
    { session: 's3', team: 'Docs Team', folder: 'docs', agents: [lead] },
    { session: 's4', team: 'Big Team With A Really Long Name Indeed', folder: 'big', agents: team(11, 3) },
  ]
  const world = diagramWorld(groups)
  assert.deepEqual(world.groups.map(g => g.team), ['API Team', 'Big Team With A Really Long Name Indeed', 'Booking App Team', 'Docs Team'])
  for (const [i, a] of world.groups.entries()) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= world.width && a.y + a.h <= world.height)
    for (const b of world.groups.slice(i + 1)) assert.equal(overlaps({ x: a.x - 60, y: a.y - 60, w: a.w + 120, h: a.h + 120 }, b), false, `${a.team} and ${b.team}`)
  }
  for (const c of world.cards) {
    const g = world.groups[c.group]
    assert.ok(c.x >= g.x + GROUP_PAD - 1 && c.x + c.w <= g.x + g.w - GROUP_PAD + 1 && c.y >= g.y + HEADER_H - 1 && c.y + c.h <= g.y + g.h, `${c.uid} in ${g.team}`)
  }
  assert.equal(new Set(world.cards.map(c => c.uid)).size, world.cards.length, 'every session has its own main')
  for (const g of world.groups) for (const e of g.edges) assert.ok(e.x1 >= g.x && e.x2 <= g.x + g.w)
})

test('the order the hub sends sessions in does not matter', () => {
  const a = diagramWorld([{ session: 's1', team: 'X', agents: team(2) }, { session: 's2', team: 'X', agents: team(3) }])
  const b = diagramWorld([{ session: 's2', team: 'X', agents: team(3) }, { session: 's1', team: 'X', agents: team(2) }])
  assert.deepEqual(a.groups.map(g => [g.key, g.x, g.y]), b.groups.map(g => [g.key, g.x, g.y]))
})

test('Fit frames the region whole inside what the HUD leaves, never bigger than asked', () => {
  const world = diagramWorld([{ session: 's1', team: 'A', agents: team(6) }, { session: 's2', team: 'B', agents: team(4) }])
  const view = { w: 1500, h: 950 }
  const inset = { top: 90, right: 340, bottom: 80, left: 30 }
  for (const key of [null, 's1', 's2']) {
    const region = regionOf(world, key)
    const t = fitTransform(region, view, inset)
    assert.ok(t.z > 0 && t.z <= 1)
    const left = region.x * t.z + t.x, top = region.y * t.z + t.y
    assert.ok(left >= inset.left - 0.5 && top >= inset.top - 0.5, `${key} starts inside the inset`)
    assert.ok(left + region.w * t.z <= view.w - inset.right + 0.5 && top + region.h * t.z <= view.h - inset.bottom + 0.5, `${key} ends inside the inset`)
  }
  assert.ok(fitTransform({ x: 0, y: 0, w: 100, h: 100 }, view, {}, 1).z === 1, 'a small region is not blown up')
  assert.ok(regionOf(world, 's1').w < regionOf(world, null).w || regionOf(world, 's1').h < regionOf(world, null).h)
  assert.equal(regionOf({ groups: [], width: 10, height: 10 }, null).w, 10)
})

test('groups are packed to fill the screen: three groups go side by side on a wide screen, in a column on a tall one', () => {
  const sizes = [{ w: 1200, h: 700 }, { w: 1100, h: 800 }, { w: 600, h: 500 }]
  const wide = bestPacking(sizes, 3)
  const tall = bestPacking(sizes, 0.4)
  assert.ok(wide.width > tall.width)
  assert.ok(wide.height < tall.height)
  for (const packed of [wide, tall]) for (const [i, a] of packed.spots.entries()) for (const [j, b] of packed.spots.entries()) if (j > i) assert.equal(overlaps({ ...a, ...sizes[i] }, { ...b, ...sizes[j] }), false)
  assert.deepEqual(bestPacking([{ w: 500, h: 400 }], 1.6).spots, [{ x: 0, y: 0 }])
})

test('on a tall narrow screen every agent goes to the right of the lead, and the group is narrower', () => {
  const agents = team(6, 2)
  const both = groupLayout(agents)
  const one = groupLayout(agents, guessSize, { oneSide: true })
  assert.ok([...one.nodes.values()].every(n => n.side !== 'left'))
  assert.ok(one.width < both.width)
  const list = rects(one.nodes)
  for (const [i, a] of list.entries()) for (const b of list.slice(i + 1)) assert.equal(overlaps(a, b), false)
  const wide = diagramWorld([{ session: 's', team: 'T', agents }], new Map(), 1.6)
  const tall = diagramWorld([{ session: 's', team: 'T', agents }], new Map(), 0.5)
  assert.ok(tall.groups[0].w < wide.groups[0].w)
})
