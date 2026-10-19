// The numbered activity feed.
import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { EMPTY_FEED, FEED_MAX, addEvents, statusEvents, stepEvents } from '../hooks/feed'
import { mergeAgents } from '../hooks/model'

const info = (id: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, name: id, type: 'general-purpose', description: 'x', status })
const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: content })

test('addEvents numbers events from where the feed left off and never changes the feed it was given', () => {
  const one = addEvents(EMPTY_FEED, 10, [{ agent: 'a', kind: 'tool', text: 'used Bash' }])
  const two = addEvents(one, 20, [
    { agent: 'a', kind: 'step', text: 'done: x' },
    { agent: 'b', kind: 'status', text: 'running → completed' },
  ])

  expect(two.events.map(e => [e.n, e.at, e.agent, e.kind])).toEqual([[1, 10, 'a', 'tool'], [2, 20, 'a', 'step'], [3, 20, 'b', 'status']])
  expect(two.next).toBe(4)
  expect(EMPTY_FEED).toEqual({ next: 1, events: [] })
  expect(one.events).toHaveLength(1)
  expect(addEvents(two, 30, [])).toBe(two)
})

test('addEvents keeps the newest 200 and n keeps rising across the cut', () => {
  let feed = EMPTY_FEED
  for (let i = 0; i < FEED_MAX + 25; i++) feed = addEvents(feed, i, [{ agent: 'a', kind: 'tool', text: `t${i}` }])

  expect(feed.events).toHaveLength(FEED_MAX)
  expect(feed.events[0]?.n).toBe(26)
  expect(feed.events.at(-1)?.n).toBe(FEED_MAX + 25)
  const ns = feed.events.map(e => e.n)
  expect(ns).toEqual([...ns].sort((a, b) => a - b))
  expect(new Set(ns).size).toBe(ns.length)
})

test('addEvents clips long text', () => {
  const feed = addEvents(EMPTY_FEED, 1, [{ agent: 'a', kind: 'step', text: 'y'.repeat(500) }])
  expect(feed.events[0]?.text.length).toBe(140)
})

test('statusEvents reports new agents and status changes, never the main session or an unchanged agent', () => {
  const before = mergeAgents({}, [info('a1'), info('a2')], 0)
  const after = mergeAgents(before, [info('a1', 'completed'), info('a2'), info('a3')], 5)

  expect(statusEvents(before, after)).toEqual([
    { agent: 'a1', kind: 'status', text: 'running → completed' },
    { agent: 'a3', kind: 'status', text: 'started (running)' },
  ])
  expect(statusEvents(after, after)).toEqual([])
})

test('stepEvents reports only the todos that became completed', () => {
  const before = [todo('Read', 'completed'), todo('Write', 'in_progress'), todo('Ship', 'pending')]
  const after = [todo('Read', 'completed'), todo('Write', 'completed'), todo('Ship', 'in_progress')]

  expect(stepEvents('a1', before, after)).toEqual([{ agent: 'a1', kind: 'step', text: 'done: Write' }])
  expect(stepEvents('a1', undefined, after).map(e => e.text)).toEqual(['done: Read', 'done: Write'])
  expect(stepEvents('a1', after, after)).toEqual([])
})
