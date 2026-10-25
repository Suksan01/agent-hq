// The Paused section of the live page: the team members who are not working and do not need the person (idle, done, failed,
// stopped) and the roster seats never started this session. The main views draw only the rest. Names and roles come from the
// state file and are shown as text nodes only. `pausedOf` is pure, so `node --test` checks it.

import React from './vendor/libs.js'
import { GlassTile, StatusPill, html } from './spacekit.js'
import { agentStatus, elapsedText, isPausedAgent, keyOf } from './livemap.js'
import { inboxOf } from './feed.js'
import { useStored } from './livestate.js'
import { t } from './i18n.js'

const FINISHED = ['done', 'failed', 'stopped']
const text = value => (typeof value === 'string' ? value : '')

/**
 * One session's paused rows: its paused members ({ id, who, role, status, ago? }, ago in ms where the end is known) and the seats
 * never started ({ who, role, isSeat }). "Hide done" drops the finished members here too. A missing `seats` is no seats.
 */
export function pausedOf(session, clock = 0) {
  const snapshot = session.snapshot
  const waiting = new Set(inboxOf(snapshot).map(i => i.agent))
  const members = (Array.isArray(snapshot.agents) ? snapshot.agents : [])
    .filter(a => a && isPausedAgent(a, waiting.has(a.id)))
    .map(a => ({ id: a.id, who: text(a.nickname) || text(a.name), role: text(a.role), status: agentStatus(a), ...(a.endedAt ? { ago: Math.max(0, clock - a.endedAt) } : {}) }))
    .filter(m => !(snapshot.hideFinished && FINISHED.includes(m.status)))
  const seats = (Array.isArray(snapshot.seats) ? snapshot.seats : [])
    .filter(x => x && typeof x === 'object' && text(x.name))
    .map(x => ({ who: text(x.name), role: text(x.roleTitle) || text(x.role), isSeat: true }))
  return [...members, ...seats]
}

/** The sections to draw: one per session shown that has paused rows. */
export const pausedSections = (sessions, names, clockOf) =>
  sessions.flatMap(s => {
    const rows = pausedOf(s, clockOf(s.session))
    return rows.length > 0 ? [{ key: keyOf(s), label: names.get(s.session)?.prefix ?? s.label, rows }] : []
  })

function Row({ row, onPick }) {
  const state = row.isSeat ? html`<${StatusPill} status="idle" label=${t('paused.notStarted')} ghost />` : html`<${StatusPill} status=${row.status} />`
  const body = html`<span className="pz-who">${row.who}</span><span className="pz-role">${row.role}</span>${state}${row.ago === undefined ? null : html`<span className="pz-ago">${t('paused.ago', { time: elapsedText(row.ago) })}</span>`}`
  return row.isSeat || !onPick
    ? html`<li className="pz-row">${body}</li>`
    : html`<li><button type="button" className="pz-row pz-pick" onClick=${() => onPick(row.id)}>${body}</button></li>`
}

function Section({ section, isMulti, onPick }) {
  const [isOpen, setOpen] = useStored(`agent-hq.paused.${section.key}`, false)
  const id = `pz-list-${section.key}`
  const title = `${t('paused.title')}${isMulti ? ` · ${section.label}` : ''}`
  return html`<${GlassTile} status="idle" soft className="pz-tile">
    <button type="button" className="pz-head" aria-expanded=${isOpen} aria-controls=${isOpen ? id : undefined} onClick=${() => setOpen(!isOpen)}>
      <span className="sk-label">${title}</span><span className="pz-count">${section.rows.length}</span><span className="pz-caret" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>
    </button>
    ${isOpen ? html`<ul className="pz-list" id=${id}>${section.rows.map((row, i) => html`<${Row} key=${row.id ?? `seat-${i}`} row=${row} onPick=${id2 => onPick?.(section.key, id2)} />`)}</ul>` : null}
  <//>`
}

/** `sections` from pausedSections; `onPick(sessionKey, agentId)` opens a member's drawer. Nothing when no one is paused. */
export function PausedPanel({ sections, isMulti, onPick }) {
  if (sections.length === 0) return null
  return html`<div className="pz-panel">${sections.map(s => html`<${Section} key=${s.key} section=${s} isMulti=${isMulti} onPick=${onPick} />`)}</div>`
}
