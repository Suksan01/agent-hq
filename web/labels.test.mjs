import assert from 'node:assert/strict'
import test from 'node:test'

import { actionToasts, sessionNames } from './labels.js'

const sess = (session, label, team, alive = true) => ({ session, label, alive, snapshot: { team: team ? { name: team } : null } })

test('an island is named by its team, with the folder under it', () => {
  const names = sessionNames([sess('abcd1234', 'booking-app', 'Booking App Team')]).get('abcd1234')
  assert.equal(names.flag, 'Booking App Team')
  assert.equal(names.sub, 'booking-app')
  assert.equal(names.chip, 'Booking App Team') // the folder is under the title already
  assert.equal(names.prefix, 'Booking App Team')
  assert.equal(names.tag, '')
})

test('without a team the folder is the name, and nothing is said twice', () => {
  const names = sessionNames([sess('s1', 'scratch', null)]).get('s1')
  assert.deepEqual([names.flag, names.sub, names.chip, names.prefix], ['scratch', '', 'scratch', 'scratch'])
})

test('different teams in one folder, or one team in different folders, need no number; the folder tells a team name apart', () => {
  const names = sessionNames([sess('s1', 'app', 'Web Team'), sess('s2', 'app', 'API Team'), sess('s3', 'docs', 'Web Team')])
  for (const n of names.values()) assert.equal(n.tag, '')
  assert.deepEqual(['s1', 's2', 's3'].map(id => names.get(id).chip), ['Web Team · app', 'API Team', 'Web Team · docs'])
})

test('two alive sessions with the same team and folder are numbered #1 and #2 in session order, and only those', () => {
  const names = sessionNames([sess('bbbb2222', 'app', 'Web Team'), sess('aaaa1111', 'app', 'Web Team'), sess('cccc3333', 'app', 'API Team')])
  assert.equal(names.get('aaaa1111').tag, '#1')
  assert.equal(names.get('bbbb2222').tag, '#2')
  assert.equal(names.get('aaaa1111').chip, 'Web Team #1')
  assert.equal(names.get('bbbb2222').flag, 'Web Team #2')
  assert.equal(names.get('bbbb2222').prefix, 'Web Team #2')
  assert.equal(names.get('cccc3333').tag, '')
  assert.equal(names.get('cccc3333').flag, 'API Team')
})

test('a stopped island does not force a tag on the one that is alive', () => {
  const names = sessionNames([sess('aaaa1111', 'app', 'Web Team'), sess('bbbb2222', 'app', 'Web Team', false)])
  assert.equal(names.get('aaaa1111').tag, '')
  assert.equal(names.get('bbbb2222').tag, '')
})

test('a hub-less single snapshot (session null) is named too', () => {
  assert.equal(sessionNames([sess(null, 'here', 'Solo Team')]).get(null).flag, 'Solo Team')
})

// ---- toasts ----

const ev = (n, kind, text, agent = 'main') => ({ n, at: n * 1000, agent, kind, text })

test('the first look toasts nothing, however many old results the feed holds', () => {
  const events = [ev(1, 'action', 'assigned a'), ev(2, 'action', 'failed: no such agent')]
  assert.deepEqual(actionToasts(undefined, events), { toasts: [], lastN: 2 })
  assert.deepEqual(actionToasts(undefined, []), { toasts: [], lastN: 0 })
})

test('every action result after the last seen n toasts, in order, so two in one push both show', () => {
  const events = [ev(1, 'tool', 'Edit'), ev(2, 'action', 'old'), ev(3, 'action', 'message sent to Mochi-chan'), ev(4, 'tool', 'Grep'), ev(5, 'action', 'failed: Mochi-chan did not get it')]
  const { toasts, lastN } = actionToasts(2, events)
  assert.deepEqual(toasts.map(t => [t.n, t.ok, t.text]), [[3, true, 'message sent to Mochi-chan'], [5, false, 'Mochi-chan did not get it']])
  assert.equal(lastN, 5)
})

test('a result is toasted once however many pushes carry it', () => {
  const events = [ev(1, 'action', 'a'), ev(2, 'action', 'b')]
  const first = actionToasts(1, events)
  assert.equal(first.toasts.length, 1)
  assert.deepEqual(actionToasts(first.lastN, events), { toasts: [], lastN: 2 })
})

test('only action events toast, a blocked tool counts as a failure, and a restarted feed starts over silently', () => {
  assert.deepEqual(actionToasts(0, [ev(1, 'message', 'hi'), ev(2, 'status', 'running → waiting')]).toasts, [])
  assert.equal(actionToasts(0, [ev(1, 'action', 'blocked Bash: not allowed')]).toasts[0].ok, false)
  assert.deepEqual(actionToasts(50, [ev(1, 'action', 'x'), ev(2, 'action', 'y')]), { toasts: [], lastN: 2 })
})
