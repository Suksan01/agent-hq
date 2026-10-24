// Prototype only, variant B "Focus" (docs/specs/task-sidebar.md, phase 3): the live page tasks panel, with mock data. Removed in phase 6.
// What is happening now first; filter chips; a click or Enter on a row opens a side drawer (a bottom sheet on a phone).

import React, { createRoot } from '../vendor/libs.js'
import { GlassTile, SpaceCanvas, html } from '../spacekit.js'
import { protoState } from './mock.js'

const { useEffect, useRef, useState } = React

const FILTERS = [
  { id: 'all', label: 'All', has: () => true },
  { id: 'now', label: 'Now', has: t => t.status === 'working' || t.status === 'review' },
  { id: 'waiting', label: 'Waiting', has: t => t.status === 'waiting' },
  { id: 'done', label: 'Done', has: t => t.status === 'done' },
]
const STATUS_WORD = { working: 'Working', review: 'In review', done: 'Done', waiting: 'Waiting' }
const STEP_WORD = { tests: 'tests', build: 'build', review: 'review', fix: 'fix' }
const GROUPS = [
  { id: 'now', label: 'Now', has: FILTERS[1].has },
  { id: 'waiting', label: 'Waiting', has: FILTERS[2].has },
  { id: 'done', label: 'Done', has: FILTERS[3].has },
]

const minOf = t => t.work.reduce((s, w) => s + w.min, 0)
const usdOf = t => t.work.reduce((s, w) => s + (w.usd ?? 0), 0)
const isPartial = t => t.work.some(w => w.usd === null)
const money = (usd, partial) => `${usd.toFixed(2)}${partial ? '+' : ''}`
const totalOf = list => ({ min: list.reduce((s, t) => s + minOf(t), 0), usd: list.reduce((s, t) => s + usdOf(t), 0), partial: list.some(isPartial) })
const tokens = n => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const shortName = name => name.replace(/^senior-/, '')

function Mark({ status }) {
  if (status === 'working') return html`<span className="tb-mark tb-spin" role="img" aria-label="Working"></span>`
  if (status === 'done') return html`<svg className="tb-mark tb-check" viewBox="0 0 16 16" role="img" aria-label="Done"><path d="M3.5 8.5l3 3 6-7" /></svg>`
  if (status === 'review') return html`<span className="tb-mark tb-half" role="img" aria-label="In review"></span>`
  return html`<span className="tb-mark tb-ring" role="img" aria-label="Waiting"></span>`
}

function Row({ task, onOpen, isOpen }) {
  const empty = task.work.length === 0
  const who = task.status === 'done' ? task.doneBy : task.who
  const open = e => { if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task.n, e.currentTarget) } }
  return html`<tr className=${`tb-row tb-row--${task.status}${isOpen ? ' is-open' : ''}`} tabIndex="0" role="button" aria-label=${`Task ${task.n}, ${STATUS_WORD[task.status]}: ${task.title}`} onClick=${open} onKeyDown=${open}>
    <td className="tb-c-mark"><${Mark} status=${task.status} /></td>
    <td className="tb-c-n">${task.n}</td>
    <td className="tb-c-title"><span className="tb-title">${task.title}</span>${who ? html`<span className="tb-who-inline">${shortName(who)}</span>` : null}</td>
    <td className="tb-c-who">${who ? shortName(who) : '—'}</td>
    <td className="tb-c-num">${empty ? '—' : minOf(task) === 0 ? '<1' : minOf(task)}</td>
    <td className="tb-c-num">${empty ? '—' : money(usdOf(task), isPartial(task))}</td>
  </tr>`
}

function Table({ tasks, filter, onOpen, openN }) {
  const shown = tasks.filter(FILTERS.find(f => f.id === filter).has)
  const done = tasks.filter(FILTERS[3].has)
  const sum = totalOf(tasks)
  const groups = GROUPS.map(g => ({ ...g, list: shown.filter(g.has) })).filter(g => g.list.length)
  return html`<div className="tb-scroll"><table className="tb-table">
    <thead><tr><th className="tb-c-mark"><span className="tb-sr">Status</span></th><th className="tb-c-n">#</th><th className="tb-c-title">Task</th><th className="tb-c-who">Who</th><th className="tb-c-num">Min</th><th className="tb-c-num">≈ $</th></tr></thead>
    ${groups.map(g => html`<tbody key=${g.id}>
      <tr className="tb-group"><th colSpan="6">${g.label} · ${g.list.length}</th></tr>
      ${g.list.map(t => html`<${Row} key=${t.n} task=${t} onOpen=${onOpen} isOpen=${openN === t.n} />`)}
    </tbody>`)}
    <tfoot><tr className="tb-total"><td></td><td></td><td className="tb-c-title">Total ${done.length}/${tasks.length}</td><td className="tb-c-who"></td><td className="tb-c-num">${sum.min}</td><td className="tb-c-num">${money(sum.usd, sum.partial)}</td></tr></tfoot>
  </table></div>`
}

function Drawer({ task, onClose }) {
  const closeRef = useRef(null)
  const total = Math.max(1, minOf(task))
  useEffect(() => { closeRef.current?.focus() }, [task.n])
  return html`<div className="tb-scrim" onClick=${onClose}>
    <aside className="tb-drawer" role="dialog" aria-modal="true" aria-label=${`Task ${task.n}`} onClick=${e => e.stopPropagation()}>
      <header className="tb-drawer__head">
        <div><div className="tb-drawer__status"><${Mark} status=${task.status} /> ${STATUS_WORD[task.status]} · #${task.n}</div><h2 className="tb-drawer__title">${task.title}</h2></div>
        <button ref=${closeRef} className="tb-x" onClick=${onClose} aria-label="Close">✕</button>
      </header>
      <h3 className="tb-h">Who worked on it</h3>
      ${task.work.length === 0 ? html`<p className="tb-muted">Nobody has worked on this yet.</p>` : html`<ul className="tb-work">
        ${task.work.map(w => html`<li key=${w.who + w.step} className="tb-work__line">
          <div className="tb-work__top"><strong>${w.who}</strong><span className="tb-muted">${w.role} · ${STEP_WORD[w.step]}</span></div>
          <div className="tb-work__nums"><span>${w.min} min</span><span>${tokens(w.tokens)} tokens</span><span>≈ $${w.usd === null ? '—' : w.usd.toFixed(2)}</span></div>
          <div className="tb-share" role="img" aria-label=${`${Math.round((w.min / total) * 100)}% of the task's minutes`}><span style=${{ width: `${(w.min / total) * 100}%` }}></span></div>
        </li>`)}
      </ul>`}
      <h3 className="tb-h">Timeline</h3>
      ${task.events.length === 0 ? html`<p className="tb-muted">Not started.</p>` : html`<ol className="tb-time">${task.events.map((e, i) => html`<li key=${i}><span className="tb-muted">${e.at}</span> ${e.text}</li>`)}</ol>`}
    </aside>
  </div>`
}

function Body({ state, tasks, openN, onOpen }) {
  const [filter, setFilter] = useState('all')
  if (state === 'loading') return html`<p className="tb-note" role="status"><span className="tb-mark tb-spin"></span> Loading tasks…</p>`
  if (state === 'error') return html`<p className="tb-note tb-note--error" role="alert">The task list could not be read. It is rewritten the next time the lead saves the plan.</p>`
  if (tasks.length === 0) return html`<p className="tb-note">The plan has no tasks yet.</p>`
  return html`<div>
    <div className="tb-chips" role="group" aria-label="Filter tasks">
      ${FILTERS.map(f => html`<button key=${f.id} className="sk-chip" aria-pressed=${filter === f.id} onClick=${() => setFilter(f.id)}>${f.label} <span className="tb-count">${tasks.filter(f.has).length}</span></button>`)}
    </div>
    <${Table} tasks=${tasks} filter=${filter} onOpen=${onOpen} openN=${openN} />
    <p className="tb-foot">≈ estimate from list prices, not your bill</p>
  </div>`
}

function App() {
  const { state, tasks } = protoState()
  const [openN, setOpenN] = useState(null)
  const opener = useRef(null)
  const task = tasks.find(t => t.n === openN)
  const close = () => { setOpenN(null); opener.current?.focus() }
  const open = (n, el) => { opener.current = el; setOpenN(n) }
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return html`<${SpaceCanvas}><main className=${`tb-page${state === 'offline' ? ' is-offline' : ''}`}>
    ${state === 'offline' ? html`<p className="tb-offline" role="status">Offline. Showing the list as last seen.</p>` : null}
    <${GlassTile} className="tb-panel" status="working" soft>
      <h1 className="tb-panel__title">Tasks</h1>
      <${Body} state=${state} tasks=${tasks} openN=${openN} onOpen=${open} />
    <//>
    ${task ? html`<${Drawer} task=${task} onClose=${close} />` : null}
  </main><//>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
