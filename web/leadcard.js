// The lead's own card, a "command deck" with a "mission board" beneath it. The deck is a wide glass capsule: the lead's
// star at the core inside the team's progress ring on the left; name, live line, crew counts, the crew as small blobs and
// round quick actions on the right. The board, attached under it, holds the lead's plan steps and the crew list (needs-you
// first) and folds away with a chevron, remembered per viewer. `compact` is the deck alone, `mini` a chip.
// htm/React like spacekit.js; styles are one <style id="lc-style"> injected on first render (prefix lc-). Light comes from
// gradients and box-shadows (no blur filters, no backdrop-filter); only a working lead moves (transform/opacity), and
// nothing moves offscreen, in a hidden tab or under reduced motion. Props only: callbacks, nothing fetched.

import React from './vendor/libs.js'
import { Blob, DotNumber, Elapsed, Icon, Orb, html, statusLabel } from './spacekit.js'
import { t } from './i18n.js'

const { useEffect, useRef, useState } = React
const cx = (...parts) => parts.filter(Boolean).join(' ')

export const LEAD_STATES = ['working', 'idle', 'needs-you', 'all-done', 'failure']
const STATE_HUE = { working: 'var(--st-working)', idle: 'var(--st-idle)', 'needs-you': 'var(--st-waiting)', 'all-done': 'var(--st-done)', failure: 'var(--st-failed)' }
const STATE_FACE = { working: 'working', idle: 'idle', 'needs-you': 'waiting', 'all-done': 'done', failure: 'working' }
const STATE_KEY = { working: 'status.working', idle: 'status.idle', 'needs-you': 'status.waiting', 'all-done': 'lead.allDone', failure: 'lead.failure' }
const stateWord = mood => t(STATE_KEY[mood])
const statusWord = status => statusLabel(status).toLowerCase() // "needs you" in a sentence
const COUNTS = ['working', 'waiting', 'done', 'failed']
const CREW_ORDER = ['waiting', 'failed', 'stopped', 'working', 'idle', 'done'] // the board lists who needs the person first
const CREW_SHOWN = { full: 8, compact: 4 } // as many as fit in the row (compact shares it with the actions)
const ROSTER_SHOWN = 6 // the board's crew list; the rest (sorted last: idle and done) fold into one line
const STEP_GLYPH = { done: '✓', now: '▸', next: '○' }
const ORB_SIZES = [20, 32, 64] // the orb sizes the kit draws
export const BOARD_KEY = 'agent-hq:lead-board-open'

/** How many members are in each status: working, waiting (needs you), done, failed (stopped counts as failed), idle. */
export function crewCounts(crew = []) {
  const counts = { working: 0, waiting: 0, done: 0, failed: 0, idle: 0 }
  for (const m of crew) {
    const key = m.status === 'stopped' ? 'failed' : m.status
    if (key in counts) counts[key]++
  }
  return counts
}

/** The deck's state from its crew: anyone waiting wins, then a failure, then work going on, then all done, else idle. */
export function leadState(crew = [], leadStatus) {
  const c = crewCounts(crew)
  if (c.waiting > 0) return 'needs-you'
  if (c.failed > 0) return 'failure'
  if (c.working > 0 || leadStatus === 'working') return 'working'
  if (crew.length > 0 && c.done === crew.length) return 'all-done'
  return 'idle'
}

// the board's open/closed choice, per viewer; storage can be missing or refuse (private windows), which is no error
function readOpen(fallback) {
  try {
    const v = localStorage.getItem(BOARD_KEY)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}
function writeOpen(open) {
  try {
    localStorage.setItem(BOARD_KEY, open ? '1' : '0')
  } catch {
    // remembered for this view only
  }
}

/** Marks the deck .is-offscreen while it is scrolled away (space.css pauses animations there), like motion.js does for the kit. */
function useOffscreen() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(([e]) => el.classList.toggle('is-offscreen', !e.isIntersecting), { rootMargin: '240px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

/** The core: the lead's star blob inside the team's progress ring (a dotted track, a glowing arc, a bright thumb). */
function Core({ seed, index, face, pct, size, orb }) {
  const r = size / 2 - 6
  const c = size / 2
  const p = Math.max(0, Math.min(100, pct ?? 0))
  const angle = (p / 100) * 2 * Math.PI - Math.PI / 2
  const tx = c + r * Math.cos(angle)
  const ty = c + r * Math.sin(angle)
  const arc = { cx: c, cy: c, r, pathLength: 100, strokeDasharray: `${p} 100`, transform: `rotate(-90 ${c} ${c})` }
  return html`<div className="lc-core" style=${{ width: size, height: size }}>
    <div className="lc-core__glow"></div>
    <svg className="lc-ring" viewBox=${`0 0 ${size} ${size}`} width=${size} height=${size} aria-hidden="true">
      <circle className="lc-ring__track" cx=${c} cy=${c} r=${r} />
      ${pct === undefined ? null : html`<circle className="lc-ring__halo" ...${arc} /><circle className="lc-ring__arc" ...${arc} />`}
      ${pct === undefined || p === 0 ? null : html`<circle className="lc-ring__flare" cx=${tx} cy=${ty} r=${size > 80 ? 9 : 5} /><circle className="lc-ring__thumb" cx=${tx} cy=${ty} r=${size > 80 ? 3.4 : 2.2} />`}
    </svg>
    <svg className="lc-sweep" viewBox=${`0 0 ${size} ${size}`} width=${size} height=${size} aria-hidden="true"><circle cx=${c} cy=${c} r=${r} pathLength="100" strokeDasharray="7 93" /></svg>
    <div className="lc-core__blob"><${Blob} seed=${seed} state=${face} lead size=${Math.round(size * 0.6)} index=${index} /></div>
    ${orb ? html`<span className="lc-core__orb"><${Orb} size=${size > 120 ? ORB_SIZES[1] : ORB_SIZES[0]} live=${false} /></span>` : null}
  </div>`
}

function Crew({ crew, max, small, onSelect }) {
  const shown = crew.slice(0, max)
  const more = crew.length - shown.length
  return html`<div className="lc-crew"><ul className="lc-crew__list" aria-label=${t('lead.crew')}>
    ${shown.map((m, i) => html`<li key=${m.id ?? m.nickname} className="lc-crew__m" data-status=${m.status} title=${`${m.nickname} · ${statusWord(m.status)}`}>
      <button type="button" className="lc-crew__btn" aria-label=${`${m.nickname}, ${statusWord(m.status)}`} onClick=${onSelect ? () => onSelect(m.id ?? m.nickname) : undefined}>
        <${Blob} seed=${m.seed ?? m.nickname} state=${m.status} size=${small ? 22 : 28} index=${m.index ?? i} />
        <span className="lc-dot"></span>
      </button>
    </li>`)}
  </ul>${more > 0 ? html`<span className="lc-crew__more" aria-label=${t('lead.more', { n: more })}><${DotNumber} value=${`+${more}`} size="xs" /></span>` : null}</div>`
}

function Counts({ counts }) {
  return html`<div className="lc-counts">
    ${COUNTS.map(key => html`<div key=${key} className="lc-count" data-status=${key} data-zero=${counts[key] === 0 ? '' : undefined}>
      <${DotNumber} value=${counts[key]} /><span className="sk-label">${statusLabel(key)}</span>
    </div>`)}
  </div>`
}

function Actions({ small, onMessage, onHire, onTasks }) {
  const btn = (icon, title, label, fn, primary) => html`<button type="button" className=${cx('sk-iconbtn', small && 'sk-iconbtn--sm', primary && 'sk-iconbtn--primary')} aria-label=${label} title=${title} onClick=${fn} disabled=${!fn}><${Icon} name=${icon} /></button>`
  return html`<div className="lc-actions" role="group" aria-label=${t('lead.actions')}>
    ${btn('message', t('lead.message'), t('lead.messageLabel'), onMessage, true)}${btn('plus', t('add.add'), t('add.title'), onHire)}${btn('tasks', t('lead.tasks'), t('lead.tasksLabel'), onTasks)}
  </div>`
}

function Live({ activity, elapsed }) {
  if (!activity) return null
  return html`<div className="lc-live"><span className="lc-live__cursor" aria-hidden="true">▸</span><span className="lc-live__text">${activity}</span>${elapsed === undefined ? null : html`<span className="lc-live__time"> · <${Elapsed} secs=${elapsed} /></span>`}</div>`
}

/** The mission board: the lead's plan steps and the crew, needs-you first; folds away with its chevron. */
function Board({ plan, crew, open, onToggle, onSelect, id }) {
  const done = plan.filter(s => s.status === 'done').length
  const sorted = [...crew].sort((a, b) => CREW_ORDER.indexOf(a.status) - CREW_ORDER.indexOf(b.status))
  const folded = sorted.slice(ROSTER_SHOWN)
  return html`<section className="lc-board" data-open=${open ? '' : undefined} aria-label=${t('lead.board')}>
    <button type="button" className="lc-board__bar" aria-expanded=${open} aria-controls=${`${id}-board`} onClick=${onToggle}>
      <span className="sk-label">${t('lead.board')}</span>
      ${plan.length ? html`<span className="lc-board__tally"><${DotNumber} value=${`${done}/${plan.length}`} size="xs" /> <span className="sk-label">${t('lead.steps')}</span></span>` : null}
      <span className="lc-board__chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6l6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
    </button>
    ${open ? html`<div className="lc-board__body" id=${`${id}-board`}>
      <div className="lc-board__col">
        <div className="sk-label lc-board__h">${t('lead.plan')}</div>
        ${plan.length ? html`<ol className="lc-steps">${plan.map((s, i) => html`<li key=${i} className="lc-step" data-step=${s.status}><span className="lc-step__glyph" aria-hidden="true">${STEP_GLYPH[s.status] ?? '○'}</span><span className="lc-step__text">${s.text}</span><span className="sr-only lc-sr"> (${STEP_GLYPH[s.status] ? t(`step.${s.status}`) : s.status})</span></li>`)}</ol>` : html`<p className="lc-empty">${t('lead.noPlan')}</p>`}
      </div>
      <div className="lc-board__col">
        <div className="sk-label lc-board__h">${t('lead.crew')}</div>
        ${sorted.length ? html`<ul className="lc-roster">${sorted.slice(0, ROSTER_SHOWN).map((m, i) => html`<li key=${m.id ?? m.nickname} className="lc-roster__m" data-status=${m.status}>
          <button type="button" className="lc-roster__btn" onClick=${onSelect ? () => onSelect(m.id ?? m.nickname) : undefined}>
            <span className="lc-roster__blob"><${Blob} seed=${m.seed ?? m.nickname} state=${m.status} size=${24} index=${m.index ?? i} /><span className="lc-dot"></span></span>
            <span className="lc-roster__name">${m.nickname}</span>
            <span className="lc-roster__word">${statusWord(m.status)}</span>
          </button>
        </li>`)}${folded.length ? html`<li className="lc-roster__more">${t('lead.moreList', { n: folded.length, words: [...new Set(folded.map(m => statusWord(m.status)))].join(', ') })}</li>` : null}</ul>` : html`<p className="lc-empty">${t('lead.noCrew')}</p>`}
      </div>
    </div>` : null}
  </section>`
}

/**
 * The lead's command deck. `variant`: full (the deck and its mission board, the diagram's centre), compact (the deck alone,
 * beside the star in the space view), mini (a chip). `crew`: [{ id, nickname, seed, status, index }] with status
 * working|waiting|done|failed|idle|stopped. `pct` the team's progress 0–100; `says` the lead's own sentence; `activity` + `elapsed` the live line;
 * `plan`: [{ text, status: done|now|next }] for the board (or `now` / `next` alone). `state` is derived from the crew
 * (leadState) unless given. `board` false hides the board; `boardOpen` is its default before the viewer chooses.
 * Callbacks: onMessage, onHire, onTasks (opens the task board), onSelect(memberId), onOpen.
 */
export function LeadDeck({ variant = 'full', id, nickname, title = t('lead.title'), team, seed, index, status, state, pct, says, activity, elapsed, now, next, plan, crew = [], board = true, boardOpen = true, orbs = true, onMessage, onHire, onTasks, onSelect, onOpen, className }) {
  ensureStyles()
  const ref = useOffscreen()
  const [open, setOpen] = useState(() => readOpen(boardOpen))
  const mood = LEAD_STATES.includes(state) ? state : leadState(crew, status)
  const counts = crewCounts(crew)
  const working = status === 'working' || (status === undefined && mood === 'working')
  const face = working && mood !== 'needs-you' ? 'working' : STATE_FACE[mood]
  const shownPct = mood === 'all-done' ? 100 : pct
  const style = { '--lc-hue': STATE_HUE[mood] }
  const uid = `lc${String(id ?? nickname ?? 'lead').replace(/[^\w-]/g, '')}`

  if (variant === 'mini') {
    return html`<button ref=${ref} type="button" className=${cx('lc', 'lc--mini', className)} data-state=${mood} data-working=${working ? '' : undefined} data-agent=${id} data-card="lead" style=${style} onClick=${onOpen} aria-label=${`${nickname}, ${title}, ${stateWord(mood)}`}>
      <${Core} seed=${seed ?? nickname} index=${index} face=${face} pct=${shownPct} size=${40} orb=${false} />
      <span className="lc-mini__name"><span className="lc-star" aria-hidden="true">✦</span>${nickname}</span>
      <span className="lc-mini__counts">${COUNTS.map(([key]) => (counts[key] > 0 ? html`<span key=${key} data-status=${key}><i></i><${DotNumber} value=${counts[key]} size="xs" /></span>` : null))}</span>
      ${counts.waiting > 0 ? html`<span className="lc-mini__attn" aria-hidden="true"></span>` : null}
    </button>`
  }

  const compact = variant === 'compact'
  const steps = plan ?? [now && { text: now, status: 'now' }, next && { text: next, status: 'next' }].filter(Boolean)
  const toggle = () => setOpen(o => (writeOpen(!o), !o))
  const badge = counts.waiting > 0 ? html`<span className="lc-badge" role="status"><${Icon} name="waiting" size=${12} /> ${t(counts.waiting === 1 ? 'lead.needsOne' : 'lead.needsMany', { n: counts.waiting })}</span>` : null
  const deck = html`<article className="lc-deck" aria-label=${`${nickname}, ${team ? t('lead.of', { title, team }) : title}: ${stateWord(mood)}`}>
    <div className="lc-stars" aria-hidden="true"></div>
    <div className="lc-left">
      <svg className="lc-orbit" viewBox="0 0 260 80" aria-hidden="true"><ellipse cx="130" cy="40" rx="127" ry="30" /><circle className="lc-orbit__moon" cx="12" cy="50" r="2.6" /></svg>
      <${Core} seed=${seed ?? nickname} index=${index} face=${face} pct=${shownPct} size=${compact ? 92 : 132} orb=${working && orbs} />
      ${shownPct === undefined ? null : html`<div className="lc-pct"><${DotNumber} value=${Math.round(shownPct)} suffix="%" size=${compact ? 'xs' : 'sm'} /><span className="sk-label">${t('team')}</span></div>`}
    </div>
    <div className="lc-right">
      <header className="lc-head">
        <h3 className="lc-name"><span className="lc-star" aria-hidden="true">✦</span>${onOpen ? html`<button type="button" className="lc-name__btn" onClick=${onOpen}>${nickname}</button>` : nickname}</h3>
        <div className="lc-sub"><span className="sk-label lc-title">${title}</span>${team ? html`<span className="lc-team">${team}</span>` : null}</div>
      </header>
      ${says ? html`<p className="lc-says" title=${says}>${says}</p>` : null}
      <${Live} activity=${activity} elapsed=${elapsed} />
      <${Counts} counts=${counts} />
      <div className="lc-foot">
        <${Crew} crew=${crew} max=${CREW_SHOWN[variant] ?? 6} small=${compact} onSelect=${onSelect} />
        ${compact ? html`<${Actions} small onMessage=${onMessage} onHire=${onHire} onTasks=${onTasks} />` : null}
      </div>
    </div>
    ${compact ? null : html`<${Actions} onMessage=${onMessage} onHire=${onHire} onTasks=${onTasks} />`}
    ${badge}
  </article>`
  return html`<div ref=${ref} className=${cx('lc', compact ? 'lc--compact' : 'lc--full', className)} data-state=${mood} data-working=${working ? '' : undefined} data-agent=${id} data-card="lead" style=${style}>
    ${deck}
    ${!compact && board ? html`<${Board} plan=${steps} crew=${crew} open=${open} onToggle=${toggle} onSelect=${onSelect} id=${uid} />` : null}
  </div>`
}

// ---------- styles ----------

const STYLE = `
.lc { --lc-hue: var(--st-working); position: relative; min-width: 0; color: var(--sk-text); font-family: var(--sk-font-title); box-sizing: border-box; }
.lc *, .lc *::before, .lc *::after { box-sizing: border-box; }
.lc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* the deck: a wide glass capsule, round around the core on the left */
.lc--full { width: min(100%, 640px); container-type: inline-size; }
.lc--compact { width: min(100%, 340px); container-type: inline-size; }
.lc-deck { position: relative; z-index: 1; isolation: isolate; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 20px;
  min-height: 180px; padding: 16px 18px 16px 20px; border-radius: 110px 40px 40px 110px;
  background:
    radial-gradient(42% 90% at 15% 50%, color-mix(in srgb, var(--st-lead) 40%, transparent), transparent 70%),
    radial-gradient(60% 80% at 100% 110%, color-mix(in srgb, var(--lc-hue) 26%, transparent), transparent 70%),
    linear-gradient(100deg, #140f2e, #08080e 48%, #060609);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.18), inset 0 0 0 1px rgba(185,166,255,.16), 0 28px 80px -40px var(--st-lead), 0 18px 60px -36px var(--lc-hue); }
.lc-stars { position: absolute; inset: 0; z-index: -1; border-radius: inherit; pointer-events: none; opacity: .75;
  background-image: radial-gradient(1.2px 1.2px at 8% 20%, #fff, transparent), radial-gradient(1px 1px at 26% 84%, rgba(255,255,255,.8), transparent),
    radial-gradient(1px 1px at 48% 12%, rgba(255,255,255,.6), transparent), radial-gradient(1.3px 1.3px at 70% 30%, rgba(255,255,255,.6), transparent),
    radial-gradient(1px 1px at 88% 70%, rgba(255,255,255,.5), transparent), radial-gradient(1px 1px at 60% 92%, rgba(255,255,255,.5), transparent),
    radial-gradient(rgba(255,255,255,.045) 1px, transparent 1.4px);
  background-size: auto, auto, auto, auto, auto, auto, 22px 22px; }
.lc-left { position: relative; display: grid; justify-items: center; }
.lc-right { display: grid; gap: 9px; min-width: 0; }
/* the orbit ring wraps the core and spills past the deck's round end */
.lc-orbit { position: absolute; left: 38%; top: 46%; width: 210px; height: 70px; transform: translate(-50%, -50%) rotate(-14deg); overflow: visible; pointer-events: none; z-index: 1; }
.lc-orbit ellipse { fill: none; stroke: #E4DCFF; stroke-opacity: .45; stroke-width: 1.1; stroke-dasharray: 1 5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.lc-orbit__moon { fill: #fff; }
.lc--compact .lc-orbit { width: 150px; height: 50px; }
.lc-core { position: relative; display: grid; place-items: center; }
.lc-core__glow { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,.5), color-mix(in srgb, var(--st-lead) 45%, transparent) 30%, transparent 64%); }
.lc-core__blob { position: relative; display: grid; place-items: center; }
.lc-ring, .lc-sweep { position: absolute; inset: 0; overflow: visible; }
.lc-ring__track { fill: none; stroke: rgba(255,255,255,.3); stroke-width: 1.6; stroke-dasharray: 0 5.2; stroke-linecap: round; }
.lc-ring__halo { fill: none; stroke: var(--lc-hue); stroke-width: 9; stroke-opacity: .18; stroke-linecap: round; }
.lc-ring__arc { fill: none; stroke: var(--lc-hue); stroke-width: 3; stroke-linecap: round; }
.lc-ring__flare { fill: #fff; fill-opacity: .16; }
.lc-ring__thumb { fill: #fff; }
.lc-sweep { opacity: 0; transform-origin: 50% 50%; }
.lc-sweep circle { fill: none; stroke: #fff; stroke-opacity: .55; stroke-width: 2; stroke-linecap: round; }
.lc-core__orb { position: absolute; right: 4%; bottom: 6%; }
.lc-pct { display: flex; align-items: baseline; gap: 6px; margin-top: -10px; position: relative; z-index: 2; }
.lc-pct .sk-dot { color: color-mix(in srgb, var(--lc-hue) 30%, #fff); }
.lc-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; min-width: 0; }
.lc-name { margin: 0; display: flex; align-items: center; gap: 8px; min-width: 0; font: 600 26px/1.05 var(--sk-font-title); letter-spacing: -.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lc-name__btn { all: unset; cursor: pointer; border-radius: 8px; overflow: hidden; text-overflow: ellipsis; }
.lc-name__btn:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.lc-star { flex: none; color: var(--st-lead); font-size: .7em; }
.lc-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; }
.lc-title { color: var(--st-lead); letter-spacing: .1em; }
.lc-team { font: 500 12.5px var(--sk-font-title); color: var(--sk-text-2); }
.lc-says { margin: 0; font: 500 14px/1.4 var(--sk-font-title); color: var(--sk-text); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
.lc-live { display: flex; min-width: 0; font: 400 12px var(--sk-font-mono); color: color-mix(in srgb, var(--lc-hue) 40%, #fff); white-space: nowrap; }
.lc-live__cursor { color: var(--lc-hue); margin-right: 6px; }
.lc-live__text { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lc-live__time { flex: none; color: var(--sk-text-2); }
.lc-live .sk-dot { --s: 12px; text-shadow: none; }
.lc-live .sk-dot small { font-size: .8em; }
.lc-counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; padding: 8px 6px; border-radius: 18px; background: rgba(255,255,255,.035); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); }
.lc-count { --hue: var(--st-idle); display: grid; justify-items: center; gap: 5px; min-width: 0; }
.lc-count[data-status='working'] { --hue: var(--st-working); }
.lc-count[data-status='waiting'] { --hue: var(--st-waiting); }
.lc-count[data-status='done'] { --hue: var(--st-done); }
.lc-count[data-status='failed'] { --hue: var(--st-failed); }
.lc-count .sk-dot { --s: 26px; color: color-mix(in srgb, var(--hue) 35%, #fff); text-shadow: none; }
.lc-count[data-zero] .sk-dot { color: var(--sk-text-3); }
.lc-count .sk-label { display: flex; align-items: center; gap: 5px; max-width: 100%; overflow: hidden; font-size: 9px; white-space: nowrap; }
.lc-count .sk-label::before { content: ''; flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--hue); }
.lc-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
.lc-crew { flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; }
.lc-crew__list { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; min-width: 0; }
.lc-crew__m { margin-right: -6px; }
.lc-crew__btn { all: unset; position: relative; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; }
.lc-crew__btn:focus-visible, .lc-roster__btn:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
.lc-dot { position: absolute; right: 2px; bottom: 3px; width: 8px; height: 8px; border-radius: 50%; background: var(--st-idle); box-shadow: 0 0 0 2px #07070c; }
[data-status='working'] .lc-dot { background: var(--st-working); }
[data-status='waiting'] .lc-dot { background: var(--st-waiting); }
[data-status='done'] .lc-dot { background: var(--st-done); }
[data-status='failed'] .lc-dot, [data-status='stopped'] .lc-dot { background: var(--st-failed); }
.lc-crew__more { flex: none; padding: 4px 9px; border-radius: 999px; background: rgba(255,255,255,.07); color: var(--sk-text-2); }
.lc-actions { flex: none; display: flex; gap: 8px; }
.lc--full .lc-deck > .lc-actions { flex-direction: column; }
.lc-badge { position: absolute; top: -12px; right: 76px; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font: 500 12px var(--sk-font-title); color: #1a1205; background: var(--st-waiting); box-shadow: 0 0 24px -4px var(--st-waiting); }

/* the mission board, hung under the deck */
.lc-board { position: relative; z-index: 0; margin: -22px 0 0; padding: 34px 20px 14px; border-radius: 0 0 30px 30px;
  background: linear-gradient(180deg, #0b0a16, #07070b); box-shadow: inset 0 -1px 0 rgba(255,255,255,.08), inset 0 0 0 1px rgba(255,255,255,.06), 0 24px 50px -34px var(--st-lead); }
.lc-board__bar { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; cursor: pointer; border-radius: 10px; padding: 2px 4px; }
.lc-board__bar:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.lc-board__tally { display: inline-flex; align-items: baseline; gap: 4px; color: var(--sk-text-2); }
.lc-board__chev { margin-left: auto; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: rgba(255,255,255,.06); color: var(--sk-text-2); transition: transform .25s var(--sk-ease); }
.lc-board[data-open] .lc-board__chev { transform: rotate(180deg); }
.lc-board__body { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 18px; padding: 14px 4px 4px; }
.lc-board__h { margin-bottom: 8px; }
.lc-steps, .lc-roster { list-style: none; margin: 0; padding: 0; display: grid; gap: 7px; }
.lc-step { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; align-items: baseline; font-size: 13.5px; color: var(--sk-text-2); }
.lc-step__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-step__glyph { font: 400 12px var(--sk-font-mono); color: var(--sk-text-3); }
.lc-step[data-step='done'] { color: var(--sk-text-3); }
.lc-step[data-step='done'] .lc-step__glyph { color: var(--st-done); }
.lc-step[data-step='now'] { color: var(--sk-text); font-weight: 500; }
.lc-step[data-step='now'] .lc-step__glyph { color: var(--lc-hue); }
.lc-roster__btn { all: unset; box-sizing: border-box; width: 100%; display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; align-items: center; gap: 8px; cursor: pointer; border-radius: 10px; padding: 2px 4px; }
.lc-roster__btn:hover { background: rgba(255,255,255,.05); }
.lc-roster__blob { position: relative; display: grid; place-items: center; width: 26px; height: 26px; }
.lc-roster__blob .lc-dot { right: -1px; bottom: 0; width: 7px; height: 7px; }
.lc-roster__name { font: 500 13.5px var(--sk-font-title); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lc-roster__word { font: 400 10.5px var(--sk-font-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--sk-text-3); }
.lc-roster__m[data-status='waiting'] .lc-roster__word { color: var(--st-waiting); }
.lc-roster__m[data-status='failed'] .lc-roster__word, .lc-roster__m[data-status='stopped'] .lc-roster__word { color: var(--st-failed); }
.lc-roster__m[data-status='working'] .lc-roster__word { color: var(--st-working); }
.lc-roster__m[data-status='done'] .lc-roster__word { color: var(--st-done); }
.lc-roster__more { padding: 2px 4px; font: 400 11px var(--sk-font-mono); color: var(--sk-text-3); }
.lc-empty { margin: 0; font-size: 13px; color: var(--sk-text-3); }

/* compact: the deck alone, stacked tighter */
.lc--compact .lc-deck { min-height: 0; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: 'left head' 'left counts' 'says says' 'live live' 'foot foot'; gap: 8px 12px; padding: 12px 14px 14px 12px; border-radius: 64px 30px 30px 64px; }
.lc--compact .lc-head { display: grid; gap: 2px; }
.lc--compact .lc-right { display: contents; }
.lc--compact .lc-left { grid-area: left; }
.lc--compact .lc-head { grid-area: head; }
.lc--compact .lc-counts { grid-area: counts; padding: 8px 4px; }
.lc--compact .lc-says { grid-area: says; font-size: 13px; }
.lc--compact .lc-live { grid-area: live; }
.lc--compact .lc-foot { grid-area: foot; }
.lc--compact .lc-name { font-size: 19px; }
.lc--compact .lc-count .sk-dot { --s: 20px; }
.lc--compact .lc-count .sk-label { font-size: 7.5px; letter-spacing: 0; gap: 3px; }
.lc--compact .lc-count .sk-label::before { display: none; } /* the number carries the colour; the label needs the room */
.lc--compact .lc-count .sk-dot { color: color-mix(in srgb, var(--hue) 55%, #fff); }
.lc--compact .lc-crew__m { margin-right: -8px; }
.lc--compact .lc-crew__btn { width: 26px; height: 26px; }
.lc--compact .lc-dot { width: 7px; height: 7px; right: 1px; bottom: 2px; }
.lc--compact .lc-actions { gap: 6px; }
.lc--compact .lc-badge { top: -10px; right: 16px; padding: 4px 10px; font-size: 11px; }

/* a narrow full deck stacks: core above, everything else under it; the board drops its columns */
@container (max-width: 520px) {
  .lc--full .lc-deck { grid-template-columns: minmax(0, 1fr); justify-items: stretch; text-align: center; gap: 14px; border-radius: 110px 110px 34px 34px / 90px 90px 34px 34px; padding: 22px 18px 18px; }
  .lc--full .lc-left { justify-self: center; }
  .lc--full .lc-head, .lc--full .lc-name, .lc--full .lc-live, .lc--full .lc-crew { justify-content: center; }
  .lc--full .lc-deck > .lc-actions { flex-direction: row; justify-self: center; }
  .lc--full .lc-badge { right: 20px; }
  .lc--full .lc-board__body { grid-template-columns: minmax(0, 1fr); }
}
@container (max-width: 370px) { .lc-foot .lc-crew__m { margin-right: -12px; } }

/* only a working lead moves: the core breathes, a spark runs round the ring (transform and opacity only) */
.lc[data-working] .lc-core__blob { animation: sk-breathe 4.2s ease-in-out infinite; }
.lc[data-working] .lc-sweep { opacity: 1; animation: lc-spin 5s linear infinite; }
.lc[data-state='idle'] .lc-core__glow { opacity: .5; }
.lc[data-state='failure'] .lc-deck { box-shadow: inset 0 1px 0 rgba(255,255,255,.18), inset 0 0 0 1px color-mix(in srgb, var(--st-failed) 40%, transparent), 0 28px 80px -40px var(--st-lead), 0 22px 70px -30px var(--st-failed); }
.lc[data-state='all-done'] .lc-ring__track { stroke: color-mix(in srgb, var(--st-done) 45%, transparent); }

/* mini: a chip */
.lc--mini { all: unset; box-sizing: border-box; position: relative; display: inline-flex; align-items: center; gap: 10px; max-width: 100%; padding: 5px 16px 5px 5px; border-radius: 999px; cursor: pointer;
  background: radial-gradient(70% 140% at 0% 50%, color-mix(in srgb, var(--st-lead) 34%, transparent), transparent 70%), #0b0916;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.16), inset 0 0 0 1px rgba(185,166,255,.2), 0 10px 30px -14px var(--lc-hue); color: var(--sk-text); font-family: var(--sk-font-title); }
.lc--mini:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.lc--mini .lc-sweep { display: none; }
.lc-mini__name { display: inline-flex; align-items: center; gap: 6px; font: 600 14px var(--sk-font-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lc-mini__counts { display: inline-flex; gap: 8px; }
.lc-mini__counts > span { display: inline-flex; align-items: center; gap: 4px; }
.lc-mini__counts i { width: 6px; height: 6px; border-radius: 50%; background: var(--st-idle); }
.lc-mini__counts [data-status='working'] i { background: var(--st-working); }
.lc-mini__counts [data-status='waiting'] i { background: var(--st-waiting); }
.lc-mini__counts [data-status='done'] i { background: var(--st-done); }
.lc-mini__counts [data-status='failed'] i { background: var(--st-failed); }
.lc-mini__attn { position: absolute; top: 2px; left: 34px; width: 9px; height: 9px; border-radius: 50%; background: var(--st-waiting); box-shadow: 0 0 0 2px #0b0916; }
.lc--mini .lc-ring__track { stroke-dasharray: 0 3.6; stroke-width: 1.2; }
.lc--mini .lc-ring__arc { stroke-width: 2; }
.lc--mini .lc-ring__halo { stroke-width: 5; }

/* the kit's blobs animate on their own: here only a working lead's star does; the crew's small blobs always hold still */
.lc:not([data-working]) .sk-blob, .lc:not([data-working]) .sk-blob *, .lc-crew .sk-blob, .lc-crew .sk-blob *, .lc-roster .sk-blob, .lc-roster .sk-blob * { animation: none !important; }
@keyframes lc-spin { to { transform: rotate(360deg); } }
.is-offscreen .lc *, .lc.is-offscreen *, html.is-hidden .lc * { animation-play-state: paused !important; }
@media (prefers-reduced-motion: reduce) { .lc, .lc * { animation: none !important; transition: none !important; } }
`

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('lc-style')) return
  const style = document.createElement('style')
  style.id = 'lc-style'
  style.textContent = STYLE
  document.head.append(style)
}
