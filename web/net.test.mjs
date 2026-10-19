// Tests for web/net.js: a click is sent with one key however often it is retried, and a stream the server ended is opened again.
//   node --test web/net.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { connectEvents, newKey, postAction } from './net.js'

const KEY = /^[A-Za-z0-9_-]{1,64}$/
const answers = (...list) => {
  const sent = []
  const fetch = async (url, init) => {
    sent.push({ url, ...init, body: JSON.parse(init.body) })
    const next = list[Math.min(sent.length, list.length) - 1]
    if (next === 'down') throw new Error('network')
    return { ok: next >= 200 && next < 300, status: next }
  }
  return { fetch, sent }
}
const noWait = () => {
  const waits = []
  return { wait: async ms => void waits.push(ms), waits }
}

test('a key is 1-64 of letters, digits, _ and -, and differs per call', () => {
  assert.match(newKey(), KEY)
  assert.notEqual(newKey(), newKey())
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
  try {
    assert.match(newKey(), KEY, 'without crypto')
  } finally {
    Object.defineProperty(globalThis, 'crypto', original)
  }
})

test('a click is sent once with a key when the server takes it', async () => {
  const { fetch, sent } = answers(202)

  const result = await postAction({ type: 'lead', text: 'hi' }, { fetch })

  assert.deepEqual(result, { ok: true, status: 202 })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, '/action')
  assert.equal(sent[0].method, 'POST')
  assert.match(sent[0].body.key, KEY)
  assert.deepEqual({ ...sent[0].body, key: undefined }, { type: 'lead', text: 'hi', key: undefined })
})

test('503, 429 and a network error are retried with the same key, then succeed', async () => {
  const { fetch, sent } = answers(503, 'down', 202)
  const { wait, waits } = noWait()

  const result = await postAction({ type: 'lead', text: 'hi' }, { fetch, wait })

  assert.equal(result.ok, true)
  assert.equal(sent.length, 3)
  assert.equal(new Set(sent.map(s => s.body.key)).size, 1, 'one key for the whole click')
  assert.deepEqual(waits, [300, 600])
  const again = answers(429, 202)
  assert.equal((await postAction({ type: 'x' }, { fetch: again.fetch, wait })).ok, true)
  assert.equal(again.sent.length, 2)
})

test('after the retries the failure is reported with the last status', async () => {
  const { fetch, sent } = answers(503)
  assert.deepEqual(await postAction({ type: 'x' }, { fetch, wait: noWait().wait }), { ok: false, status: 503 })
  assert.equal(sent.length, 3, 'one try and two retries')
  const down = answers('down')
  assert.deepEqual(await postAction({ type: 'x' }, { fetch: down.fetch, wait: noWait().wait }), { ok: false, status: 0 })
})

test('a 400 or a 404 is final: no retry', async () => {
  for (const status of [400, 403, 404]) {
    const { fetch, sent } = answers(status)
    assert.deepEqual(await postAction({ type: 'x' }, { fetch, wait: noWait().wait }), { ok: false, status })
    assert.equal(sent.length, 1, String(status))
  }
})

test('two clicks get two keys', async () => {
  const { fetch, sent } = answers(202)
  await postAction({ type: 'x' }, { fetch })
  await postAction({ type: 'x' }, { fetch })
  assert.notEqual(sent[0].body.key, sent[1].body.key)
})

/** A fake EventSource that tests drive by hand, a fake clock, and a probe whose answer the test sets. */
function harness() {
  const sources = []
  class FakeSource {
    constructor(url) {
      this.url = url
      this.readyState = 0
      sources.push(this)
    }
    close() {
      this.readyState = 2
      this.closed = true
    }
  }
  const timers = []
  const h = {
    sources,
    timers,
    status: 200, // what the probe answers
    probes: 0,
    options: {
      EventSource: FakeSource,
      setTimeout: (fn, ms) => (timers.push({ fn, ms, live: true }), timers.length),
      clearTimeout: id => void (timers[id - 1].live = false),
      random: () => 0.5,
      probe: async () => (h.probes++, h.status),
    },
    fire: () => {
      const next = timers.find(t => t.live)
      next.live = false
      next.fn()
    },
    /** the newest stream ends for good, and the probe's answer is taken in */
    end: async (readyState = 2) => {
      const source = sources.at(-1)
      source.readyState = readyState
      source.onerror()
      await new Promise(resolve => setImmediate(resolve))
    },
  }
  return h
}

test('a stream that ended (readyState CLOSED) is opened again after 1 s, then 2 s, 4 s, up to 30 s', async () => {
  const h = harness()
  const errors = []
  connectEvents('/events', { onError: reason => errors.push(reason) }, h.options)
  assert.equal(h.sources.length, 1)

  for (const expected of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
    await h.end()
    assert.equal(h.timers.at(-1).ms, expected)
    h.fire()
  }
  assert.equal(h.sources.length, 8)
  assert.equal(h.sources.at(-1).url, '/events')
  assert.deepEqual(errors, Array(7).fill(undefined), 'the page is told of every error, with no reason')
})

test('while the browser retries by itself (CONNECTING) nothing is scheduled and nothing is probed', async () => {
  const h = harness()
  connectEvents('/events', {}, h.options)
  await h.end(0)
  assert.equal(h.timers.length, 0)
  assert.equal(h.probes, 0)
})

test('the wait starts over after a message or an open, and has jitter', async () => {
  const h = harness()
  const seen = []
  connectEvents('/events', { onMessage: e => seen.push(e.data) }, { ...h.options, random: () => 0 })
  await h.end()
  assert.equal(h.timers[0].ms, 800, 'jitter shortens the wait to 80%')
  h.fire()
  await h.end()
  assert.equal(h.timers[1].ms, 1600)
  h.fire()
  h.sources[2].onmessage({ data: 'x' })
  await h.end()
  assert.equal(h.timers[2].ms, 800, 'back to the first wait')
  assert.deepEqual(seen, ['x'])
  const high = harness()
  connectEvents('/events', {}, { ...high.options, random: () => 1 })
  await high.end()
  assert.equal(high.timers[0].ms, 1200)
})

test('three 403s in a row mean the login is lost: reconnecting stops and the page is told why', async () => {
  const h = harness()
  const errors = []
  connectEvents('/events', { onError: reason => errors.push(reason) }, h.options)
  h.status = 403

  await h.end()
  h.fire()
  await h.end()
  h.fire()
  assert.equal(h.sources.length, 3)
  await h.end()

  assert.deepEqual(errors, [undefined, undefined, undefined, 'login-lost'])
  assert.equal(h.timers.filter(t => t.live).length, 0, 'no further reconnect')
  assert.equal(h.sources.length, 3)
  assert.equal(h.probes, 3)
})

test('a 403 followed by anything else, or by an open, starts the count over; other failures keep the backoff', async () => {
  const h = harness()
  const errors = []
  connectEvents('/events', { onError: reason => errors.push(reason) }, h.options)
  h.status = 403
  await h.end()
  h.fire()
  await h.end()
  h.fire()
  h.status = 429 // not a lost login
  await h.end()
  h.fire()
  h.status = 403
  await h.end()
  h.fire()
  await h.end()
  h.fire()
  h.sources.at(-1).onopen()
  await h.end()
  assert.ok(!errors.includes('login-lost'))
  assert.equal(h.timers.filter(t => t.live).length, 1, 'still reconnecting')
  const fails = harness()
  connectEvents('/events', {}, { ...fails.options, probe: async () => Promise.reject(new Error('down')) })
  await fails.end()
  assert.equal(fails.timers.length, 1, 'a probe that fails counts as not-403 and the backoff goes on')
})

test('closing stops the stream, a waiting reconnect and an answer still on its way', async () => {
  const h = harness()
  const close = connectEvents('/events', {}, h.options)
  await h.end()
  close()
  assert.equal(h.timers[0].live, false)
  assert.equal(h.sources[0].closed, true)
  h.sources[0].onerror() // a late error after close
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.timers.length, 1)

  const late = harness()
  const closeLate = connectEvents('/events', {}, late.options)
  late.sources[0].readyState = 2
  late.sources[0].onerror()
  closeLate() // closed while the probe is out
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(late.timers.length, 0, 'nothing scheduled after close')
})
