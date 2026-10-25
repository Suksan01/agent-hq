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

// ---- 3. the Tasks panel: what a screen reader gets, and the row that opens --------------------------------------------------------

test('the Tasks panel: a progressbar with its text, the status in words beside a hidden icon, and aria-expanded following a click', { skip, timeout: slow(60_000) }, async t => {
  const world = newWorld(t)
  const { alpha, alphaMod } = await twoSessions(world)
  const row = (n, status, over = {}) => ({ n, title: `Task ${n}`, status, who: null, doneBy: null, startedAt: null, doneAt: null, lastActiveAt: null, workMs: 0, costUsd: null, isPartial: false, work: [], events: [], ...over })
  const taskList = { rows: [row(1, 'done', { who: 'dev-1' }), row(2, 'waiting')], total: { done: 1, count: 2, workMs: 0, costUsd: null, isPartial: false }, removed: { workMs: 0, costUsd: 0 } }
  alphaMod.make = mark => ({ ...buildSnapshot({ team: 'Alpha Team', mark }), taskList })
  alphaMod.write(1)
  const page = await launchBrowser(world)
  await page.open(alpha.url)
  await until(() => page.eval(`!!document.querySelector('.tk-panel .tk-title')`), 15_000, 'the Tasks panel')

  const bar = await page.eval(`(() => { const b = document.querySelector('.tk-panel [role=progressbar]'); return b && { now: b.getAttribute('aria-valuenow'), max: b.getAttribute('aria-valuemax'), text: b.getAttribute('aria-valuetext') } })()`)
  assert.deepEqual(bar, { now: '1', max: '2', text: '1/2 done' })
  const statusCell = await page.eval(`(() => { const c = document.querySelectorAll('.tk-panel .tk-c-mark')[1]; return { words: c.querySelector('.tk-sr')?.textContent, iconHidden: c.querySelector('.tk-mark')?.getAttribute('aria-hidden') } })()`)
  assert.deepEqual(statusCell, { words: 'Waiting', iconHidden: 'true' }, 'the status is said in words; the glyph is hidden from a reader')

  const expanded = () => page.eval(`document.querySelectorAll('.tk-panel .tk-title')[1].getAttribute('aria-expanded')`)
  assert.equal(await expanded(), 'false')
  await page.eval(`document.querySelectorAll('.tk-panel .tk-title')[1].click()`)
  await until(async () => (await expanded()) === 'true', 5000, 'aria-expanded true after a click')
  assert.ok(await page.eval(`!!document.querySelector('.tk-panel .tk-task.is-open')`), 'the open row has its class')
  await page.eval(`document.querySelectorAll('.tk-panel .tk-title')[1].click()`)
  await until(async () => (await expanded()) === 'false', 5000, 'aria-expanded false after a second click')
})

test('the Tasks table: every row has as many cells as the header, counting colSpan, and the detail spans the whole width, also with Min folded', { skip, timeout: slow(60_000) }, async t => {
  const world = newWorld(t)
  const { alpha, alphaMod } = await twoSessions(world)
  const row = (n, status, over = {}) => ({ n, title: `Task ${n}`, status, who: null, doneBy: null, startedAt: null, lastActiveAt: null, workMs: 0, costUsd: null, isPartial: false, work: [], events: [], ...over })
  const rows = [row(1, 'done', { who: 'dev-1', workMs: 60_000, costUsd: 1.5, work: [{ who: 'dev-1', role: 'dev', step: 'build', workMs: 60_000, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 1.5, lastAt: null }] }), row(2, 'waiting')]
  const taskList = { rows, total: { done: 1, count: 2, workMs: 60_000, costUsd: 1.5, isPartial: false }, removed: { workMs: 0, costUsd: 0 } }
  alphaMod.make = mark => ({ ...buildSnapshot({ team: 'Alpha Team', mark }), taskList })
  alphaMod.write(1)
  const page = await launchBrowser(world)
  await page.open(alpha.url)
  await until(() => page.eval(`!!document.querySelector('.tk-panel .tk-title')`), 15_000, 'the Tasks panel')
  await page.eval(`document.querySelectorAll('.tk-panel .tk-title')[0].click()`)
  await until(() => page.eval(`!!document.querySelector('.tk-panel .tk-detail')`), 5000, 'the open detail row')

  const measure = () => page.eval(`(() => {
    const table = document.querySelector('.tk-table')
    const tableW = table.getBoundingClientRect().width
    const span = tr => [...tr.cells].reduce((n, c) => n + c.colSpan, 0)
    const shown = tr => [...tr.cells].filter(c => c.getBoundingClientRect().width > 0)
    const width = tr => shown(tr).reduce((w, c) => w + c.getBoundingClientRect().width, 0)
    const rows = [...table.querySelectorAll('tr')].map(tr => ({ kind: tr.closest('thead') ? 'head' : tr.closest('tfoot') ? 'foot' : tr.classList.contains('tk-detail') ? 'detail' : 'row', cells: span(tr), shown: shown(tr).length, fills: Math.abs(width(tr) - tableW) <= 1, title: Math.round(tr.querySelector('.tk-c-title')?.getBoundingClientRect().width ?? 0) }))
    return { tableW, rows }
  })()`)

  const wide = await measure()
  const head = wide.rows.find(r => r.kind === 'head')
  assert.ok(wide.rows.length >= 5, 'a header, two rows, a detail and a total')
  for (const r of wide.rows) assert.equal(r.cells, head.cells, `${r.kind}: ${r.cells} cells against the header's ${head.cells}`)
  for (const r of wide.rows) assert.ok(r.fills, `${r.kind} fills the table (wide)`)

  await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true })
  await until(async () => (await measure()).rows.find(r => r.kind === 'head').shown < head.cells, 8000, 'Min to fold away in the narrow panel')
  const narrow = await measure()
  for (const r of narrow.rows) assert.equal(r.cells, head.cells, `${r.kind} keeps its cells when narrow`)
  for (const r of narrow.rows) assert.ok(r.fills, `${r.kind} still fills the table with Min folded (narrow)`)
  const titleRow = narrow.rows.find(r => r.kind === 'row')
  assert.ok(titleRow.title >= 140, `the title cell keeps its room beside an open detail row (${titleRow.title}px, not half)`)
  assert.ok(narrow.rows.find(r => r.kind === 'detail').shown === 1, 'the detail is one cell spanning the width')
})

test('below 1100px the last Paused row stays clickable: the left column stops above the needs-you and activity stack', { skip, timeout: slow(60_000) }, async t => {
  const world = newWorld(t)
  const { alpha, alphaMod } = await twoSessions(world)
  const paused = ['p1', 'p2', 'p3', 'p4'].map(id => [id, `Idle ${id}`, 'idle', { isPaused: true }])
  const seats = [{ name: 'qa-2', role: 'qa', roleTitle: 'QA Engineer' }, { name: 'rev-2', role: 'reviewer', roleTitle: 'Code Reviewer' }]
  alphaMod.make = mark => ({ ...buildSnapshot({ team: 'Alpha Team', mark, agents: paused }), seats })
  alphaMod.write(1)
  const page = await launchBrowser(world, { width: 375, height: 812, mobile: true })
  await page.open(alpha.url)
  await until(() => page.eval(`!!document.querySelector('.pz-head')`), 15_000, 'the Paused section')
  await page.eval(`document.querySelector('.pz-head').click()`)
  await until(() => page.eval(`document.querySelectorAll('.pz-row').length === 6`), 5000, 'four members and two seats listed')

  await page.eval(`(() => { const left = document.querySelector('.hq-left'); left.scrollTop = left.scrollHeight })()`)
  await sleep(300)
  const hit = await page.eval(`(() => {
    const rows = document.querySelectorAll('.pz-row')
    const last = rows[rows.length - 1]
    const r = last.getBoundingClientRect()
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const right = document.querySelector('.hq-right').getBoundingClientRect()
    return { isLast: el?.closest('.pz-row') === last, lastBottom: r.bottom, rightTop: right.top, rightHeight: right.height }
  })()`)

  assert.ok(hit.isLast, `the last Paused row is what sits under its own centre (its bottom ${hit.lastBottom}, the stack starts at ${hit.rightTop})`)
  assert.ok(hit.lastBottom <= hit.rightTop || hit.rightHeight === 0, 'the column ends above the stack')
})
