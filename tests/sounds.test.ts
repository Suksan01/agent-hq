// Spec for hooks/sounds.ts: which sound a status change plays. Decisions the spec pins down:
//  - muted wins over everything; levelUp (when not muted) wins over any status change;
//  - an agent seen for the first time (prev null) plays 'start' if it is pending or running, and nothing if it is already finished;
//  - waiting and idle both mean "needs you" and only sound when the agent was running or pending before;
//  - 'killed' is the person's own doing, so it is silent; a finished agent that moves again is silent;
//  - the same status twice is silent.
import { expect, test } from 'claude-code/testing'

import type { HqStatus } from '../types'
import { soundFor } from '../hooks/sounds'

const LIVE = { muted: false }

test('a change to a finished status plays done or failed', () => {
  for (const prev of ['running', 'waiting', 'idle', 'pending'] as const) {
    expect(soundFor(prev, 'completed', LIVE), prev).toBe('done')
    expect(soundFor(prev, 'failed', LIVE), prev).toBe('failed')
  }
})

test('an agent that now needs the person plays needs_you', () => {
  expect(soundFor('running', 'waiting', LIVE)).toBe('needs_you')
  expect(soundFor('running', 'idle', LIVE)).toBe('needs_you')
  expect(soundFor('pending', 'waiting', LIVE)).toBe('needs_you')
  expect(soundFor('waiting', 'idle', LIVE)).toBeNull() // still waiting on the person
  expect(soundFor('idle', 'waiting', LIVE)).toBeNull()
})

test('a newly seen live agent plays start, a newly seen finished one nothing', () => {
  expect(soundFor(null, 'running', LIVE)).toBe('start')
  expect(soundFor(null, 'pending', LIVE)).toBe('start')
  for (const next of ['completed', 'failed', 'killed', 'waiting', 'idle'] as const) expect(soundFor(null, next, LIVE), next).toBeNull()
})

test('quiet changes stay quiet', () => {
  const all: HqStatus[] = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed']
  for (const status of all) expect(soundFor(status, status, LIVE), status).toBeNull()
  expect(soundFor('running', 'killed', LIVE)).toBeNull()
  expect(soundFor('waiting', 'running', LIVE)).toBeNull() // resumed
  expect(soundFor('pending', 'running', LIVE)).toBeNull() // start already played when it appeared
  expect(soundFor('completed', 'running', LIVE)).toBeNull()
  expect(soundFor('completed', 'failed', LIVE)).toBeNull()
  expect(soundFor('failed', 'completed', LIVE)).toBeNull()
})

test('a level up plays levelup whatever the status did', () => {
  const up = { muted: false, levelUp: true }
  expect(soundFor('running', 'completed', up)).toBe('levelup')
  expect(soundFor('running', 'running', up)).toBe('levelup')
  expect(soundFor(null, 'running', up)).toBe('levelup')
  expect(soundFor('running', 'completed', { muted: false, levelUp: false })).toBe('done')
})

test('muted plays nothing at all', () => {
  const muted = { muted: true }
  expect(soundFor('running', 'completed', muted)).toBeNull()
  expect(soundFor('running', 'failed', muted)).toBeNull()
  expect(soundFor('running', 'waiting', muted)).toBeNull()
  expect(soundFor(null, 'running', muted)).toBeNull()
  expect(soundFor('running', 'completed', { muted: true, levelUp: true })).toBeNull()
})
