// The live page, end to end, in a real browser: a real hub serving web/index.html, real session servers with scripted mods, and a
// headless Chrome of its own (browser-kit.mjs). Everything the person does on the page is done through its own buttons and boxes.
//   node --test --test-concurrency=1 web/live.test.mjs      (skipped when no Chrome is found; CHROME_BIN overrides)
//
// Selectors for the page's parts are all in SEL, so a redesign changes one table. A test marked `todo` is a spec for something
// the page does not do yet: it runs and reports, but does not fail the run; remove the `todo` when it lands.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSnapshot, launchBrowser, newWorld, skip, sleep, slow, twoSessions, until } from './browser-kit.mjs'

// ---- the page's parts ---------------------------------------------------------------------------------------------------

const SEL = {
  card: '.node', // one agent
  cardName: '.name',
  cardTone: 'data-tone', // running | needs_input | done | error
  lead: '.node.lead',
  chip: 'button.fc', // an island/group chip
  tool: 'button.tb', // toolbar and panel buttons, found by their text
  drawer: 'aside.drawer',
  inbox: 'aside.inbox',
  messageBox: 'textarea',
  toast: '.toast',
  inboxRow: '.inbox-row',
  group: '.island', // one session's group
}
const BTN = { lead: 'Message lead', hide: 'Hide done', show: 'Show done', clear: 'Clear done', add: '^\\+$|Add an agent', send: '^Send$', stop: 'Stop agent', confirmStop: 'Stop it', addAgent: 'Add agent' }

/** What every test starts from: alpha (the hub) with a mixed team, beta with a small one, a browser logged in on alpha's page. */
async function openLive(t, { sessions, browserOptions, probe = false } = {}) {
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
  await page.open(alpha.url)
  // ready when the page shows an agent card (the "live" badge is not shown at phone width)
  await until(async () => (await cards(page)).length > 0, 20_000, 'the page to show agent cards')
  return { world, page, alpha, beta, alphaMod, betaMod }
}

/** Opens an agent's drawer the way a person does: fit the team in view, then click its card with the mouse. */
async function openCard(page, name) {
  await page.click(SEL.tool, 'Fit the team|^Fit$')
  await sleep(slow(400))
  await page.mouseClickOn(SEL.card, name)
}

/** Types into the message box and presses Send once the page has enabled it (the box is controlled: the click must come after its state updated). */
async function typeAndSend(page, text) {
  await until(() => page.eval(`!!document.querySelector(${JSON.stringify(SEL.messageBox)})`), 8000, 'the message box')
  await page.type(SEL.messageBox, text)
  await until(() => page.eval(`[...document.querySelectorAll(${JSON.stringify(SEL.tool)})].some(b => /^Send$/.test(b.textContent.trim()) && !b.disabled)`), 8000, 'the Send button to be enabled')
  await page.click(SEL.tool, BTN.send)
}

const cards = page => page.eval(`[...document.querySelectorAll(${JSON.stringify(SEL.card)})].map(n => ({ name: (n.querySelector(${JSON.stringify(SEL.cardName)}) || n).textContent.trim(), tone: n.getAttribute(${JSON.stringify(SEL.cardTone)}) }))`)

// ---- what is on the page -------------------------------------------------------------------------------------------------

test('a group per session, with its team name', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  await until(async () => (await page.eval(`document.querySelectorAll(${JSON.stringify(SEL.group)}).length`)) === 2, 15_000, 'one group per session')
  const text = await page.text()
  assert.match(text, /Alpha Team/)
  assert.match(text, /Beta Team/)
})

test('a card for every agent, each in the right state', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  const seen = await until(async () => {
    const list = await cards(page)
    return list.length >= 8 ? list : null // 2 leads + 5 members + 1 member
  }, 15_000, 'a card for every agent')
  const toneOf = name => seen.find(c => c.name.includes(name))?.tone
  assert.equal(toneOf('Mochi-chan'), 'running')
  assert.equal(toneOf('Tanuki'), 'needs_input', 'waiting for the person')
  assert.equal(toneOf('Kuma-san'), 'error', 'failed')
  assert.equal(toneOf('Tamago'), 'done', 'completed')
  assert.equal(toneOf('Daifuku'), 'needs_input', 'idle')
  assert.equal(toneOf('Momo'), 'running', 'beta session member')
  assert.ok(seen.some(c => c.name.includes('Captain Alpha Team')) && seen.some(c => c.name.includes('Captain Beta Team')), 'both leads')
})

test('a lead deck per session: the lead card shows its team, progress and what it is doing', { skip, todo: 'the lead deck is part of the new page', timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  const lead = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(SEL.lead)}); return el ? el.innerText : '' })()`)
  assert.match(lead, /Captain/)
  assert.match(lead, /leading|Splitting|Tech Lead/i)
  assert.match(lead, /members? working|working/i)
})

test('the drawer shows one agent in full and closes with Escape', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  await until(async () => (await cards(page)).length >= 8, 15_000, 'the cards')
  await openCard(page, 'Mochi-chan')
  await until(() => page.eval(`!!document.querySelector(${JSON.stringify(SEL.drawer)})`), 8000, 'the drawer')
  const drawer = await page.eval(`document.querySelector(${JSON.stringify(SEL.drawer)}).innerText`)
  assert.match(drawer, /Mochi-chan/)
  assert.match(drawer, /dev1|Developer/)
  assert.match(drawer, /Edit|tools/i)
  await page.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await until(() => page.eval(`!document.querySelector(${JSON.stringify(SEL.drawer)})`), 5000, 'the drawer to close')
})

// ---- the five actions ------------------------------------------------------------------------------------------------------

/** Waits for the scripted mod to get `n` actions and returns them; every one must carry the page's idempotency key. */
async function handled(mod, n) {
  await until(() => mod.handled.length >= n, 10_000, `the mod to get ${n} action(s)`)
  await sleep(slow(300))
  for (const h of mod.handled) assert.match(String(h.action.key), /^[A-Za-z0-9_-]{8,64}$/, 'every action carries an idempotency key')
  return mod.handled.map(h => h.action)
}

test('message the lead: the text reaches the mod as a lead action', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await page.click(SEL.tool, BTN.lead)
  await typeAndSend(page, 'Please prioritise checkout')
  const [action] = await handled(alphaMod, 1)
  assert.equal(action.type, 'lead')
  assert.equal(action.text, 'Please prioritise checkout')
  await until(async () => /Sent to/i.test(await page.text()), 8000, 'the page to say it was sent')
})

test('message one agent, from its drawer', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await until(async () => (await cards(page)).length >= 8, 15_000, 'the cards')
  await openCard(page, 'Mochi-chan')
  await typeAndSend(page, 'Use the new API')
  const [action] = await handled(alphaMod, 1)
  assert.deepEqual({ type: action.type, agent: action.agent, text: action.text }, { type: 'message', agent: 'dev1', text: 'Use the new API' })
})

test('stop an agent: only after the confirm', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await until(async () => (await cards(page)).length >= 8, 15_000, 'the cards')
  await openCard(page, 'Mochi-chan')
  await until(() => page.eval(`!!document.querySelector(${JSON.stringify(SEL.drawer)})`), 8000, 'the drawer')
  await page.click(SEL.tool, BTN.stop)
  await sleep(slow(800))
  assert.equal(alphaMod.handled.length, 0, 'one click on "Stop agent…" stops nothing')
  await page.click(SEL.tool, BTN.confirmStop)
  const [action] = await handled(alphaMod, 1)
  assert.deepEqual({ type: action.type, agent: action.agent }, { type: 'stop', agent: 'dev1' })
})

test('add an agent: role and task reach the mod as a spawn', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod, betaMod } = await openLive(t)
  await until(async () => (await cards(page)).length >= 8, 15_000, 'the cards')
  await page.click(SEL.tool, BTN.add)
  await until(() => page.eval(`!!document.querySelector('[role="dialog"] ${SEL.messageBox}, ${SEL.messageBox}')`), 8000, 'the add panel')
  await page.type(SEL.messageBox, 'Build the search page')
  await page.click(SEL.tool, BTN.addAgent)
  const target = await until(() => (alphaMod.handled.length ? alphaMod : betaMod.handled.length ? betaMod : null), 10_000, 'a spawn to arrive')
  const [action] = await handled(target, 1)
  assert.deepEqual({ type: action.type, role: action.role, task: action.task }, { type: 'spawn', role: 'dev', task: 'Build the search page' })
})

test('hide done, show done and clear done reach the mod; hiding really hides the finished card', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await until(async () => (await cards(page)).some(c => c.name.includes('Tamago')), 15_000, 'the finished card')

  await page.click(SEL.tool, BTN.hide)
  let [action] = await handled(alphaMod, 1)
  assert.deepEqual({ type: action.type, mode: action.mode }, { type: 'finished', mode: 'hide' })
  // the mod does what the real one does: it hides finished agents in the state it writes next
  alphaMod.make = mark => buildSnapshot({ team: 'Alpha Team', mark, hideFinished: true, agents: [['dev1', 'Mochi-chan', 'running'], ['qa1', 'Tanuki', 'waiting'], ['be1', 'Kuma-san', 'failed']] })
  alphaMod.write(1)
  await until(async () => !(await cards(page)).some(c => c.name.includes('Tamago')), 10_000, 'the finished card to go')
  assert.ok((await cards(page)).some(c => c.name.includes('Mochi-chan')), 'running agents stay')

  await page.click(SEL.tool, BTN.show)
  await until(() => alphaMod.handled.length >= 2, 10_000, 'show to arrive')
  assert.equal(alphaMod.handled[1].action.mode, 'show')

  await page.click(SEL.tool, BTN.clear)
  await sleep(slow(300))
  await page.click(SEL.tool, 'Clear\\?|Click again|Clear done') // a second click confirms
  await until(() => alphaMod.handled.some(h => h.action.mode === 'clear'), 10_000, 'clear to arrive')
})

test('the inbox lists what needs the person; its Message button opens the agent and sends', { skip, timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  await until(() => page.eval(`document.querySelectorAll(${JSON.stringify(SEL.inboxRow)}).length > 0`), 10_000, 'an inbox row for the waiting agent')
  assert.match(await page.eval(`document.querySelector(${JSON.stringify(SEL.inboxRow)}).innerText`), /Tanuki/)
  await page.click(`${SEL.inboxRow} button`, 'Message')
  await typeAndSend(page, 'Go ahead')
  const [action] = await handled(alphaMod, 1)
  assert.deepEqual({ type: action.type, agent: action.agent }, { type: 'message', agent: 'qa1' })
})

test('two results that arrive in one push both show as toasts', { skip, todo: 'one toast at a time today', timeout: slow(60_000) }, async t => {
  const { page, alphaMod } = await openLive(t)
  const now = Date.now()
  const events = [
    { n: 1, at: now, agent: 'dev1', kind: 'action', text: 'started frontend-dev-1 (Frontend)' },
    { n: 2, at: now, agent: 'dev1', kind: 'action', text: 'message sent to Mochi-chan' },
  ]
  // collect every distinct toast text while it is on screen
  const seen = new Set()
  const poll = setInterval(() => page.eval(`[...document.querySelectorAll(${JSON.stringify(SEL.toast)})].map(e => e.textContent)`).then(list => list.forEach(x => seen.add(x))).catch(() => {}), 100)
  t.after(() => clearInterval(poll))
  alphaMod.make = mark => buildSnapshot({ team: 'Alpha Team', mark, events, notice: { seq: 2, ok: true, text: 'message sent to Mochi-chan' }, agents: [['dev1', 'Mochi-chan', 'running']] })
  alphaMod.write(2)
  await until(() => [...seen].some(x => /started frontend-dev-1/.test(x)) && [...seen].some(x => /message sent to Mochi-chan/.test(x)), 10_000, 'both results as toasts')
})

// ---- views -------------------------------------------------------------------------------------------------------------------

test('Diagram and Space: a toggle switches views, and Space loads only when asked for', { skip, todo: 'the Diagram/Space toggle is part of the new page', timeout: slow(90_000) }, async t => {
  const { page } = await openLive(t)
  const threeLoaded = () => [...page.requests.values()].some(r => /three|spaceview|starsystem|lazyspace/.test(r.url) && r.status === 200)
  assert.equal(threeLoaded(), false, 'the 3D code is not fetched until Space is chosen')
  await page.click('button, [role=button]', '^Space$')
  await until(() => threeLoaded(), 15_000, 'the 3D code to load')
  await until(() => page.eval(`!!document.querySelector('canvas')`), 15_000, 'a canvas')
  await page.click('button, [role=button]', '^Diagram$')
  await until(() => page.eval(`!document.querySelector('canvas[data-space]')`), 8000, 'back on the diagram')
})

test('without WebGL there is no Space toggle, and the diagram still works (with WebGL there is one)', { skip, todo: 'the Diagram/Space toggle is part of the new page', timeout: slow(120_000) }, async t => {
  const toggles = page => page.eval(`[...document.querySelectorAll('button, [role=button]')].filter(b => /^Space$/.test(b.textContent.trim())).length`)
  const withGl = await openLive(t)
  await until(async () => (await cards(withGl.page)).length >= 8, 15_000, 'the cards (WebGL on)')
  assert.ok((await toggles(withGl.page)) >= 1, 'a Space toggle when WebGL is on (the control for the check below)')
  const noGl = await openLive(t, { browserOptions: { webgl: false } })
  await until(async () => (await cards(noGl.page)).length >= 8, 15_000, 'the cards (WebGL off)')
  assert.equal(await toggles(noGl.page), 0, 'no Space toggle when WebGL is off')
})

test('a chip flies the view to its group', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t)
  const before = await page.eval(`document.querySelector('.canvas, canvas')?.style.transform ?? ''`)
  await page.click(SEL.chip, 'beta')
  await sleep(slow(800))
  const after = await page.eval(`document.querySelector('.canvas, canvas')?.style.transform ?? ''`)
  assert.notEqual(after, before, 'the view moved')
})

test('at phone width the page does not scroll sideways and still shows the agents', { skip, timeout: slow(60_000) }, async t => {
  const { page } = await openLive(t, { browserOptions: { width: 390, height: 844, mobile: true } })
  const m = await page.eval(`({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })`)
  assert.ok(m.scroll <= m.client + 1, `no horizontal scroll: ${m.scroll}px in a ${m.client}px window`)
  assert.match(await page.text(), /Mochi-chan|Alpha Team/)
})

test('a browser with no login, or an old link, is told how to get one, not shown a blank page', { skip, timeout: slow(60_000) }, async t => {
  const { world, alpha } = await openLive(t)
  const root = new URL(alpha.url).origin
  const stranger = await launchBrowser(world) // a fresh profile: no cookie
  await stranger.open(`${root}/`)
  await until(async () => /\/hq web/i.test(await stranger.text()), 10_000, 'the instruction to run /hq web again')
  assert.doesNotMatch(await stranger.text(), /Mochi-chan/, 'no agents are shown without a login')
  await stranger.open(`${root}/?c=${'0'.repeat(32)}`) // a link that is wrong or already used
  await sleep(slow(500))
  assert.doesNotMatch(await stranger.text(), /Mochi-chan/)
  assert.match(await stranger.text(), /forbidden|\/hq web/i)
})

// ---- cost -----------------------------------------------------------------------------------------------------------------------

test('idle budget: at most 2 frames/s, 12 running animations and no drawing canvases while nothing is working', { skip, todo: 'frames keep coming while idle: infinite halo/ping animations on an idle page (see the perf report)', timeout: slow(120_000) }, async t => {
  const idle = id => buildSnapshot({ team: id, agents: [['a1', 'Mochi-chan', 'completed'], ['a2', 'Tamago', 'idle']], lead: 'idle' })
  const { page } = await openLive(t, { sessions: [() => idle('Alpha Team'), () => idle('Beta Team')], probe: true })
  await sleep(slow(3000))
  const cost = await page.idleCost(5)
  console.log(`[live idle] ${cost.framesPerSecond} frames/s, ${cost.animations} running animations, ${cost.canvases.length} drawing canvases (${cost.canvases.filter(c => !c.inView).length} offscreen)`)
  assert.ok(cost.framesPerSecond <= 2, `idle frames/s ${cost.framesPerSecond} must be <= 2`)
  assert.ok(cost.animations <= 12, `running animations ${cost.animations} must be <= 12`)
  assert.equal(cost.canvases.length, 0, `${cost.canvases.length} canvases still draw while nothing works`)
})
