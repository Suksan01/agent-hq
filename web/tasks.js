// The live page's Tasks panel, variant A "Ledger" (docs/specs/task-sidebar.md): the approved plan's task list from the snapshot's
// `taskList` (hooks/live.ts) as a table, a row opening to who worked on it and its timeline. The pure parts are exported for
// `node --test`; every word is in i18n.js under `tasks.*`; plan text is drawn as text, never parsed as markup, a real <button> per row title.

import { GlassTile, Icon, html } from './spacekit.js'
import { has, t } from './i18n.js'
import React from './vendor/libs.js'

const { useState } = React
const NONE = '—'
const MINUTE = 60_000

const wholeMinutes = ms => (!(ms > 0) ? NONE : ms < MINUTE ? '<1' : String(Math.round(ms / MINUTE)))

/** Minutes of work on a row (or the total): a dash where nothing is counted, `<1` under a minute, else whole minutes. */
export const minText = row => wholeMinutes(row.workMs)

/** The total row's minutes, as the sidebar's: whole minutes always, 0 where nothing is counted. */
export const totalMinText = total => String(Math.round(total.workMs / MINUTE))

/** Estimated dollars of a row or the total: a dash where none is priced, two decimals, `+` where only some are. */
export const costText = row => (row.costUsd === null || row.costUsd === undefined ? NONE : `${row.costUsd.toFixed(2)}${row.isPartial ? '+' : ''}`)

/** One member's work for the detail: who, role, step, minutes, all four token kinds added, and its own cost. */
export const memberLine = work => ({
  who: work.who,
  role: work.role,
  step: work.step,
  min: wholeMinutes(work.workMs),
  tokens: work.inputTokens + work.outputTokens + work.cacheReadTokens + work.cacheWriteTokens,
  cost: costText({ costUsd: work.costUsd, isPartial: false }),
})

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

function Mark({ status, isStill }) {
  if (status === 'done') return html`<span className="tk-mark tk-mark--done"><${Icon} name="done" size=${14} /></span>`
  if (status === 'working') return html`<span className=${`tk-mark tk-mark--working${isStill ? ' is-still' : ''}`}><span className="tk-spin"></span></span>`
  return html`<span className=${`tk-mark tk-mark--${status}`}>${status === 'review' ? '◑' : '○'}</span>`
}

function Detail({ row, id }) {
  const lines = row.work.map(memberLine)
  return html`<tr className="tk-detail" id=${id}><td colSpan="6">
    ${lines.length === 0 ? html`<p className="tk-none">${t('tasks.noWork')}</p>` : html`<ul className="tk-work">
      ${lines.map((line, i) => html`<li key=${i}>
        <span className="tk-w-who">${line.who}</span><span className="tk-w-role">${line.role}</span><span className="tk-w-step">${word('tasks.step', line.step)}</span>
        <span className="tk-num">${t('tasks.minutes', { n: line.min })}</span><span className="tk-num">${t('tasks.tokens', { n: line.tokens.toLocaleString() })}</span><span className="tk-num">${line.cost === NONE ? NONE : `≈ $${line.cost}`}</span>
      </li>`)}
    </ul>`}
    ${row.events.length > 0 ? html`<ol className="tk-events">${timeline(row).map((e, i) => html`<li key=${i}><time>${clock(e.at)}</time> ${word('tasks.event', e.kind)}${e.who ? ` · ${e.who}` : ''}</li>`)}</ol>` : null}
  </td></tr>`
}

function Row({ row, isOpen, isStill, onToggle }) {
  const id = `tk-detail-${row.n}`
  return html`<tbody className=${`tk-task tk-task--${row.status}${isOpen ? ' is-open' : ''}`}>
    <tr className="tk-row" onClick=${onToggle}>
      <td className="tk-c-mark" title=${word('tasks.status', row.status)}><${Mark} status=${row.status} isStill=${isStill} /></td>
      <td className="tk-c-n">${row.n}</td>
      <td className="tk-c-title"><button type="button" className="tk-title" aria-expanded=${isOpen} aria-controls=${isOpen ? id : undefined} onClick=${e => { e.stopPropagation(); onToggle() }}>${row.title}</button></td>
      <td className="tk-c-who">${row.who ?? NONE}</td>
      <td className="tk-c-num">${minText(row)}</td>
      <td className="tk-c-num">${costText(row)}</td>
    </tr>
    ${isOpen ? html`<${Detail} row=${row} id=${id} />` : null}
  </tbody>`
}

function Table({ list, isStill }) {
  const [open, setOpen] = useState(null)
  return html`<table className="tk-table">
    <thead><tr><th><span className="tk-sr">${t('tasks.colStatus')}</span></th><th>#</th><th>${t('tasks.colTask')}</th><th className="tk-c-who">${t('tasks.colWho')}</th><th className="tk-c-num">${t('tasks.colMin')}</th><th className="tk-c-num">${t('tasks.colCost')}</th></tr></thead>
    ${list.rows.map(row => html`<${Row} key=${row.n} row=${row} isStill=${isStill} isOpen=${open === row.n} onToggle=${() => setOpen(nextOpen(open, row.n))} />`)}
    <tfoot><tr>
      <td colSpan="4">${t('tasks.total')} ${list.total.done}/${list.total.count}</td>
      <td className="tk-c-num">${totalMinText(list.total)}</td>
      <td className="tk-c-num">${costText(list.total)}</td>
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
    ${state === 'offline' ? html`<p className="tk-offline" role="status">${t('tasks.offline')}</p>` : null}
    ${state === 'loading' || state === 'empty' ? html`<p className="tk-note" role="status">${t(`tasks.${state}`)}</p>` : null}
    ${hasTable ? html`<${Table} list=${list} isStill=${state === 'offline'} />` : null}
    ${hasTable ? html`<p className="tk-foot">${t('tasks.footnote')}</p>` : null}
  <//>`
}
