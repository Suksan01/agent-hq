// The live page in a real browser (a headless Chrome of its own, a throwaway profile, its own debugging port; the person's
// Chrome is never touched), against a real hub and real session servers with scripted mods. Skipped when no Chrome is found
// (CHROME_BIN overrides the path). The helpers are in browser-kit.mjs.
//   node --test --test-concurrency=1 web/browser.test.mjs
//
// 1. A click whose first attempt fails (the session server is frozen, so the hub answers 503 after its forward times out) is
//    retried by the page with the SAME idempotency key, and the action runs exactly once.
// 2. The hub is killed: another session takes over, the page's event stream reconnects by itself (no new login) within its
//    backoff, and it shows live data again.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import { buildSnapshot, launchBrowser, newWorld, skip, sleep, slow, twoSessions, until } from './browser-kit.mjs'

// ---- 1. a failed first attempt is retried with the same key, and the action runs once -----------------------------------

test('a click the hub cannot deliver at first is retried with the same key and the action runs exactly once', { skip, timeout: slow(60_000) }, async t => {
  const world = newWorld(t)
  // the hub keeps the frozen session "alive" well past the freeze, as it does by default (6 s against the 3 s forward timeout): with
  // the kit's quick 1.5 s, a retry sent before the test sees the 503 and wakes the session got a final 404 "stopped" (3 runs in 10)
  const { beta, betaMod, alpha } = await twoSessions(world, undefined, { env: { AGENT_HQ_DEAD_MS: '20000' } })
  const page = await launchBrowser(world)
  await page.open(alpha.url) // the one-time code logs the browser in, then the page loads
  await until(async () => /Alpha Team/.test(await page.text()) && /Beta Team/.test(await page.text()), 15_000, 'the page showing both sessions')

  // open beta's lead's message box from its lead deck, type a message (the selectors are live.test.mjs' SEL/BTN)
  await until(() => page.eval(`[...document.querySelectorAll('.lc-deck')].some(d => /Beta/.test(d.getAttribute('aria-label')))`), 8000, "beta's lead deck")
  await page.eval(`[...document.querySelectorAll('.lc-deck')].find(d => /Beta/.test(d.getAttribute('aria-label'))).querySelector('button[aria-label="Message the lead"]').click()`)
  const box = '.sk-drawer input, .sk-drawer textarea'
  await until(() => page.eval(`!!document.querySelector(${JSON.stringify(box)})`), 8000, 'the message box')
  await page.type(box, 'hello from the browser')
  await until(() => page.eval(`[...document.querySelectorAll('button')].some(b => /^Send$/i.test((b.getAttribute('aria-label') || b.textContent).trim()) && !b.disabled)`), 5000, 'the Send button enabled')
  const toasts = new Set() // a toast is short-lived: collect each while it is on screen
  const poll = setInterval(() => page.eval(`[...document.querySelectorAll('.sk-toast')].map(e => e.textContent)`).then(list => list.forEach(x => toasts.add(x))).catch(() => {}), 100)
  t.after(() => clearInterval(poll))

  // freeze beta's server: the hub can reach its socket but gets no answer, so its forward times out and it answers 503
  beta.child.kill('SIGSTOP')
  const clickedAt = performance.now()
  await page.click('button', '^Send$')
  const posts = () => [...page.requests.values()].filter(r => r.method === 'POST' && r.url.endsWith('/action'))
  await until(() => posts().some(p => p.status === 503), 12_000, `the first attempt to be refused with 503 (POSTs so far: ${JSON.stringify(posts().map(p => ({ status: p.status, failed: p.failed, body: p.body })))}; page says: ${(await page.text()).replace(/\s+/g, ' ').slice(0, 300)})`).catch(async error => {
    throw new Error(`${error.message.split(' (POSTs')[0]} (POSTs: ${JSON.stringify(posts().map(p => ({ status: p.status, failed: p.failed, body: p.body })))}; page: ${(await page.text()).replace(/\s+/g, ' ').slice(0, 300)})`)
  })
  const firstRefusedAt = performance.now() - clickedAt
  beta.child.kill('SIGCONT') // the session is back; the page's retry (after its backoff) lands on it
  await until(() => posts().some(p => p.status === 202), 15_000, 'a retry to be accepted with 202').catch(error => {
    throw new Error(`${error.message} (POSTs: ${JSON.stringify(posts().map(p => ({ status: p.status, sentMs: Math.round(p.at - clickedAt), answeredMs: p.answeredAt && Math.round(p.answeredAt - clickedAt) })))})`)
  })
  await until(() => [...toasts].some(x => /sent/i.test(x)), 8000, `a toast saying it was sent (saw: ${[...toasts].join(' | ')})`)
  await until(() => betaMod.handled.length >= 1, 8000, 'the mod to get the action')
  await sleep(slow(2500)) // past a reprint: nothing may run twice

  const sent = posts()
  const keys = sent.map(p => JSON.parse(p.body).key)
  assert.ok(sent.length >= 2, `the page tried again (${sent.length} POSTs: ${sent.map(p => p.status ?? p.failed).join(', ')})`)
  assert.ok(keys.every(k => typeof k === 'string' && k.length >= 8), `every attempt carries a key: ${keys}`)
  assert.equal(new Set(keys).size, 1, `every attempt used the SAME key: ${keys}`)
  assert.equal(sent[0].status, 503, 'the first attempt was refused')
  assert.equal(sent.at(-1).status, 202, 'the last attempt was accepted')
  assert.equal(betaMod.handled.length, 1, `the action ran exactly once (handled: ${JSON.stringify(betaMod.handled.map(h => h.id))})`)
  assert.equal(betaMod.handled[0].action.text, 'hello from the browser')
  const queued = readFileSync(`${betaMod.statePath}.queue.jsonl`, 'utf8').split('\n').filter(Boolean)
  assert.equal(queued.length, 1, `the session queued it once, not once per attempt (${queued.length} queue lines)`)
  assert.equal(betaMod.handled[0].action.key, keys[0], 'the queued action kept the key')
  console.log(`[browser 1] first attempt answered 503 after ${firstRefusedAt.toFixed(0)} ms; ${sent.length} POSTs (${sent.map(p => p.status).join(', ')}), one key (${keys[0].slice(0, 8)}...), mod handled it once`)
})

// ---- 2. the hub dies: the page reconnects by itself and shows live data -------------------------------------------------

test('kill -9 of the hub: the page reconnects by itself within the backoff, without a new login, and shows live data again', { skip, timeout: slow(60_000) }, async t => {
  const world = newWorld(t)
  const { alpha, betaMod } = await twoSessions(world)
  // beta's member says "tick N", so a push is visible on the page whatever else the page shows
  betaMod.make = mark => buildSnapshot({ team: 'Beta Team', mark, agents: [['dev1', 'Mochi-chan', 'running', { now: `tick ${mark}` }]] })
  betaMod.write(1)
  const page = await launchBrowser(world)
  await page.open(alpha.url)
  await until(async () => (await page.text()).includes('tick 1'), 15_000, 'live data before the kill')
  const events = () => [...page.requests.values()].filter(r => r.url.endsWith('/events'))
  assert.ok(events().length >= 1)

  const killedAt = performance.now()
  await alpha.kill('SIGKILL') // alpha is the hub: the page's stream breaks
  // beta takes over the hub's port; keep writing until the page shows a write made after the takeover
  let mark = 1
  const ticker = setInterval(() => betaMod.write(++mark), 300)
  t.after(() => clearInterval(ticker))
  const firstNew = mark + 1
  await until(async () => {
    const m = /tick (\d+)/.exec(await page.text())
    return m && Number(m[1]) >= firstNew + 1
  }, 20_000, 'a write made after the takeover on the page')
  const backAt = performance.now() - killedAt
  clearInterval(ticker)
  await until(async () => !(await page.text()).includes('Captain Alpha Team'), 10_000, 'the dead session to drop off the page')

  assert.equal([...page.requests.values()].filter(r => r.status === 403).length, 0, 'no request was refused: no new login was needed')
  assert.ok(events().length >= 2, `the page opened the stream again (${events().length} /events requests)`)
  assert.ok(events().some(e => e.status === 200 && e.at > killedAt), 'the new stream was accepted')
  assert.ok(backAt < slow(15_000), `back within the backoff (${backAt.toFixed(0)} ms)`)
  console.log(`[browser 2] hub killed: live data on the page again after ${backAt.toFixed(0)} ms, ${events().length} /events requests, 0 refused`)
})
