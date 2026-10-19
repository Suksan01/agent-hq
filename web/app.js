import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, createRoot, htm, Card as HeroCard, Chip as HeroChip, ProgressBar as HeroProgressBar, BotAvatar } from './vendor/libs.js'
import { NODE_H, NODE_W, buildWorld, fitView, regionOf, uidOf } from './world.js'
import { GLYPH, arrivals, catchUpRow, feedRows, inboxOf } from './feed.js'
import { levelOf, timelineOf } from './drawer.js'
import { soundSummary, soundsFor } from './sounds.js'
import { playEvent } from './space-sounds.js'
import { connectEvents, postAction } from './net.js'
import { completedTasks, confettiPieces, delightSummary, levelUps, skyAt } from './delight.js'

const html = htm.bind(React.createElement)

// HeroUI 3's Card, Chip and ProgressBar, bundled in ./vendor/libs.js; the plain elements with HeroUI's CSS classes stay as
// the fallback should a component be missing
const UI = { Card: HeroCard, Chip: HeroChip, ProgressBar: HeroProgressBar }

// the islands drawing is optional: without it the sessions are drawn as plain patches on the paper
const islandsReady = import('./islands.js').catch(error => {
  console.warn('Agent HQ: islands did not load, drawing plain patches', error)
  return null
})

const TONE_COLOR = { running: 'accent', needs_input: 'warning', done: 'success', error: 'danger' }
const STATUS_LABEL = { pending: 'queued', running: 'running', waiting: 'needs approval', idle: 'idle', completed: 'done', failed: 'failed', killed: 'stopped' }
// a card's soft fill and its line colour, both derived from the agent's bot colour
const pastelOf = c => `color-mix(in srgb, ${c} 30%, #FFF6E6)`
const deepOf = c => `color-mix(in srgb, ${c} 60%, #2B140F)`
// a setting the person's browser remembers (per viewer; never needed: without storage it starts from the default each time)
function useStored(key, fallback) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw) } catch { return fallback }
  })
  const set = next => {
    setValue(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage is blocked: the choice lasts until the page closes */ }
  }
  return [value, set]
}

// sounds: the browser only lets audio start after the person has touched the page, so the first touch creates (and wakes) the context
let audio = null
function wakeAudio() {
  try {
    const Context = window.AudioContext ?? window.webkitAudioContext
    audio = audio ?? (Context ? new Context() : null)
    if (audio?.state === 'suspended') audio.resume()
  } catch { /* no audio on this device */ }
}
function playSound(name) {
  wakeAudio()
  try { if (audio?.state === 'running') playEvent(audio, name) } catch { /* a sound that cannot play is not worth a message */ }
}

const SEA_REACH = 3000 // the sea is drawn this far beyond the islands, so panning never shows its edge

function Card({ className = '', children }) {
  return UI?.Card ? html`<${UI.Card} variant="secondary" className=${'card ' + className}>${children}<//>`
    : html`<div className=${'card card--secondary ' + className}>${children}</div>`
}
const CardContent = ({ children }) => UI?.Card?.Content
  ? html`<${UI.Card.Content}>${children}<//>` : html`<div className="card__content">${children}</div>`
function Chip({ color = 'default', children }) {
  return UI?.Chip ? html`<${UI.Chip} color=${color} variant="soft" size="sm">${children}<//>`
    : html`<span className=${`chip chip--sm chip--soft chip--${color}`}>${children}</span>`
}
const TONES = [['running', 'working'], ['needs_input', 'waiting'], ['done', 'done'], ['error', 'failed']]
const Stamp = ({ tone, n, label }) => html`<div className=${'stamp ' + tone}><b>${n}</b><span>${label}</span></div>`
function Progress({ value, tone = 'running', label }) {
  const pct = Math.max(0, Math.min(100, value))
  if (UI?.ProgressBar?.Track) {
    return html`<${UI.ProgressBar} aria-label=${label} value=${pct} color=${TONE_COLOR[tone]} size="sm">
      <${UI.ProgressBar.Track}><${UI.ProgressBar.Fill} /><//><//>`
  }
  return html`<div className="fallback-bar" style=${{ '--tone': `var(--tone-${tone})` }} role="progressbar" aria-label=${label} aria-valuenow=${pct}><div style=${{ width: pct + '%' }}></div></div>`
}

// an agent as the person addresses it: "Mochi-chan (frontend-dev-1)", its nickname first, its real name in brackets
const hasNickname = agent => Boolean(agent.nickname) && agent.nickname !== agent.name
const whoOf = agent => (hasNickname(agent) ? `${agent.nickname} (${agent.name})` : agent.name)
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// a toast from the engine names agents by their real name: add each one's nickname
function nicknamed(text, agents) {
  const named = agents.filter(a => !a.isMain && hasNickname(a)).sort((a, b) => b.name.length - a.name.length)
  if (named.length === 0) return text
  const pattern = new RegExp(`(?<![\\w-])(${named.map(a => escapeRe(a.name)).join('|')})(?![\\w-])`, 'g')
  return text.replace(pattern, name => whoOf(named.find(a => a.name === name)))
}

// a working agent with no todos yet still shows a bar: the status of a board task it owns, else a drifting shimmer (no percentage)
const TASK_BAR = { pending: [0, 'pending'], in_progress: [50, 'in progress'], completed: [100, 'done'] }
function StepsBar({ agent }) {
  const { todos, fallback } = agent
  const label = whoOf(agent) + ' progress'
  if (todos) {
    const tone = agent.tone === 'error' ? 'error' : todos.done === todos.total ? 'done' : 'running'
    return html`<div className="todo"><${Progress} value=${pctOf(todos)} tone=${tone} label=${label} /><span>${todos.done}/${todos.total}</span></div>`
  }
  if (fallback?.kind === 'task') {
    const [value, word] = TASK_BAR[fallback.status] ?? TASK_BAR.pending
    return html`<div className="todo"><${Progress} value=${value} tone=${value === 100 ? 'done' : 'running'} label=${label} /><span>${word}</span></div>`
  }
  if (fallback?.kind === 'sweep') {
    const tools = `${agent.tools} tool${agent.tools === 1 ? '' : 's'}`
    return html`<div className="todo"><div className="fallback-bar shimmer" role="progressbar" aria-label=${label + ': getting started'}><div></div></div><span>getting started · ${tools}</span></div>`
  }
  return html`<div className="todo"><span style=${{ color: 'var(--hq-faint)' }}>no steps tracked</span><span></span></div>`
}

const pctOf = p => (!p || !p.total ? 0 : p.done === p.total ? 100 : Math.min(99, Math.round((p.done / p.total) * 100)))
const elapsed = ms => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

// the mascot: a Bot Avatars character (libraries.dev/bots, MIT) in the agent's state; the pixel sprite the terminal draws,
// frame by frame, is the fallback
const seedOf = id => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) / 4294967296

// the pixel sprite's frame counter lives in the sprite itself, so a tick re-renders one mascot, not the page; it ticks only
// while the agent works and the tab is showing
function useBeat(active) {
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => { if (!document.hidden) setBeat(b => b + 1) }, 220)
    return () => clearInterval(timer)
  }, [active])
  return beat
}

function PixelBot({ mascot, running }) {
  const beat = useBeat(running)
  const frame = mascot.frames[beat % mascot.frames.length] ?? []
  const cells = []
  frame.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') cells.push(html`<rect key=${x + '-' + y} x=${x} y=${y} width="1.02" height="1.02" fill=${mascot.palette[ch] ?? '#f0f'} />`)
  }))
  return html`<svg className="pixel" viewBox="0 0 12 10" width="54" height="45" shapeRendering="crispEdges">${cells}</svg>`
}

function Mascot({ agent }) {
  const { mascot, tone } = agent
  const badge = tone === 'needs_input' ? html`<span className="badge wait">?</span>` : tone === 'error' ? html`<span className="badge fail">!</span>` : null
  const body = BotAvatar
    ? html`<${BotAvatar} type=${mascot.type} state=${mascot.state} size=${50} hat=${mascot.hat} theme="light" seed=${seedOf(agent.id)}
        color=${mascot.color} paused=${tone !== 'running'} interactive=${false}
        saturation=${tone === 'error' ? 0.35 : undefined} brightness=${tone === 'error' ? 0.75 : undefined} aria-label=${whoOf(agent)} />`
    : html`<${PixelBot} mascot=${mascot} running=${tone === 'running'} />`
  return html`<div className="mascot" title=${mascot.type}>${body}${badge}</div>`
}

function Links({ cards, width, height, pulses }) {
  const byUid = new Map(cards.map(c => [c.uid, c]))
  return html`<svg className="links" width=${width} height=${height}>
    ${cards.filter(c => c.parentUid && byUid.has(c.parentUid)).map(c => {
      // centre to centre with a slight bend; the cards drawn over the line hide its ends
      const { x: x1, y: y1 } = byUid.get(c.parentUid)
      const { x: x2, y: y2 } = c
      const bend = 0.12
      const qx = (x1 + x2) / 2 - (y2 - y1) * bend, qy = (y1 + y2) / 2 + (x2 - x1) * bend
      const d = `M${x1} ${y1} Q ${qx} ${qy}, ${x2} ${y2}`
      // only an agent at work gets a flowing line in its (ink-darkened) colour; idle, waiting, done and failed ones a still ink line
      const working = c.agent.tone === 'running'
      const color = working ? deepOf(c.agent.mascot.color) : 'rgba(43, 20, 15, 0.45)'
      return html`<g key=${c.uid}>
        <path className="link-base" d=${d} />
        ${working ? html`<path className="link-flow" d=${d} style=${{ stroke: color, color }} />` : html`<path className="link-idle" d=${d} />`}
        ${pulses[c.uid] && html`<path key=${pulses[c.uid]} className="link-pulse" d=${d} style=${{ stroke: deepOf(c.agent.mascot.color) }} />`}
        <circle cx=${x2} cy=${y2} r="4.5" fill=${color} stroke="#F3ECE2" strokeWidth="2" />
      </g>`
    })}
  </svg>`
}

// the status chip's words: the lead says whether its team is at work
const statusTextOf = agent => (agent.isMain ? (agent.tone === 'running' ? 'leading' : 'idle') : STATUS_LABEL[agent.status] ?? agent.status)

function Node({ card, clock, summary, gone, pulseAt, needsYou, sparkle }) {
  const { agent } = card
  const left = card.x - NODE_W / 2, top = card.y - NODE_H / 2
  const end = agent.endedAt ?? clock
  const statusText = statusTextOf(agent)
  // the lead is lime from the stylesheet; every other card takes a pastel of its bot's colour
  const style = agent.isMain ? { left, top } : { left, top, '--tone': `var(--tone-${agent.tone})`, '--pastel': pastelOf(agent.mascot.color) }
  return html`<div className=${'node' + (agent.isMain ? ' lead' : '') + (gone ? ' gone' : '') + (needsYou ? ' needs-you' : '')} data-id=${card.uid} data-tone=${agent.tone} style=${style}>
    <div className="glow"></div>
    ${pulseAt && html`<span key=${pulseAt} className="pulse" style=${{ '--ring': deepOf(agent.mascot.color) }}></span>`}
    ${needsYou && html`<span className="needs-flag">needs you</span>`}
    ${sparkle && html`<span key=${sparkle.at} className="sparkle" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map(i => html`<i key=${i}>✦</i>`)}<b>Level ${sparkle.level}!</b></span>`}
    <${Card}>
      <${CardContent}>
        <div style=${{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 10 }}>
          <div className="head">
            <${Mascot} agent=${agent} />
            <div className="who">
              <div className="name" title=${whoOf(agent)}>${agent.nickname || agent.name}</div>
              ${!agent.isMain && html`<div className="real" title=${agent.name + ' · ' + agent.role}>${hasNickname(agent) ? agent.name + ' · ' : ''}${agent.role}</div>`}
              <div className="chips">
                ${agent.isMain && html`<${Chip} color="warning">★ Team lead<//>`}
                <${Chip} color=${TONE_COLOR[agent.tone]}>${statusText}<//>
              </div>
            </div>
          </div>
          <div className="line now" title=${agent.now}>${agent.now}</div>
          ${agent.isMain ? html`<div className="line summary">${summary}</div>` : agent.next ? html`<div className="line" title=${agent.next}><span className="k">next</span>${agent.next}</div>`
            : agent.last ? html`<div className="line" title=${agent.last}><span className="k">last</span>${agent.last}</div>`
            : html`<div className="line"> </div>`}
          <${StepsBar} agent=${agent} />
          <div className="foot"><span>${agent.tools} tools${agent.lastTool && agent.tone === 'running' ? ' · ' + agent.lastTool : ''}</span><span>${agent.isMain ? '' : elapsed(end - agent.startedAt)}</span></div>
        </div>
      <//>
    <//>
  </div>`
}

// the lead card's line: how much of its team is at work
const summaryOf = island => (island.members === 0 ? 'No members started yet' : `${island.working} of ${island.members} members working`)

// a burst of confetti where a task was just completed; it removes itself (App) after it has fallen
function Confetti({ burst }) {
  return html`<div className="confetti" style=${{ left: burst.x, top: burst.y }} aria-hidden="true">
    ${confettiPieces(burst.seed).map((p, i) => html`<i key=${i} style=${{ '--dx': p.dx + 'px', '--dy': p.dy + 'px', '--turn': p.turn + 'deg', width: p.size, height: p.round ? p.size : Math.round(p.size / 2), background: p.color, animationDelay: p.delay + 'ms', borderRadius: p.round ? '50%' : '3px' }}></i>`)}
  </div>`
}

// the canvas: a sea with an island per session, laid out for the stage's size and fitted into it, until the person drags
// (pan) or scrolls (zoom); Fit puts it back (on the chosen island, if one is), ⛶ fills the screen, + adds an agent
function Stage({ world, focus, isl, clockOf, pulses, needs, soundOn, onSound, bursts, sparkles, sky, onAdd, onSelect, onLead, hidden, onFinished, boardOpen, onBoard, taskCount, narrow }) {
  const [confirmClear, setConfirmClear] = useState(false)
  const stage = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [view, setView] = useState(null) // null: auto-fit; else { x, y, z } the person chose
  const drag = useRef(null)
  // islands and cards scrolled or zoomed out of view hold their animations (the stylesheet reads data-offscreen)
  const shown = world.islands.map(i => i.key).join('|') + '#' + world.cards.map(c => c.uid).join('|')
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return undefined
    const observer = new IntersectionObserver(entries => entries.forEach(e => e.target.toggleAttribute('data-offscreen', !e.isIntersecting)))
    stage.current?.querySelectorAll('.island, .node').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [shown])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }))
    if (stage.current) observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  // the floating panels' rectangles (title, task board, toolbar), measured so Fit can keep cards out from under them
  const [panels, setPanels] = useState([])
  useLayoutEffect(() => {
    const els = ['.hud-top', '.hud-board', '.tools', '.focus-bar', '.inbox'].map(selector => document.querySelector(selector)).filter(Boolean)
    const measure = () => {
      const next = els.filter(el => !document.fullscreenElement || stage.current.contains(el)).map(el => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      })
      setPanels(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    const observer = new ResizeObserver(measure)
    els.forEach(el => observer.observe(el))
    measure()
    return () => observer.disconnect()
  }, [boardOpen, box.w, box.h, narrow, world.islands.length > 1, needs.total > 0])
  const region = useMemo(() => regionOf(world, focus), [world, focus])
  const auto = useMemo(() => (box.w > 0 ? fitView(region, box, boardOpen, panels) : { z: 1, x: 16, y: 16 }), [region, box, boardOpen, panels])
  const focusKey = (focus ?? []).join()
  useEffect(() => setView(null), [focusKey]) // choosing an island frames it
  const v = view ?? auto
  const zoomAt = (factor, cx, cy) => {
    const z = Math.max(0.08, Math.min(2.5, v.z * factor))
    setView({ z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z })
  }
  const onWheel = e => {
    const r = stage.current.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top)
  }
  const onDown = e => {
    if (e.target.closest('button, .modal')) return
    drag.current = { sx: e.clientX, sy: e.clientY, x: v.x, y: v.y, z: v.z }
    stage.current.setPointerCapture(e.pointerId)
    stage.current.classList.add('dragging')
  }
  const onMove = e => {
    const d = drag.current
    if (d) setView({ z: d.z, x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy })
  }
  const onUp = e => {
    const d = drag.current
    drag.current = null
    stage.current?.classList.remove('dragging')
    // a press that barely moved is a click: on a card, it opens that agent's actions
    if (d && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) {
      const id = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.closest?.('.node'))?.closest('.node')?.dataset.id
      if (id) onSelect(id)
    }
  }
  const full = () => (document.fullscreenElement ? document.exitFullscreen() : stage.current.requestFullscreen()).catch(() => {})
  return html`<section className="stage" ref=${stage} onWheel=${onWheel} onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}>
    <div className="tools">
      <button className="tb" title="Send the lead a message" onClick=${onLead}>Message lead</button>
      <button className=${'tb' + (boardOpen ? ' on' : '')} title="Show or hide the task board" onClick=${onBoard}>Tasks${taskCount ? ` ${taskCount}` : ''}</button>
      <button className="tb" title="Hide or show finished agents" onClick=${() => onFinished(hidden ? 'show' : 'hide')}>${hidden ? 'Show done' : 'Hide done'}</button>
      <button className=${'tb' + (confirmClear ? ' danger' : '')} title="Remove finished agents and tasks from the view"
        onClick=${() => (confirmClear ? (onFinished('clear'), setConfirmClear(false)) : (setConfirmClear(true), setTimeout(() => setConfirmClear(false), 3000)))}>${confirmClear ? 'Clear? Click again' : 'Clear done'}</button>
      <button className="tb" title="Fit the team in view" onClick=${() => setView(null)}>Fit</button>
      <button className=${'tb' + (soundOn ? ' on' : '')} title=${soundOn ? 'Sounds are on: click to mute' : 'Sounds are off: click to turn on'} aria-pressed=${soundOn} aria-label="Sounds" onClick=${onSound}>${soundOn ? '♪' : '♪̸'}</button>
      <button className="tb" title="Full screen" onClick=${full}>⛶</button>
      <button className="tb add" title="Add an agent" onClick=${onAdd}>+</button>
    </div>
    <div className=${'canvas' + (view && !drag.current ? ' ease' : '')} style=${{ width: world.width, height: world.height, transform: `translate(${v.x}px, ${v.y}px) scale(${v.z})`, '--sea-now': sky.sea, '--shallow-now': sky.shallow, '--night': sky.night }}>
      ${isl && html`<div className="sea" style=${{ left: -SEA_REACH, top: -SEA_REACH }}><${isl.Sea} html=${html} width=${world.width + 2 * SEA_REACH} height=${world.height + 2 * SEA_REACH} /></div>`}
      ${world.islands.map(i => html`<div key=${i.key} className=${'island' + (isl ? '' : ' plain') + ' mood-' + i.mood} data-island=${i.key} style=${{ left: i.x, top: i.y, width: i.w, height: i.h }}>
        ${isl ? html`<${isl.Island} html=${html} seed=${i.key} width=${i.w} height=${i.h} mood=${i.mood} label=${i.label} />` : html`<span className="island-label">${i.label}</span>`}
        ${needs.byIsland.get(i.key) > 0 && html`<span className="island-flag">⚑ ${needs.byIsland.get(i.key)} ${needs.byIsland.get(i.key) === 1 ? 'needs' : 'need'} you</span>`}
      </div>`)}
      <${Links} cards=${world.cards} width=${world.width} height=${world.height} pulses=${pulses} />
      ${world.cards.map(c => html`<${Node} key=${c.uid} card=${c} clock=${clockOf(c.session)} summary=${c.agent.isMain ? summaryOf(world.islands[c.island]) : ''} gone=${!world.islands[c.island].alive} pulseAt=${pulses[c.uid]} needsYou=${needs.uids.has(c.uid)} sparkle=${sparkles[c.uid]} />`)}
      ${bursts.map(b => html`<${Confetti} key=${b.id} burst=${b} />`)}
    </div>
    <div className="zoom">${Math.round(v.z * 100)}% · drag to move · scroll to zoom</div>
  </section>`
}

// /events and /state carry {v: 2, sessions: [{session, cwd, label, alive, snapshot}]}; an older single snapshot is one session
const BLANK = { at: 0, team: null, agents: [], tasks: [], roles: [], overall: { done: 0, active: 0, total: 0 }, tasksProgress: { done: 0, active: 0, total: 0 }, notice: null, hideFinished: false, events: [] }
function sessionsOf(data) {
  const list = data.v === 2 ? data.sessions ?? [] : [{ session: null, label: data.team?.name ?? 'Agent HQ', alive: true, snapshot: data }]
  // in a stable order (the hub may reshuffle after a takeover): by name, then session id; the same order as the islands
  return list.filter(s => s?.snapshot).map(s => ({ session: s.session ?? null, label: s.label || 'session', alive: s.alive !== false, snapshot: { ...BLANK, ...s.snapshot } }))
    .sort((a, b) => a.label.localeCompare(b.label) || String(a.session).localeCompare(String(b.session)))
}
const keyOf = s => s.session ?? 'main'

// every request the page makes: POSTed to the local server (the hub), which forwards it to the session it names; the result
// comes back with that session's next state push, as a toast
async function post(action, target) {
  const body = target?.session ? { ...action, session: target.session } : action
  const res = await postAction(body) // one idempotency key per click, kept across its retries
  if (res.ok) return { ok: true, text: 'Sent to Agent HQ…' }
  const where = target?.label ? `${target.label}: ` : ''
  if (res.status === 404) return { ok: false, text: `${where}that session has stopped` }
  if (res.status === 503) return { ok: false, text: `${where}could not reach the session` }
  if (res.status === 429) return { ok: false, text: `${where}too many requests are waiting; try again shortly` }
  return { ok: false, text: 'Could not reach Agent HQ' }
}

// one agent in full, in a drawer: who it is, what it does now and next, its progress, tools, time, level and badges (when the
// snapshot has them), its own timeline, and the actions: message it while it works or waits, stop it after a confirm; the lead takes messages only
function Drawer({ card, session, isMulti, clock, onClose, onSent }) {
  const { agent } = card
  const [text, setText] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const finished = ['completed', 'failed', 'killed'].includes(agent.status)
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const run = async (action, done) => {
    setBusy(true)
    const result = await post(action, session)
    setBusy(false)
    onSent(result.ok ? { ok: true, text: `Sent to ${whoOf(agent)}…` } : result)
    if (result.ok) done()
  }
  const level = levelOf(agent.xp)
  const timeline = timelineOf(session.snapshot.events, agent.id)
  const end = agent.endedAt ?? clock
  return html`<aside className="drawer" role="dialog" aria-label=${whoOf(agent)}>
    <header className="drawer-head">
      <${Mascot} agent=${agent} />
      <div className="who">
        <h3 title=${whoOf(agent)}>${agent.nickname || agent.name}</h3>
        <div className="real">${hasNickname(agent) ? agent.name + ' · ' : ''}${agent.role}${isMulti ? ` · on ${session.label}` : ''}</div>
        <div className="chips">
          ${agent.isMain && html`<${Chip} color="warning">★ Team lead<//>`}
          <${Chip} color=${TONE_COLOR[agent.tone]}>${statusTextOf(agent)}<//>
        </div>
      </div>
      <button className="tb drawer-x" aria-label="Close" onClick=${onClose}>✕</button>
    </header>
    <section>
      <h4>Right now</h4>
      <div className="line now wrap">${agent.now}</div>
      ${agent.next && html`<div className="line wrap"><span className="k">next</span>${agent.next}</div>`}
      ${agent.last && html`<div className="line wrap"><span className="k">last</span>${agent.last}</div>`}
      <${StepsBar} agent=${agent} />
    </section>
    <section className="tiles">
      <div><b>${agent.tools}</b><span>tools used</span></div>
      <div><b>${elapsed(end - agent.startedAt)}</b><span>${agent.endedAt ? 'it ran' : 'running for'}</span></div>
      <div><b title=${agent.lastTool ?? ''}>${agent.lastTool ?? '—'}</b><span>last tool</span></div>
    </section>
    ${level && html`<section>
      <h4>Level</h4>
      <div className="level"><span className="lv">Lv ${level.level}</span><${Progress} value=${level.pct} tone="done" label=${whoOf(agent) + ' level progress'} /><span>${level.into}/${level.need} xp</span></div>
      ${level.badges.length > 0 && html`<div className="badges">${level.badges.map(b => html`<span key=${b.id} className="badge-chip" title=${b.hint}>${b.title}</span>`)}</div>`}
    </section>`}
    <section>
      <h4>Timeline</h4>
      <ol className="timeline">
        ${timeline.map(e => html`<li key=${e.n} className=${'tl-' + e.kind}><time>${elapsed(clock - e.at)}</time><span className="fg">${GLYPH[e.kind] ?? '·'}</span><span>${e.text}</span></li>`)}
        <li className="tl-start"><time>${elapsed(clock - agent.startedAt)}</time><span className="fg">◆</span><span>started</span></li>
      </ol>
    </section>
    <section className="drawer-actions">
      ${finished ? html`<div className="line wrap">This agent has finished; there is nothing to send or stop.</div>` : html`
        <label>${agent.isMain ? 'Message the lead (runs once Claude is free)' : 'Message this agent'}
          <textarea autoFocus value=${text} onInput=${e => setText(e.target.value)} placeholder=${agent.isMain ? 'What should the team do next?' : 'Extra instructions, a correction, a question…'} />
        </label>
        <div className="row">
          ${!agent.isMain && (confirming
            ? html`<button className="tb danger" disabled=${busy} onClick=${() => run({ type: 'stop', agent: agent.id }, onClose)}>Stop it: confirm</button>`
            : html`<button className="tb" onClick=${() => setConfirming(true)}>Stop agent…</button>`)}
          <button className="tb add" style=${{ fontSize: 13 }} disabled=${busy || !text.trim()}
            onClick=${() => run(agent.isMain ? { type: 'lead', text } : { type: 'message', agent: agent.id, text }, () => setText(''))}>${busy ? 'Sending…' : 'Send'}</button>
        </div>`}
    </section>
  </aside>`
}

// the "+" dialog: the island to add to (when there are several), one of its team's roles (with how many of it are at work) and the task
function AddAgent({ sessions, initial, onClose, onSent }) {
  const [key, setKey] = useState(keyOf(initial))
  const target = sessions.find(s => keyOf(s) === key) ?? initial
  const roles = target.snapshot.roles ?? []
  const [role, setRole] = useState(roles.find(r => r.active < r.count)?.id ?? roles[0]?.id ?? '')
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = roles.some(r => r.id === role) ? role : roles.find(r => r.active < r.count)?.id ?? roles[0]?.id ?? ''
  const send = async () => {
    setBusy(true)
    const result = await post({ type: 'spawn', role: chosen, task }, target)
    setBusy(false)
    onSent(result.ok ? { ok: true, text: 'Sent: the agent starts within a second…' } : result)
  }
  return html`<div className="modal-bg" onPointerDown=${e => e.target === e.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-label="Add an agent">
      <h3>Add an agent</h3>
      ${sessions.length > 1 && html`<label>Island
        <select value=${key} onChange=${e => setKey(e.target.value)}>${sessions.map(s => html`<option key=${keyOf(s)} value=${keyOf(s)}>${s.label}</option>`)}</select>
      </label>`}
      <label>Role
        <select value=${chosen} onChange=${e => setRole(e.target.value)}>
          ${roles.map(r => html`<option key=${r.id} value=${r.id} disabled=${r.active >= r.count}>${r.title} · ${r.active}/${r.count} at work</option>`)}
        </select>
      </label>
      <label>Task
        <textarea autoFocus placeholder="What should it do? Be specific: the goal, the files, what done means." value=${task} onInput=${e => setTask(e.target.value)} />
      </label>
      <div className="row">
        <button className="tb" onClick=${onClose}>Cancel</button>
        <button className="tb add" style=${{ fontSize: 13 }} disabled=${busy || !task.trim() || !chosen} onClick=${send}>${busy ? 'Sending…' : 'Add agent'}</button>
      </div>
    </div>
  </div>`
}

function TaskList({ tasks, progress }) {
  const order = { in_progress: 0, pending: 1, completed: 2 }
  const sorted = [...tasks].sort((a, b) => order[a.status] - order[b.status] || Number(a.id) - Number(b.id))
  const open = new Set(tasks.filter(t => t.status !== 'completed').map(t => t.id))
  return html`<div className="board-list">
    ${progress.total > 0 && html`<${Progress} value=${pctOf(progress)} tone=${progress.done === progress.total ? 'done' : 'running'} label="Task board progress" />`}
    ${sorted.length === 0 ? html`<div className="task"><span className="line">No board tasks yet.</span></div>`
      : sorted.map(t => html`<div key=${t.id} className=${'task ' + t.status + (t.status === 'completed' ? ' done' : '')}>
          <div className="t"><span className="id">#${t.id}</span><span className="subject">${t.subject}</span></div>
          <div className="chips">
            <${Chip} color=${t.status === 'completed' ? 'success' : t.status === 'in_progress' ? 'accent' : 'default'}>${t.status.replace('_', ' ')}<//>
            ${t.owner && html`<${Chip} color="default">@${t.owner}<//>`}
            ${t.blockedBy.filter(b => open.has(b)).length > 0 && html`<${Chip} color="warning">waits on ${t.blockedBy.filter(b => open.has(b)).map(b => '#' + b).join(' ')}<//>`}
          </div>
        </div>`)}
  </div>`
}

// the board of every island shown, each under its island's name when there are several
function Board({ sections }) {
  const total = sections.reduce((p, s) => ({ done: p.done + s.progress.done, total: p.total + s.progress.total }), { done: 0, total: 0 })
  return html`<aside className="board">
    <h2><span>Task board</span><span>${total.done}/${total.total}</span></h2>
    ${sections.map(s => html`<section key=${s.key} className="board-section">
      ${sections.length > 1 && html`<h3 className="board-island"><span>${s.label}</span><span>${s.progress.done}/${s.progress.total}</span></h3>`}
      <${TaskList} tasks=${s.tasks} progress=${s.progress} />
    </section>`)}
  </aside>`
}

// the approvals inbox: every agent waiting for the person, on any island; "Open message" opens that agent's message box
function Inbox({ items, open, onToggle, onOpen, clockOf, isMulti }) {
  return html`<aside className=${'inbox' + (open ? ' open' : '')} aria-label="Needs you">
    <button className="inbox-head" aria-expanded=${open} onClick=${onToggle}><span className="inbox-count">${items.length}</span><span>${items.length === 1 ? 'agent needs you' : 'agents need you'}</span><span className="chev">${open ? '▾' : '▴'}</span></button>
    ${open && html`<ul className="inbox-list">
      ${items.map((i, at) => html`<li key=${i.uid + '#' + at} className="inbox-row">
        <i className="fdot" style=${{ background: i.agent.mascot.color }}></i>
        <div className="inbox-who"><b style=${{ color: deepOf(i.agent.mascot.color) }}>${i.agent.nickname || i.agent.name}</b>
          <span title=${i.text}>${i.text}${isMulti ? ' · ' + i.label : ''}${i.since ? ' · ' + elapsed(clockOf(i.session) - i.since) : ''}</span></div>
        <button className="tb" onClick=${() => onOpen(i.uid)}>Open message</button>
      </li>`)}
    </ul>`}
  </aside>`
}

// the activity feed: what just happened, newest first, each line in its agent's colour; "caught up N events" says when the page missed some
function FeedPanel({ rows, open, onToggle, clockOf, isMulti }) {
  return html`<section className="feed">
    <button className="feed-head" aria-expanded=${open} onClick=${onToggle}><span>Activity</span><span className="feed-count">${rows.length}</span><span className="chev">${open ? '▾' : '▸'}</span></button>
    ${open && html`<ol className="feed-list" aria-live="polite">
      ${rows.length === 0 ? html`<li className="feed-empty">Nothing has happened yet.</li>` : rows.map(r => r.marker
        ? html`<li key=${r.key} className="feed-row marker">${isMulti ? r.label + ': ' : ''}${r.text}</li>`
        : html`<li key=${r.key} className="feed-row">
            <i className="fdot" style=${{ background: r.agent?.mascot.color ?? 'var(--hq-faint)' }}></i>
            <span className="fg" title=${r.kind}>${GLYPH[r.kind] ?? '·'}</span>
            <b style=${{ color: r.agent ? deepOf(r.agent.mascot.color) : undefined }}>${r.agent ? r.agent.nickname || r.agent.name : r.agentId}</b>
            <span className="ft" title=${r.text}>${r.text}</span>
            <time>${isMulti ? r.label + ' · ' : ''}${elapsed(clockOf(r.session) - r.at)}</time>
          </li>`)}
    </ol>`}
  </section>`
}

// All, or one island: choosing one frames it on the sea (Fit goes back to it)
function FocusBar({ islands, focus, onFocus }) {
  const labels = islands.map(i => i.label)
  const nameOf = i => (labels.filter(l => l === i.label).length > 1 ? `${i.label} · ${String(i.session ?? '').slice(0, 4)}` : i.label)
  return html`<nav className="focus-bar" aria-label="Islands">
    <button className=${'fc' + (focus === null ? ' on' : '')} aria-pressed=${focus === null} onClick=${() => onFocus(null)}>All</button>
    ${islands.map(i => html`<button key=${i.key} className=${'fc' + (focus === i.key ? ' on' : '') + (i.alive ? '' : ' gone')} aria-pressed=${focus === i.key} onClick=${() => onFocus(i.key)} title=${i.alive ? i.label : i.label + ' (stopped)'}>
      <i className=${'dot mood-' + i.mood}></i>${nameOf(i)}
    </button>`)}
  </nav>`
}

// a portrait phone-sized screen: the title panel folds into a one-line bar and the graph takes the room
function useNarrow() {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 620px)').matches)
  useEffect(() => {
    const query = matchMedia('(max-width: 620px)')
    const update = () => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

function App() {
  const narrow = useNarrow()
  const [hudOpen, setHudOpen] = useState(false) // the title panel, unfolded, on a narrow screen
  const [env, setEnv] = useState(null) // the sessions, as last pushed
  const [online, setOnline] = useState(false)
  const [loginLost, setLoginLost] = useState(false) // the page's cookie is gone: it says so instead of reconnecting for ever
  const [isl, setIsl] = useState(null) // the islands drawing, once loaded
  const receivedAt = useRef(Date.now())
  useEffect(() => {
    islandsReady.then(module => {
      if (!module) return
      const style = document.createElement('style')
      style.textContent = module.islandCss
      document.head.append(style)
      setIsl(module)
    })
  }, [])
  useEffect(() => {
    // reopened by itself with a growing wait when the server ends the stream (e.g. 429, too many pages open)
    return connectEvents('/events', {
      onMessage: event => {
        try { setEnv(sessionsOf(JSON.parse(event.data))); receivedAt.current = Date.now(); setOnline(true) } catch { /* a half-written file: the next push fixes it */ }
      },
      onError: reason => { setOnline(false); reconnected.current = true; if (reason === 'login-lost') setLoginLost(true) },
    })
  }, [])
  useEffect(() => {
    // a hidden tab holds every animation (the stylesheet reads data-hidden)
    const mark = () => { document.documentElement.toggleAttribute('data-hidden', document.hidden) }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [])
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState(null) // a card's uid
  const [focus, setFocus] = useState(null) // an island's key, or null for all
  const [boardOpen, setBoardOpen] = useState(() => innerWidth >= 900) // closed on small screens, toggled with "Tasks"
  const [toast, setToast] = useState(null)
  const seenNotice = useRef(new Map())
  const lastN = useRef(new Map()) // per session: the newest event number seen
  const reconnected = useRef(false)
  const [pulses, setPulses] = useState({}) // a card's uid -> when an event about it last arrived
  const [markers, setMarkers] = useState([]) // "caught up" rows
  const [feedOpen, setFeedOpen] = useStored('agent-hq.feed', innerWidth >= 1400 && innerHeight >= 780)
  const [inboxOpen, setInboxOpen] = useStored('agent-hq.inbox', true)
  const [soundOn, setSoundOn] = useStored('agent-hq.sound', true)
  const lastSounds = useRef(undefined)
  const lastDelight = useRef(undefined)
  const [bursts, setBursts] = useState([]) // confetti on the sea
  const [sparkles, setSparkles] = useState({}) // a card's uid -> its latest level-up
  const [sky, setSky] = useState(() => skyAt(new Date())) // the sea's colour for the hour
  const sessions = env ?? []
  const isWorking = sessions.some(s => s.alive && (s.snapshot?.agents ?? []).some(a => a.tone === 'running'))
  // what became of a request from "+" arrives with the next state push: show it once
  useEffect(() => {
    for (const s of sessions) {
      const notice = s.snapshot.notice
      const seen = seenNotice.current.get(keyOf(s))
      if (seen === undefined) { // a page opened later doesn't replay an old notice; the first later one shows
        seenNotice.current.set(keyOf(s), notice?.seq ?? 0)
        continue
      }
      if (!notice || notice.seq <= seen) continue
      seenNotice.current.set(keyOf(s), notice.seq)
      const text = (sessions.length > 1 ? `${s.label}: ` : '') + nicknamed(notice.text, s.snapshot.agents)
      setToast({ ok: notice.ok, text: notice.ok ? `✓ ${text}` : `! ${text}` })
    }
  }, [env])
  // events that arrived: pulse each agent's card, and say so when some were missed (the page was away, or the list kept only the last 200)
  useEffect(() => {
    const fresh = {}, rows = []
    for (const s of sessions) {
      const events = s.snapshot.events ?? []
      const seen = arrivals(lastN.current.get(keyOf(s)), events)
      lastN.current.set(keyOf(s), seen.maxN)
      for (const e of seen.added) fresh[uidOf(s.session, e.agent)] = Date.now()
      const row = catchUpRow(s.session, s.label, seen, events, reconnected.current)
      if (row) rows.push(row)
    }
    reconnected.current = false
    if (Object.keys(fresh).length > 0) setPulses(p => ({ ...p, ...fresh }))
    if (rows.length > 0) setMarkers(m => [...m, ...rows].slice(-12))
  }, [env])
  // blips for what just happened: done, needs you, failed, level up (off with the ♪ button; remembered)
  useEffect(() => {
    const now = soundSummary(sessions, inboxOf)
    const names = soundsFor(lastSounds.current, now)
    lastSounds.current = now
    if (soundOn) names.forEach((name, i) => setTimeout(() => playSound(name), i * 280))
  }, [env])
  useEffect(() => {
    const timer = setInterval(() => setSky(skyAt(new Date())), 60_000)
    return () => clearInterval(timer)
  }, [])
  // a task completed: confetti where its owner stands (else the island's middle); a level up: sparkles on the card
  useEffect(() => {
    const now = delightSummary(sessions)
    const done = completedTasks(lastDelight.current, now)
    const ups = levelUps(lastDelight.current, now)
    lastDelight.current = now
    if (done.length > 0) {
      const added = done.map(d => {
        const card = world.cards.find(c => c.session === d.session && (c.agent.name === d.owner || c.agent.id === d.owner))
        const island = world.islands.find(i => i.session === d.session)
        const at = card ?? (island ? { x: island.x + island.w / 2, y: island.y + island.h / 2 } : { x: 0, y: 0 })
        return { id: `${Date.now()}-${d.session}-${d.task}`, x: at.x, y: at.y, seed: `${d.session}|${d.task}` }
      })
      setBursts(b => [...b, ...added])
      setTimeout(() => setBursts(b => b.filter(x => !added.some(a => a.id === x.id))), 2400)
    }
    if (ups.length > 0) setSparkles(p => ({ ...p, ...Object.fromEntries(ups.map(u => [uidOf(u.session, u.agent), { at: Date.now(), level: u.level }])) }))
  }, [env])
  useEffect(() => {
    const wake = () => wakeAudio()
    window.addEventListener('pointerdown', wake, { once: true })
    return () => window.removeEventListener('pointerdown', wake)
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(timer)
  }, [toast])
  const world = useMemo(() => buildWorld(sessions, narrow), [env, narrow])
  // who waits for the person, on any island (a count per island for its flag, and the cards to mark)
  const inbox = useMemo(() => sessions.flatMap(s => inboxOf(s.snapshot).flatMap(item => {
    const agent = s.snapshot.agents.find(a => a.id === item.agent)
    return agent ? [{ ...item, agent, session: s.session, label: s.label, uid: uidOf(s.session, item.agent) }] : []
  })), [env])
  const needs = useMemo(() => {
    const byIsland = new Map()
    for (const i of inbox) byIsland.set(i.session ?? 'main', (byIsland.get(i.session ?? 'main') ?? 0) + 1)
    return { uids: new Set(inbox.map(i => i.uid)), byIsland, total: inbox.length }
  }, [inbox])
  const hasSea = Boolean(isl) && sessions.length > 0
  useEffect(() => {
    document.body.classList.toggle('has-sea', hasSea)
  }, [hasSea])
  const focusKey = world.islands.some(i => i.key === focus) ? focus : null
  const focusKeys = useMemo(() => (focusKey === null ? null : [focusKey]), [focusKey])
  if (!env) return html`<div className="app"><div className="empty">Connecting to Agent HQ…</div></div>`
  if (sessions.length === 0) return html`<div className="app"><div className="empty">No Claude Code session is running. Start one with /hq web.</div></div>`

  const shown = focusKey === null ? sessions : sessions.filter(s => keyOf(s) === focusKey)
  const current = shown.find(s => s.alive) ?? shown[0] // what Message lead, "+" and the board labels act on
  const isMulti = sessions.length > 1
  const single = shown.length === 1 ? shown[0].snapshot : null
  const members = shown.flatMap(s => s.snapshot.agents.filter(a => !a.isMain))
  const count = tone => members.filter(a => a.tone === tone).length
  const overall = shown.reduce((p, s) => ({ done: p.done + s.snapshot.overall.done, total: p.total + s.snapshot.overall.total }), { done: 0, total: 0 })
  const pct = pctOf(overall)
  const title = single ? (single.team ? single.team.name : 'Your agents') : `${shown.length} islands`
  const purpose = single ? (single.team ? single.team.purpose : 'No team defined yet. Run /agent-hq:team in Claude Code to build one.') : shown.map(s => s.label).join(' · ')
  const taskCount = shown.reduce((n, s) => n + s.snapshot.tasks.length, 0)
  // the engine's clock, advanced by the time since the last push so running timers tick between updates; a stopped session's stands still
  const clockOf = session => {
    const s = sessions.find(x => x.session === session)
    return s ? (s.alive ? s.snapshot.at + (Date.now() - receivedAt.current) : s.snapshot.at) : 0
  }
  const card = selected ? world.cards.find(c => c.uid === selected) : null
  const cardSession = card ? sessions.find(s => s.session === card.session) : null
  const leadOf = s => s.snapshot.agents.find(a => a.isMain)
  const finish = async mode => {
    const targets = shown.filter(s => s.alive)
    const results = await Promise.all(targets.map(s => post({ type: 'finished', mode }, s)))
    setToast(results.find(r => !r.ok) ?? results[0] ?? { ok: false, text: 'No session is running' })
  }
  // the canvas is the whole screen; the title, progress and task board float over it as panels
  return html`<div className="app">
    <${Stage} world=${world} focus=${focusKeys} isl=${isl} clockOf=${clockOf} pulses=${pulses} needs=${needs} soundOn=${soundOn} bursts=${bursts} sparkles=${sparkles} sky=${sky}
      onSound=${() => { const next = !soundOn; setSoundOn(next); if (next) playSound('done') }} onAdd=${() => setAdding(true)} onSelect=${setSelected}
      onLead=${() => { const lead = leadOf(current); if (lead) setSelected(uidOf(current.session, lead.id)) }} hidden=${current.snapshot.hideFinished}
      onFinished=${finish} boardOpen=${boardOpen} onBoard=${() => setBoardOpen(o => !o)} taskCount=${taskCount} narrow=${narrow} />
    ${isMulti && html`<${FocusBar} islands=${world.islands} focus=${focusKey} onFocus=${setFocus} />`}
    ${needs.total > 0 && html`<${Inbox} items=${inbox} open=${inboxOpen} onToggle=${() => setInboxOpen(!inboxOpen)} onOpen=${setSelected} clockOf=${clockOf} isMulti=${isMulti} />`}
    <header className=${'hud hud-top' + (narrow && !hudOpen ? ' compact' : '')}>
      ${narrow && !hudOpen ? html`<button className="hud-bar" aria-expanded="false" title="Show the team details" onClick=${() => setHudOpen(true)}>
        <b className="mark">◆</b><span className="bar-title">${title}</span>
        <span className="minis">${TONES.map(([tone, label]) => html`<span key=${tone} className=${'stamp mini ' + tone} title=${label} aria-label=${count(tone) + ' ' + label}>${count(tone)}</span>`)}</span>
        ${needs.total > 0 && html`<span className="needs-pill">⚑ ${needs.total}</span>`}
        <span className="pct">${pct}%</span>
      </button>` : html`
      <div className="brand"><b>◆</b> Agent HQ <span className=${'live' + (online ? (isWorking ? ' busy' : '') : ' off')}><i></i>${online ? 'live' : loginLost ? 'lost its login: run /hq web again' : 'reconnecting'}</span>
        ${needs.total > 0 && html`<button className="needs-pill" onClick=${() => setInboxOpen(true)} title="Open the list of agents waiting for you">⚑ ${needs.total} need${needs.total === 1 ? 's' : ''} you</button>`}
        ${narrow && html`<button className="hud-fold" aria-expanded="true" aria-label="Fold the team details" onClick=${() => setHudOpen(false)}>▴</button>`}</div>
      <h1>${title}</h1>
      <div className="purpose">${purpose}</div>
      <div className="stats">
        ${TONES.map(([tone, label]) => html`<${Stamp} key=${tone} tone=${tone} n=${count(tone)} label=${label} />`)}
      </div>
      <div className="overall">
        <span className="label">Team</span>
        <${Progress} value=${pct} tone=${pct === 100 ? 'done' : 'running'} label="Team progress" />
        <span className="pct">${pct}%</span>
      </div>
      <${FeedPanel} rows=${feedRows(shown, markers)} open=${feedOpen} onToggle=${() => setFeedOpen(!feedOpen)} clockOf=${clockOf} isMulti=${shown.length > 1} />`}
    </header>
    ${boardOpen && html`<div className="hud hud-board"><${Board} sections=${shown.map(s => ({ key: keyOf(s), label: s.label, tasks: s.snapshot.tasks, progress: s.snapshot.tasksProgress }))} /></div>`}
    ${adding && html`<${AddAgent} sessions=${sessions.filter(s => s.alive)} initial=${current} onClose=${() => setAdding(false)} onSent=${result => { setAdding(false); setToast(result) }} />`}
    ${card && cardSession && html`<${Drawer} key=${card.uid} card=${card} session=${cardSession} isMulti=${isMulti} clock=${clockOf(card.session)}
      onClose=${() => setSelected(null)} onSent=${setToast} />`}
    ${toast && html`<div className=${'toast' + (toast.ok ? '' : ' bad') + (isMulti ? ' high' : '')} role="status">${toast.text}</div>`}
  </div>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
