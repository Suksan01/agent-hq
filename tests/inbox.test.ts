// What waits on the person, and the status line.
import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { IDLE_LIMIT_MS, addAsk, buildInbox, describeAsk, dropAsksOf, liveAsks, removeAsk, statusText, trackWaiting } from '../hooks/inbox'
import { MAIN, mergeAgents, workingCount } from '../hooks/model'

const info = (id: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, name: id, type: 'general-purpose', description: 'x', status })

test('describeAsk names the tool and the one thing it works on, in one short line', () => {
  expect(describeAsk('Bash', { command: 'npm   test\n-- --watch' })).toBe('Bash: npm test')
  expect(describeAsk('Edit', { file_path: 'app/page.tsx', old_string: 'secret', new_string: 'x' })).toBe('Edit: page.tsx')
  expect(describeAsk('WebFetch', { url: 'https://example.com' })).toBe('WebFetch: example.com')
  expect(describeAsk('mcp__x__y', { anything: 1 })).toBe('mcp__x__y')
  expect(describeAsk('Bash', null)).toBe('Bash')
  expect(describeAsk('Bash', { command: 'x'.repeat(500) }).length).toBeLessThanOrEqual(120)
})

test('describeAsk never carries a raw command, a full path or a URL query', () => {
  const secret = describeAsk('Bash', { command: 'API_KEY=sk-x npm run deploy' })
  expect(secret).toBe('Bash: npm run')
  expect(secret).not.toContain('sk-x')
  expect(secret).not.toContain('API_KEY')
  const url = describeAsk('WebFetch', { url: 'https://x.dev/a?token=abc' })
  expect(url).toBe('WebFetch: x.dev')
  expect(url).not.toContain('token')
  expect(describeAsk('Read', { file_path: '/Users/me/.ssh/id_rsa' })).toBe('Read: id_rsa')
  expect(describeAsk('NotebookEdit', { notebook_path: '/home/me/private/a.ipynb' })).toBe('NotebookEdit: a.ipynb')
  expect(describeAsk('Bash', { command: 'curl -H "Authorization: Bearer abc" https://x.dev' })).toBe('Bash: curl')
  expect(describeAsk('Bash', { command: '/usr/bin/env FOO=bar' })).toBe('Bash: env')
  expect(describeAsk('Bash', { command: 'echo ghp_abcdef123456' })).toBe('Bash: echo')
  expect(describeAsk('WebFetch', { url: 'not a url' })).toBe('WebFetch')
})

test('asks are added and removed by tool call, and at most 50 are kept', () => {
  let asks = addAsk({}, 'u1', { agent: 'a1', since: 5, what: 'Bash: ls' })
  asks = addAsk(asks, 'u2', { agent: MAIN, since: 6, what: 'Edit: x' })
  expect(Object.keys(asks)).toEqual(['u1', 'u2'])
  expect(Object.keys(removeAsk(asks, 'u1'))).toEqual(['u2'])
  expect(removeAsk(asks, 'nope')).toEqual(asks)
  for (let i = 0; i < 60; i++) asks = addAsk(asks, `n${i}`, { agent: MAIN, since: i, what: 'x' })
  expect(Object.keys(asks)).toHaveLength(50)
  expect(asks.u1).toBeUndefined()
  expect(asks.n59).toBeDefined()
})

test('an ask of an agent that has ended is dropped; the lead stays', () => {
  const agents = mergeAgents({}, [info('a1'), info('a2', 'completed')], 0)
  const asks = {
    u1: { agent: 'a1', since: 1, what: 'x' },
    u2: { agent: 'a2', since: 2, what: 'y' },
    u3: { agent: MAIN, since: 3, what: 'z' },
    u4: { agent: 'gone', since: 4, what: 'w' },
  }
  expect(Object.keys(liveAsks(asks, agents))).toEqual(['u1', 'u3'])
})

test('trackWaiting dates a newly waiting agent once and forgets it when it stops waiting', () => {
  const waiting = mergeAgents({}, [info('a1', 'waiting'), info('a2')], 0)
  const first = trackWaiting({}, waiting, 100)
  expect(first).toEqual({ a1: 100 })
  expect(trackWaiting(first, waiting, 900)).toEqual({ a1: 100 })
  expect(trackWaiting(first, mergeAgents(waiting, [info('a1'), info('a2')], 5), 1000)).toEqual({})
})

test('the inbox lists open asks and held agents, longest waiting first, an agent once', () => {
  const agents = mergeAgents({}, [info('a1', 'waiting'), info('a2', 'waiting'), info('a3')], 0)
  const asks = { u1: { agent: 'a1', since: 50, what: 'Bash: git push' }, u2: { agent: MAIN, since: 20, what: 'Edit: x' } }

  expect(buildInbox(asks, agents, { a1: 10, a2: 30 }, 100)).toEqual([
    { agent: MAIN, since: 20, what: 'Edit: x' },
    { agent: 'a2', since: 30, what: expect.stringContaining('waiting') },
    { agent: 'a1', since: 50, what: 'Bash: git push' }, // its ask says more than "held"
  ])
  expect(buildInbox({}, mergeAgents({}, [info('a3')], 0), {}, 100)).toEqual([])
})

test('an idle teammate needs the person: dated once, listed, and counted on the status line', () => {
  const idle = mergeAgents({}, [info('a1', 'idle')], 0)
  const since = trackWaiting({}, idle, 100)

  expect(since).toEqual({ a1: 100 })
  expect(buildInbox({}, idle, since, 100)).toEqual([{ agent: 'a1', since: 100, what: 'idle, waiting for a message' }])
  // "0 working · 1 needs you", whatever the status line's emoji
  expect(statusText(workingCount(idle), buildInbox({}, idle, since, 100).length, { done: 0, total: 0 })).toBe(statusText(0, 1, { done: 0, total: 0 }))
})

test('the status line counts who works and who needs the person, and is empty when there is nothing', () => {
  expect(statusText(3, 1, { done: 0, total: 0 })).toBe('🪐 3 working · 1 needs you')
  expect(statusText(2, 0, { done: 1, total: 4 })).toBe('🪐 2 working · 1/4 tasks')
  expect(statusText(0, 2, { done: 0, total: 0 })).toBe('🪐 0 working · 2 needs you')
  expect(statusText(0, 0, { done: 0, total: 0 })).toBeUndefined()
})

test('an idle teammate needs the person only until the idle limit; a held agent and an open ask stay however long', () => {
  const agents = mergeAgents({}, [info('i1', 'idle'), info('w1', 'waiting')], 0)
  const asks = { u1: { agent: MAIN, since: 0, what: 'Bash: ls' } }
  const since = { i1: 0, w1: 0 }

  expect(buildInbox(asks, agents, since, IDLE_LIMIT_MS).map(item => item.agent)).toEqual([MAIN, 'i1', 'w1'])
  expect(buildInbox(asks, agents, since, IDLE_LIMIT_MS + 1).map(item => item.agent)).toEqual([MAIN, 'w1'])
  expect(statusText(0, buildInbox(asks, agents, since, 10 * IDLE_LIMIT_MS).length, { done: 0, total: 0 })).toBe('🪐 0 working · 2 needs you')
})

test('dropAsksOf drops every ask of one loop and keeps the others', () => {
  const asks = { u1: { agent: MAIN, since: 1, what: 'Agent' }, u2: { agent: 'a1', since: 2, what: 'Bash: ls' }, u3: { agent: MAIN, since: 3, what: 'Agent' } }
  expect(Object.keys(dropAsksOf(asks, MAIN))).toEqual(['u2'])
  expect(dropAsksOf(asks, 'nobody')).toEqual(asks)
})
