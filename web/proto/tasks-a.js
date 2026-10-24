// Prototype only, variant A "Ledger" (docs/specs/task-sidebar.md, phase 3): the live page tasks panel, with mock data. Removed in phase 6.

import React, { createRoot } from '../vendor/libs.js'
import { GlassTile, Icon, SpaceCanvas, html } from '../spacekit.js'
import { protoState } from './mock.js'

const { useState } = React
const NONE = '—'
const STATUS_LABEL = { done: 'Done', working: 'Working', review: 'In review', waiting: 'Waiting' }
const STEP_LABEL = { tests: 'tests', build: 'build', review: 'review', fix: 'fix' }

const sum = (list, pick) => list.reduce((s, x) => s + pick(x), 0)
const minutesOf = task => sum(task.work, w => w.min)
const costOf = task => {
  const known = task.work.filter(w => w.usd !== null)
  return { sum: sum(known, w => w.usd), isPartial: known.length < task.work.length, isNone: known.length === 0 }
}
const money = (n, isPartial) => `${n.toFixed(2)}${isPartial ? '+' : ''}`
const tokens = n => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const minText = task => (task.work.length === 0 ? NONE : minutesOf(task) < 1 ? '<1' : String(Math.round(minutesOf(task))))
const costText = task => (costOf(task).isNone ? NONE : money(costOf(task).sum, costOf(task).isPartial))

function Mark({ status, isStopped }) {
  if (status === 'done') return html`<span className="tka-mark tka-mark--done"><${Icon} name="done" size=${14} /></span>`
  if (status === 'working') return html`<span className=${`tka-mark tka-mark--working${isStopped ? ' is-still' : ''}`}><span className="tka-spin"></span></span>`
  if (status === 'review') return html`<span className="tka-mark tka-mark--review">◑</span>`
  return html`<span className="tka-mark tka-mark--waiting">○</span>`
}

function Detail({ task }) {
  return html`<tr className="tka-detail"><td colSpan="6">
    ${task.work.length === 0 ? html`<p className="tka-none">Nobody has worked on this yet.</p>` : html`<ul className="tka-work">
      ${task.work.map((w, i) => html`<li key=${i}>
        <span className="tka-w-who">${w.who}</span><span className="tka-w-role">${w.role}</span><span className="tka-w-step">${STEP_LABEL[w.step] ?? w.step}</span>
        <span className="tka-num">${w.min} min</span><span className="tka-num">${tokens(w.tokens)} tokens</span><span className="tka-num">${w.usd === null ? NONE : `≈ $${w.usd.toFixed(2)}`}</span>
      </li>`)}
    </ul>`}
    ${task.events.length > 0 && html`<ol className="tka-events">${task.events.map((e, i) => html`<li key=${i}><time>${e.at}</time> ${e.text}</li>`)}</ol>`}
  </td></tr>`
}

function Row({ task, isOpen, onToggle, isStopped }) {
  const who = task.status === 'done' ? task.doneBy : task.who
  const press = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }
  return html`<tbody className=${`tka-task tka-task--${task.status}${isOpen ? ' is-open' : ''}`}>
    <tr className="tka-row" tabIndex="0" role="button" aria-expanded=${isOpen} onClick=${onToggle} onKeyDown=${press}>
      <td className="tka-c-mark" title=${STATUS_LABEL[task.status]}><${Mark} status=${task.status} isStopped=${isStopped} /></td>
      <td className="tka-c-n">${task.n}</td>
      <td className="tka-c-title">${task.title}</td>
      <td className="tka-c-who">${who ?? NONE}</td>
      <td className="tka-c-num">${minText(task)}</td>
      <td className="tka-c-num">${costText(task)}</td>
    </tr>
    ${isOpen && html`<${Detail} task=${task} />`}
  </tbody>`
}

function Table({ tasks, isStopped }) {
  const [open, setOpen] = useState(null)
  const costs = tasks.map(costOf)
  const done = tasks.filter(x => x.status === 'done').length
  return html`<table className="tka-table">
    <thead><tr><th></th><th>#</th><th>Task</th><th className="tka-c-who">Who</th><th className="tka-c-num">Min</th><th className="tka-c-num">≈ $</th></tr></thead>
    ${tasks.map(task => html`<${Row} key=${task.n} task=${task} isStopped=${isStopped} isOpen=${open === task.n} onToggle=${() => setOpen(open === task.n ? null : task.n)} />`)}
    <tfoot><tr>
      <td colSpan="4">Total ${done}/${tasks.length}</td>
      <td className="tka-c-num">${Math.round(sum(tasks, minutesOf))}</td>
      <td className="tka-c-num">${money(sum(costs, c => c.sum), costs.some(c => c.isPartial))}</td>
    </tr></tfoot>
  </table>`
}

const NOTICE = {
  loading: 'Loading tasks…',
  empty: 'The plan has no tasks yet.',
  error: 'The task list could not be read. It is rewritten the next time the lead saves a plan.',
}

function App() {
  const { state, tasks } = protoState()
  const isOffline = state === 'offline'
  const hasTable = !NOTICE[state] || state === 'many'
  const doneText = hasTable ? `${tasks.filter(x => x.status === 'done').length}/${tasks.length} done` : ''
  return html`<${SpaceCanvas}><main className="tka-page"><${GlassTile} edge="bottom" soft className="tka-panel" as="section" aria-labelledby="tka-h">
    <header className="tka-head"><h1 id="tka-h" className="sk-label">Tasks</h1><span className="tka-count">${doneText}</span></header>
    ${isOffline && html`<p className="tka-offline" role="status">Offline: showing the tasks as last seen.</p>`}
    ${NOTICE[state] && html`<p className=${`tka-note tka-note--${state}`} role=${state === 'error' ? 'alert' : 'status'}>${NOTICE[state]}</p>`}
    ${hasTable && html`<${Table} tasks=${tasks} isStopped=${isOffline} />`}
    ${hasTable && html`<p className="tka-foot">≈ estimate from list prices, not your bill</p>`}
  </${GlassTile}></main></${SpaceCanvas}>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
