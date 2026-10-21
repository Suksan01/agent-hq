import assert from 'node:assert/strict'
import test from 'node:test'

import { arrivals, catchUpRow, feedRows, inboxOf, newestN } from './feed.js'

const ev = (n, agent = 'a', at = n * 1000, kind = 'tool', text = `t${n}`) => ({ n, at, agent, kind, text })
const events = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ev(from + i))
const sess = (session, label, evs, agents = [{ id: 'a', nickname: 'Mochi-chan' }]) => ({ session, label, snapshot: { agents, events: evs } })

test('the first look shows nothing as new, and remembers the newest n', () => {
  assert.deepEqual(arrivals(undefined, events(1, 5)), { maxN: 5, added: [], jumped: 0, lost: 0 })
  assert.equal(newestN([]), 0)
})

test('later pushes bring the events numbered after the last one seen', () => {
  const seen = arrivals(5, events(1, 8))
  assert.deepEqual(seen.added.map(e => e.n), [6, 7, 8])
  assert.equal(seen.jumped, 3)
  assert.equal(seen.lost, 0)
  assert.equal(arrivals(8, events(1, 8)).jumped, 0)
})

test('events that fell out of the list are counted as lost, so the gap is never hidden', () => {
  const seen = arrivals(10, events(300, 500)) // only the last 200 are kept
  assert.equal(seen.jumped, 490)
  assert.equal(seen.added.length, 201)
  assert.equal(seen.lost, 289)
})

test('a feed that starts over (a smaller n) is not an arrival', () => {
  assert.deepEqual(arrivals(50, events(1, 3)), { maxN: 3, added: [], jumped: 0, lost: 0 })
})

test('"caught up" says how many came in while the page was away, and how many are too old to show', () => {
  const evs = events(1, 12)
  assert.equal(catchUpRow('s', 'web', arrivals(12, evs), evs, true), null, 'nothing new')
  assert.equal(catchUpRow('s', 'web', arrivals(9, evs), evs, false), null, 'a normal push is not a catch-up')
  assert.equal(catchUpRow('s', 'web', arrivals(9, evs), evs, true).text, '… caught up 3 events')
  assert.equal(catchUpRow('s', 'web', arrivals(11, evs), evs, true).text, '… caught up 1 event')
  const trimmed = events(300, 500)
  const row = catchUpRow('s', 'web', arrivals(10, trimmed), trimmed, false)
  assert.equal(row.text, '… caught up 490 events (289 too old to show)')
  assert.equal(row.marker, true)
  assert.ok(row.n > 500 && row.n < 501)
})

test('the feed is newest first, names the agent of each event and merges sessions', () => {
  const rows = feedRows([sess('s1', 'web', [ev(1, 'a', 100), ev(2, 'a', 300)]), sess('s2', 'api', [ev(1, 'a', 200), ev(2, 'gone', 400)])])
  assert.deepEqual(rows.map(r => [r.label, r.n, r.at]), [['api', 2, 400], ['web', 2, 300], ['api', 1, 200], ['web', 1, 100]])
  assert.equal(rows[1].agent.nickname, 'Mochi-chan')
  assert.equal(rows[0].agent, null, 'an agent that left the snapshot')
  assert.equal(new Set(rows.map(r => r.key)).size, 4)
})

test('caught-up rows sit among the events by time and only for sessions shown; the list is capped', () => {
  const web = sess('s1', 'web', events(1, 60))
  const marker = { key: 'm', session: 's1', label: 'web', n: 60.5, at: 60_000, marker: true, text: '… caught up 20 events' }
  const rows = feedRows([web], [marker, { ...marker, key: 'm2', session: 'other' }], 10)
  assert.equal(rows.length, 10)
  assert.equal(rows[0].marker, true, 'the marker is newest: same time as the last event, a higher n')
  assert.equal(rows.filter(r => r.marker).length, 1)
})

test('the inbox is what the mod sends, or else every agent waiting for approval', () => {
  const agents = [{ id: 'a', status: 'running' }, { id: 'b', status: 'waiting' }, { id: 'c', status: 'waiting' }]
  assert.deepEqual(inboxOf({ agents }), [{ agent: 'b', text: 'Needs approval', since: null }, { agent: 'c', text: 'Needs approval', since: null }])
  assert.deepEqual(inboxOf({ agents, inbox: [{ agent: 'a', what: 'Bash: rm -rf build', since: 5 }, { agent: 'a', what: 'Edit: app.ts', since: 6 }, { agent: 'zz' }] }), [{ agent: 'a', text: 'Bash: rm -rf build', since: 5 }, { agent: 'a', text: 'Edit: app.ts', since: 6 }])
  assert.deepEqual(inboxOf({ agents, inbox: [] }), [], 'an empty inbox from the mod is believed')
  assert.deepEqual(inboxOf({}), [])
})

test('in Thai the "caught up" row is Thai', async () => {
  const { setLang } = await import('./i18n.js')
  try {
    setLang('th')
    const trimmed = events(300, 500)
    assert.equal(catchUpRow('s', 'web', arrivals(10, trimmed), trimmed, false).text, '… ตามทัน 490 เหตุการณ์ (289 รายการเก่าเกินจะแสดง)')
  } finally {
    setLang('en')
  }
})
