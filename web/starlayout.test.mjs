import assert from 'node:assert/strict'
import test from 'node:test'

import { LEAD_R, fitDistance, fitDistanceBox, normStatus, orbitPoint, placeSystems, systemLayout, unit } from './starlayout.js'

const lead = { id: 'main', isLead: true, status: 'working' }
const member = (id, status = 'idle', parentId = 'main') => ({ id, parentId, status })

test('statuses from the snapshot become the scene\'s six', () => {
  assert.deepEqual(['running', 'pending', 'waiting', 'idle', 'completed', 'failed', 'killed', 'done', 'what'].map(normStatus), ['working', 'working', 'waiting', 'idle', 'done', 'failed', 'stopped', 'done', 'idle'])
})

test('the lead is the star; each member has an orbit ring of its own, further out one by one', () => {
  const { lead: id, orbits, radius } = systemLayout([lead, member('a'), member('b'), member('c')])
  assert.equal(id, 'main')
  assert.equal(orbits.get('main').kind, 'lead')
  const radii = ['a', 'b', 'c'].map(k => orbits.get(k).radius)
  assert.deepEqual([...radii].sort((x, y) => x - y), radii)
  assert.equal(new Set(radii).size, 3)
  assert.ok(radius > radii[2] && radius > LEAD_R)
})

test('only working agents move; the rest stay where they started', () => {
  const { orbits } = systemLayout([lead, member('w', 'running'), member('i', 'idle'), member('d', 'completed'), member('f', 'failed'), member('n', 'waiting')])
  assert.ok(orbits.get('w').omega > 0)
  for (const k of ['i', 'd', 'f', 'n']) assert.equal(orbits.get(k).omega, 0)
})

test('helpers are moons of their parent, nested moons are smaller, and every agent has an orbit', () => {
  const agents = [lead, member('a'), { id: 'h1', parentId: 'a', status: 'running' }, { id: 'h2', parentId: 'a', status: 'running' }, { id: 'hh', parentId: 'h1', status: 'idle' }, { id: 'lone', parentId: 'main', status: 'idle' }]
  const { orbits } = systemLayout(agents)
  assert.equal(orbits.size, agents.length)
  assert.equal(orbits.get('h1').kind, 'moon')
  assert.equal(orbits.get('h1').parent, 'a')
  assert.ok(orbits.get('h2').radius > orbits.get('h1').radius)
  assert.equal(orbits.get('hh').parent, 'h1')
  assert.ok(orbits.get('hh').radius < orbits.get('h1').radius)
  assert.equal(orbits.get('lone').kind, 'member')
})

test('the layout is the same every time, and a system without agents is still a system', () => {
  const agents = [lead, member('a'), member('b', 'running')]
  assert.deepEqual([...systemLayout(agents).orbits], [...systemLayout(agents).orbits])
  const empty = systemLayout([])
  assert.equal(empty.lead, null)
  assert.ok(empty.radius > 0)
  assert.equal(systemLayout([member('x', 'idle', null)]).lead, 'x', 'with no marked lead the first parentless agent is the star')
})

test('systems are spread apart with a gap between them, in a stable order', () => {
  const systems = [{ session: 's3', team: 'C', radius: 700 }, { session: 's1', team: 'A', radius: 350 }, { session: 's2', team: 'B', radius: 520 }, { session: 's4', team: 'B', radius: 250 }]
  const at = placeSystems(systems)
  assert.deepEqual(at[1], { x: 0, y: at[1].y, z: 0 }, 'the first by name sits at the centre')
  for (const [i, a] of at.entries()) for (const [j, b] of at.entries()) if (j > i) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= systems[i].radius + systems[j].radius + 200, `${i} and ${j}`)
  assert.deepEqual(placeSystems([...systems].reverse()).reverse(), at, 'the order given does not matter')
  assert.deepEqual(placeSystems([]), [])
  assert.equal(placeSystems([systems[0]]).length, 1)
})

test('orbit points lie on their circle', () => {
  for (const angle of [0, 1, 2.5, 5]) {
    const p = orbitPoint(100, angle)
    assert.ok(Math.abs(Math.hypot(p.x, p.z) - 100) < 1e-9)
  }
  assert.ok(unit('a') >= 0 && unit('a') < 1)
  assert.equal(unit('a'), unit('a'))
  assert.notEqual(unit('a'), unit('b'))
})

test('the camera stands further back for a bigger system or a narrower screen', () => {
  assert.ok(fitDistance(800, 50, 1.6) > fitDistance(400, 50, 1.6))
  assert.ok(fitDistance(500, 50, 0.5) > fitDistance(500, 50, 1.6))
  assert.ok(fitDistance(500, 50, 1.6) > 500)
})

test('a wide box is limited by its width on a narrow screen and by its height on a wide one', () => {
  assert.ok(fitDistanceBox(1000, 200, 50, 0.6) > fitDistanceBox(1000, 200, 50, 2))
  assert.ok(fitDistanceBox(300, 600, 50, 2) > fitDistanceBox(300, 100, 50, 2))
  assert.ok(fitDistanceBox(500, 500, 50, 1.6) < fitDistance(500 * Math.SQRT2, 50, 1.6) * 1.1, 'a box fits closer than the sphere round it')
})
