import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { pausedOf, pausedSections } from './paused.js'
import { STRINGS } from './i18n.js'
import { sessionNames } from './labels.js'
import { sessionsOf } from './livemap.js'

const agent = (id, over = {}) => ({ id, parentId: 'main', name: id, nickname: id.toUpperCase(), role: 'Dev', status: 'running', isMain: false, ...over })
const lead = agent('main', { parentId: null, isMain: true, nickname: 'Lead', role: 'Tech Lead' })
const session = (agents, extra = {}) => sessionsOf({ v: 2, sessions: [{ session: 's1', label: 'app', alive: true, snapshot: { at: 5000, team: null, agents, ...extra } }] })[0]

test('Paused lists paused members with their state and how long ago they ended, and the seats never started', () => {
  const s = session([lead, agent('w'), agent('i', { status: 'idle', isPaused: true }), agent('d', { status: 'completed', isPaused: true, endedAt: 3000 }), agent('f', { status: 'failed', isPaused: true }), agent('k', { status: 'killed', isPaused: true })],
    { seats: [{ name: 'qa-2', role: 'qa', roleTitle: 'QA Engineer' }] })

  const rows = pausedOf(s, 5000)

  assert.deepEqual(rows.map(r => [r.who, r.status ?? 'seat']), [['I', 'idle'], ['D', 'done'], ['F', 'failed'], ['K', 'stopped'], ['qa-2', 'seat']])
  assert.equal(rows[1].ago, 2000)
  assert.equal(rows[0].ago, undefined) // not known: no time shown
  assert.deepEqual(rows.at(-1), { who: 'qa-2', role: 'QA Engineer', isSeat: true })
})

test('a member waiting on the person is not paused even when marked, and the lead never is', () => {
  const s = session([agent('ask', { status: 'idle', isPaused: true }), { ...lead, isPaused: true }], { inbox: [{ agent: 'ask', what: 'Bash: ls' }] })

  assert.deepEqual(pausedOf(s), [])
})

test('missing and malformed fields are tolerated: no isPaused, no seats, bad seats, bad names', () => {
  assert.deepEqual(pausedOf(session([lead, agent('a')])), [])
  const bad = session([agent('b', { status: 'idle', isPaused: true, nickname: 5, name: null })], { seats: [null, 'x', { name: 7 }, { name: 'ok', role: 'r' }] })
  assert.deepEqual(pausedOf(bad).map(r => r.who), ['', 'ok'])
})

test('hide done also hides finished members here, never the idle ones or the seats', () => {
  const s = session([agent('d', { status: 'completed', isPaused: true }), agent('i', { status: 'idle', isPaused: true })], { hideFinished: true, seats: [{ name: 's', role: 'r' }] })

  assert.deepEqual(pausedOf(s).map(r => r.who), ['I', 's'])
})

test('sections: one per session with rows, named by the session, none when empty', () => {
  const s = session([lead, agent('i', { status: 'idle', isPaused: true })])
  const empty = session([lead])

  assert.equal(pausedSections([empty], sessionNames([empty]), () => 0).length, 0)
  const [section] = pausedSections([s], sessionNames([s]), () => 0)
  assert.equal(section.key, 's1')
  assert.equal(section.rows.length, 1)
})

test('the Paused words exist in English and Thai with the same placeholders', () => {
  for (const key of ['paused.title', 'paused.notStarted', 'paused.ago']) {
    assert.ok(STRINGS.en[key] && STRINGS.th[key], key)
    assert.deepEqual(STRINGS.en[key].match(/\{\w+\}/g), STRINGS.th[key].match(/\{\w+\}/g), key)
  }
  assert.match(STRINGS.th['paused.title'], /[฀-๿]/)
})

test('the Not started pill text and the Paused greys keep at least 4.5:1 on the lightest tile they can sit on', () => {
  const css = readFileSync(new URL('./space.css', import.meta.url), 'utf8')
  const lin = c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = ([x, y, z]) => 0.2126 * lin(x) + 0.7152 * lin(y) + 0.0722 * lin(z)
  const mix = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha))
  const ratio = (x, y) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05)
  const lit = [60, 60, 80] // a tile under a bright planet or glow: the lightest we have seen
  const hover = mix([255, 255, 255], 0.06, lit) // a row under the pointer
  const idle = /--st-idle:\s*#([0-9a-f]{6})/i.exec(css)[1].match(/../g).map(h => parseInt(h, 16))
  const pill = mix(idle, 0.4, [255, 255, 255]) // .sk-pill: color-mix(var(--hue) 40%, #fff); the ghost pill has no fill of its own
  const grey = Number(/\.pz-tile \{[^}]*--sk-text-2:\s*rgba\(242,\s*242,\s*245,\s*([\d.]+)\)/.exec(css)[1])

  assert.ok(ratio(pill, hover) >= 4.5, `pill ${ratio(pill, hover).toFixed(2)}`)
  assert.ok(ratio(mix([242, 242, 245], grey, hover), hover) >= 4.5, `grey ${ratio(mix([242, 242, 245], grey, hover), hover).toFixed(2)}`)
})
