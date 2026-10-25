// The live page's Tasks panel, variant A "Ledger" (docs/specs/task-sidebar.md): the approved plan's task list from the snapshot's
// `taskList` (hooks/live.ts) as a table, a row opening to who worked on it and its timeline. The pure parts are exported for
// `node --test`; every word is in i18n.js under `tasks.*`; plan text is drawn as text, never parsed as markup, a real <button> per row title.

import { GlassTile, Icon, html } from './spacekit.js'
import { has, t } from './i18n.js'
import React from './vendor/libs.js'

const { useState } = React
const NONE = '—'
const MINUTE = 60_000
/** A working task with no activity for this long gets the quiet spinner (and is said to be quiet to a screen reader). */
export const QUIET_MS = 10 * MINUTE

const wholeMinutes = ms => (!(ms > 0) ? NONE : ms < MINUTE ? '<1' : String(Math.round(ms / MINUTE)))

/** Minutes of work on a row (or the total): a dash where nothing is counted, `<1` under a minute, else whole minutes. */
export const minText = row => wholeMinutes(row.workMs)

/** The total row's minutes, as the sidebar's: `<1` under a minute, else whole minutes, 0 where nothing is counted. */
export const totalMinText = total => (total.workMs > 0 && total.workMs < MINUTE ? '<1' : String(Math.round(total.workMs / MINUTE)))

/** Estimated dollars of a row or the total: a dash where none is priced, a `$` prefix, two decimals, `+` where only some are. */
export const costText = row => (row.costUsd === null || row.costUsd === undefined ? NONE : `$${row.costUsd.toFixed(2)}${row.isPartial ? '+' : ''}`)

/** One member's work for the detail: who, role, step, minutes, all four token kinds added, and its own cost. */
export const memberLine = work => ({
  who: work.who,
  role: work.role,
  step: work.step,
  min: wholeMinutes(work.workMs),
  tokens: work.inputTokens + work.outputTokens + work.cacheReadTokens + work.cacheWriteTokens,
  cost: costText({ costUsd: work.costUsd, isPartial: false }),
})

/** Does this member's work count (as the terminal's isCounted does): some time, or any token of the four kinds. */
const isCounted = w => w.workMs > 0 || (w.inputTokens ?? 0) + (w.outputTokens ?? 0) + (w.cacheReadTokens ?? 0) + (w.cacheWriteTokens ?? 0) > 0

/** The who cell: the row's `who`, and `+n` when n more members have counted work on it (the detail lists them all). */
export function whoText(row) {
  const names = [...new Set((row.work ?? []).filter(isCounted).map(w => w.who))]
  const first = row.who ?? names[0] ?? null
  if (first === null) return { text: NONE, title: '' }
  const others = names.filter(name => name !== first)
  return { text: others.length > 0 ? `${first} +${others.length}` : first, title: others.length > 0 ? [first, ...others].join(', ') : '' }
}

/** Which legend lines the footnote adds: `+` when some price is unknown, `—` when a row has none, the removed tasks when the total counts them. */
export function footnoteKeys(list) {
  const unpriced = value => value === null || value === undefined
  const keys = []
  if (list.rows.some(r => !unpriced(r.costUsd) && r.isPartial) || (!unpriced(list.total?.costUsd) && list.total?.isPartial)) keys.push('tasks.footPartial')
  if (list.rows.some(r => unpriced(r.costUsd))) keys.push('tasks.footNoPrice')
  if (list.removed && (list.removed.workMs > 0 || list.removed.costUsd > 0)) keys.push('tasks.footRemoved')
  return keys
}

/** Minutes since `at`, as the detail says them: `<1` under a minute; a stamp in the future counts as now; null where none is known. */
export function agoMinutes(at, now) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  const ms = Math.max(0, now - at)
  return ms < MINUTE ? '<1' : String(Math.floor(ms / MINUTE))
}

/** Whole minutes a working task has been quiet, or null: only a working task with a known stamp, quiet for QUIET_MS or more (done, review and waiting are never flagged). */
export function quietMinutes(row, now) {
  if (row.status !== 'working' || typeof row.lastActiveAt !== 'number') return null
  const ms = Math.max(0, now - row.lastActiveAt)
  return ms >= QUIET_MS ? String(Math.floor(ms / MINUTE)) : null
}

/** How much of the plan is done, 0 to 100. */
export const donePercent = total => (total.count > 0 ? Math.round((total.done / total.count) * 100) : 0)

/** The row's events oldest first; the row is not changed. */
export const timeline = row => [...row.events].sort((a, b) => a.at - b.at)

/** The row to show open after a click (or Enter on its button) on row `n`: the same row closes. */
export const nextOpen = (open, n) => (open === n ? null : n)

/** loading before the first snapshot, hidden with no list, empty for a list with no rows, offline when the connection is lost, else ready. */
export function panelState(snapshot, { isOnline }) {
  if (snapshot === undefined) return 'loading'
  const list = snapshot?.taskList
  if (!list) return 'hidden'
  if (list.rows.length === 0) return 'empty'
  return isOnline ? 'ready' : 'offline'
}

const word = (prefix, key) => (has(`${prefix}.${key}`) ? t(`${prefix}.${key}`) : key)
const clock = at => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Mark({ status, isStill, isQuiet }) {
  if (status === 'done') return html`<span className="tk-mark tk-mark--done" aria-hidden="true"><${Icon} name="done" size=${14} /></span>`
  if (status === 'working') return html`<span className=${`tk-mark tk-mark--working${isStill ? ' is-still' : ''}${isQuiet ? ' is-quiet' : ''}`} aria-hidden="true"><span className="tk-spin"></span></span>`
  return html`<span className=${`tk-mark tk-mark--${status}`} aria-hidden="true">${status === 'review' ? '◑' : '○'}</span>`
}

function Chevron() {
  return html`<span className="tk-chev" aria-hidden="true">›</span>`
}

function Detail({ row, id, now }) {
  const lines = row.work.map(memberLine)
  const last = agoMinutes(row.lastActiveAt, now)
  return html`<tr className="tk-detail" id=${id}><td colSpan="6">
    ${last === null ? null : html`<p className="tk-last">${t('tasks.lastActive', { n: last })}</p>`}
    ${lines.length === 0 ? html`<p className="tk-none">${t('tasks.noWork')}</p>` : html`<ul className="tk-work">
      ${lines.map((line, i) => html`<li key=${i}>
        <span className="tk-w-who">${line.who}</span><span className="tk-w-role">${line.role}</span><span className="tk-w-step">${word('tasks.step', line.step)}</span>
        <span className="tk-num">${t('tasks.minutes', { n: line.min })}</span><span className="tk-num">${t('tasks.tokens', { n: line.tokens.toLocaleString() })}</span><span className="tk-num">${line.cost === NONE ? NONE : `≈ ${line.cost}`}</span>${agoMinutes(row.work[i].lastAt, now) === null ? null : html`<span className="tk-num">${t('tasks.ago', { n: agoMinutes(row.work[i].lastAt, now) })}</span>`}
      </li>`)}
    </ul>`}
    ${row.events.length > 0 ? html`<ol className="tk-events">${timeline(row).map((e, i) => html`<li key=${i}><time>${clock(e.at)}</time> ${word('tasks.event', e.kind)}${e.who ? ` · ${e.who}` : ''}</li>`)}</ol>` : null}
  </td></tr>`
}

function Row({ row, isOpen, isStill, now, onToggle }) {
  const id = `tk-detail-${row.n}`
  const quiet = quietMinutes(row, now)
  const who = whoText(row)
  return html`<tbody className=${`tk-task tk-task--${row.status}${isOpen ? ' is-open' : ''}`}>
    <tr className="tk-row" onClick=${onToggle}>
      <td className="tk-c-mark" title=${word('tasks.status', row.status)}><${Mark} status=${row.status} isStill=${isStill} isQuiet=${quiet !== null} /><span className="tk-sr">${word('tasks.status', row.status)}${quiet === null ? '' : `, ${t('tasks.quiet', { n: quiet })}`}</span></td>
      <td className="tk-c-n">${row.n}</td>
      <td className="tk-c-title"><button type="button" className="tk-title" aria-expanded=${isOpen} aria-controls=${isOpen ? id : undefined} onClick=${e => { e.stopPropagation(); onToggle() }}><${Chevron} /><span>${row.title}</span></button></td>
      <td className="tk-c-who" title=${who.title || undefined}>${who.text}</td>
      <td className="tk-c-num">${minText(row)}</td>
      <td className="tk-c-num tk-c-cost">${costText(row)}</td>
    </tr>
    ${isOpen ? html`<${Detail} row=${row} id=${id} now=${now} />` : null}
  </tbody>`
}

function Table({ list, isStill, now }) {
  const [open, setOpen] = useState(null)
  return html`<table className="tk-table">
    <thead><tr><th><span className="tk-sr">${t('tasks.colStatus')}</span></th><th>#</th><th>${t('tasks.colTask')}</th><th className="tk-c-who">${t('tasks.colWho')}</th><th className="tk-c-num">${t('tasks.colMin')}</th><th className="tk-c-num tk-c-cost">${t('tasks.colCost')}</th></tr></thead>
    ${list.rows.map(row => html`<${Row} key=${row.n} row=${row} isStill=${isStill} now=${now} isOpen=${open === row.n} onToggle=${() => setOpen(nextOpen(open, row.n))} />`)}
    <tfoot><tr>
      <td colSpan="4">${t('tasks.total')}</td>
      <td className="tk-c-num">${totalMinText(list.total)}</td>
      <td className="tk-c-num tk-c-cost">${costText(list.total)}</td>
    </tr></tfoot>
  </table>`
}

/** The panel for a session's snapshot (`undefined` before the first one); draws nothing while there is no list. */
export function TasksPanel({ snapshot, isOnline }) {
  const state = panelState(snapshot, { isOnline })
  if (state === 'hidden') return null
  const list = snapshot?.taskList
  const hasTable = state === 'ready' || state === 'offline'
  return html`<${GlassTile} edge="bottom" soft className="tk-panel" role="region" aria-label=${t('tasks.title')}>
    <header className="tk-head"><span className="sk-label">${t('tasks.title')}</span>${hasTable ? html`<span className="tk-count">${t('tasks.done', { done: list.total.done, count: list.total.count })}</span>` : null}</header>
    ${hasTable ? html`<div className="tk-progress" role="progressbar" aria-label=${t('tasks.progress')} aria-valuemin="0" aria-valuemax=${list.total.count} aria-valuenow=${list.total.done} aria-valuetext=${t('tasks.done', { done: list.total.done, count: list.total.count })}><span style=${{ width: `${donePercent(list.total)}%` }}></span></div>` : null}
    ${state === 'offline' ? html`<p className="tk-offline" role="status">${t('tasks.offline')}</p>` : null}
    ${state === 'loading' || state === 'empty' ? html`<p className="tk-note" role="status">${t(`tasks.${state}`)}</p>` : null}
    ${hasTable ? html`<${Table} list=${list} isStill=${state === 'offline'} now=${snapshot.at ?? 0} />` : null}
    ${hasTable ? html`<p className="tk-foot">${[t('tasks.footnote'), ...footnoteKeys(list).map(key => t(key))].join(' · ')}</p>` : null}
  <//>`
}
