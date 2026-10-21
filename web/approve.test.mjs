// 0.7.0 page approvals, the web half: web/approve.mjs (the helper the mod's tool.check holds in), the hub's approval routes
// and SSE events, and pages.json. Real processes: a session server (which is the hub) and the helper as a child.
//   node --test web/approve.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cleanLiveDir } from './cleanup.mjs'

const WEB = dirname(fileURLToPath(import.meta.url))
const SERVER = join(WEB, 'server.mjs')
const HELPER = join(WEB, 'approve.mjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function until(check, ms = 5000, what = 'condition') {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(20)
  }
}

function call(port, { method = 'GET', path = '/', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: text }))
    })
    req.on('error', error => resolve({ status: 0, error: error.code }))
    req.end(body)
  })
}

/** A session server (it is the hub) in a temp dir, logged in: { port, cookie, statePath, dir, stop }. */
async function startHub(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hq-approve-'))
  const statePath = join(dir, 'sess1.json')
  const child = spawn(process.execPath, [SERVER, '--state', statePath, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }) })
  let out = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => (out += chunk))
  child.stderr.resume()
  const [, port, code] = await until(() => /AGENT_HQ_URL http:\/\/127\.0\.0\.1:(\d+)\/\?c=([0-9a-f]{32})/.exec(out), 5000, 'the URL line')
  const login = await new Promise(resolve => request({ host: '127.0.0.1', port, path: `/?c=${code}` }, res => (res.resume(), resolve(res.headers['set-cookie']?.[0]))).end())
  return { port: Number(port), cookie: /^(hq_\d+=[0-9a-f]{32})/.exec(login)[1], statePath, dir, origin: `http://127.0.0.1:${port}` }
}

/** /events with named events parsed: { named: [{ event, data }], close } */
function openEvents(hub) {
  const named = []
  const req = request({ host: '127.0.0.1', port: hub.port, path: '/events', headers: { cookie: hub.cookie } }, res => {
    let buffer = ''
    res.setEncoding('utf8')
    res.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const event = /^event: (.+)$/m.exec(block)?.[1]
        const data = /^data: (.*)$/m.exec(block)?.[1]
        if (event) named.push({ event, data: JSON.parse(data) })
      }
    })
  })
  req.on('error', () => {})
  req.end()
  return { named, close: () => req.destroy() }
}

/** Runs the helper: { out (stdout so far), exited (promise of the code), child }. */
function helper(hub, requestJson, { statePath = hub.statePath } = {}) {
  const child = spawn(process.execPath, [HELPER, '--state', statePath], { stdio: ['pipe', 'pipe', 'pipe'] })
  const result = { out: '', child }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => (result.out += chunk))
  child.stderr.resume()
  result.exited = new Promise(resolve => child.on('exit', code => resolve(code)))
  child.stdin.end(typeof requestJson === 'string' ? requestJson : JSON.stringify(requestJson))
  return result
}

const ask = (over = {}) => ({ id: 'toolu_01ABC', agent: 'Sam (dev1)', role: 'Developer', tool: 'Bash', input: { command: 'rm -rf build', description: 'Clean' }, cwd: '/tmp/x', lang: 'en', at: Date.now(), timeoutMs: 60000, reason: 'The path /etc/hosts is outside the working folder', setting: null, hook: null, ...over })
const answer = (hub, id, body, headers = {}) => call(hub.port, {
  method: 'POST', path: `/approval/${id}`, body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': 'application/json', cookie: hub.cookie, origin: hub.origin, 'sec-fetch-site': 'same-origin', ...headers },
})
const opened = async (stream, id = 'toolu_01ABC') => (await until(() => stream.named.find(e => e.event === 'approval' && e.data.id === id), 5000, `the approval event for ${id}`)).data
const withdrawn = (stream, id = 'toolu_01ABC') => until(() => stream.named.some(e => e.event === 'approval-withdrawn' && e.data.id === id), 5000, `${id} withdrawn`)

// ---- pages.json -------------------------------------------------------------------------------------------------------

test('pages.json in the live directory counts the open pages, on connect and disconnect (user-only file)', async t => {
  const hub = await startHub(t)
  const path = join(dirname(hub.statePath), 'pages.json') // what the mod reads: `${dirname(statePath)}/pages.json`
  const read = () => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null)
  await until(() => read()?.count === 0, 5000, 'count 0 when the hub starts')
  const a = openEvents(hub)
  await until(() => read()?.count === 1, 5000, 'count 1')
  const b = openEvents(hub)
  await until(() => read()?.count === 2, 5000, 'count 2')
  assert.ok(Math.abs(read().at - Date.now()) < 5000, 'at is a time in ms')
  assert.equal(statSync(path).mode & 0o777, 0o600)
  b.close()
  await until(() => read()?.count === 1, 5000, 'back to 1')
  a.close()
  await until(() => read()?.count === 0, 5000, 'back to 0')
})

test('the hourly tidy never takes pages.json for the state file of a session named "pages"', t => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hq-tidy-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const name of ['pages.json', 'pages.json.tmp', 'old.json']) {
    writeFileSync(join(dir, name), '{}')
    utimesSync(join(dir, name), new Date(0), new Date(0))
  }
  assert.deepEqual(cleanLiveDir(dir, { isRegistered: () => false, olderThanMs: 1000 }), ['old.json'])
})

// ---- the helper and the hub ---------------------------------------------------------------------------------------------

for (const decision of ['allow', 'deny', 'ask']) {
  test(`an answer of ${decision} on the page: the helper prints it and exits; every page is told it is gone`, async t => {
    const hub = await startHub(t)
    const stream = openEvents(hub)
    t.after(stream.close)
    await sleep(100)
    const run = helper(hub, ask())
    const card = await opened(stream)
    assert.deepEqual(Object.keys(card).sort(), ['agent', 'at', 'expiresAt', 'hook', 'id', 'input', 'label', 'reason', 'role', 'setting', 'token', 'tool'])
    assert.equal(card.agent, 'Sam (dev1)')
    assert.deepEqual(card.input, ask().input)
    assert.deepEqual([card.reason, card.setting, card.hook], [ask().reason, null, null], "the engine's reason for asking, as sent")
    assert.match(card.token, /^[0-9a-f]{32}$/)
    assert.ok(card.expiresAt > Date.now() + 50_000, 'expires about 60 s on')
    const state = await call(hub.port, { path: '/state', headers: { cookie: hub.cookie } })
    assert.ok(!state.body.includes(card.token), 'the token is never in the state envelope')

    assert.equal((await answer(hub, card.id, { token: card.token, decision })).status, 200)
    assert.equal(await run.exited, 0)
    assert.equal(run.out, `${decision}\n`)
    await withdrawn(stream)
    assert.equal((await answer(hub, card.id, { token: card.token, decision: 'allow' })).status, 409, 'a second answer (replay, double click) is refused')
  })
}

test('the answer route refuses everything but the page itself, and the approval stays open through it', async t => {
  const hub = await startHub(t)
  const stream = openEvents(hub)
  t.after(stream.close)
  await sleep(100)
  const run = helper(hub, ask())
  const card = await opened(stream)
  const good = { token: card.token, decision: 'allow' }
  const refused = [
    ['no cookie', good, { cookie: '' }, 403],
    ['a wrong cookie', good, { cookie: `hq_${hub.port}=${'0'.repeat(32)}` }, 403],
    ['no Origin', good, { origin: undefined }, 403],
    ['a cross-site Origin', good, { origin: 'http://evil.example' }, 403],
    ['another port', good, { origin: `http://127.0.0.1:${hub.port + 1}` }, 403],
    ['Origin null', good, { origin: 'null' }, 403],
    ['no Sec-Fetch-Site', good, { 'sec-fetch-site': undefined }, 403],
    ['Sec-Fetch-Site cross-site', good, { 'sec-fetch-site': 'cross-site' }, 403],
    ['Sec-Fetch-Site same-site', good, { 'sec-fetch-site': 'same-site' }, 403],
    ['Sec-Fetch-Site none', good, { 'sec-fetch-site': 'none' }, 403],
    ['a foreign Host', good, { host: 'evil.example' }, 403],
    ['a wrong token', { token: '0'.repeat(32), decision: 'allow' }, {}, 403],
    ['no token', { decision: 'allow' }, {}, 403],
    ['a decision that is not one of the three', { token: card.token, decision: 'always' }, {}, 400],
    ['not JSON', 'token=x&decision=allow', { 'content-type': 'application/x-www-form-urlencoded' }, 415],
    ['broken JSON', '{', {}, 400],
  ]
  for (const [what, body, headers, status] of refused) {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined))
    const dropped = Object.keys(headers).filter(k => headers[k] === undefined)
    const sent = await call(hub.port, {
      method: 'POST', path: `/approval/${card.id}`, body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: Object.fromEntries(Object.entries({ 'content-type': 'application/json', cookie: hub.cookie, origin: hub.origin, 'sec-fetch-site': 'same-origin', ...clean }).filter(([k]) => !dropped.includes(k))),
    })
    assert.equal(sent.status, status, what)
  }
  assert.equal((await answer(hub, 'toolu_unknown', good)).status, 404, 'an id never seen')
  assert.equal((await answer(hub, '..%2Fstate', good)).status, 404, 'a malformed id')
  assert.equal((await call(hub.port, { path: `/approval/${card.id}`, headers: { cookie: hub.cookie } })).status, 404, 'GET is not an answer')
  assert.equal(run.out, '', 'still waiting')
  assert.equal((await answer(hub, card.id, good)).status, 200, 'the page itself is heard')
  assert.equal(await run.exited, 0)
  assert.equal(run.out, 'allow\n')
})

test('two answers at once: exactly one wins, the other gets 409', async t => {
  const hub = await startHub(t)
  const stream = openEvents(hub)
  t.after(stream.close)
  await sleep(100)
  const run = helper(hub, ask())
  const card = await opened(stream)
  const both = await Promise.all([answer(hub, card.id, { token: card.token, decision: 'deny' }), answer(hub, card.id, { token: card.token, decision: 'allow' })])
  assert.deepEqual(both.map(r => r.status).sort(), [200, 409])
  await run.exited
  assert.equal(run.out, both[0].status === 200 ? 'deny\n' : 'allow\n')
})

test('the helper killed (Esc in the terminal): the approval is withdrawn and a late answer is refused', async t => {
  const hub = await startHub(t)
  const stream = openEvents(hub)
  t.after(stream.close)
  await sleep(100)
  const run = helper(hub, ask())
  const card = await opened(stream)
  run.child.kill('SIGKILL')
  await withdrawn(stream)
  assert.equal((await answer(hub, card.id, { token: card.token, decision: 'allow' })).status, 409, 'a stale id')
})

test('no answer in time: the helper prints ask and the card is withdrawn', async t => {
  const hub = await startHub(t)
  const stream = openEvents(hub)
  t.after(stream.close)
  await sleep(100)
  const run = helper(hub, ask({ timeoutMs: 400 }))
  await opened(stream)
  assert.equal(await run.exited, 0)
  assert.equal(run.out, 'ask\n')
  await withdrawn(stream)
})

test('one approval at a time: a second one is not held (ask at once), the first is untouched', async t => {
  const hub = await startHub(t)
  const stream = openEvents(hub)
  t.after(stream.close)
  await sleep(100)
  const first = helper(hub, ask())
  const card = await opened(stream)
  const second = helper(hub, ask({ id: 'toolu_02DEF' }))
  assert.equal(await second.exited, 0)
  assert.equal(second.out, 'ask\n')
  assert.ok(!stream.named.some(e => e.data.id === 'toolu_02DEF'), 'no card for the second')
  assert.equal((await answer(hub, card.id, { token: card.token, decision: 'deny' })).status, 200)
  await first.exited
  assert.equal(first.out, 'deny\n')
})

test('a page that opens while an approval waits gets it at once', async t => {
  const hub = await startHub(t)
  const run = helper(hub, ask())
  await sleep(300)
  const stream = openEvents(hub)
  t.after(stream.close)
  const card = await opened(stream)
  assert.equal((await answer(hub, card.id, { token: card.token, decision: 'allow' })).status, 200)
  await run.exited
})

test('anything the helper cannot hold for is ask at once: oversize input, bad request, unknown session, no hub', async t => {
  const hub = await startHub(t)
  const stream = openEvents(hub)
  t.after(stream.close)
  await sleep(100)
  const cases = [
    ['input over 20 KB', ask({ input: { content: 'x'.repeat(21 * 1024) } })],
    ['not JSON', '{nope'],
    ['no id', ask({ id: undefined })],
    ['a bad id', ask({ id: '../x' })],
    ['no tool', ask({ tool: '' })],
    ['a timeout past 60 s', ask({ timeoutMs: 600_000 })],
    ['a reason that is not text', ask({ reason: 42 })],
    ['a setting that is not a name', ask({ setting: { x: 1 } })],
    ['a reason past 2000 characters', ask({ reason: 'r'.repeat(2001) })],
  ]
  for (const [what, body] of cases) {
    const run = helper(hub, body)
    assert.equal(await run.exited, 0, what)
    assert.equal(run.out, 'ask\n', what)
  }
  const stranger = helper(hub, ask(), { statePath: join(hub.dir, 'nobody.json') })
  await stranger.exited
  assert.equal(stranger.out, 'ask\n', 'a session the hub does not know')
  const noHub = helper(hub, ask(), { statePath: join(mkdtempSync(join(tmpdir(), 'agent-hq-nohub-')), 'x.json') })
  await noHub.exited
  assert.equal(noHub.out, 'ask\n', 'no hub at all')
  assert.equal(stream.named.length, 0, 'no card was shown for any of them')
})

// ---- the card on the page -------------------------------------------------------------------------------------------------

test('visibleText marks control, bidi and zero-width characters and leaves real text (Thai marks, emoji) alone', async () => {
  const { visibleText } = await import('./approvalmarks.js')
  assert.equal(visibleText('a\u{202E}b\u{200B}c\u0085d\u007Fe\u{FEFF}f\u{2066}g\u{2028}h\u{E0041}i'), 'a⟦U+202E⟧b⟦U+200B⟧c⟦U+0085⟧d⟦U+007F⟧e⟦U+FEFF⟧f⟦U+2066⟧g⟦U+2028⟧h⟦U+E0041⟧i')
  assert.equal(visibleText('แก้ไข view.tsx ✓ 🚀 <b>x</b> "\\n"'), 'แก้ไข view.tsx ✓ 🚀 <b>x</b> "\\n"')
  assert.equal(visibleText(JSON.stringify({ cmd: 'a\nb\tc\u0007' }, null, 2)), JSON.stringify({ cmd: 'a\nb\tc\u0007' }, null, 2), 'JSON already escapes C0 controls, newlines and tabs')
})

const { buildSnapshot, launchBrowser, newWorld, skip, slow, twoSessions } = await import('./browser-kit.mjs')
const { STRINGS } = await import('./i18n.js')

/** The live page (alpha is the hub) and a way to run the helper for alpha's session. */
async function openPage(t, { lang, ...browserOptions } = {}) {
  const world = newWorld(t)
  const alphaMake = () => ({ ...buildSnapshot({ team: 'Alpha Team' }), ...(lang ? { lang } : {}) })
  const { alpha } = await twoSessions(world, [alphaMake, 'Beta Team'])
  const page = await launchBrowser(world, browserOptions)
  await page.open(alpha.url)
  await until(async () => (await page.eval('location.pathname')) === '/' && (await page.eval(`document.querySelectorAll('.lc-deck').length === 2`)), slow(25_000), 'the page')
  const run = req => helper({}, req, { statePath: join(world.dir, 'alpha.json') })
  return { page, run }
}
const CARD = `document.querySelector('.ap-card')`
const buttonOf = label => `[...${CARD}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`
const armed = (page, label) => until(() => page.eval(`!!${buttonOf(label)} && !${buttonOf(label)}.disabled`), slow(5000), `${label} enabled`)
const TRICKY = { command: 'echo <img src=x onerror="window.__pwned=1"> \u{202E}gnp.exe\u{200B}', note: 'line one\nline two\u0085' }

test('the approval card: who, which tool, the exact input as text with hidden characters shown, a countdown; Allow answers allow', { skip, timeout: slow(60_000) }, async t => {
  const { page, run } = await openPage(t)
  await page.eval(`new MutationObserver((_, o) => { const c = document.querySelector('.ap-card'); if (c) { window.__firstDisabled = [...c.querySelectorAll('button')].map(b => b.disabled); o.disconnect() } }).observe(document.body, { childList: true, subtree: true })`)
  const allow = run(ask({ input: TRICKY, reason: '<b>outside</b> the working folder', setting: 'permissions.ask', hook: null }))
  await until(() => page.eval(`!!${CARD}`), slow(10_000), 'the card')
  const seen = await page.eval(`(() => {
    const c = ${CARD}, pre = c.querySelector('pre'), title = document.getElementById(c.getAttribute('aria-labelledby'))
    return { role: c.getAttribute('role'), title: title?.textContent, text: c.innerText, pre: pre.textContent, markup: c.querySelectorAll('img, b').length,
      reason: c.querySelector('.ap-reason')?.textContent, reasonFirst: Boolean(c.querySelector('.ap-reason')?.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING),
      buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim()), focusInCard: c.contains(document.activeElement), focusOnButton: document.activeElement?.tagName === 'BUTTON',
      disabledAtFirst: window.__firstDisabled?.length === 3 && window.__firstDisabled.every(Boolean), preTab: pre.tabIndex }
  })()`)
  assert.equal(seen.role, 'alertdialog')
  assert.equal(seen.title, 'Needs your approval')
  assert.match(seen.text, /Sam \(dev1\) wants to use Bash/)
  assert.match(seen.text, /Developer/i)
  assert.match(seen.text, /\d+s left/)
  assert.ok(seen.pre.includes('<img src=x onerror=\\"window.__pwned=1\\">'), 'the HTML is shown as its text')
  assert.equal(seen.markup, 0)
  assert.equal(seen.reason, 'Claude Code asks because: <b>outside</b> the working folder (setting permissions.ask)', 'the reason, as text, with the setting that asks')
  assert.ok(seen.reasonFirst, 'the reason comes above the input')
  assert.ok(seen.pre.includes('⟦U+202E⟧gnp.exe⟦U+200B⟧'), `bidi and zero-width shown: ${seen.pre}`)
  assert.ok(seen.pre.includes('line two⟦U+0085⟧'), 'a C1 control shown')
  assert.ok(!/[\u{202E}\u{200B}\u0085]/u.test(seen.pre), 'none of them left raw')
  assert.match(seen.text, /Hidden characters are shown as/)
  assert.deepEqual(seen.buttons, ['Allow', 'Deny', 'Ask in terminal now'])
  assert.ok(seen.focusInCard && !seen.focusOnButton, 'the card takes the focus, never a button (no stray Enter allows)')
  assert.ok(seen.disabledAtFirst, 'the buttons arm a moment after the card appears')
  assert.equal(seen.preTab, 0, 'a long input scrolls with the keyboard')
  assert.equal(await page.eval('window.__pwned'), undefined)

  await armed(page, 'Allow')
  await page.mouseClickOn('.ap-card button', '^Allow$')
  assert.equal(await allow.exited, 0)
  assert.equal(allow.out, 'allow\n')
  await until(async () => !(await page.eval(`!!${CARD}`)), slow(5000), 'the card gone')

  // Deny from the keyboard; then a helper that goes away takes its card with it
  const deny = run(ask({ id: 'toolu_02' }))
  await until(() => page.eval(`!!${CARD}`), slow(10_000), 'the second card')
  await armed(page, 'Deny')
  await page.eval(`${buttonOf('Deny')}.focus()`)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await deny.exited
  assert.equal(deny.out, 'deny\n')
  const gone = run(ask({ id: 'toolu_03' }))
  await until(() => page.eval(`!!${CARD}`), slow(10_000), 'the third card')
  gone.child.kill('SIGKILL')
  await until(async () => !(await page.eval(`!!${CARD}`)), slow(5000), 'the card withdrawn with its helper')
})

test('the card in Thai at phone width: Thai words, fits the screen, still under reduced motion; "Ask in terminal now" answers ask', { skip, timeout: slow(60_000) }, async t => {
  const { page, run } = await openPage(t, { lang: 'th', width: 390, height: 844, mobile: true })
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const th = STRINGS.th
  const asked = run(ask({ lang: 'th', input: { command: 'x'.repeat(400) }, reason: 'ฮุกขอให้ถาม', hook: 'guard' }))
  await until(() => page.eval(`!!${CARD}`), slow(10_000), 'the card')
  const seen = await page.eval(`(() => {
    const c = ${CARD}, r = c.getBoundingClientRect()
    return { text: c.innerText, buttons: [...c.querySelectorAll('button')].map(b => b.textContent.trim()), left: r.left, right: r.right, vw: innerWidth, scroll: document.documentElement.scrollWidth - innerWidth,
      moving: [c, ...c.querySelectorAll('*')].filter(e => getComputedStyle(e).animationName !== 'none').length }
  })()`)
  assert.match(seen.text, new RegExp(th['approval.title']))
  assert.match(seen.text, new RegExp(th['approval.wants'].replace('{agent}', 'Sam \\(dev1\\)').replace('{tool}', 'Bash')))
  assert.deepEqual(seen.buttons, [th['approval.allow'], th['approval.deny'], th['approval.terminal']])
  assert.ok(seen.text.includes(`${th['approval.because'].replace('{reason}', 'ฮุกขอให้ถาม')} (${th['approval.hook'].replace('{name}', 'guard')})`), `the reason in Thai: ${seen.text}`)
  for (const key of ['approval.title', 'approval.allow', 'approval.deny', 'approval.terminal']) assert.ok(!seen.text.includes(STRINGS.en[key]), `no English "${STRINGS.en[key]}"`)
  assert.ok(seen.left >= 15 && seen.right <= seen.vw - 15, `inside the screen with a 16px gutter (${seen.left}..${seen.right} of ${seen.vw})`)
  assert.ok(seen.scroll <= 0, 'no sideways scroll')
  assert.equal(seen.moving, 0, 'nothing animates under reduced motion')
  await armed(page, th['approval.terminal'])
  await page.eval(`${buttonOf(th['approval.terminal'])}.click()`)
  await asked.exited
  assert.equal(asked.out, 'ask\n')
})
