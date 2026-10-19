import assert from 'node:assert/strict'
import test from 'node:test'

import { readFileSync } from 'node:fs'

import { FAMILIES, PLANET_COUNT, PLANET_TYPES, TYPE_NAME, assignPlanets, planetSpec, planetSvg, pulseHtml } from './planets.js'

test('every kind of world comes in every colour family', () => {
  assert.equal(PLANET_COUNT, PLANET_TYPES.length * FAMILIES.length)
  assert.ok(PLANET_COUNT >= 24)
  const specs = Array.from({ length: PLANET_COUNT }, (_, i) => planetSpec('x', i))
  assert.equal(new Set(specs.map(s => `${s.type}|${s.family}`)).size, PLANET_COUNT)
  assert.deepEqual([...new Set(specs.map(s => s.type))].sort(), [...PLANET_TYPES].sort())
  assert.deepEqual([...new Set(specs.map(s => s.family))].sort(), [...FAMILIES].sort())
  for (const s of specs) { assert.equal(s.palette.length, 4); assert.equal(s.ring, s.type === 'ringed') }
})

test('a world is the same for the same seed and index', () => {
  assert.deepEqual(planetSpec('mochi', 9), planetSpec('mochi', 9))
  assert.notDeepEqual(planetSpec('mochi', 9), planetSpec('mochi', 10))
  assert.equal(planetSpec('a', PLANET_COUNT).index, 0, 'the numbers wrap round')
  assert.equal(planetSpec('a', -1).index, PLANET_COUNT - 1)
})

test('no two agents share a world while there are free ones, and the same ids always get the same ones', () => {
  const ids = Array.from({ length: 36 }, (_, i) => `agent-${i}`) // fewer than the non-moon worlds
  const a = assignPlanets(ids)
  assert.equal(new Set(a.values()).size, 36)
  assert.deepEqual([...assignPlanets(ids)], [...a])
  for (const index of a.values()) assert.notEqual(planetSpec('x', index).type, 'moon', 'the moon kind is kept for helpers')
})

test('with more agents than worlds the numbers are reused rather than refused', () => {
  const ids = Array.from({ length: PLANET_COUNT + 12 }, (_, i) => `a${i}`)
  const a = assignPlanets(ids)
  assert.equal(a.size, PLANET_COUNT + 12)
  for (const v of a.values()) assert.ok(v >= 0 && v < PLANET_COUNT)
})

test('helpers are small moons, in a family of their own', () => {
  const a = assignPlanets(['a', 'm1', 'm2', 'm3'], new Set(['m1', 'm2', 'm3']))
  for (const id of ['m1', 'm2', 'm3']) assert.equal(planetSpec(id, a.get(id)).type, 'moon')
  assert.notEqual(planetSpec('a', a.get('a')).type, 'moon')
})

test('the first 32 agent slots are 32 different planets: kind, colour family and surface feature', () => {
  const signatures = Array.from({ length: 32 }, (_, i) => planetSpec(`agent-${i}`, i)).map(s => `${s.type}|${s.family}|${s.feature}`)
  assert.equal(new Set(signatures).size, 32)
  assert.equal(new Set(signatures.slice(0, 12).map(s => s.split('|')[0])).size, PLANET_TYPES.length, 'the first twelve slots are all the kinds')
})

test('planetSvg draws every kind, the same way every time, with a name for screen readers', () => {
  const kinds = new Set()
  for (let i = 0; i < PLANET_COUNT; i++) {
    const svg = planetSvg({ seed: `p${i}`, index: i })
    kinds.add(svg.match(/data-planet="(\w+)\|/)[1])
    assert.match(svg, /^<svg [^>]*viewBox="0 0 120 120"/)
  }
  assert.deepEqual([...kinds].sort(), [...PLANET_TYPES].sort())
  assert.equal(planetSvg({ seed: 'mochi', index: 5, state: 'working' }), planetSvg({ seed: 'mochi', index: 5, state: 'working' }))
  assert.notEqual(planetSvg({ seed: 'mochi', index: 5 }), planetSvg({ seed: 'mochi', index: 6 }))
  assert.match(planetSvg({ seed: 'mochi', index: 2 }), new RegExp(`aria-label="${TYPE_NAME.ringed}, idle"`))
  assert.match(planetSvg({ seed: 'x', label: 'Mochi "chan" <3' }), /aria-label="Mochi &#34;chan&#34; &#60;3, idle"/)
})

test('each state shows on the planet; the lead is a star and a helper a moon', () => {
  const svg = state => planetSvg({ seed: 'mochi', index: 4, state })
  assert.match(svg('working'), /#3D7BFF/)
  assert.match(svg('working'), /sk-planet__drift/)
  assert.match(svg('waiting'), /#FFB547/)
  assert.doesNotMatch(svg('waiting'), /sk-planet__/, 'the beacon is light, not motion')
  assert.match(svg('failed'), /#FF5A5F/)
  assert.match(svg('stopped'), /#7A7D88/) // drawn in greys
  for (const state of ['done', 'idle', 'failed', 'stopped']) assert.doesNotMatch(svg(state), /sk-planet__/, `${state} is completely still`)
  const star = planetSvg({ kind: 'star', seed: 'lead', state: 'working' })
  assert.match(star, /sk-planet--star/); assert.doesNotMatch(star, /sk-planet__/, 'the corona is still')
  assert.match(planetSvg({ kind: 'moon', seed: 'helper-1' }), /data-planet="moon\|/)
})

test('planets.js loads nothing and evaluates nothing', () => {
  const source = readFileSync(new URL('./planets.js', import.meta.url), 'utf8')
  for (const banned of [/\beval\(/, /new Function/, /\bfetch\(/, /XMLHttpRequest/, /https?:\/\//, /import\(/]) assert.doesNotMatch(source, banned)
})

test('no planet uses an SVG filter, and a still planet keeps its look without anything that moves', () => {
  for (const kind of ['planet', 'star', 'moon']) for (const state of ['working', 'waiting', 'done', 'failed', 'idle', 'stopped']) {
    for (let i = 0; i < 12; i++) assert.doesNotMatch(planetSvg({ seed: `s${i}`, index: i, state, kind }), /<filter|filter="/)
  }
  const still = planetSvg({ seed: 'mochi', index: 4, state: 'working', still: true })
  assert.doesNotMatch(still, /sk-planet__/)
  assert.match(still, /#3D7BFF/, 'the blue atmosphere is still drawn')
})

test('every planet turns on its own tilted axis at its own speed: 12 to 60 s a day, giants fastest, a few backwards', () => {
  const specs = Array.from({ length: PLANET_COUNT }, (_, i) => planetSpec(`agent-${i}`, i))
  for (const s of specs) {
    assert.ok(s.period >= 12 && s.period <= 60, `${s.type} period ${s.period}`)
    assert.ok(Math.abs(s.tilt) <= 0.3)
    if (['gas', 'ringed', 'storm'].includes(s.type)) assert.ok(s.period <= 24)
    if (['rocky', 'moon', 'twin', 'crystal'].includes(s.type)) assert.ok(s.period >= 36)
  }
  assert.ok(new Set(specs.map(s => s.period)).size >= 20, 'periods vary')
  const backwards = specs.filter(s => s.retrograde).length
  assert.ok(backwards > 0 && backwards < PLANET_COUNT / 3, `${backwards} retrograde`)
  assert.deepEqual(planetSpec('kepler', 3), planetSpec('kepler', 3))
})

test('the surface scrolls along the tilted axis behind fixed shading; spin can be asked for, still wins', () => {
  const spec = planetSpec('kepler', 1)
  const working = planetSvg({ seed: 'kepler', index: 1, state: 'working' })
  assert.match(working, new RegExp(`--pl-t:${spec.period}s`))
  assert.match(working, /<g transform="rotate\([-\d.]+ 60 60\)">\s*<g transform="translate[^"]*"><g class="sk-planet__drift"/)
  assert.ok(working.lastIndexOf('-s)"') > working.indexOf('sk-planet__drift'), 'the shading is drawn on top, outside the rotation')
  assert.doesNotMatch(planetSvg({ seed: 'kepler', index: 1 }), /sk-planet__drift/, 'idle does not turn')
  assert.match(planetSvg({ seed: 'kepler', index: 1, spin: 'hover' }), /sk-planet--spin-hover[\s\S]*sk-planet__drift/)
  assert.match(planetSvg({ seed: 'kepler', index: 1, spin: 'always' }), /sk-planet--spin-always/)
  assert.doesNotMatch(planetSvg({ seed: 'kepler', index: 1, state: 'working', spin: 'always', still: true }), /sk-planet__drift|sk-planet--spin/)
  const back = Array.from({ length: 40 }, (_, i) => `s${i}`).find(seed => planetSpec(seed, 1).retrograde)
  assert.match(planetSvg({ seed: back, index: 1, state: 'working' }), /animation-direction:reverse/)
})

test('the needs-you pulse lives outside the planet and moves only by opacity and scale', () => {
  const pulse = pulseHtml({ x: '40%', y: '60%', d: '52px' })
  assert.match(pulse, /^<span class="sk-planet-pulse" aria-hidden="true"/)
  assert.match(pulse, /animation:sk-attn [^;"]*,sk-breathe-fast /) // opacity, and transform: scale: nothing else
  assert.match(pulse, /left:calc\(40% - 52px \/ 2\);top:calc\(60% - 52px \/ 2\)/)
  assert.doesNotMatch(pulse, /filter|<svg/)
  assert.doesNotMatch(planetSvg({ seed: 'x', index: 3, state: 'waiting' }), /sk-planet__|animation/, 'the waiting planet itself is still')
})
