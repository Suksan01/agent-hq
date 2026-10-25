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
import { costText, donePercent, footnoteKeys, memberLine, minText, nextOpen, panelState, timeline, totalMinText, whoText } from './tasks.js'

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
  assert.match(source, /aria-expanded/)
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

  assert.match(source, /<td className="tk-c-mark"[^>]*>.*<span className="tk-sr">\$\{word\('tasks\.status', row\.status\)\}<\/span>/, 'a tk-sr span with the status word in the status cell')
  assert.match(read('./space.css'), /\.tk-sr\s*\{[^}]*clip: rect\(0 0 0 0\)/, 'tk-sr hides it visually only')
  for (const status of ['done', 'working', 'review', 'waiting']) assert.match(STRINGS.th[`tasks.status.${status}`], THAI)
})

test('the greys of the tasks table keep at least 4.5:1 on the tile', () => {
  const css = read('./space.css')
  const [, r, g, b, a] = /--tk-dim:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(css)
  const lin = c => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const lum = ([x, y, z]) => 0.2126 * lin(x) + 0.7152 * lin(y) + 0.0722 * lin(z)
  const mix = (fg, alpha, bg) => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha))
  const ratio = (x, y) => (Math.max(lum(x), lum(y)) + 0.05) / (Math.min(lum(x), lum(y)) + 0.05)
  const lit = [28, 28, 44] // a tile lit from one edge, lighter than the canvas (#050507) under a 5% glass
  const ink = mix([r, g, b].map(Number), Number(a), lit)

  assert.ok(ratio(ink, lit) >= 4.5, `contrast ${ratio(ink, lit).toFixed(2)}`)
  assert.doesNotMatch(css.slice(css.indexOf('.tk-panel {')), /\.tk-[^{]*\{[^}]*var\(--sk-text-3\)/, 'no tasks rule uses the 3.2:1 grey')
})

test('the header has the count and a progress bar; the footer total does not repeat the count', () => {
  const source = read('./tasks.js')

  assert.equal(donePercent({ done: 2, count: 5 }), 40)
  assert.equal(donePercent({ done: 0, count: 0 }), 0)
  assert.match(source, /role="progressbar"/)
  assert.match(source, /<td colSpan="4">\$\{t\('tasks\.total'\)\}<\/td>/, 'the footer says Total, no count')
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

  assert.match(source, /className="tk-chev" aria-hidden="true"/)
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
  assert.match(css, /\.tk-table \.tk-c-cost\s*\{[^}]*width:\s*64px[^}]*white-space:\s*nowrap/)
  assert.match(css, /\.tk-table \.tk-c-num\s*\{[^}]*width:\s*44px/)
  assert.equal(STRINGS.en['tasks.colCost'], '≈', 'each cell carries its own $')
})
