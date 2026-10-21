// Live-page panels built on the kit (spacekit.js) that only the live page needs: the task board. The other panels (Drawer,
// FeedTile, InboxTile, AddAgentDialog, Dialog, ToastStack) live in spacekit.js; livemap.js turns the hub's snapshots into their
// props. The ordering and totals are pure and exported for `node --test`. No timers, no filters.

import { DotNumber, DotProgress, GlassTile, IconButton, html } from './spacekit.js'
import { t } from './i18n.js'

const TASK_ORDER = { in_progress: 0, pending: 1, completed: 2 }
const TASK_STATUS = { in_progress: 'working', pending: 'idle', completed: 'done' }
const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true })

/** A board's tasks in reading order: in progress, then pending, then completed; by task number within each. Never mutates. */
export const orderTasks = tasks => [...tasks].sort((a, b) => (TASK_ORDER[a.status] ?? 1) - (TASK_ORDER[b.status] ?? 1) || byId(a, b))

/** Done and total over every team's board, for the tile's title. */
export const boardTotals = sections => sections.reduce((sum, s) => ({ done: sum.done + s.progress.done, total: sum.total + s.progress.total }), { done: 0, total: 0 })

function TaskRow({ task }) {
  const isDone = task.status === 'completed'
  return html`<div className="sk-feed__row" data-status=${TASK_STATUS[task.status] ?? 'idle'} style=${{ gridTemplateColumns: '28px 1fr', opacity: isDone ? 0.55 : 1 }}>
    <span className="sk-feed__dot"></span>
    <span style=${{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 8px', minWidth: 0 }}>
      <span className="sk-label">#${task.id}</span>
      <span style=${{ textDecoration: isDone ? 'line-through' : 'none', color: isDone ? 'var(--sk-text-3)' : 'var(--sk-text)' }}>${task.subject}</span>
      ${task.owner ? html`<span className="sk-label" style=${{ color: 'var(--st-lead)' }}>@${task.owner}</span>` : null}
      ${task.blockedBy?.length ? html`<span className="sk-label" style=${{ color: 'var(--st-waiting)' }}>${t('board.waitsOn', { ids: task.blockedBy.map(id => `#${id}`).join(', ') })}</span>` : null}
    </span>
  </div>`
}

/**
 * The task board as a glass tile: one section per team, `sections` [{ key, label, progress: { done, total }, tasks: [{ id, subject,
 * status: 'pending'|'in_progress'|'completed', owner?, blockedBy: [open task ids] }] }]. Team headings only when there are several.
 */
export function TaskBoardTile({ sections = [], onClose }) {
  const totals = boardTotals(sections)
  const isMulti = sections.length > 1
  const hasTasks = sections.some(s => s.tasks.length > 0)
  return html`<${GlassTile} status="working" soft className="sk-feed" role="region" aria-label=${t('board.title')} style=${{ width: '100%', maxWidth: 420, boxSizing: 'border-box' }}>
    <div className="sk-feed__head">
      <span className="sk-label">${t('board.title')} <${DotNumber} value=${`${totals.done}/${totals.total}`} size="xs" /></span>
      ${onClose ? html`<${IconButton} icon="close" label=${t('board.close')} small onClick=${onClose} />` : null}
    </div>
    ${!hasTasks ? html`<div className="sk-body-text sk-dim" style=${{ padding: '4px 10px 8px' }}>${t('board.empty')}</div>` : sections.filter(s => s.tasks.length > 0).map(s => html`<section key=${s.key} aria-label=${s.label} style=${{ display: 'grid', gap: 4, padding: '6px 0' }}>
      ${isMulti ? html`<div className="sk-name" style=${{ fontSize: 15, padding: '0 10px' }}>${s.label}</div>` : null}
      <div style=${{ padding: '0 10px 4px' }}><${DotProgress} value=${s.progress.total ? (s.progress.done / s.progress.total) * 100 : 0} status="done" /></div>
      ${orderTasks(s.tasks).map(task => html`<${TaskRow} key=${task.id} task=${task} />`)}
    </section>`)}
  <//>`
}
