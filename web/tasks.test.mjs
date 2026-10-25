// Spec for the live page's Tasks panel, variant A "Ledger" (docs/specs/task-sidebar.md Screens/States, AC17, AC18, AC19; plan task 7):
// the pure parts of web/tasks.js, which draws from the snapshot's `taskList` (tests/live-tasks.test.ts has its shape). The contract:
//  - minText(row): `—` where no time is counted, `<1` under a minute, else whole minutes;
//  - costText(row_or_total): `—` for a null costUsd, else a `$` prefix and two decimals, with `+` when isPartial;
//  - memberLine(work): { who, role, step, min, tokens, cost } for the detail, tokens the sum of the four kinds, min as minText, cost as costText;
//  - timeline(row): the events oldest first, never changing the row;
//  - nextOpen(open, n): the row to show open after a click (or Enter on the row's <button>) on row n: the same row closes;
//  - panelState(snapshot, { isOnline }): 'loading' before the first snapshot, 'hidden' with no list (AC19), 'empty' for a list with no
//    rows, 'offline' when the connection is lost (the table stays as last seen), else 'ready';
//  - the panel draws text as text (no innerHTML), a real <button> per row title, and its spinner stops under prefers-reduced-motion
//    (web/space.css, class `tk-spin`); every string is in web/i18n.js under `tasks.*`, en and th.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { STRINGS } from './i18n.js'
import { QUIET_MS, agoMinutes, costText, donePercent, footnoteKeys, memberLine, minText, needsTick, nextOpen, panelNow, panelState, quietMinutes, timeline, totalMinText, whoText } from './tasks.js'

const MIN = 60_000
const THAI = /[฀-๿]/
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')

test('minutes: nothing counted is a dash, under a minute is <1, else whole minutes', () => {
  assert.equal(minText({ workMs: 0, work: [] }), '—')
  assert.equal(minText({ workMs: 0, work: [{ workMs: 0 }] }), '—')
  assert.equal(minText({ workMs: 20_000, work: [{ workMs: 20_000 }] }), '<1')
  assert.equal(minText({ workMs: 59_999, work: [{ workMs: 59_999 }] }), '<1')
  assert.equal(minText({ workMs: 5 * MIN, work: [{ workMs: 5 * MIN }] }), '5')
  assert.equal(minText({ workMs: 5.4 * MIN, work: [{ workMs: 5.4 * MIN }] }), '5')
  assert.equal(minText({ workMs: 5.6 * MIN, work: [{ workMs: 5.6 * MIN }] }), '6')
})

test('cost: a dash when none is priced, $ and two decimals otherwise, + when partial', () => {
  assert.equal(costText({ costUsd: null, isPartial: false }), '—')
  assert.equal(costText({ costUsd: null, isPartial: true }), '—')
  assert.equal(costText({ costUsd: 0.4, isPartial: false }), '$0.40')
  assert.equal(costText({ costUsd: 12, isPartial: false }), '$12.00')
  assert.equal(costText({ costUsd: 0.71, isPartial: true }), '$0.71+')
  assert.equal(costText({ costUsd: 0.005, isPartial: false }), `$${(0.005).toFixed(2)}`)
})

test('a member line for the detail: who, role, step, minutes, all four token kinds added, and its own cost', () => {
  const line = memberLine({ who: 'dev-1', role: 'senior-dev', step: 'build', workMs: 3 * MIN, inputTokens: 100, outputTokens: 40, cacheReadTokens: 7, cacheWriteTokens: 3, costUsd: 1.5 })

  assert.deepEqual(line, { who: 'dev-1', role: 'senior-dev', step: 'build', min: '3', tokens: 150, cost: '$1.50' })
  assert.equal(memberLine({ who: 'rev-1', role: 'reviewer', step: 'review', workMs: 10_000, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null }).cost, '—')
  assert.equal(memberLine({ who: 'rev-1', role: 'reviewer', step: 'review', workMs: 10_000, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null }).min, '<1')
})

test('the timeline lists the events oldest first and does not change the row', () => {
  const row = { events: [{ at: 90, kind: 'done', who: 'dev-1' }, { at: 10, kind: 'start', who: 'qa-1' }, { at: 40, kind: 'review', who: 'rev-1' }] }
  const before = JSON.stringify(row)

  assert.deepEqual(timeline(row).map(e => e.at), [10, 40, 90])
  assert.equal(JSON.stringify(row), before)
  assert.deepEqual(timeline({ events: [] }), [])
})

test('a click, or Enter on the row\'s button, opens that row; the same again closes it; another row moves the opening (AC17)', () => {
  assert.equal(nextOpen(null, 3), 3)
  assert.equal(nextOpen(3, 3), null)
  assert.equal(nextOpen(2, 3), 3)
  assert.equal(nextOpen(undefined, 1), 1)
})

test('the panel\'s state: loading, hidden with no list, empty, offline with the table kept, ready', () => {
  const list = rows => ({ taskList: { plan: 'p.md', rows, total: {}, removed: {} } })

  assert.equal(panelState(undefined, { isOnline: true }), 'loading')
  assert.equal(panelState({ taskList: null }, { isOnline: true }), 'hidden')
  assert.equal(panelState({}, { isOnline: true }), 'hidden', 'a snapshot of an older mod has no taskList: as today')
  assert.equal(panelState(list([]), { isOnline: true }), 'empty')
  assert.equal(panelState(list([{ n: 1 }]), { isOnline: true }), 'ready')
  assert.equal(panelState(list([{ n: 1 }]), { isOnline: false }), 'offline')
  assert.equal(panelState({ taskList: null }, { isOnline: false }), 'hidden', 'offline with nothing seen shows nothing')
})

test('the panel draws plan text as text, never as HTML, and puts a real button on each row title', () => {
  const source = read('./tasks.js')

  assert.doesNotMatch(source, /innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write/)
  assert.match(source, /<button/, 'a real <button> per row title')
  assert.doesNotMatch(source, /role="button"|role='button'/, 'not a role=button on a <tr>')
})

/** The bodies of every `@media (prefers-reduced-motion: reduce) { ... }` block in the css, braces matched. */
function reducedMotionBlocks(css) {
  const blocks = []
  const head = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g
  for (let m = head.exec(css); m; m = head.exec(css)) {
    let depth = 1
    let i = head.lastIndex
    while (i < css.length && depth > 0) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0, i++
    blocks.push(css.slice(head.lastIndex, i - 1))
  }
  return blocks
}

test('the working spinner stops under prefers-reduced-motion (AC18)', () => {
  const css = read('./space.css')

  assert.match(css, /\.tk-spin\b[^{]*\{[^}]*animation/, 'the spinner is a CSS animation')
  const stopped = reducedMotionBlocks(css).some(body => /\.tk-spin\b[^{]*\{[^}]*animation:\s*none/.test(body))
  assert.ok(stopped, 'a reduced-motion rule sets .tk-spin to animation: none')
})

test('every string of the panel is in en and th, the footnote says it is an estimate, and the Thai is Thai', () => {
  const keys = Object.keys(STRINGS.en).filter(k => k.startsWith('tasks.'))

  for (const word of ['title', 'loading', 'empty', 'offline', 'footnote', 'colTask', 'colWho', 'colMin', 'colCost', 'total', 'noWork']) assert.ok(keys.includes(`tasks.${word}`), `tasks.${word}`)
  for (const status of ['done', 'working', 'review', 'waiting']) assert.ok(keys.includes(`tasks.status.${status}`), `tasks.status.${status}`)
  for (const step of ['tests', 'build', 'review', 'fix']) assert.ok(keys.includes(`tasks.step.${step}`), `tasks.step.${step}`)
  assert.equal(STRINGS.en['tasks.footnote'], '≈ estimate from list prices, not your bill')
  assert.equal(STRINGS.en['tasks.loading'], 'Loading tasks…')
  for (const key of keys) {
    assert.match(STRINGS.th[key], THAI, `${key} is Thai`)
    assert.notEqual(STRINGS.th[key], STRINGS.en[key], `${key} is translated`)
  }
})

test('the whole row opens on a click, and aria-controls names the detail only while it is open', () => {
  const source = read('./tasks.js')

  assert.match(source, /<tr className="tk-row" onClick=/, 'a click anywhere on the row toggles it')
  assert.match(source, /aria-controls=\$\{isOpen \? id : undefined\}/)
})

test('the total row shows whole minutes and a cost even with no work counted, as the sidebar does', () => {
  assert.equal(totalMinText({ workMs: 0 }), '0')
  assert.equal(totalMinText({ workMs: 20_000 }), '<1', 'under a minute is <1 in the total too, as in the row')
  assert.equal(totalMinText({ workMs: 31_000 }), '<1')
  assert.equal(totalMinText({ workMs: 5.6 * MIN }), '6')
  assert.equal(costText({ costUsd: 0, isPartial: false }), '$0.00')
})

test('the status cell says the status in words for a screen reader, in en and th', () => {
  const source = read('./tasks.js')

  assert.match(read('./space.css'), /\.tk-sr\s*\{[^}]*clip: rect\(0 0 0 0\)/, 'tk-sr hides it visually only')
  for (const status of ['done', 'working', 'review', 'waiting']) assert.match(STRINGS.th[`tasks.status.${status}`], THAI)
})

test('the greys of the tasks table keep at least 4.5:1 on the lightest tile it can sit on, in order: text > secondary > dim', () => {
  const css = read('./space.css')
  const panel = /\.tk-panel \{([^}]*)\}/.exec(css)[1]
  const alphaOf = name => Number(new RegExp(`${name}:\\s*rgba\\(242,\\s*242,\\s*245,\\s*([\\d.]+)\\)`).exec(panel)[1])
  const lin = c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = ([x, y, z]) => 0.2126 * lin(x) + 0.7152 * lin(y) + 0.0722 * lin(z)
  const mix = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha))
  const ratio = (x, y) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05)
  const overlay = name => Number(new RegExp(`${name}[^{]*\\{[^}]*background:\\s*rgba\\(255,\\s*255,\\s*255,\\s*([\\d.]+)\\)`).exec(css)[1])
  const lit = [60, 60, 80] // a tile under a bright planet or glow (the .sk-tile gradients): the lightest we have seen
  const worst = Math.max(overlay('\\.tk-task\\.is-open \\.tk-row'), overlay('\\.tk-row:hover'), overlay('\\.tk-detail td'))
  const bg = mix([255, 255, 255], worst, lit) // the open row's overlay, the lightest of the three

  for (const name of ['--tk-dim', '--sk-text-2']) {
    const ink = mix([242, 242, 245], alphaOf(name), bg)
    assert.ok(ratio(ink, bg) >= 4.5, `${name} contrast ${ratio(ink, bg).toFixed(2)} on ${bg.map(Math.round)}`)
  }
  assert.ok(1 > alphaOf('--sk-text-2') && alphaOf('--sk-text-2') > alphaOf('--tk-dim'), 'text 1.0 > secondary > dim')
  assert.doesNotMatch(css.slice(css.indexOf('.tk-panel {')), /\.tk-[^{]*\{[^}]*var\(--sk-text-3\)/, 'no tasks rule uses the 3.2:1 grey')
})

test('the header has the count and a progress bar; the footer total does not repeat the count', () => {
  const source = read('./tasks.js')

  assert.equal(donePercent({ done: 2, count: 5 }), 40)
  assert.equal(donePercent({ done: 0, count: 0 }), 0)
  assert.match(source, /role="progressbar"/)
  assert.match(source, /<td colSpan="3">\$\{t\('tasks\.total'\)\}<\/td>/, 'the footer says Total, no count')
})

test('the footnote explains + for unknown prices, — for no price, and removed tasks, each only when it applies', () => {
  const rows = (...costs) => costs.map(([costUsd, isPartial], n) => ({ n, costUsd, isPartial }))

  assert.deepEqual(footnoteKeys({ rows: rows([1, false]), total: { costUsd: 1, isPartial: false }, removed: { workMs: 0, costUsd: 0 } }), [])
  assert.deepEqual(footnoteKeys({ rows: rows([1, true]), total: { costUsd: 1, isPartial: true }, removed: { workMs: 0, costUsd: 0 } }), ['tasks.footPartial'])
  assert.deepEqual(footnoteKeys({ rows: rows([null, false], [1, false]), total: { costUsd: 1, isPartial: false }, removed: { workMs: 0, costUsd: 0 } }), ['tasks.footNoPrice'])
  assert.deepEqual(footnoteKeys({ rows: rows([1, true], [null, false]), total: { costUsd: 1, isPartial: true }, removed: { workMs: 5, costUsd: 0 } }), ['tasks.footPartial', 'tasks.footNoPrice', 'tasks.footRemoved'])
  for (const key of ['footPartial', 'footNoPrice', 'footRemoved']) {
    assert.match(STRINGS.th[`tasks.${key}`], THAI)
    assert.ok(STRINGS.en[`tasks.${key}`])
  }
})

test('an expandable row shows a chevron that turns when open, an open-row style, and no motion under reduced motion', () => {
  const source = read('./tasks.js')
  const css = read('./space.css')

  assert.match(css, /\.tk-task\.is-open \.tk-chev\s*\{[^}]*rotate\(90deg\)/)
  assert.match(css, /\.tk-task\.is-open \.tk-row\s*\{[^}]*background/)
  assert.ok(reducedMotionBlocks(css).some(body => /\.tk-chev[^{]*\{[^}]*transition:\s*none/.test(body)), 'the chevron does not animate under reduced motion')
})

test('Thai headings of the table are 12px, not the 10px mono of the Latin ones', () => {
  assert.match(read('./space.css'), /html\[lang='th'\] \.tk-table th\s*\{[^}]*font-size:\s*12px/)
})

test('parallel work shows the first member and +n for the others with counted work; the title lists them all', () => {
  const work = (who, workMs) => ({ who, workMs })

  assert.deepEqual(whoText({ who: 'dev-1', work: [work('dev-1', 5000)] }), { text: 'dev-1', title: '' })
  assert.deepEqual(whoText({ who: 'dev-1', work: [work('dev-1', 5000), work('qa-1', 9000), work('qa-1', 1000), work('rev-1', 0)] }), { text: 'dev-1 +1', title: 'dev-1, qa-1' })
  assert.deepEqual(whoText({ who: 'dev-1', work: [work('dev-1', 5000), { ...work('qa-1', 0), outputTokens: 3 }] }), { text: 'dev-1 +1', title: 'dev-1, qa-1' }, 'tokens without time count, as the terminal counts them')
  assert.deepEqual(whoText({ who: 'dev-1', work: [work('dev-1', 1), work('dev-2', 1), work('qa-1', 1)] }), { text: 'dev-1 +2', title: 'dev-1, dev-2, qa-1' })
  assert.deepEqual(whoText({ who: null, work: [] }), { text: '—', title: '' })
  assert.deepEqual(whoText({ who: 'dev-1' }), { text: 'dev-1', title: '' }, 'an older snapshot without work entries')
})

test('the cost column is wide enough and never wraps: its header, rows and total carry tk-c-cost; Min stays narrow', () => {
  const source = read('./tasks.js')
  const css = read('./space.css')

  assert.equal(costText({ costUsd: 123.45, isPartial: true }), '$123.45+')
  assert.match(source, /<td className="tk-c-num tk-c-cost">\$\{costText\(row\)\}<\/td>/)
  assert.match(source, /<td className="tk-c-num tk-c-cost">\$\{costText\(list\.total\)\}<\/td>/)
  assert.match(source, /<th className="tk-c-num tk-c-cost">/)
  assert.match(css, /\.tk-table \.tk-c-cost\s*\{[^}]*width:\s*72px[^}]*white-space:\s*nowrap[^}]*text-align:\s*right/)
  assert.match(css, /\.tk-table \.tk-c-num\s*\{[^}]*width:\s*44px/)
  assert.equal(STRINGS.en['tasks.colCost'], '≈', 'each cell carries its own $')
})

test('"last active" counts whole minutes, never goes negative, and says nothing without a stamp', () => {
  const now = 100 * MIN

  assert.equal(agoMinutes(now - 5 * MIN, now), '5')
  assert.equal(agoMinutes(now - 5.9 * MIN, now), '5')
  assert.equal(agoMinutes(now - 20_000, now), '<1')
  assert.equal(agoMinutes(now + 7 * MIN, now), '<1', 'a stamp in the future is not negative')
  assert.equal(agoMinutes(null, now), null)
  assert.equal(agoMinutes(undefined, now), null, 'a snapshot of an older mod')
  assert.equal(agoMinutes(Number.NaN, now), null)
})

test('only a working task quiet for QUIET_MS or more is flagged; done, review, waiting and unknown never are', () => {
  const now = 500 * MIN
  const row = (status, lastActiveAt) => ({ status, lastActiveAt })

  assert.equal(quietMinutes(row('working', now - QUIET_MS), now), '10', 'exactly the threshold')
  assert.equal(quietMinutes(row('working', now - QUIET_MS + 1), now), null, 'just under it')
  assert.equal(quietMinutes(row('working', now - 45 * MIN), now), '45')
  assert.equal(quietMinutes(row('working', now + MIN), now), null, 'a future stamp is not quiet')
  assert.equal(quietMinutes(row('working', null), now), null, 'unknown is not flagged')
  assert.equal(quietMinutes({ status: 'working' }, now), null)
  for (const status of ['done', 'waiting', 'review']) assert.equal(quietMinutes(row(status, now - 60 * MIN), now), null, `${status} is never flagged`)
})

test('the quiet spinner is dimmed, the detail and member lines show last active, and the words are in en and th', () => {
  const source = read('./tasks.js')

  assert.match(read('./space.css'), /\.tk-mark\.is-quiet\s*\{[^}]*color:\s*var\(--tk-dim\)/)
  assert.match(source, /isQuiet=\$\{quiet !== null\}/)
  assert.match(source, /t\('tasks\.quiet', \{ n: quiet \}\)/, 'a screen reader hears the quiet minutes')
  assert.match(source, /t\('tasks\.lastActive'/)
  assert.match(source, /t\('tasks\.ago'/)
  for (const key of ['lastActive', 'ago', 'quiet']) {
    assert.match(STRINGS.en[`tasks.${key}`], /\{n\}/)
    assert.match(STRINGS.th[`tasks.${key}`], THAI)
  }
})

test('quiet is measured on the page clock, so a working task whose snapshot is old still gets flagged; offline keeps the last seen time', () => {
  const at = 1_000 * MIN // the last snapshot: the mod sends none while nobody works
  const snapshot = { at, taskList: { rows: [{ status: 'working', lastActiveAt: at - MIN }] } }
  const later = () => at + 30 * MIN
  const row = snapshot.taskList.rows[0]

  assert.equal(quietMinutes(row, snapshot.at), null, 'frozen at the snapshot time it never shows')
  assert.equal(quietMinutes(row, panelNow(snapshot, true, later)), '31', 'the page clock moves on')
  assert.equal(panelNow(snapshot, false, later), at, 'offline: as last seen')
  assert.equal(panelNow({}, false, later), later(), 'no snapshot time: the clock')
  assert.equal(agoMinutes(at + 5 * MIN, panelNow(snapshot, true, () => at)), '<1', 'a clock behind the stamp never shows negative')
  assert.equal(needsTick(snapshot.taskList), true)
  assert.equal(needsTick({ rows: [{ status: 'done' }, { status: 'waiting' }] }), false, 'no timer without a working task')
  assert.equal(needsTick(null), false)
})

test('the panel draws again on a slow timer while a task works, and clears it', () => {
  const source = read('./tasks.js')

  assert.match(source, /setInterval\(\(\) => setTick\(n => n \+ 1\), TICK_MS\)/)
  assert.match(source, /return \(\) => clearInterval\(timer\)/)
  assert.match(source, /isTicking = isOnline && needsTick\(list\)/)
})

test('quiet needs no working member: a long turn is not quiet, an abandoned task is, and a null stamp falls back to the start', () => {
  const now = 500 * MIN
  const agent = (name, status) => ({ id: `id-${name}`, name, nickname: `Nick ${name}`, status, isMain: false })
  const task = (over = {}) => ({ status: 'working', who: 'dev-1', work: [{ who: 'dev-1', workMs: 1000 }], lastActiveAt: now - 40 * MIN, startedAt: now - 90 * MIN, ...over })

  assert.equal(quietMinutes(task(), now, [agent('dev-1', 'running')]), null, 'a member in one long turn is working: the stamp is only set at a turn end')
  assert.equal(quietMinutes(task(), now, [agent('dev-1', 'pending')]), null)
  assert.equal(quietMinutes(task(), now, [agent('dev-1', 'idle')]), '40', 'its member stopped and the stamp is old')
  assert.equal(quietMinutes(task(), now, []), '40', 'a member gone from the list')
  assert.equal(quietMinutes(task(), now, [agent('dev-2', 'running')]), '40', 'another member working is not this task\'s')
  assert.equal(quietMinutes(task({ work: [{ who: 'dev-1' }, { who: 'qa-1' }] }), now, [agent('dev-1', 'idle'), agent('qa-1', 'running')]), null, 'any one of its members working')
  assert.equal(quietMinutes(task({ lastActiveAt: null }), now, []), '90', 'no stamp: measured from when it started')
  assert.equal(quietMinutes(task({ lastActiveAt: null, startedAt: null }), now, []), null, 'no usable time: not flagged')
  assert.equal(quietMinutes(task({ lastActiveAt: now - 3 * MIN }), now, []), null, 'recent')
  assert.equal(quietMinutes(task(), Number.NaN, []), null)
  assert.equal(agoMinutes(now - MIN, Number.NaN), null, 'no usable clock: no last-active line')
})

test('the quiet words reach a sighted user too: the status cell title and the open detail', () => {
  const source = read('./tasks.js')

  assert.match(source, /<td className="tk-c-mark" title=\$\{quiet === null \?/)
  assert.match(source, /tk-last tk-last--quiet/)
  assert.match(source, /<\$\{Detail\} row=\$\{row\} id=\$\{id\} now=\$\{now\} quiet=\$\{quiet\} \/>/)
})

test('a quiet spinner is still and in the dim grey, not a faded animation; the quiet words are lowercase in en and Thai has its own', () => {
  const css = read('./space.css')

  assert.match(css, /\.tk-mark\.is-quiet \.tk-spin\s*\{[^}]*animation:\s*none/)
  assert.doesNotMatch(css, /\.tk-mark\.is-quiet\s*\{[^}]*opacity/, 'opacity .45 gave 1.9:1')
  assert.equal(STRINGS.en['tasks.quiet'], 'no activity for {n} min')
  assert.match(css, /\.tk-last--quiet::first-letter\s*\{[^}]*uppercase/, 'the detail line starts with a capital')
  assert.equal(STRINGS.en['tasks.footRemoved'], 'the total includes removed tasks')
  assert.doesNotMatch(STRINGS.th['tasks.footRemoved'], /รวมรวม/, 'no doubled word')
})

test('the who column is gone: who sits under the title, and no rule styles a heading as a who cell', () => {
  const source = read('./tasks.js')
  const css = read('./space.css')

  assert.doesNotMatch(source, /tk-c-who/)
  assert.match(source, /<span className="tk-who"/)
  assert.doesNotMatch(css, /\.tk-c-who/, 'the old rule also hit the Who heading: 12px, grey, no uppercase')
  assert.match(css, /\.tk-who\s*\{[^}]*display:\s*block/)
})

test('the title keeps its room: no who column, Min folds away in a narrow panel, the cost stays', () => {
  const css = read('./space.css')
  const widths = [...css.matchAll(/\.tk-table (?:th:first-child, )?\.tk-c-(\w+)\s*\{[^}]*?width:\s*(\d+)px/g)].map(m => [m[1], Number(m[2])])
  const fixed = Object.fromEntries(widths)

  assert.deepEqual([fixed.num, fixed.cost], [44, 72])
  assert.match(css, /\.tk-panel\s*\{[^}]*container-type:\s*inline-size/)
  assert.match(css, /@container \(max-width: 300px\)\s*\{\s*\.tk-table \.tk-c-min\s*\{\s*width:\s*0/)
  assert.doesNotMatch(css, /@container[^\n]*\.tk-c-min\s*\{[^}]*display:\s*none/, 'display: none leaves an empty auto column under an open detail row')
  assert.doesNotMatch(css, /@container[^\n]*tk-c-cost/, 'the cost is never folded away')
  // 24 (status) + 24 (#) + 44 (Min) + 72 (cost) leave a 320px table 156px for the title cell, 142px for its text after the chevron
  assert.ok(320 - 24 - 24 - fixed.num - fixed.cost - 14 >= 140)
  assert.ok(260 - 24 - 24 - fixed.cost - 14 >= 100, 'at 320px the panel is about 260px; with Min folded the text has at least 100px')
})

test('the footnote and the left column: footnote in the secondary grey, the column scrolls with a visible bar', () => {
  const css = read('./space.css')

  assert.match(css, /\.tk-foot\s*\{[^}]*color:\s*var\(--sk-text-2\)/)
  assert.match(css, /\.hq-left\s*\{[^}]*scrollbar-width:\s*thin/)
  assert.doesNotMatch(css, /\.hq-left::-webkit-scrollbar[^{]*\{\s*display:\s*none/)
})

test('a member counts as working only by its name: a nickname or id equal to another member\'s name is not it', () => {
  const now = 500 * MIN
  const task = { status: 'working', who: 'dev-1', work: [{ who: 'dev-1', workMs: 1 }], lastActiveAt: now - 40 * MIN }
  const agent = (over) => ({ id: 'a1', name: 'zed', nickname: 'Zed', status: 'running', isMain: false, ...over })

  assert.equal(quietMinutes(task, now, [agent({ nickname: 'dev-1' })]), '40', 'a nickname is not a name')
  assert.equal(quietMinutes(task, now, [agent({ id: 'dev-1' })]), '40', 'nor is an id')
  assert.equal(quietMinutes(task, now, [agent({ name: 'dev-1' })]), null, 'its name is')
})

test('the who line under the title is labelled for a screen reader, in en and th', () => {
  const source = read('./tasks.js')

  assert.match(source, /<span className="tk-who"[^>]*><span className="tk-sr">\$\{t\('tasks\.colWho'\)\}: <\/span>\$\{who\.text\}<\/span>/)
  assert.equal(STRINGS.en['tasks.colWho'], 'Who')
  assert.match(STRINGS.th['tasks.colWho'], THAI)
})
