// The space theme's React components (htm, no build step), styled by space.css. They are what the live page is made of:
// glass tiles, status pills, dot-matrix numbers, dotted progress, the agent card, chips, the toolbar, the drawer, the
// feed, the inbox, toasts, the title HUD, a modal, an input and an empty state. Three libraries.dev effects ride on
// top: border-beam (the glow along a working card), thinking-orbs (the thinking orb) and liquid-gooey (goo that
// merges on the toolbar and the chips).

import React, { htm, Liquid, ThinkingOrb } from './vendor/libs.js'
import { blobSvg } from './blobs.js'

const { useEffect, useLayoutEffect, useRef, useState } = React
export const html = htm.bind(React.createElement)

export const STATUS_LABEL = { working: 'Working', waiting: 'Needs you', done: 'Done', failed: 'Failed', idle: 'Idle', stopped: 'Stopped', lead: 'Lead' }
const cx = (...parts) => parts.filter(Boolean).join(' ')

/* ---------- icons ---------- */
const ICONS = {
  working: '<circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.6a4.4 4.4 0 0 1 0 8.8z" fill="currentColor"/>',
  waiting: '<path d="M6 2.2v4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="6" cy="9.4" r="1.1" fill="currentColor"/>',
  done: '<path d="M2.6 6.3l2.3 2.3l4.5 -5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  failed: '<path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  idle: '<path d="M3.2 6h5.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  stopped: '<rect x="3" y="3" width="6" height="6" rx="1.2" fill="currentColor"/>',
  lead: '<path d="M6 1.2l1.4 3l3.2 .4l-2.4 2.2l.7 3.2L6 8.3l-2.9 1.7l.7-3.2L1.4 4.6l3.2-.4z" fill="currentColor"/>',
  arrowL: '<path d="M15 5l-7 7l7 7M9 12h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  arrowR: '<path d="M9 5l7 7l-7 7M15 12H4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  bell: '<path d="M6 17h12l-1.6-2.4V10a4.4 4.4 0 0 0-8.8 0v4.6zM10 19.6a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  send: '<path d="M12 19V6M6 11.5L12 5.5l6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  message: '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.4V15A2.5 2.5 0 0 1 5 12.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  tasks: '<path d="M5 7l2 2l3.4 -4M5 16l2 2l3.4-4M14 7.5h5M14 16.5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5S21.5 12 21.5 12S18 18.5 12 18.5S2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  chevronUp: '<path d="M6 15l6-6l6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  chevronDown: '<path d="M6 9l6 6l6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  spark: '<path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" fill="currentColor"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  volume: '<path d="M4 10v4h3.5L12 18V6L7.5 10zM15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  mute: '<path d="M4 10v4h3.5L12 18V6L7.5 10zM16 9.5l4 5M20 9.5l-4 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 6a9 9 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a16 16 0 0 1-3 3.6M6.5 7.5A15 15 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.2-.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
}
export function Icon({ name, size }) {
  const viewBox = ['working', 'waiting', 'done', 'failed', 'idle', 'stopped', 'lead'].includes(name) ? '0 0 12 12' : '0 0 24 24'
  return html`<svg viewBox=${viewBox} width=${size} height=${size} aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[name] ?? '' }} />`
}

/* ---------- the canvas ---------- */
export function SpaceCanvas({ className, children, style }) {
  return html`<div className=${cx('sk-canvas', className)} style=${style}>
    <div className="sk-nebula sk-nebula--a"></div><div className="sk-nebula sk-nebula--b"></div><div className="sk-nebula sk-nebula--c"></div>
    <div className="sk-stars"></div>
    ${children}
  </div>`
}

/* ---------- glass, pills, numbers, progress ---------- */
export function GlassTile({ status, edge, soft, bright, lift, dim, className, children, as = 'div', ...rest }) {
  return React.createElement(as, { 'data-status': status, className: cx('sk-tile', edge && `sk-tile--${edge}`, soft && 'sk-tile--soft', bright && 'sk-tile--bright', lift && 'sk-tile--lift', dim && 'sk-tile--dim', className), ...rest }, children)
}

export function StatusPill({ status = 'idle', label, ghost }) {
  return html`<span className=${cx('sk-pill', ghost && 'sk-pill--ghost')} data-status=${status}>
    <span className="sk-pill__disc"><${Icon} name=${status} /></span>${label ?? STATUS_LABEL[status] ?? status}
  </span>`
}

/** A number in dot-matrix type. `suffix` is the small unit after it ("%", "h"). */
export function DotNumber({ value, size, suffix, status, className }) {
  return html`<span className=${cx('sk-dot', size && `sk-dot--${size}`, className)} data-status=${status}>${value}${suffix ? html`<small>${suffix}</small>` : null}</span>`
}

/** The dotted bar: a track of tiny dots, a glowing filled segment and a bright thumb. */
export function DotProgress({ value = 0, status = 'working', indeterminate }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return html`<div className=${cx('sk-bar', status === 'idle' && 'sk-bar--idle', indeterminate && 'sk-bar--indeterminate')} data-status=${status} style=${{ '--p': `${pct}%` }} role="progressbar" aria-valuenow=${indeterminate ? undefined : pct} aria-valuemin="0" aria-valuemax="100">
    <div className="sk-bar__fill"></div>${indeterminate ? null : html`<div className="sk-bar__thumb"></div>`}
  </div>`
}

/** A creature (see blobs.js): the same seed always draws the same one. */
export function Blob({ seed, state = 'idle', lead, size = 72, index, label }) {
  return html`<span className="sk-blobwrap" style=${{ display: 'inline-grid', width: size, height: size }} dangerouslySetInnerHTML=${{ __html: blobSvg({ seed, state, lead, size, index, label }) }} />`
}


/** Seconds as a Doto number with a unit: 12s, 4m, 2h. */
export function Elapsed({ secs = 0, size }) {
  const [value, unit] = secs < 60 ? [secs, 's'] : secs < 3600 ? [Math.floor(secs / 60), 'm'] : [Math.floor(secs / 3600), 'h']
  return html`<${DotNumber} value=${value} suffix=${unit} size=${size} />`
}

/** The live line: "▸ Editing view.tsx · 12s". */
export function ActivityLine({ text, elapsed }) {
  return html`<div className="sk-agent__activity"><span aria-hidden="true">▸</span> ${text}${elapsed === undefined ? null : html` · <${Elapsed} secs=${elapsed} />`}</div>`
}

/** [ref, onScreen]: whether the element is on screen (or about to be). Effects that run in JS stop while it is not. */
function useOnScreen() {
  const ref = useRef(null)
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver !== 'function') return
    const watch = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { rootMargin: '160px' })
    watch.observe(ref.current)
    return () => watch.disconnect()
  }, [])
  return [ref, onScreen]
}

function useReducedMotion() {
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  const [reduce, setReduce] = useState(!!query?.matches)
  useEffect(() => {
    if (!query) return
    const onChange = e => setReduce(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduce
}

// the small orb on cards: three glowing dots turning (a transform the compositor runs), no canvas redrawn every frame
const DOTS = 'radial-gradient(circle at 50% 14%, #fff 0 1.6px, transparent 2.3px), radial-gradient(circle at 84% 66%, #9fd0ff 0 1.3px, transparent 2px), radial-gradient(circle at 18% 66%, #3d7bff 0 1.3px, transparent 2px)'

/**
 * The thinking orb beside a working agent's pill. `live` draws thinking-orbs' canvas (the drawer, a big lead core; on by default
 * from 32 px); otherwise, on cards, it is a light CSS orb, since a canvas per card redrawn 60 times a second costs more than it
 * shows. Both stand still off screen and when the person asks for less motion.
 */
export function Orb({ size = 20, live = size >= 32 }) {
  const reduce = useReducedMotion()
  const [ref, onScreen] = useOnScreen()
  if (!live) {
    return html`<span ref=${ref} className="sk-orb" role="img" aria-label="Thinking" style=${{ width: size, height: size, borderRadius: '50%', background: 'radial-gradient(circle, rgba(61,123,255,.38), transparent 70%)' }}>
      <span style=${{ display: 'block', width: '100%', height: '100%', borderRadius: '50%', background: DOTS, animation: reduce ? 'none' : 'sk-spin 1.6s linear infinite' }}></span>
    </span>`
  }
  return html`<span ref=${ref} className="sk-orb"><${ThinkingOrb} state="working" size=${size} theme="dark" paused=${reduce || !onScreen} aria-label="Thinking" /></span>`
}

/* ---------- the agent card ---------- */
const BEAM_LIGHT = 'conic-gradient(from 0deg, transparent 0 60%, rgba(61,123,255,0) 64%, #3d7bff 80%, #cfe6ff 86%, rgba(61,123,255,0) 93%, transparent)'

/**
 * The glow riding the border of a working card: a conic gradient turning behind a 1.5 px ring. Only a transform moves, so the
 * compositor runs it; border-beam (the library) animated a registered custom property, which repainted the card every frame
 * on the main thread (about 30 points of CPU per card without a GPU). Stops when `active` is false (off screen).
 */
function Beam({ active = true, children }) {
  const reduce = useReducedMotion()
  return html`<div className="sk-beam" style=${{ position: 'relative', width: 'fit-content', maxWidth: '100%', padding: 1.5, borderRadius: 'var(--sk-radius-tile)' }}>
    <span aria-hidden="true" style=${{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', borderRadius: 'inherit' }}>
      <span style=${{ position: 'absolute', inset: '-60%', background: BEAM_LIGHT, animation: reduce ? 'none' : 'sk-spin 3.2s linear infinite', animationPlayState: active ? 'running' : 'paused' }}></span>
      <span style=${{ position: 'absolute', inset: 1.5, borderRadius: 'calc(var(--sk-radius-tile) - 1.5px)', background: '#06060a' }}></span>
    </span>
    <div style=${{ position: 'relative', zIndex: 1 }}>${children}</div>
  </div>`
}

const PCT_STATUS = { done: 100 }

/** One agent. `activity` + `elapsed` is the live line ("▸ Editing view.tsx · 12s"), `task` the assignment, `now` / `next` the plan.
 *  `compact` is the small card (blob, nickname, pill, %). The glass tile carries data-agent=${id} and data-card="full|compact|lead":
 *  measure it with getBoundingClientRect() to attach connection lines edge to edge (the border beam wraps outside it). */
export function AgentCard({ id, nickname, name, role, status = 'idle', pct, task, activity, elapsed, now, next, seed, lead, selected, compact, index, className, onSelect, children, orbs = true }) {
  const shown = PCT_STATUS[status] ?? pct
  const [ref, onScreen] = useOnScreen()
  const tile = html`<${GlassTile} ref=${ref} as=${onSelect ? 'button' : 'div'} type=${onSelect ? 'button' : undefined} status=${lead ? 'lead' : status} lift edge=${status === 'failed' ? 'bottom' : undefined} data-agent=${id} data-card=${lead ? 'lead' : compact ? 'compact' : 'full'}
    className=${cx('sk-agent', lead && 'sk-agent--lead', compact && 'sk-agent--compact', selected && 'sk-agent--selected', `sk-agent--${status}`, className)} onClick=${onSelect} aria-pressed=${onSelect ? !!selected : undefined} style=${{ textAlign: 'left', font: 'inherit', color: 'inherit', border: 0 }}>
    <div className="sk-agent__blob"><${Blob} seed=${seed ?? nickname} state=${status} lead=${lead} size=${lead ? 84 : 68} index=${index} /></div>
    <div className="sk-agent__head"><span className="sk-agent__name">${nickname}</span></div>
    <div className="sk-agent__meta">
      <${StatusPill} status=${lead && status === 'working' ? 'lead' : status} label=${lead ? 'Lead' : undefined} />
      ${status === 'working' && orbs ? html`<${Orb} />` : null}
      <span className="sk-label">${name}${role ? html` · ${role}` : null}</span>
    </div>
    <div className="sk-agent__pct">${shown === undefined ? null : html`<${DotNumber} value=${shown} suffix="%" size="sm" status=${status} />`}</div>
    ${activity && !compact ? html`<${ActivityLine} text=${activity} elapsed=${elapsed} />` : null}
    <div className="sk-agent__bar"><${DotProgress} value=${shown ?? 0} status=${status} indeterminate=${status === 'working' && shown === undefined} /></div>
    <div className="sk-agent__now">
      ${task ? html`<div className="sk-agent__task" title=${task}>${task}</div>` : null}
      ${now ? html`<div className="sk-agent__line"><span className="sk-label">Now</span><b>${now}</b></div>` : null}
      ${next ? html`<div className="sk-agent__line"><span className="sk-label">Next</span><span>${next}</span></div>` : null}
    </div>
    ${children}
  <//>`
  return status === 'working' && !compact ? html`<${Beam} active=${onScreen}>${tile}<//>` : tile
}

const CREW = [['working', 'Working'], ['waiting', 'Waiting'], ['done', 'Done'], ['failed', 'Failed']]

/** The lead: a brighter card with the crew's counts under it. */
export function LeadCard({ crew = {}, ...agent }) {
  return html`<${AgentCard} ...${agent} lead>
    <div className="sk-agent__crew">${CREW.map(([key, label]) => html`<div key=${key} className="sk-stat sk-stat--sm" data-status=${key}><${DotNumber} value=${crew[key] ?? 0} /><span className="sk-label">${label}</span></div>`)}</div>
  <//>`
}

/* ---------- chips, buttons, the toolbar ---------- */
export function SystemChip({ label, count, active, attention, seed, className, disabled, title, onClick }) {
  return html`<button type="button" className=${cx('sk-chip', attention && 'sk-chip--attn', className)} aria-pressed=${!!active} disabled=${disabled} title=${title} onClick=${onClick}>
    ${seed ? html`<span className="sk-chip__blob"><${Blob} seed=${seed} state=${active ? 'working' : 'idle'} size=${22} /></span>` : null}
    ${label}${count === undefined ? null : html`<${DotNumber} value=${count} />`}
  </button>`
}

/** Chips with a liquid indicator that follows the selection like a drop of goo (liquid-gooey, effect "move"). */
export function ChipBar({ items, value, onChange, label = 'Systems' }) {
  const row = useRef(null)
  const [box, setBox] = useState({ x: 0, w: 0 })
  useLayoutEffect(() => {
    const pressed = row.current?.querySelector('[aria-pressed="true"]')
    if (pressed) setBox({ x: pressed.offsetLeft, w: pressed.offsetWidth })
  }, [value, items.length])
  return html`<${Liquid} blur=${7} contrast=${20} fill="#f7f7fb" shadow="0 0 26px rgba(185,166,255,.35)" style=${{ display: 'inline-block', maxWidth: '100%' }}>
    <div ref=${row} role="group" aria-label=${label} style=${{ position: 'relative', display: 'flex', flexWrap: 'wrap', gap: 8, padding: 6, borderRadius: 28, background: 'rgba(255,255,255,.05)', boxShadow: 'inset 0 0 0 1px var(--sk-line)' }}>
      <${Liquid.Item} effect="move" move=${{ springiness: 0.55, trail: 0.5 }}>
        <div style=${{ position: 'absolute', left: 0, top: 6, height: 36, width: box.w, borderRadius: 999, transform: `translateX(${box.x}px)`, pointerEvents: 'none' }}></div>
      <//>
      ${items.map(item => html`<${SystemChip} key=${item.id} ...${item} active=${item.id === value} onClick=${() => onChange?.(item.id)} />`)}
    </div>
  <//>`
}

export function IconButton({ icon, label, primary, small, pressed, dot, disabled, className, onClick, ...rest }) {
  return html`<button type="button" className=${cx('sk-iconbtn', primary && 'sk-iconbtn--primary', small && 'sk-iconbtn--sm', className)} aria-label=${label} title=${label} aria-pressed=${pressed} disabled=${disabled} onClick=${onClick} ...${rest}>
    <${Icon} name=${icon} />${dot ? html`<span className="sk-iconbtn__dot"></span>` : null}
  </button>`
}
export function PillButton({ children, primary, danger, small, hint, className, onClick, ...rest }) {
  return html`<button type="button" className=${cx('sk-pillbtn', primary && 'sk-pillbtn--primary', danger && 'sk-pillbtn--danger', small && 'sk-pillbtn--sm', className)} onClick=${onClick} ...${rest}>${children}${hint ? html`<span className="sk-label">${hint}</span>` : null}</button>`
}
export function Toolbar({ children, label = 'Tools' }) {
  return html`<div className="sk-toolbar" role="toolbar" aria-label=${label}>${children}</div>`
}

/** A "+" that splits into round buttons like droplets (liquid-gooey, morph). */
export function LiquidMenu({ actions, label = 'Actions' }) {
  const [open, setOpen] = useState(false)
  return html`<${Liquid} blur=${9} contrast=${22} fill="rgba(247,247,251,.16)" shadow="0 10px 30px rgba(0,0,0,.5)" style=${{ width: 56, height: 56 }}>
    ${actions.map((a, i) => html`<${Liquid.Item} key=${a.icon} x=${open ? -(i + 1) * 58 : 0} y=${0} transition="bouncy" delay=${i * 45} style=${{ position: 'absolute', right: 0, top: 0 }}>
      <${IconButton} icon=${a.icon} label=${a.label} onClick=${a.onClick} tabIndex=${open ? 0 : -1} aria-hidden=${!open} />
    <//>`)}
    <${Liquid.Item} style=${{ position: 'absolute', right: 0, top: 0 }}><${IconButton} icon=${open ? 'close' : 'plus'} label=${label} primary pressed=${open} aria-expanded=${open} onClick=${() => setOpen(!open)} /><//>
  <//>`
}

/* ---------- inputs ---------- */
/** A pill field; `multiline` makes it a textarea. Anything in `children` sits at its right end (a send button). */
export function TextInput({ multiline, className, children, ...field }) {
  const label = field['aria-label'] ?? field.placeholder
  return html`<div className=${cx('sk-input', multiline && 'sk-input--area', className)}>
    ${multiline ? html`<textarea rows="3" ...${field} aria-label=${label}></textarea>` : html`<input ...${field} aria-label=${label} />`}${children}
  </div>`
}
export function SendButton({ label = 'Send', ...rest }) {
  return html`<${IconButton} icon="send" label=${label} primary ...${rest} />`
}
/** A message box: a field and a send button; Enter sends. */
export function SendInput({ placeholder = 'Message the lead…', onSend, className }) {
  const [text, setText] = useState('')
  const send = () => {
    if (!text.trim()) return
    onSend?.(text.trim())
    setText('')
  }
  return html`<${TextInput} className=${className} placeholder=${placeholder} value=${text} onChange=${e => setText(e.target.value)} onKeyDown=${e => e.key === 'Enter' && send()}>
    <${SendButton} disabled=${!text.trim()} onClick=${send} />
  <//>`
}

/* ---------- patterns ---------- */
export function TitleHud({ team, folder, counts = {} }) {
  return html`<${GlassTile} status="lead" soft className="sk-hud">
    <div><div className="sk-hud__title">${team}</div>${folder ? html`<div className="sk-label sk-hud__folder">${folder}</div>` : null}</div>
    <div className="sk-hud__stats">${CREW.map(([key, label]) => html`<div key=${key} className="sk-stat" data-status=${key}><${DotNumber} value=${counts[key] ?? 0} size="lg" status=${key} /><span className="sk-label">${label}</span></div>`)}</div>
  <//>`
}

/** The agent detail drawer. `stats` is [[label, value, suffix?]], `timeline` is [{ time, status, text }].
 *  Stop asks first, inline; `confirmStop` opens that question from the start. */
export function Drawer({ nickname, name, role, team, status = 'working', seed, index, lead, pct, task, activity, elapsed, now, next, stats = [], level, xp, xpNext, badges = [], timeline = [], finished = false, confirmStop = false, onClose, onSend, onStop }) {
  const [confirming, setConfirming] = useState(confirmStop)
  const shown = PCT_STATUS[status] ?? pct
  const stoppable = !lead && !['done', 'stopped'].includes(status) // the lead is messaged, never stopped from here
  return html`<${GlassTile} status=${lead ? 'lead' : status} edge="bottom" className="sk-drawer" role="dialog" aria-label=${`${nickname}, ${STATUS_LABEL[status]}`}>
    <div className="sk-drawer__head">
      <${Blob} seed=${seed ?? nickname} state=${status} lead=${lead} size=${64} index=${index} />
      <div style=${{ minWidth: 0 }}><div className="sk-name">${nickname}</div><div className="sk-label" style=${{ marginTop: 4 }}>${[name, role, team].filter(Boolean).join(' · ')}</div></div>
      <${IconButton} icon="close" label="Close" small onClick=${onClose} />
    </div>
    <div style=${{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <${StatusPill} status=${lead && status === 'working' ? 'lead' : status} />${status === 'working' ? html`<${Orb} live />` : null}
    </div>
    ${activity ? html`<div><${ActivityLine} text=${activity} elapsed=${elapsed} /></div>` : null}
    ${task ? html`<div className="sk-body-text">${task}</div>` : null}
    ${shown === undefined ? null : html`<div style=${{ display: 'grid', gap: 10 }}><${DotNumber} value=${shown} suffix="%" size="lg" status=${status} /><${DotProgress} value=${shown} status=${status} /></div>`}
    ${now || next ? html`<div style=${{ display: 'grid', gap: 4 }}>
      ${now ? html`<div className="sk-agent__line"><span className="sk-label">Now</span><b>${now}</b></div>` : null}
      ${next ? html`<div className="sk-agent__line"><span className="sk-label">Next</span><span>${next}</span></div>` : null}
    </div>` : null}
    ${stats.length ? html`<div className="sk-drawer__stats">${stats.map(([label, value, suffix]) => html`<div key=${label} className="sk-mini">${typeof value === 'number' ? html`<${DotNumber} value=${value} suffix=${suffix} size="sm" status=${status} />` : html`<span className="sk-body-text" style=${{ color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title=${value}>${value}</span>`}<span className="sk-label">${label}</span></div>`)}</div>` : null}
    ${level === undefined ? null : html`<div className="sk-drawer__sec sk-xp">
      <div className="sk-drawer__row"><span className="sk-label">Level <${DotNumber} value=${level} size="sm" status="lead" /></span><span className="sk-label"><${DotNumber} value=${xp} size="xs" /> / ${xpNext} XP</span></div>
      <${DotProgress} value=${xpNext ? (xp / xpNext) * 100 : 0} status="lead" />
      ${badges.length ? html`<div className="sk-badges">${badges.map(b => html`<span key=${b} className="sk-badge">✦ ${b}</span>`)}</div>` : null}
    </div>`}
    ${timeline.length ? html`<div className="sk-drawer__sec"><span className="sk-label">Timeline</span><div className="sk-timeline">
      ${timeline.map((t, i) => html`<div key=${i} className="sk-timeline__item" data-status=${t.status}><span className="sk-timeline__dot"></span><span>${t.text}</span><${DotNumber} value=${t.time} size="xs" /></div>`)}
    </div></div>` : null}
    ${finished ? html`<div className="sk-drawer__sec sk-body-text sk-dim">This agent has finished; nothing to send or stop.</div>` : html`<div className="sk-drawer__sec">
      <${SendInput} placeholder=${`Message ${nickname}…`} onSend=${onSend} />
      ${!stoppable ? null : confirming
        ? html`<div className="sk-confirm" role="alertdialog" aria-label=${`Stop ${nickname}?`}><span>Stop ${nickname}? Work in progress is lost.</span>
            <${PillButton} small onClick=${() => setConfirming(false)}>Keep<//><${PillButton} small danger autoFocus=${!confirmStop} onClick=${() => { setConfirming(false); onStop?.() }}>Stop<//></div>`
        : html`<${PillButton} danger small style=${{ justifySelf: 'start' }} onClick=${() => setConfirming(true)}><${Icon} name="stop" size=${15} /> Stop agent<//>`}
    </div>`}
  <//>`
}

/** One feed line; a `marker` row ("caught up 3 events") is a dim full-width note. With `onPick` the line is a button (to pulse the card). */
export function FeedRow({ time, status, who, text, marker, onPick }) {
  if (marker) return html`<div className="sk-feed__row sk-dim" style=${{ gridTemplateColumns: '1fr', fontSize: 12 }}>${text}</div>`
  const body = html`<span className="sk-feed__dot"></span><span><b>${who}</b> ${text}</span><${DotNumber} value=${time} />`
  return onPick
    ? html`<button type="button" className="sk-feed__row" data-status=${status} onClick=${onPick} style=${{ border: 0, background: 'none', color: 'inherit', textAlign: 'left', width: '100%', cursor: 'pointer' }}>${body}</button>`
    : html`<div className="sk-feed__row" data-status=${status}>${body}</div>`
}
/** The activity feed, newest first. `collapsible` folds it to its head (open by default); `onPick(row)` makes each line a button. */
export function FeedTile({ rows, title = 'Activity', collapsible, defaultOpen = true, onPick }) {
  const [isOpen, setOpen] = useState(defaultOpen)
  const count = rows.filter(r => !r.marker).length
  return html`<${GlassTile} status="working" soft className="sk-feed" role="log" aria-label=${title}>
    <div className="sk-feed__head"><span className="sk-label">${title}</span><span style=${{ display: 'flex', alignItems: 'center', gap: 8 }}><${DotNumber} value=${count} size="xs" />${collapsible ? html`<${IconButton} icon=${isOpen ? 'chevronUp' : 'chevronDown'} label=${isOpen ? `Fold ${title}` : `Open ${title}`} small aria-expanded=${isOpen} onClick=${() => setOpen(!isOpen)} />` : null}</span></div>
    ${!isOpen ? null : rows.length ? rows.map((row, i) => html`<${FeedRow} key=${row.key ?? i} ...${row} onPick=${onPick && !row.marker ? () => onPick(row) : undefined} />`) : html`<div className="sk-body-text sk-dim" style=${{ padding: '4px 10px 8px' }}>Quiet for now.</div>`}
  <//>`
}

/** Agents waiting on a permission prompt: `items` [{ uid, who, role, ask, command?, seed?, waited? (seconds) }]. The page cannot answer
 *  the prompt itself, so it offers a message (`onMessage(item)`) and points to the terminal. */
export function InboxTile({ items = [], onMessage }) {
  return html`<${GlassTile} status=${items.length ? 'waiting' : 'idle'} soft=${!items.length} className="sk-inbox">
    <div className="sk-inbox__head"><span className="sk-label" style=${{ color: items.length ? 'var(--st-waiting)' : undefined }}>Needs you</span><${DotNumber} value=${items.length} size="sm" status="waiting" /></div>
    ${items.length ? null : html`<div className="sk-body-text sk-dim" style=${{ padding: '0 4px 4px' }}>Nothing needs you. The crew is on it.</div>`}
    ${items.map((item, i) => html`<div key=${item.uid ?? i} className="sk-inbox__item">
      <div className="sk-inbox__who"><${Blob} seed=${item.seed ?? item.who} state="waiting" size=${34} /><div style=${{ flex: 1, minWidth: 0 }}><div className="sk-name" style=${{ fontSize: 15 }}>${item.who}</div><div className="sk-label">${item.role}</div></div>${item.waited === undefined ? null : html`<span className="sk-label" title="Waiting for">waiting <${Elapsed} secs=${item.waited} size="xs" /></span>`}</div>
      <div className="sk-inbox__ask">${item.ask}</div>
      ${item.command ? html`<div className="sk-inbox__cmd" title=${item.command}>${item.command}</div>` : null}
      <div className="sk-inbox__actions"><${PillButton} primary small onClick=${() => onMessage?.(item)}><${Icon} name="message" size=${15} /> Message<//></div>
      <div className="sk-label">Answer it in the terminal</div>
    </div>`)}
  <//>`
}

export function Toast({ status = 'working', children, onClose }) {
  return html`<div className="sk-toast" data-status=${status} role="status"><span className="sk-pill__disc"><${Icon} name=${status} /></span><span className="sk-toast__text">${children}</span>${onClose ? html`<${IconButton} icon="close" label="Dismiss" small onClick=${onClose} />` : null}</div>`
}
export function ToastStack({ children }) {
  return html`<div className="sk-toasts" aria-live="polite">${children}</div>`
}

/** A modal glass tile over a dimmed scene. Escape or a click on the scrim closes it; `inline` keeps it inside its box. */
export function Dialog({ title, children, actions, inline, onClose }) {
  const box = useRef(null)
  useEffect(() => { if (!inline) box.current?.querySelector('input, textarea, button')?.focus() }, [])
  return html`<div className=${cx('sk-scrim', inline && 'sk-scrim--inline')} onKeyDown=${e => e.key === 'Escape' && onClose?.()} onClick=${e => e.target === e.currentTarget && onClose?.()}>
    <${GlassTile} ref=${box} status="lead" soft className="sk-modal" role="dialog" aria-modal="true" aria-label=${title}>
      <div className="sk-modal__title">${title}</div>${children}<div className="sk-modal__actions">${actions}</div>
    <//>
  </div>`
}

const isFull = role => role.count > 0 && role.active >= role.count

/** A team's roles: `roles` is one list (one team) or a map { [sessionKey]: list }. */
export const rolesFor = (roles, sessionKey) => (Array.isArray(roles) ? roles : roles?.[sessionKey] ?? [])

/** The role to show picked: the chosen one if this team has it, else its first role with room, else its first. */
export const pickRole = (list, roleId) => list.find(r => r.id === roleId) ?? list.find(r => !isFull(r)) ?? list[0]

/**
 * Add an agent to a team: the team (a picker only when there are several `sessions` [{ key, label }]), a role from `roles`
 * [{ id, title, count, active }] or, per team, { [sessionKey]: [...] } (a full role cannot be picked) and the task. "Add agent" starts one; "Hire another" asks the lead
 * to bring one more on. Both wait for a task. onAdd({ sessionKey, roleId, task, hire }).
 */
export function AddAgentDialog({ sessions = [], roles = [], initialSession, inline, onAdd, onClose }) {
  const [sessionKey, setSession] = useState(initialSession ?? sessions[0]?.key)
  const [chosenRole, setRole] = useState()
  const [task, setTask] = useState('')
  const teamRoles = rolesFor(roles, sessionKey)
  const role = pickRole(teamRoles, chosenRole) // follows the team picked: a role that team lacks falls back to one it has
  const roleId = role?.id
  const send = hire => task.trim() && onAdd?.({ sessionKey, roleId, task: task.trim(), hire })
  return html`<${Dialog} title="Add an agent" inline=${inline} onClose=${onClose} actions=${html`<${PillButton} onClick=${onClose}>Cancel<//>
      <${PillButton} disabled=${!task.trim()} onClick=${() => send(true)}>Hire another<//>
      <${PillButton} primary disabled=${!task.trim() || !role || isFull(role)} onClick=${() => send(false)}>Add agent<//>`}>
    ${sessions.length > 1 ? html`<div className="sk-field"><span className="sk-label" id="sk-team-label">Team</span><div className="sk-chipset" role="group" aria-labelledby="sk-team-label">
      ${sessions.map(t => html`<${SystemChip} key=${t.key} label=${t.label} active=${t.key === sessionKey} onClick=${() => setSession(t.key)} />`)}
    </div></div>` : null}
    <div className="sk-field"><span className="sk-label" id="sk-role-label">Role</span><div className="sk-chipset" role="group" aria-labelledby="sk-role-label">
      ${teamRoles.length ? teamRoles.map(r => html`<${SystemChip} key=${r.id} label=${r.title} count=${`${r.active}/${r.count}`} active=${r.id === roleId} disabled=${isFull(r)} title=${isFull(r) ? `${r.title}: all ${r.count} at work` : `${r.active} of ${r.count} at work`} onClick=${() => setRole(r.id)} />`) : html`<span className="sk-body-text sk-dim">No team roles: use Hire another to ask the lead.</span>`}
    </div></div>
    <label className="sk-field"><span className="sk-label">Task</span><${TextInput} multiline placeholder="What should it do?" value=${task} onChange=${e => setTask(e.target.value)} /></label>
    <div className="sk-label" style=${{ textAlign: 'right' }}>Hire another asks the lead to bring one on</div>
  <//>`
}

export function EmptyState({ title, text, children }) {
  return html`<${GlassTile} status="lead" soft className="sk-empty"><div className="sk-empty__orbit"><i></i></div><div className="sk-name">${title}</div><div className="sk-body-text" style=${{ maxWidth: 260 }}>${text}</div>${children}<//>`
}

/** A pill of options with one lit, e.g. Diagram / List. `options` is [{ id, label, icon? }]. */
export function SegmentedToggle({ options, value, onChange, label }) {
  return html`<div className="sk-seg" role="group" aria-label=${label}>
    ${options.map(o => html`<button key=${o.id} type="button" className="sk-seg__item" aria-pressed=${o.id === value} onClick=${() => onChange?.(o.id)}>${o.icon ? html`<${Icon} name=${o.icon} />` : null}${o.label}</button>`)}
  </div>`
}
