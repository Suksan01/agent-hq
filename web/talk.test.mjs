// 0.6.0 on the live page, in a real browser (browser-kit.mjs: a real hub, scripted mods, a headless Chrome of its own):
// the page in the snapshot's language (Thai), each agent's "what I'm doing" sentence on its card, and talk bubbles over the
// cards in the Diagram and Space views. Skipped when no Chrome is found (CHROME_BIN overrides).
//   node --test --test-concurrency=1 web/talk.test.mjs
// AGENT_HQ_SHOT_DIR=<folder> also saves a screenshot of the Thai page there.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildSnapshot, launchBrowser, newWorld, skip, sleep, slow, twoSessions, until } from './browser-kit.mjs'
import { STRINGS } from './i18n.js'

const LONG = 'Working on the old API and fixing its issues, then the search page and its slow queries too' // 90 characters

/** A snapshot with `lang`, a sentence per agent id (`says`), `bubbles`, and `over` merged into agents by id. */
function snapshot({ team, agents, lang, says = {}, bubbles, over = {}, roleTitle = 'Developer' }) {
  const snap = buildSnapshot({ team, agents, roles: [{ id: 'dev', title: roleTitle, count: 5, active: 1 }] })
  const rows = snap.agents.map(a => ({ ...a, ...(over[a.id] ?? {}), ...(a.id in says ? { says: says[a.id] } : {}) }))
  return { ...snap, agents: rows, ...(lang ? { lang } : {}), ...(bubbles ? { bubbles } : {}) }
}

/** Two sessions (alpha is the hub), a browser logged in and showing the page. */
async function openPage(t, makes) {
  const world = newWorld(t)
  const { alpha, alphaMod, betaMod } = await twoSessions(world, makes)
  const page = await launchBrowser(world)
  await page.open(alpha.url)
  await until(async () => (await page.eval('location.pathname')) === '/' && (await page.eval('document.readyState')) === 'complete', 20_000, 'the login redirect')
  await sleep(slow(300))
  await page.open(`${new URL(alpha.url).origin}/`)
  await until(() => page.eval(`document.querySelectorAll('.sk-agent').length > 0`), 25_000, 'the page to show agent cards')
  return { page, alphaMod, betaMod }
}

/** The first agent card whose name is `name`, as an expression for page.eval (member cards are found by name, as a person does). */
const card = name => `[...document.querySelectorAll('.sk-agent')].find(c => c.querySelector('.sk-agent__name')?.textContent === ${JSON.stringify(name)})`

// ---- the status sentence ------------------------------------------------------------------------------------------------------

test("each agent's sentence is a line above its tool line, clamped to two lines; the lead's deck and the drawer show it too", { skip, timeout: slow(60_000) }, async t => {
  const now = Date.now()
  const alpha = () => snapshot({
    team: 'Alpha Team',
    agents: [['dev1', 'Sam', 'running'], ['qa1', 'Tanuki', 'running']],
    says: { main: 'Waiting for 2 of 2 members', dev1: LONG, qa1: null },
    over: { dev1: { activity: { text: 'Editing view.tsx', since: now } }, qa1: { activity: { text: 'Running npm test', since: now } } },
  })
  const { page } = await openPage(t, [alpha, 'Beta Team'])
  await until(() => page.eval(`!!${card('Sam')}?.querySelector('.sk-agent__says')`), 10_000, "Sam's sentence")
  const line = await page.eval(`(() => {
    const says = ${card('Sam')}.querySelector('.sk-agent__says'), tool = ${card('Sam')}.querySelector('.sk-agent__activity')
    const css = getComputedStyle(says)
    return { text: says.textContent, clamp: css.webkitLineClamp, lines: says.offsetHeight / parseFloat(css.lineHeight), before: Boolean(says.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING) }
  })()`)
  assert.equal(line.text, LONG)
  assert.equal(line.clamp, '2', 'clamped to two lines')
  assert.ok(line.lines <= 2.05, `at most two lines high (${line.lines.toFixed(2)})`)
  assert.ok(line.before, 'the sentence comes before the tool line')
  assert.equal(await page.eval(`${card('Tanuki')}.querySelector('.sk-agent__says')`), null, 'no line when the mod sends null')

  const deck = `[...document.querySelectorAll('.lc')].find(l => /Captain Alpha/.test(l.textContent))`
  assert.equal(await page.eval(`${deck}.querySelector('.lc-says')?.textContent`), 'Waiting for 2 of 2 members', "the lead's sentence on its deck")
  await page.eval(`${deck}.querySelector('button[aria-label="Message the lead"]').click()`)
  await until(() => page.eval(`document.querySelector('.sk-drawer .sk-agent__says')?.textContent === 'Waiting for 2 of 2 members'`), 8000, "the lead's sentence in the drawer")
})

// ---- talk bubbles ---------------------------------------------------------------------------------------------------------------

test('bubbles: on the card they name, with direction and the other party, outside the measured card, gone when the snapshot drops them', { skip, timeout: slow(60_000) }, async t => {
  let bubbles = []
  const alpha = () => snapshot({ team: 'Alpha Team', agents: [['dev1', 'Sam', 'running'], ['qa1', 'Tanuki', 'running'], ['rev1', 'Tamago', 'completed']], bubbles })
  const { page, alphaMod } = await openPage(t, [alpha, 'Beta Team'])
  await sleep(slow(800)) // the cards measured and laid out
  const places = () => page.eval(`[...document.querySelectorAll('.dg-node')].map(n => n.style.left + ',' + n.style.top + ',' + n.querySelector('.dg-measure').offsetWidth + 'x' + n.querySelector('.dg-measure').offsetHeight).join(' ')`)
  const before = await places()

  bubbles = [
    { agent: 'dev1', other: 'main', dir: 'from', text: 'fix the old API', at: Date.now() },
    { agent: 'qa1', other: 'dev1', dir: 'to', text: 'can you check the API tests?', at: Date.now() },
  ]
  alphaMod.write(1)
  await until(() => page.eval(`document.querySelectorAll('.sk-bubble').length === 2`), 10_000, 'two bubbles')
  // a push about something else, three seconds on, redraws the cards: the bubble's fade keeps its own pace (still lit at 6 s * 85%)
  await sleep(3000)
  alphaMod.write(3)
  await sleep(300)
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('.sk-bubble')).opacity`), '1', 'still lit after a redraw')
  const seen = await page.eval(`(() => [${card('Sam')}, ${card('Tanuki')}, ${card('Tamago')}].map(c => {
    const b = c?.closest('.dg-node')?.querySelector('.sk-bubble')
    if (!b) return null
    const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { text: b.innerText.replace(/\\s+/g, ' ').trim(), inMeasure: Boolean(b.closest('.dg-measure')), pointer: getComputedStyle(b).pointerEvents, animation: getComputedStyle(b).animationName, through: !hit?.closest('.sk-bubble') }
  }))()`)
  assert.match(seen[0].text, /^← Lead fix the old API$/, 'on dev1: from the lead')
  assert.match(seen[1].text, /^→ Sam can you check the API tests\?$/, 'on qa1: to Sam')
  assert.equal(seen[2], null, 'none on a card the snapshot names no bubble for')
  for (const b of seen.slice(0, 2)) {
    assert.equal(b.inMeasure, false, 'outside the measured card')
    assert.equal(b.pointer, 'none')
    assert.ok(b.through, 'a click on the bubble reaches what is under it')
    assert.notEqual(b.animation, 'none', 'it fades')
  }
  await sleep(slow(500))
  assert.equal(await places(), before, 'no card moved or changed size for a bubble')

  bubbles = []
  alphaMod.write(2)
  await until(() => page.eval(`document.querySelectorAll('.sk-bubble').length === 0`), 10_000, 'the bubbles to go with the snapshot')
})

test('the Space view draws bubbles on its cards too, and under reduced motion they do not fade', { skip, timeout: slow(120_000) }, async t => {
  const alpha = () => snapshot({ team: 'Alpha Team', agents: [['dev1', 'Sam', 'running'], ['qa1', 'Tanuki', 'running']], bubbles: [{ agent: 'dev1', other: 'main', dir: 'from', text: 'fix the old API', at: Date.now() }] })
  const { page } = await openPage(t, [alpha, 'Beta Team'])
  await until(() => page.eval(`!!document.querySelector('.dg-node .sk-bubble')`), 10_000, 'a bubble in the diagram')

  await page.click('button', '^Space$')
  const inSpace = `[...document.querySelectorAll('.spv-card.is-placed')].find(c => c.querySelector('.sk-agent__name')?.textContent === 'Sam')?.querySelector('.sk-bubble')`
  await until(() => page.eval(`!!(${inSpace})`), 30_000, "the bubble on Sam's card in the Space view")
  const b = await page.eval(`(() => { const b = ${inSpace}; return { text: b.innerText.replace(/\\s+/g, ' ').trim(), inMeasure: Boolean(b.closest('.spv-measure')), pointer: getComputedStyle(b).pointerEvents, animation: getComputedStyle(b).animationName } })()`)
  assert.equal(b.text, '← Lead fix the old API')
  assert.equal(b.inMeasure, false)
  assert.equal(b.pointer, 'none')
  assert.notEqual(b.animation, 'none', 'it fades')
  assert.equal(await page.eval(`document.querySelectorAll('.spv-card .sk-bubble').length`), 1, 'one bubble: what the snapshot carries')

  // the person asks for less motion (switched on a page already placed: the Space view under reduced motion from the start places no cards at all, an older issue)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await until(() => page.eval(`getComputedStyle(${inSpace}).animationName === 'none'`), 5000, 'no fade under reduced motion')
})

// ---- the page in Thai ---------------------------------------------------------------------------------------------------------

/** Every English string of the page's table, as the fragments between its placeholders that a Thai page must not show. */
const ENGLISH = Object.entries(STRINGS.en).flatMap(([key, en]) => en.split(/\{\w+\}/).map(f => f.trim()).filter(f => /[A-Za-z]{3}/.test(f) && !STRINGS.th[key].includes(f)))
const pageWords = page => page.eval(`[document.body.innerText, ...[...document.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap(e => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('placeholder')])].filter(Boolean).join('\\n')`)
const englishIn = text => ENGLISH.filter(f => new RegExp(`(^|[^A-Za-z])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z])`, 'i').test(text))

test('the page follows the first live session into Thai: lang="th", Thai fonts, and no English from its table anywhere', { skip, timeout: slow(90_000) }, async t => {
  const thai = { main: { role: 'หัวหน้าทีมเทค', now: 'นำทีม', next: null }, dev1: { role: 'นักพัฒนา', now: 'แก้ไข search.tsx', next: 'รันเทสต์', activity: { text: 'แก้ไข search.tsx', since: Date.now() } }, qa1: { role: 'ผู้ทดสอบ', now: 'รออนุมัติ', next: null }, dev2: { role: 'นักพัฒนา', now: 'อ่าน README', next: null } }
  const alpha = () => snapshot({
    team: 'ทีมอัลฟา', lang: 'th', roleTitle: 'นักพัฒนา', over: thai,
    agents: [['dev1', 'Sam', 'running'], ['qa1', 'Tanuki', 'waiting']],
    says: { main: 'รอสมาชิก 1/2', dev1: 'กำลังทำ API เก่าและแก้ปัญหาที่เจอ' },
    bubbles: [{ agent: 'dev1', other: 'main', dir: 'from', text: 'แก้ปัญหาของ API เก่า', at: Date.now() }],
  })
  const beta = () => snapshot({ team: 'ทีมเบตา', lang: 'en', roleTitle: 'นักพัฒนา', over: thai, agents: [['dev2', 'Momo', 'running']] }) // listed second: alpha decides
  const { page } = await openPage(t, [alpha, beta])
  await until(() => page.eval(`document.documentElement.lang === 'th' && !!document.querySelector('.sk-bubble')`), 10_000, 'the page in Thai with its bubble')
  await sleep(slow(500))

  const font = await page.eval(`getComputedStyle(document.documentElement).getPropertyValue('--sk-font-title')`)
  assert.match(font, /Thonburi|Sukhumvit|Noto Sans Thai|Leelawadee/, `a Thai system font in the stack: ${font}`)
  const sam = await page.eval(`${card('Sam')}.innerText.replace(/\\s+/g, ' ')`)
  const bubble = await page.eval(`document.querySelector('.sk-bubble').innerText.replace(/\\s+/g, ' ').trim()`)
  console.log(`[talk thai] card: ${sam}\n[talk thai] bubble: ${bubble}`)
  assert.equal(bubble, '← หัวหน้า แก้ปัญหาของ API เก่า')
  assert.match(sam, /กำลังทำ API เก่าและแก้ปัญหาที่เจอ/)
  if (process.env.AGENT_HQ_SHOT_DIR) await page.shot(join(process.env.AGENT_HQ_SHOT_DIR, 'thai-page.png'))

  assert.deepEqual(englishIn(await pageWords(page)), [], 'the page as it opens')
  await page.eval(`[...document.querySelectorAll('.lc')].find(l => /ทีมอัลฟา/.test(l.textContent)).querySelector('.lc-actions .sk-iconbtn--primary').click()`)
  await until(() => page.eval(`!!document.querySelector('.sk-drawer')`), 8000, "the lead's drawer")
  assert.match(await page.eval(`document.querySelector('.sk-drawer').innerText`), /รอสมาชิก 1\/2/)
  assert.deepEqual(englishIn(await pageWords(page)), [], 'with the drawer open')
  await page.eval(`[...document.querySelectorAll('.hq-bar .sk-iconbtn--primary')].at(-1).click()`)
  await until(() => page.eval(`!!document.querySelector('.sk-modal')`), 8000, 'the add dialog')
  assert.deepEqual(englishIn(await pageWords(page)), [], 'with the add dialog open')
})
