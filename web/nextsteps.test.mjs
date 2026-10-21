// 0.7.0 on the live page, in a real browser (browser-kit.mjs: a real hub, scripted mods, a headless Chrome of its own): the
// lead's drafted next steps on its deck. Up to three, between the lead's turns; pressing one only drafts it into the Message
// lead box (the text is model output: the person reads it and sends it), "Not now" hides the set for good. Skipped when no
// Chrome is found (CHROME_BIN overrides).
//   node --test --test-concurrency=1 web/nextsteps.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSnapshot, launchBrowser, newWorld, skip, sleep, slow, twoSessions, until } from './browser-kit.mjs'
import { STRINGS } from './i18n.js'

const HTML = '<img src=x onerror="window.__pwned=1"> <b>Ship</b> it'
const ITEMS = ['Review the search page with the reviewer', HTML, 'Write the changelog for 0.7.0']
const RECAP = 'Search page shipped and 3 tests added; the reviewer has not looked yet'

/** Alpha's snapshot: its lead idle (between turns) or working, with `suggestions` as the mod writes them (or none). */
const alphaOf = state => () => {
  const snap = buildSnapshot({ team: 'Alpha Team', lead: state.working ? 'running' : 'completed', agents: [['dev1', 'Sam', 'completed']] })
  const agents = snap.agents.map(a => (a.isMain ? { ...a, endedAt: null } : a)) // the session's lead never ends: between turns it is only not working
  return { ...snap, agents, ...(state.lang ? { lang: state.lang } : {}), suggestions: state.suggestions ?? null }
}

/** Two sessions (alpha is the hub), a browser logged in and showing the page. */
async function openPage(t, state, browserOptions) {
  const world = newWorld(t)
  const { alpha, alphaMod } = await twoSessions(world, [alphaOf(state), 'Beta Team'])
  const page = await launchBrowser(world, browserOptions)
  await page.open(alpha.url)
  await until(async () => (await page.eval('location.pathname')) === '/' && (await page.eval('document.readyState')) === 'complete', 20_000, 'the login redirect')
  await until(() => page.eval(`document.querySelectorAll('.lc-deck').length === 2`), 25_000, 'both lead decks')
  return { page, alphaMod }
}

const alphaLead = `[...document.querySelectorAll('.lc')].find(l => /Captain Alpha/.test(l.textContent))`
const next = `${alphaLead}?.querySelector('.lc-next')`
const posts = page => [...page.requests.values()].filter(r => r.method === 'POST' && r.url.endsWith('/action')).length
const shown = page => page.eval(`!!(${next})`)

/** Presses the element `expr` (a page expression) with a real mouse once it holds still and is what lies under its centre: the diagram's camera eases. */
async function press(page, expr) {
  const seen = []
  const point = await until(async () => {
    seen.push(await page.eval(`(() => { const el = ${expr}, r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return JSON.stringify({ x, y, hit: el.contains(document.elementFromPoint(x, y)) }) })()`))
    await sleep(150)
    const last = seen.slice(-3)
    return last.length === 3 && new Set(last).size === 1 && JSON.parse(last[0]).hit && JSON.parse(last[0])
  }, 10_000, `${expr} to hold still`)
  await page.mouseClick(point.x, point.y)
}

test("the lead's next steps: recap and up to three on its deck between turns, as plain text; pressing one drafts it into the box and sends nothing", { skip, timeout: slow(90_000) }, async t => {
  const state = { suggestions: { recap: RECAP, items: ITEMS, at: 1001 } }
  const { page, alphaMod } = await openPage(t, state)
  await until(() => shown(page), 10_000, "the next steps on alpha's deck")

  const seen = await page.eval(`(() => {
    const n = ${next}, buttons = [...n.querySelectorAll('.lc-next__item')]
    const recap = n.querySelector('.lc-next__recap'), css = getComputedStyle(recap)
    return { title: n.getAttribute('aria-label'), head: n.querySelector('.lc-next__title').textContent, recap: recap.textContent, clamp: css.webkitLineClamp,
      items: buttons.map(b => b.querySelector('.lc-next__text').textContent), names: buttons.map(b => b.getAttribute('aria-label')), tags: buttons.map(b => b.tagName),
      markup: n.querySelectorAll('img, b').length, notNow: [...n.querySelectorAll('button')].find(b => b.textContent === 'Not now')?.tagName,
      beta: [...document.querySelectorAll('.lc')].find(l => /Captain Beta/.test(l.textContent)).querySelector('.lc-next') }
  })()`)
  assert.equal(seen.head, 'Next steps')
  assert.equal(seen.title, 'Next steps')
  assert.equal(seen.recap, RECAP)
  assert.equal(seen.clamp, '2', 'the recap is clamped to two lines')
  assert.deepEqual(seen.items, ITEMS, 'each suggestion is labelled with its text')
  assert.deepEqual(seen.tags, ['BUTTON', 'BUTTON', 'BUTTON'], 'real buttons: reachable with Tab and Enter')
  assert.deepEqual(seen.names, ITEMS.map(text => `Draft in Message lead: ${text}`))
  assert.equal(seen.markup, 0, 'HTML in a suggestion is shown as text, never parsed')
  assert.equal(await page.eval('window.__pwned'), undefined)
  assert.equal(seen.notNow, 'BUTTON')
  assert.equal(seen.beta, null, 'a session with no suggestions shows none')

  // press the first one with a real mouse: the lead's box opens with exactly its text, focused, the cursor at the end; nothing is sent
  const before = posts(page)
  await press(page, `${next}.querySelector('.lc-next__item')`)
  const box = '.sk-drawer input, .sk-drawer textarea'
  await until(() => page.eval(`document.querySelector(${JSON.stringify(box)})?.value === ${JSON.stringify(ITEMS[0])}`), 8000, 'the box filled with the suggestion')
  const field = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(box)}); return { focused: document.activeElement === el, start: el.selectionStart, end: el.selectionEnd, len: el.value.length, drawer: document.querySelector('.sk-drawer').getAttribute('aria-label') } })()`)
  assert.ok(field.focused, 'the box has the focus')
  assert.equal(field.start, field.len, 'the cursor at the end')
  assert.equal(field.end, field.len)
  assert.match(field.drawer, /Captain Alpha Team/, "it is alpha's lead's box")
  assert.equal(await shown(page), false, 'a used set goes away')
  await sleep(slow(800))
  assert.equal(posts(page), before, 'pressing a suggestion posts nothing')
  assert.equal(alphaMod.handled.length, 0, 'and the session got nothing')

  // a new set (a new `at`) comes back; the keyboard drafts the one with HTML, still as text; Escape leaves the box unsent
  await page.eval(`document.querySelector('.sk-drawer button[aria-label="Close"]').click()`)
  state.suggestions = { recap: null, items: [HTML], at: 1002 }
  alphaMod.write(1)
  await until(() => page.eval(`${next}?.querySelectorAll('.lc-next__item').length === 1`), 10_000, 'the new set of one')
  assert.equal(await page.eval(`${next}.querySelector('.lc-next__recap')`), null, 'no recap line when there is none')
  await page.eval(`${next}.querySelector('.lc-next__item').focus()`)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await until(() => page.eval(`document.querySelector(${JSON.stringify(box)})?.value === ${JSON.stringify(HTML)}`), 8000, 'the HTML suggestion drafted as plain text')
  await sleep(slow(500))
  assert.equal(posts(page), before, 'Enter on a suggestion posts nothing')
  assert.equal(await page.eval('window.__pwned'), undefined)

  // the box sends only when the person sends it: the lead action, with the drafted text
  await page.click('button', '^Send$')
  await until(() => alphaMod.handled.length === 1, 8000, 'the sent message to reach the session')
  assert.deepEqual({ type: alphaMod.handled[0].action.type, text: alphaMod.handled[0].action.text }, { type: 'lead', text: HTML.trim() })
})

test('the next steps hide while the lead works, on null or none, and once "Not now" (remembered per set, also after a reload)', { skip, timeout: slow(90_000) }, async t => {
  const state = { working: true, suggestions: { recap: RECAP, items: ITEMS.slice(0, 2), at: 2001 } }
  const { page, alphaMod } = await openPage(t, state)
  await sleep(slow(800))
  assert.equal(await shown(page), false, 'hidden while the lead is working')

  state.working = false
  alphaMod.write(1)
  await until(() => page.eval(`${next}?.querySelectorAll('.lc-next__item').length === 2`), 10_000, 'shown once the lead is idle, two of them')

  const before = posts(page)
  await press(page, `${next}.querySelector('.lc-next__dismiss')`)
  await until(async () => !(await shown(page)), 5000, '"Not now" to hide the set')
  assert.equal(await page.eval(`!!document.querySelector('.sk-drawer')`), false, '"Not now" opens nothing')
  alphaMod.write(2) // the same set again
  await sleep(slow(800))
  assert.equal(await shown(page), false, 'the same set stays dismissed')
  await page.open(await page.eval('location.href'))
  await until(() => page.eval(`document.querySelectorAll('.lc-deck').length === 2`), 20_000, 'the page again after a reload')
  await sleep(slow(500))
  assert.equal(await shown(page), false, 'still dismissed after a reload')
  assert.equal(posts(page), before, '"Not now" posts nothing')

  state.suggestions = { recap: null, items: ['Run the full suite'], at: 2002 }
  alphaMod.write(3)
  await until(() => shown(page), 10_000, 'a new set shows again')
  state.suggestions = { recap: RECAP, items: [], at: 2003 }
  alphaMod.write(4)
  await until(async () => !(await shown(page)), 10_000, 'hidden with no items')
  state.suggestions = { recap: null, items: ['Run the full suite'], at: 2004 }
  alphaMod.write(5)
  await until(() => shown(page), 10_000, 'shown again')
  state.suggestions = null
  alphaMod.write(6)
  await until(async () => !(await shown(page)), 10_000, 'hidden when suggestions is null')
})

test('the Space view shows them on the compact lead deck, and a press drafts there too', { skip, timeout: slow(120_000) }, async t => {
  const state = { suggestions: { recap: RECAP, items: ITEMS, at: 3001 } }
  const { page, alphaMod } = await openPage(t, state)
  await until(() => shown(page), 10_000, 'the next steps in the diagram')
  await page.click('button', '^Space$')
  await sleep(slow(1500))
  await page.click('.hq-bar button', 'Alpha Team') // zoomed out, a lead is its mini chip; the system chosen, its compact deck
  const inSpace = `[...document.querySelectorAll('.spv-card.is-placed')].find(c => /Captain Alpha/.test(c.textContent))?.querySelector('.lc-next')`
  await until(() => page.eval(`${inSpace}?.querySelectorAll('.lc-next__item').length === 3`), 30_000, "three on the lead's compact deck in the Space view")
  const fit = await page.eval(`(() => { const n = ${inSpace}, card = n.closest('.spv-card'), m = card.querySelector('.spv-measure').getBoundingClientRect(), r = n.getBoundingClientRect(); return { outside: !n.closest('.spv-measure'), below: r.top >= m.bottom - 30 } })()`)
  assert.ok(fit.outside, "outside the deck's measured box, so the deck keeps its slot")
  assert.ok(fit.below, 'hung under the deck')
  const before = posts(page)
  await page.eval(`${inSpace}.querySelector('.lc-next__item').click()`)
  await until(() => page.eval(`document.querySelector('.sk-drawer input')?.value === ${JSON.stringify(ITEMS[0])}`), 8000, 'the box filled from the Space view')
  await sleep(slow(500))
  assert.equal(posts(page), before, 'nothing posted')
  assert.equal(alphaMod.handled.length, 0)
})

test('in Thai, at phone width: Thai labels, no English from the table, nothing wider than the deck, and no motion under reduced motion', { skip, timeout: slow(90_000) }, async t => {
  const thai = ['ให้ผู้รีวิวตรวจหน้าค้นหา', 'เขียน changelog ของ 0.7.0', 'รันเทสต์ทั้งหมดอีกรอบก่อนรวม branch']
  const state = { lang: 'th', suggestions: { recap: 'หน้าค้นหาเสร็จแล้ว เพิ่มเทสต์ 3 ข้อ ผู้รีวิวยังไม่ได้ดู', items: thai, at: 4001 } }
  const { page } = await openPage(t, state, { width: 390, height: 844, mobile: true })
  await until(async () => (await page.eval(`document.documentElement.lang === 'th'`)) && shown(page), 15_000, 'the page in Thai with the next steps')
  const th = STRINGS.th
  const seen = await page.eval(`(() => {
    const n = ${next}, r = n.getBoundingClientRect()
    return { head: n.querySelector('.lc-next__title').textContent, title: n.getAttribute('aria-label'), list: n.querySelector('ul').getAttribute('aria-label'),
      notNow: [...n.querySelectorAll('button')].some(b => b.textContent === ${JSON.stringify(th['next.notNow'])}),
      names: [...n.querySelectorAll('.lc-next__item')].map(b => b.getAttribute('aria-label')),
      words: [n.innerText, ...[...n.querySelectorAll('[aria-label], [title]')].flatMap(e => [e.getAttribute('aria-label'), e.getAttribute('title')])].filter(Boolean).join('\\n'),
      wider: [...n.querySelectorAll('*')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.left < r.left - 0.5 || b.right > r.right + 0.5) }).map(e => e.className),
      scroll: n.scrollWidth - n.clientWidth }
  })()`)
  assert.equal(seen.head, th['next.title'])
  assert.equal(seen.title, th['next.title'])
  assert.equal(seen.list, th['next.list'])
  assert.ok(seen.notNow, `"Not now" in Thai: ${th['next.notNow']}`)
  assert.deepEqual(seen.names, thai.map(text => th['next.use'].replace('{text}', text)))
  for (const key of ['next.title', 'next.notNow', 'next.list', 'next.use']) {
    const english = STRINGS.en[key].replace(/\{\w+\}/g, '').replace(/[:\s]+$/, '')
    assert.ok(!seen.words.includes(english), `no English "${english}" on the Thai page`)
  }
  assert.deepEqual(seen.wider, [], 'nothing pokes out of the section at phone width')
  assert.ok(seen.scroll <= 1, `no sideways scroll inside it (${seen.scroll}px)`)

  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  const moving = await page.eval(`[...${next}.querySelectorAll('*')].concat(${next}).filter(e => { const s = getComputedStyle(e); return s.animationName !== 'none' || parseFloat(s.transitionDuration) > 0 }).length`)
  assert.equal(moving, 0, 'nothing animates or transitions under reduced motion')
})
