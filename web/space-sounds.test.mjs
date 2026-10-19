import assert from 'node:assert/strict'
import test from 'node:test'

import { EVENT_PEAK, NAV_KINDS, NAV_PEAK, PEAK, SOUND_NAMES, navDirection, playEvent, playNav, renderNav, renderSound } from './space-sounds.js'

const RATE = 8000
const peakOf = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
/** Where the energy sits, from zero crossings: enough to tell low from high without an FFT. */
const crossingsHz = x => {
  let z = 0
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 !== x[i] < 0) z++
  return z / 2 / (x.length / RATE)
}

test('every event sound renders, peaks at PEAK, ends in silence and stays low', () => {
  for (const name of SOUND_NAMES) {
    const x = renderSound(name, RATE)
    assert.ok(!x.some(Number.isNaN), name)
    assert.ok(Math.abs(peakOf(x) - PEAK) < 0.01, `${name} peaks at PEAK`)
    assert.ok(Math.abs(x.at(-1)) < 0.001, `${name} ends in silence`)
    assert.ok(crossingsHz(x) < 600, `${name} sits low`)
  }
})

test('every navigation sound renders under the event level, and directions keep their order', () => {
  for (const kind of [...NAV_KINDS, 'nudge']) {
    const x = renderNav(kind, RATE)
    assert.ok(!x.some(Number.isNaN), kind)
    assert.ok(peakOf(x) <= NAV_PEAK + 1e-6 && NAV_PEAK < EVENT_PEAK, `${kind} is quieter than the events`)
  }
  const bright = move => crossingsHz(renderNav('travel', RATE, move))
  assert.ok(bright({ dz: 1 }) > bright({ dz: -1 }), 'zooming in is brighter than zooming out')
  assert.ok(bright({ dy: -0.6 }) > bright({ dy: 0.6 }), 'up is airier than down')
  assert.ok(renderNav('travel', RATE, { dx: 1.5, dz: -1.5 }).length > renderNav('travel', RATE, { dx: 0.25 }).length, 'a bigger move lasts longer')
  assert.deepEqual(navDirection({ dx: 0.6, dy: -0.1, dz: 3 }), { dx: 0.5, dy: 0, dz: 2, size: 1 })
})

test('playEvent plays the page events on the context it is given, and nothing for an unknown name', () => {
  const started = []
  const node = () => ({ connect: next => next })
  const ctx = {
    sampleRate: RATE,
    destination: {},
    createBuffer: (channels, length) => ({ length, copyToChannel() {} }),
    createBufferSource: () => ({ ...node(), start() { started.push(this.buffer.length) } }),
    createGain: () => ({ ...node(), gain: { value: 1 } }),
  }
  for (const name of ['start', 'done', 'needs', 'needs_you', 'failed', 'levelup']) assert.equal(playEvent(ctx, name), true, name)
  assert.equal(started.length, 6)
  assert.equal(playEvent(ctx, 'nope'), false)
})

test('playNav stays silent where there is no audio (no page, no click)', () => {
  assert.equal(playNav('travel'), false)
  assert.equal(playNav('nudge', { dz: 1 }), false)
  assert.equal(playNav('nope'), false)
})
