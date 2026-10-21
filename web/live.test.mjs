// The live page, end to end, in a real browser: a real hub serving the page, real session servers with scripted mods, and a
// headless Chrome of its own (browser-kit.mjs). Everything the person does on the page is done through its own buttons and boxes.
//   node --test --test-concurrency=1 web/live.test.mjs      (skipped when no Chrome is found; CHROME_BIN overrides)
//
// It tests the page served at PAGE ("/": web/index.html + live.js).
// (AGENT_HQ_LIVE_PAGE=/other runs it against another path). Every selector is in SEL and BTN, so a redesign changes one table.
// Waits and timeouts scale with the machine's load (browser-kit.mjs: AGENT_HQ_TEST_SLOWDOWN).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSnapshot, launchBrowser, newWorld, skip, sleep, slow, twoSessions, until } from './browser-kit.mjs'

const PAGE = process.env.AGENT_HQ_LIVE_PAGE ?? '/'

// ---- the page's parts ---------------------------------------------------------------------------------------------------

const SEL = {
  group: 'section.dg-group', // one session's team
  groupTeam: '.dg-team',
  agentCard: '.sk-agent', // a member (data-status: working | waiting | failed | done | idle | stopped)
  agentName: '.sk-agent__name',
  leadDeck: '.lc-deck',
  drawer: '.sk-drawer',
  drawerInput: '.sk-drawer input, .sk-drawer textarea',
  inboxItem: '.sk-inbox__item',
  toast: '.sk-toast',
  chip: '.hq-bar button',
  world: '.dg-world',
  live: '.hq-live',
}
// buttons are found by their text, title or aria-label
const BTN = {
  lead: '^Message lead$',
  add: '^Add an agent$',
  hide: '^Hide done agents$',
  show: '^Show done agents$',
  clear: '^Clear done agents and tasks$',
  clearYes: '^Clear$',
  fit: '^Fit everything$',
  send: '^Send$',
  stop: 'Stop agent',
  stopYes: '^Stop$',
  message: 'Message',
  addAgent: '^Add agent$',
  space: '^Space$',
  diagram: '^Diagram$',
}
const STATUS = { running: 'working', waiting: 'waiting', failed: 'failed', completed: 'done', idle: 'idle' }

/** What every test starts from: alpha (the hub) with a mixed team, beta with a small one, a browser logged in showing PAGE. */
async function openLive(t, { sessions, browserOptions, probe = false, ready = true } = {}) {
  const world = newWorld(t)
  const alphaMake = mark => buildSnapshot({
    team: 'Alpha Team',
    mark,
    agents: [['dev1', 'Mochi-chan', 'running'], ['qa1', 'Tanuki', 'waiting'], ['be1', 'Kuma-san', 'failed'], ['rev1', 'Tamago', 'completed'], ['arch1', 'Daifuku', 'idle']],
    tasks: [{ id: '1', subject: 'Search page', status: 'in_progress', owner: 'dev1', blockedBy: [] }],
  })
  const betaMake = mark => buildSnapshot({ team: 'Beta Team', mark, agents: [['dev2', 'Momo', 'running']] })
  const { alpha, beta, alphaMod, betaMod } = await twoSessions(world, sessions ?? [alphaMake, betaMake])
  const page = await launchBrowser(world, browserOptions)
  if (probe) await page.installProbe()
  await page.open(alpha.url) // the one-time code logs the browser in and redirects to /
  await until(async () => (await page.eval('location.pathname')) === '/' && (await page.eval('document.readyState')) === 'complete', 20_000, 'the login redirect')
  await sleep(slow(300))
  await page.open(`${new URL(alpha.url).origin}${PAGE}`)
  if (ready) await until(async () => (await members(page)).length > 0, 25_000, 'the page to show agent cards')
  return { world, page, alpha, beta, alphaMod, betaMod }
}

/** The members on the page, once each: `{ name, status }`. Compact cards repeat inside their hover copy, so repeats are dropped. */
async function members(page) {
  const list = await page.eval(`[...document.querySelectorAll(${JSON.stringify(SEL.agentCard)})].map(n => ({ name: (n.querySelector(${JSON.stringify(SEL.agentName)}) || n).textContent.trim(), status: n.getAttribute('data-status') }))`)
  return [...new Map(list.map(c => [c.name, c])).values()]
}

/** The centre of the first visible card whose text matches `name`, or null. */
const cardPoint = (page, name) => page.eval(`(() => { const re = new RegExp(${JSON.stringify(name)}, 'i'); const el = [...document.querySelectorAll(${JSON.stringify(SEL.agentCard)})].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).find(e => re.test(e.textContent)); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)

/** Waits until the card stops moving (the camera is still flying after Fit): two samples 150 ms apart that agree. */
async function settledPoint(page, name) {
  let before = null
  for (let i = 0; i < 60; i++) {
    const now = await cardPoint(page, name)
    if (now && before && Math.abs(now.x - before.x) < 1 && Math.abs(now.y - before.y) < 1) return now
    before = now
    await sleep(150)
  }
  throw new Error(`the card for ${name} never held still`)
}

/** Fits everything in view, waits for the camera to settle, then clicks an agent's card with a real mouse, as a person does (one retry). */
async function openCard(page, name) {
  const drawerOpen = () => page.eval(`!!document.querySelector(${JSON.stringify(SEL.drawer)})`)
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.click('button', BTN.fit)
    const point = await settledPoint(page, name)
    await page.mouseClick(point.x, point.y)
    const deadline = Date.now() + slow(2000)
    while (Date.now() < deadline) {
      if (await drawerOpen()) return
      await sleep(100)
    }
  }
  await until(drawerOpen, 5000, 'the drawer')
}

/** Types into the drawer's box and presses Send once the page has enabled it. */
async function typeAndSend(page, text) {
  await until(() => page.eval(`!!document.querySelector(${JSON.stringify(SEL.drawerInput)})`), 8000, 'the message box')
  await page.type(SEL.drawerInput, text)
  await until(() => page.eval(`[...document.querySelectorAll('button')].some(b => /${BTN.send}/i.test((b.getAttribute('aria-label') || b.textContent).trim()) && !b.disabled)`), 8000, 'the Send button to be enabled')
  await page.click('button', BTN.send)
}

/**
 * Records every toast the page shows, from inside the page (a MutationObserver), so a short-lived toast is never missed however slow
 * the machine. Returns a function that gives every distinct toast text seen so far.
 */
async function collectToasts(page) {
  await page.eval(`(() => {
    if (window.__toastSeen) return
    const seen = (window.__toastSeen = new Set())
    const read = () => document.querySelectorAll(${JSON.stringify(SEL.toast)}).forEach(e => seen.add(e.textContent))
    new MutationObserver(read).observe(document.body, { childList: true, subtree: true, characterData: true })
    read()
  })()`)
  return () => page.eval('[...window.__toastSeen]')
}

/** Waits for the scripted mod to get `n` actions and returns them; every one must carry the page's idempotency key. */
async function handled(mod, n) {
  await until(() => mod.handled.length >= n, 10_000, `the mod to get ${n} action(s)`)
  await sleep(slow(300))
  for (const h of mod.handled) assert.match(String(h.action.key), /^[A-Za-z0-9_-]{8,64}$/, 'every action carries an idempotency key')
  return mod.handled.map(h => h.action)
}

// ---- what is on the page -------------------------------------------------------------------------------------------------

test('a group per session, with its team name', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  await until(async () => (await page.eval(`document.querySelectorAll(${JSON.stringify(SEL.group)}).length`)) === 2, 15_000, 'one group per session')
  const teams = await page.eval(`[...document.querySelectorAll(${JSON.stringify(SEL.groupTeam)})].map(e => e.textContent.trim())`)
  assert.deepEqual(teams.sort(), ['Alpha Team', 'Beta Team'])
  assert.match(await page.text(), /live/i, 'the page says it is live')
})

test('a card for every agent, each in the right state', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  const seen = await until(async () => {
    const list = await members(page)
    return list.length >= 6 ? list : null // 5 members in alpha + 1 in beta
  }, 15_000, 'a card for every member')
  const statusOf = name => seen.find(c => c.name.includes(name))?.status
  assert.equal(statusOf('Mochi-chan'), STATUS.running)
  assert.equal(statusOf('Tanuki'), STATUS.waiting, 'waiting for the person')
  assert.equal(statusOf('Kuma-san'), STATUS.failed)
  assert.equal(statusOf('Tamago'), STATUS.completed)
  assert.equal(statusOf('Daifuku'), STATUS.idle)
  assert.equal(statusOf('Momo'), STATUS.running, 'beta session member')
})

test('a lead deck per session: the lead shows its team, progress and what it is doing', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  await until(async () => (await page.eval(`document.querySelectorAll(${JSON.stringify(SEL.leadDeck)}).length`)) >= 1, 15_000, 'a lead deck')
  const decks = await page.eval(`[...document.querySelectorAll(${JSON.stringify(SEL.leadDeck)})].map(e => e.getAttribute('aria-label') + ' | ' + e.innerText.replace(/\\s+/g, ' '))`)
  assert.ok(decks.some(d => /Captain Alpha Team/.test(d)), `a deck for alpha's lead: ${decks.join(' // ').slice(0, 300)}`)
  assert.ok(decks.some(d => /Captain Beta Team/.test(d)), "a deck for beta's lead")
})

test('the drawer shows one agent in full and closes with Escape', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  await openCard(page, 'Mochi-chan')
  const drawer = await page.eval(`document.querySelector(${JSON.stringify(SEL.drawer)}).innerText`)
  assert.match(drawer, /Mochi-chan/)
  assert.match(drawer, /dev1|Developer/i) // the label is set in capitals
  assert.match(drawer, /Editing|Now/i)
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await until(() => page.eval(`!document.querySelector(${JSON.stringify(SEL.drawer)})`), 5000, 'the drawer to close')
})

test('a member that leaves the page while its drawer is open stays in the drawer until the person closes it', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await openCard(page, 'Tamago')
  // the mod folds Tamago (finished more than the grace ago): the next snapshot no longer lists it
  alphaMod.make = mark => buildSnapshot({ team: 'Alpha Team', mark, agents: [['dev1', 'Mochi-chan', 'running'], ['qa1', 'Tanuki', 'waiting']] })
  alphaMod.write(2)
  await until(async () => !(await members(page)).some(m => /Tamago/.test(m.name)), 8000, 'the Tamago card to leave the page')

  assert.match(await page.eval(`document.querySelector(${JSON.stringify(SEL.drawer)})?.innerText ?? ''`), /Tamago/, 'the drawer still shows it')
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await until(() => page.eval(`!document.querySelector(${JSON.stringify(SEL.drawer)})`), 5000, 'the drawer to close')
})

// ---- the five actions ------------------------------------------------------------------------------------------------------

test('message the lead: the text reaches the mod as a lead action', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  const toasts = await collectToasts(page)
  await page.click('button', BTN.lead)
  await typeAndSend(page, 'Please prioritise checkout')
  const [action] = await handled(alphaMod, 1)
  assert.equal(action.type, 'lead')
  assert.equal(action.text, 'Please prioritise checkout')
  await until(async () => (await toasts()).some(x => /sent/i.test(x)), 8000, 'a toast saying it was sent')
})

test('message one agent, from its drawer', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await openCard(page, 'Mochi-chan')
  await typeAndSend(page, 'Use the new API')
  const [action] = await handled(alphaMod, 1)
  assert.deepEqual({ type: action.type, agent: action.agent, text: action.text }, { type: 'message', agent: 'dev1', text: 'Use the new API' })
})

test('stop an agent: only after the confirm', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await openCard(page, 'Mochi-chan')
  await page.click('button', BTN.stop)
  await sleep(slow(800))
  assert.equal(alphaMod.handled.length, 0, 'one click on "Stop agent" stops nothing')
  await page.click('.sk-confirm button', BTN.stopYes)
  const [action] = await handled(alphaMod, 1)
  assert.deepEqual({ type: action.type, agent: action.agent }, { type: 'stop', agent: 'dev1' })
})

test('add an agent: role and task reach the mod as a spawn', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod, betaMod } = await openLive(t)
  await page.click('button', BTN.add)
  await until(() => page.eval(`!!document.querySelector('[role="dialog"] textarea')`), 8000, 'the add dialog')
  await page.type('[role="dialog"] textarea', 'Build the search page')
  await until(() => page.eval(`[...document.querySelectorAll('[role="dialog"] button')].some(b => /${BTN.addAgent}/.test(b.textContent.trim()) && !b.disabled)`), 8000, 'Add agent to be enabled')
  await page.click('[role="dialog"] button', BTN.addAgent)
  const target = await until(() => (alphaMod.handled.length ? alphaMod : betaMod.handled.length ? betaMod : null), 10_000, 'a spawn to arrive')
  const [action] = await handled(target, 1)
  assert.deepEqual({ type: action.type, role: action.role, task: action.task }, { type: 'spawn', role: 'dev', task: 'Build the search page' })
})

test('hide done, show done and clear done reach the mod; hiding really hides the finished card', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await until(async () => (await members(page)).some(c => c.name.includes('Tamago')), 15_000, 'the finished card')

  await page.click('button', BTN.hide)
  await until(() => alphaMod.handled.length >= 1, 10_000, 'hide to arrive')
  assert.ok(alphaMod.handled.some(h => h.action.type === 'finished' && h.action.mode === 'hide'))
  // the mod does what the real one does: it hides finished agents in the state it writes next
  alphaMod.make = mark => buildSnapshot({ team: 'Alpha Team', mark, hideFinished: true, agents: [['dev1', 'Mochi-chan', 'running'], ['qa1', 'Tanuki', 'waiting'], ['be1', 'Kuma-san', 'failed']] })
  alphaMod.write(1)
  await until(async () => !(await members(page)).some(c => c.name.includes('Tamago')), 10_000, 'the finished card to go')
  assert.ok((await members(page)).some(c => c.name.includes('Mochi-chan')), 'running agents stay')

  await page.click('button', BTN.show)
  await until(() => alphaMod.handled.some(h => h.action.mode === 'show'), 10_000, 'show to arrive')

  await page.click('button', BTN.clear)
  await until(() => page.eval(`!!document.querySelector('[role="dialog"]')`), 5000, 'the "Clear done?" dialog')
  await page.click('[role="dialog"] button', BTN.clearYes)
  await until(() => alphaMod.handled.some(h => h.action.mode === 'clear'), 10_000, 'clear to arrive')
})

test('"Keep them" in the clear dialog sends nothing', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await page.click('button', BTN.clear)
  await until(() => page.eval(`!!document.querySelector('[role="dialog"]')`), 5000, 'the "Clear done?" dialog')
  await page.click('[role="dialog"] button', '^Keep them$')
  await sleep(slow(800))
  assert.equal(alphaMod.handled.length, 0)
  assert.equal(await page.eval(`!!document.querySelector('[role="dialog"]')`), false, 'the dialog closed')
})

test('the needs-you tile lists what waits on the person; its Message button opens the agent and sends', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await until(() => page.eval(`document.querySelectorAll(${JSON.stringify(SEL.inboxItem)}).length > 0`), 10_000, 'a needs-you item for the waiting agent')
  assert.match(await page.eval(`document.querySelector(${JSON.stringify(SEL.inboxItem)}).innerText`), /Tanuki/)
  await page.click(`${SEL.inboxItem} button`, BTN.message)
  await typeAndSend(page, 'Go ahead')
  const [action] = await handled(alphaMod, 1)
  assert.deepEqual({ type: action.type, agent: action.agent }, { type: 'message', agent: 'qa1' })
})

test('two results that arrive in one push both show as toasts', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  const now = Date.now()
  const events = [
    { n: 1, at: now, agent: 'dev1', kind: 'action', text: 'started frontend-dev-1 (Frontend)' },
    { n: 2, at: now, agent: 'dev1', kind: 'action', text: 'message sent to Mochi-chan' },
  ]
  const toasts = await collectToasts(page)
  alphaMod.make = mark => buildSnapshot({ team: 'Alpha Team', mark, events, notice: { seq: 2, ok: true, text: 'message sent to Mochi-chan' }, agents: [['dev1', 'Mochi-chan', 'running']] })
  alphaMod.write(2)
  await until(async () => {
    const seen = await toasts()
    return seen.some(x => /started frontend-dev-1/.test(x)) && seen.some(x => /message sent to Mochi-chan/.test(x))
  }, 10_000, 'both results as toasts')
})

// ---- views -------------------------------------------------------------------------------------------------------------------

test('Diagram and Space: a toggle switches views, and the 3D code loads only when Space is chosen', { skip, timeout: slow(120_000) }, async t => {
  const { page } = await openLive(t)
  const threeLoaded = () => [...page.requests.values()].some(r => /three|spaceview|starsystem|engine\.chunk/.test(r.url) && r.status === 200)
  assert.equal(threeLoaded(), false, 'the 3D code is not fetched until Space is chosen')
  await page.click('button', BTN.space)
  await until(() => threeLoaded(), 20_000, 'the 3D code to load')
  await until(() => page.eval(`!!document.querySelector('canvas')`), 20_000, 'the Space canvas')
  await page.click('button', BTN.diagram)
  await until(() => page.eval(`!!document.querySelector(${JSON.stringify(SEL.world)})`), 10_000, 'the diagram again')
})

test('without WebGL there is no Space toggle, and the diagram still works (with WebGL there is one)', { skip, timeout: slow(120_000) }, async t => {
  const toggles = page => page.eval(`[...document.querySelectorAll('button')].filter(b => /${BTN.space}/.test((b.getAttribute('aria-label') || b.textContent).trim())).length`)
  const withGl = await openLive(t)
  assert.ok((await toggles(withGl.page)) >= 1, 'a Space toggle when WebGL is on (the control for the check below)')
  const noGl = await openLive(t, { browserOptions: { webgl: false } })
  assert.equal(await toggles(noGl.page), 0, 'no Space toggle when WebGL is off')
  assert.ok((await members(noGl.page)).length >= 6, 'the diagram shows the agents')
})

test('a chip flies the view to its group', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  const transform = () => page.eval(`document.querySelector(${JSON.stringify(SEL.world)})?.style.transform ?? ''`)
  const before = await transform()
  await page.click(SEL.chip, '^beta')
  await until(async () => (await transform()) !== before, 5000, 'the view to move')
})

test('at phone width the page does not scroll sideways and still shows the agents', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t, { browserOptions: { width: 390, height: 844, mobile: true } })
  const m = await page.eval(`({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, body: document.body.scrollWidth })`)
  assert.ok(m.scroll <= m.client + 1 && m.body <= m.client + 1, `no horizontal scroll: ${m.scroll}/${m.body}px in a ${m.client}px window`)
  assert.match(await page.text(), /Mochi-chan|Alpha Team|Captain/)
})

test('a browser with no login, or an old link, is told how to get one, not shown a blank page', { skip, timeout: slow(60_000) }, async t => {
  const { world, alpha } = await openLive(t)
  const root = new URL(alpha.url).origin
  const stranger = await launchBrowser(world) // a fresh profile: no cookie
  await stranger.open(`${root}${PAGE}`)
  await until(async () => /\/hq web/i.test(await stranger.text()), 10_000, 'the instruction to run /hq web again')
  assert.doesNotMatch(await stranger.text(), /Mochi-chan/, 'no agents are shown without a login')
  await stranger.open(`${root}/?c=${'0'.repeat(32)}`) // a link that is wrong or already used
  await sleep(slow(500))
  assert.doesNotMatch(await stranger.text(), /Mochi-chan/)
  assert.match(await stranger.text(), /forbidden|\/hq web/i)
})

test('a page that loses its login says so, instead of "reconnecting" forever', { skip, timeout: slow(90_000) }, async t => {
  const { page, alpha } = await openLive(t)
  await page.send('Network.clearBrowserCookies') // the browser forgets the login
  await alpha.kill('SIGKILL') // the stream breaks; the page reconnects, and is refused
  await until(async () => /lost its login|run \/hq web again/i.test(await page.text()), 40_000, 'the lost-login message')
})

// ---- cost -----------------------------------------------------------------------------------------------------------------------

test('idle budget: at most 2 frames/s, 12 running animations and no drawing canvases while nothing is working', { skip, timeout: slow(120_000) }, async t => {
  const idle = id => buildSnapshot({ team: id, agents: [['a1', 'Mochi-chan', 'completed'], ['a2', 'Tamago', 'idle']], lead: 'idle' })
  const { page } = await openLive(t, { sessions: [() => idle('Alpha Team'), () => idle('Beta Team')], probe: true })
  await sleep(slow(3000))
  const cost = await page.idleCost(5)
  console.log(`[live idle] ${cost.framesPerSecond} frames/s (a headless Chrome draws faster than a display's 60), ${cost.animations} running animations, ${cost.canvases.length} drawing canvases (${cost.canvases.filter(c => !c.inView).length} offscreen)`)
  assert.ok(cost.framesPerSecond <= 2, `idle frames/s ${cost.framesPerSecond} must be <= 2 (running animations: ${cost.animationNames.join('; ') || 'none'})`)
  assert.ok(cost.animations <= 12, `running animations ${cost.animations} must be <= 12`)
  assert.equal(cost.canvases.length, 0, `${cost.canvases.length} canvases still draw while nothing works`)
})
