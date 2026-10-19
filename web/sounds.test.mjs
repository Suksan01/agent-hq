import assert from 'node:assert/strict'
import test from 'node:test'

import { soundSummary, soundsFor } from './sounds.js'

const agent = (id, status = 'running', level) => ({ id, status, ...(level === undefined ? {} : { xp: { level } }) })
const sessions = (agents, asks = 0, session = 's1') => [{ session, snapshot: { agents, asks } }]
const summary = (agents, asks, session) => soundSummary(sessions(agents, asks, session), snap => Array.from({ length: snap.asks }))

test('the first look is silent', () => {
  assert.deepEqual(soundsFor(undefined, summary([agent('a', 'completed')])), [])
})

test('an agent that finishes plays done, one that fails plays failed, a stopped one too', () => {
  const before = summary([agent('a'), agent('b'), agent('c')])
  assert.deepEqual(soundsFor(before, summary([agent('a', 'completed'), agent('b'), agent('c')])), ['done'])
  assert.deepEqual(soundsFor(before, summary([agent('a'), agent('b', 'failed'), agent('c')])), ['failed'])
  assert.deepEqual(soundsFor(before, summary([agent('a'), agent('b'), agent('c', 'killed')])), ['failed'])
})

test('quiet changes and agents seen finished from the start stay quiet', () => {
  const before = summary([agent('a'), agent('b', 'completed')])
  assert.deepEqual(soundsFor(before, summary([agent('a', 'waiting'), agent('b', 'completed')])), [])
  assert.deepEqual(soundsFor(before, summary([agent('a'), agent('b', 'completed'), agent('new', 'completed')])), [])
  assert.deepEqual(soundsFor(before, before), [])
})

test('a new ask on the person plays needs, but fewer asks does not', () => {
  assert.deepEqual(soundsFor(summary([agent('a')], 1), summary([agent('a')], 2)), ['needs'])
  assert.deepEqual(soundsFor(summary([agent('a')], 2), summary([agent('a')], 1)), [])
})

test('a level up plays levelup; no xp data never does', () => {
  assert.deepEqual(soundsFor(summary([agent('a', 'running', 1)]), summary([agent('a', 'running', 2)])), ['levelup'])
  assert.deepEqual(soundsFor(summary([agent('a', 'running', 2)]), summary([agent('a', 'running', 2)])), [])
  assert.deepEqual(soundsFor(summary([agent('a')]), summary([agent('a', 'running', 3)])), [])
})

test('a busy moment plays the two most important sounds, in order, each once', () => {
  const before = summary([agent('a'), agent('b'), agent('c', 'running', 1)], 0)
  const after = summary([agent('a', 'completed'), agent('b', 'failed'), agent('c', 'running', 2)], 1)
  assert.deepEqual(soundsFor(before, after), ['failed', 'needs'])
  assert.deepEqual(soundsFor(summary([agent('a'), agent('b')]), summary([agent('a', 'completed'), agent('b', 'completed')])), ['done'])
})

test('a session that has just appeared is not news', () => {
  assert.deepEqual(soundsFor(summary([agent('a')], 0, 's1'), summary([agent('a', 'completed')], 3, 's2')), [])
})
