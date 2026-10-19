// The "Space" view: the 3D star systems (starsystem.js) with the glass cards, chips and team titles laid over them as HTML.
//
// Cards do not follow the orbiting planets. Each agent has a fixed slot round its own system (slots.js: outside the outermost ring, on
// the side its orbit starts on, clear of every other card, title, star and other system), worked out only when the camera has been
// still for a moment and then at most once every couple of seconds; a thin leader line joins the slot to the planet as it moves. While
// the camera flies the cards ride along with their systems, then glide (a quarter second) to their new slots; a card that changes kind
// fades from one to the other. The cards are the diagram's glass cards: the lead its compact LeadDeck, a working agent or one that needs
// the person the full card, the rest the compact one, and a name chip only where there is no room (or a system is tiny on screen).
//
//   html`<${SpaceView} groups=${groups} focus=${session|null} selected=${uid} inset=${{ top, right, bottom, left }} onSelect=${(session, id) => ...}
//         onLeadMessage=${session => ...} onLeadHire=${session => ...} onLeadTasks=${() => ...} onMove=${({ dx, dy, dz, duration }) => ...}
//         onReady=${api => ...} onContextLost=${() => ...} onError=${error => ...} />`
//   onMove: the camera's move to a newly chosen system, for the navigation sounds (screen fractions right and down, zoom in doublings). groups: the same as Diagram's. api: { fit(), focus(session|null) }. A click on a planet selects its agent, on the background selects
//   nothing (onSelect(null, null)). Without WebGL it shows a glass note (`unavailable`) and calls onError.

import React from './vendor/libs.js'
import { AgentCard, GlassTile, html } from './spacekit.js'
import { LeadDeck } from './leadcard.js'
import { cardProps, leadDeckProps, useOffscreenClass } from './diagram.js'
import { loadEngine } from './spaceengine.js'
import { webglAvailable } from './webgl.js'
import { isChipOnly, variantsFor } from './labellayout.js'
import { createSlotKeeper } from './slots.js'
import { STATUS_HUE, normStatus, systemLayout } from './starlayout.js'
import { ensureStyles } from './diagramstyle.js'
import { playNav } from './space-sounds.js'

const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React

export { webglAvailable }
export const UNAVAILABLE = "The Space view needs WebGL, which this browser has turned off. Quit and reopen Chrome, or turn on 'Use graphics acceleration' in chrome://settings/system."

const GUESS = { full: { w: 316, h: 250 }, lead: { w: 320, h: 190 }, compact: { w: 260, h: 96 }, chip: { w: 150, h: 34 } }
const PRIORITY = { waiting: 5, failed: 4, working: 3, done: 1, idle: 1, stopped: 0 }
const NARROW = 600
const CARD_COVER = 0.4, NARROW_COVER = 0.22, MIN_CARD_SCALE = 0.55 // the cards shrink to cover about this share of the free area, but never below this size
const FRAME_EVERY_MS = 30 // the cards and leader lines are brought up to date at most once per frame the scene draws
const GLIDE_MS = 250 // a card moving to a new slot
const CLICK_SLOP = 5, PICK_PADDING = 10 // pixels: a press that moves less is a click; how far outside a planet still picks it
const LEAD_MIN_SCALE = 0.8
const LEAD_WIDTH = 320 // the compact lead deck is built for about this width
const TITLE_FALLBACK = { w: 220, h: 60 }

/** The scene's data from the groups: the fields the 3D scene needs. */
export const sceneData = groups => groups.map(g => ({ session: g.session, team: g.team, folder: g.folder, tag: g.tag, agents: g.agents.map(a => ({ id: a.id, parentId: a.parentId, status: a.status, isLead: a.isLead, needsYou: a.needsYou, seed: a.seed ?? a.nickname ?? a.id })) }))

/** The side of its system (screen angle) each agent's orbit starts on: the slot it prefers. A moon takes its parent's side. */
function startAngles(groups) {
  const angles = new Map()
  for (const g of groups) {
    const layout = systemLayout(g.agents)
    const side = id => { const o = layout.orbits.get(id); return o?.kind === 'moon' ? side(o.parent) : o?.angle ?? 0 }
    for (const a of g.agents) angles.set(`${g.session ?? ''}|${a.id}`, a.isLead ? Math.PI / 2 : side(a.id))
  }
  return angles
}

export function SpaceView({ groups = [], focus = null, selected = null, inset = {}, onSelect: choose, onLeadMessage, onLeadHire, onLeadTasks, onMove, onReady, onContextLost, onError, className = '', style }) {
  useLayoutEffect(ensureStyles, [])
  const onSelect = choose ? (session, id) => { if (id !== null && id !== undefined) playNav('select'); choose(session, id) } : undefined // a card chosen makes a soft click
  const sceneRef = useRef(null)
  const boxRef = useRef(null)
  useOffscreenClass(boxRef)
  const spaceRef = useRef(null)
  const [failure, setFailure] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [kinds, setKinds] = useState({}) // uid -> the kinds drawn now: the current one, and the one fading out
  const current = useRef({}) // uid -> kind
  const leaving = useRef(new Map()) // `${uid}|${kind}` -> when it is removed
  const lastPlan = useRef(0)
  const cleanup = useRef(0) // the timer that removes a card that has faded out
  const trail = useRef(0) // the timer for the one more frame after the last one, so the cards end up where the scene stopped
  const [hover, setHover] = useState(null) // uid of the compact card under the pointer: only that one carries its full card
  const keeper = useMemo(() => createSlotKeeper(), [])
  const sizes = useRef(new Map())
  const els = useRef(new Map()) // `${uid}|${kind}` / `title|${key}` -> element
  const lines = useRef(new Map())
  const glided = useRef(new Map()) // uid -> the plan its card last glided to
  const props = useRef({})
  props.current = { groups, inset, focus, onMove }
  const angles = useMemo(() => startAngles(groups), [groups])

  const agentOf = useMemo(() => {
    const map = new Map()
    for (const g of groups) for (const a of g.agents) map.set(`${g.session ?? ''}|${a.id}`, { agent: a, group: g })
    return map
  }, [groups])

  // the scene: its engine is loaded on first use; the props at that moment are what it starts with
  useEffect(() => {
    let cancelled = false
    let space = null
    if (!webglAvailable()) {
      const error = new Error('WebGL is not available in this browser, so the space view cannot be drawn')
      setFailure(error)
      onError?.(error)
      return undefined
    }
    loadEngine().then(engine => {
      if (cancelled) return
      space = engine.createStarSystems({ container: sceneRef.current, onContextLost, onFrame: () => frame(), onNudge: move => playNav('nudge', move) })
      spaceRef.current = space
      space.setInset(props.current.inset)
      space.update(sceneData(props.current.groups))
      space.focus(props.current.focus ?? null)
      onReady?.({ fit: () => space.fit(), focus: key => space.focus(key ?? null) }) // both return the camera's move
      setLoaded(true)
    }).catch(error => {
      if (cancelled) return
      setFailure(error)
      onError?.(error)
    })
    return () => { cancelled = true; clearTimeout(trail.current); clearTimeout(cleanup.current); space?.dispose(); spaceRef.current = null }
  }, [])
  useEffect(() => { spaceRef.current?.update(sceneData(groups)) }, [groups])
  useEffect(() => {
    const move = spaceRef.current?.focus(focus ?? null)
    if (move) props.current.onMove?.(move)
  }, [focus])
  useEffect(() => { spaceRef.current?.setInset(inset) }, [inset?.top, inset?.right, inset?.bottom, inset?.left])

  // measure every card where it stands
  const measure = useMemo(() => (key, el) => { if (el) els.current.set(key, el); else els.current.delete(key) }, [])
  useLayoutEffect(() => {
    const observer = new ResizeObserver(entries => {
      let changed = false
      for (const e of entries) {
        const w = e.target.offsetWidth, h = e.target.offsetHeight, was = sizes.current.get(e.target.dataset.key)
        if (w > 0) { sizes.current.set(e.target.dataset.key, { w, h }); if (was?.w !== w || was?.h !== h) changed = true }
      }
      if (changed) { clearTimeout(trail.current); trail.current = setTimeout(() => frame(true), 0) }
    })
    for (const [key, el] of els.current) { const m = el.querySelector('.spv-measure') ?? el; m.dataset.key = key; observer.observe(m) }
    return () => observer.disconnect()
  })

  const scaleRef = useRef(1) // the cards shrink when there are many for the room
  const rawSize = (uid, kind) => sizes.current.get(`${uid}|${kind}`) ?? GUESS[kind]
  const scaleOf = kind => (kind === 'chip' ? 1 : kind === 'lead' ? Math.max(LEAD_MIN_SCALE, scaleRef.current) : scaleRef.current) // the lead's deck never shrinks far: it falls back to its mini chip instead
  const sizeOf = (uid, kind) => { const s = rawSize(uid, kind), k = scaleOf(kind); return k === 1 ? s : { w: s.w * k, h: s.h * k } }

  // after cards of another kind have been drawn, place them
  useLayoutEffect(() => { frame(true) }, [kinds, hover])

  /** One frame: the plan (made again only when the camera has settled and a while has passed), the cards at their slots, the leader lines to the planets. */
  function frame(force = false) {
    const space = spaceRef.current, box = boxRef.current
    if (!space || !box) return
    const W = box.clientWidth, H = box.clientHeight
    const now = performance.now()
    clearTimeout(trail.current)
    if (!force && now - lastPlan.current < FRAME_EVERY_MS) { trail.current = setTimeout(() => frame(true), FRAME_EVERY_MS); return }
    lastPlan.current = now
    const { groups: gs, inset: pad, focus: focused } = props.current
    const infos = new Map(space.systems().map(s => [s.session ?? '', s]))
    const bounds = { x: pad.left ?? 0, y: pad.top ?? 0, w: W - (pad.left ?? 0) - (pad.right ?? 0), h: H - (pad.top ?? 0) - (pad.bottom ?? 0) }
    const narrow = W < NARROW
    const focusedOnly = narrow && focused !== null && focused !== undefined // on a phone, with a system chosen, the room is for that system

    // the systems on screen, and every agent of them with the kinds of card it would take
    const systems = new Map()
    const agents = []
    for (const g of gs) {
      const key = g.session ?? ''
      const info = infos.get(key)
      if (!info?.visible || (focusedOnly && key !== focused)) continue
      systems.set(key, { x: info.x, y: info.y, r: info.r, starR: info.starR, visible: true })
      const chipOnly = isChipOnly(info.r, W, H)
      for (const a of g.agents) {
        const uid = `${key}|${a.id}`
        const state = a.needsYou ? 'waiting' : normStatus(a.status)
        agents.push({ id: uid, key, angle: angles.get(uid) ?? 0, priority: a.isLead ? 6 : PRIORITY[state] ?? 1, farOk: narrow, variants: variantsFor({ isLead: a.isLead, state, needsYou: a.needsYou }, { chipOnly, narrow }) })
      }
    }

    // cards shrink (in steps of a twentieth) so that the ones wanted cover about CARD_COVER of the free area
    const wanted = agents.reduce((sum, i) => { const s = rawSize(i.id, i.variants[0]); return sum + s.w * s.h }, 0)
    scaleRef.current = Math.round(Math.min(1, Math.max(MIN_CARD_SCALE, Math.sqrt(((narrow ? NARROW_COVER : CARD_COVER) * bounds.w * bounds.h) / Math.max(1, wanted)))) * 20) / 20

    // the team titles stand above their systems, fixed to them
    const titles = new Map()
    for (const g of gs) {
      const key = g.session ?? ''
      const info = infos.get(key)
      const el = els.current.get(`title|${key}`)
      const show = Boolean(info?.visible && info.r > 40 && systems.has(key))
      if (el) el.classList.toggle('is-placed', show)
      if (!show) continue
      const size = sizes.current.get(`title|${key}`) ?? TITLE_FALLBACK
      const x = Math.min(Math.max(bounds.x, info.title.x - size.w / 2), bounds.x + bounds.w - size.w)
      // a title that would land on another system's title steps up, then down, a title's height at a time; with no room it is left out
      const clear = at => ![...titles.values()].some(o => x < o.x + o.w + 6 && o.x < x + size.w + 6 && at < o.y + o.h + 6 && o.y < at + size.h + 6)
      const top = Math.max(bounds.y, info.title.y - size.h)
      const y = [top, top - size.h - 8, top + size.h + 8].find(at => at >= bounds.y && at + size.h <= bounds.y + bounds.h && clear(at))
      if (y === undefined) { if (el) el.classList.remove('is-placed'); continue }
      titles.set(key, { x, y, w: size.w, h: size.h })
      if (el && el.dataset.at !== `${x},${y}`) { el.style.transform = `translate(${x}px, ${y}px)`; el.dataset.at = `${x},${y}` }
    }

    const { plan, moving, planId } = keeper.update(now, { systems, agents, sizeOf, bounds, titles })

    // which kind each card is: a changed kind fades from the old one to the new
    const next = {}
    let changed = false
    for (const a of agents) {
      const kind = plan.get(a.id)?.kind ?? null
      if (kind) next[a.id] = kind
      if ((current.current[a.id] ?? null) !== kind) {
        const was = current.current[a.id]
        if (was) { leaving.current.set(`${a.id}|${was}`, now + GLIDE_MS + 80); clearTimeout(cleanup.current); cleanup.current = setTimeout(() => frame(true), GLIDE_MS + 150) }
        changed = true
      }
    }
    for (const id of Object.keys(current.current)) if (!(id in next) && !agents.some(a => a.id === id)) changed = true
    if (changed) { current.current = next; setKinds(k => ({ ...k, ...Object.fromEntries(Object.keys(next).map(id => [id, next[id]])) })) }
    for (const [key, until] of leaving.current) if (until < now) { leaving.current.delete(key); changed = true }

    // the cards at their slots (riding along with their system while the camera moves), and the leader lines to the planets
    const shown = new Set()
    for (const a of agents) {
      const slot = plan.get(a.id)
      const sys = systems.get(a.key)
      const ok = Boolean(slot?.kind)
      const x = ok ? sys.x + slot.dx : 0, y = ok ? sys.y + slot.dy : 0
      const glide = ok && glided.current.get(a.id) !== planId && !moving
      for (const kind of ['lead', 'full', 'compact', 'chip']) {
        const el = els.current.get(`${a.id}|${kind}`)
        if (!el) continue
        const on = ok && slot.kind === kind
        const fresh = on && !el.classList.contains('is-placed')
        el.style.transition = glide && !fresh ? `transform ${GLIDE_MS}ms ease-out, opacity ${GLIDE_MS}ms` : ''
        el.classList.toggle('is-placed', on)
        if (on) {
          const to = `translate(${x}px, ${y}px)${scaleOf(kind) < 1 ? ` scale(${scaleOf(kind)})` : ''}`
          if (el.dataset.at !== to) { el.style.transform = to; el.dataset.at = to } // only a card that moved is written to
        }
      }
      if (ok) glided.current.set(a.id, planId)
      const line = lines.current.get(a.id)
      const [, key2, id] = /^([^|]*)\|(.*)$/.exec(a.id) ?? []
      const p = ok ? space.project(id, key2 === '' ? null : key2) : null
      if (line && p?.visible) {
        const { w, h } = slot // already at the scale the card is drawn
        const nx = Math.min(Math.max(p.x, x), x + w), ny = Math.min(Math.max(p.y, y), y + h)
        const far = Math.hypot(nx - p.x, ny - p.y) > Math.max(6, p.r) + 6
        const d = far ? `M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${nx.toFixed(1)} ${ny.toFixed(1)}` : ''
        if (line.getAttribute('d') !== d) line.setAttribute('d', d)
        if (far) shown.add(a.id)
      }
    }
    for (const [id, line] of lines.current) if (!shown.has(id)) line.setAttribute('d', '')
    for (const [id, el] of els.current) if (!id.startsWith('title|') && !agents.some(a => id.startsWith(`${a.id}|`))) el.classList.remove('is-placed')
    if (changed) setKinds(k => ({ ...k }))
  }

  // a press that does not move is a click: on a planet it selects that agent, on the background nothing
  const press = useRef(null)
  const onPointerDown = e => { press.current = { x: e.clientX, y: e.clientY } }
  const onPointerUp = e => {
    const start = press.current
    press.current = null
    if (e.target.closest?.('.spv-card, .spv-chip')) return // a card or chip has its own click
    const space = spaceRef.current, box = boxRef.current
    if (!start || !space || !box || Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_SLOP) return
    const rect = box.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    let best = null
    for (const g of props.current.groups) for (const a of g.agents) {
      const p = space.project(a.id, g.session ?? null)
      if (!p?.visible) continue
      const d = Math.hypot(p.x - x, p.y - y)
      if (d <= Math.max(p.r, 8) + PICK_PADDING && (!best || d < best.d)) best = { d, session: g.session ?? null, id: a.id }
    }
    onSelect?.(best ? best.session : null, best ? best.id : null)
  }

  if (failure) {
    return html`<div className=${`spv ${className}`} style=${style}><div className="spv-note"><${GlassTile}><h3>Space view unavailable</h3><p>${UNAVAILABLE}</p><p style=${{ opacity: 0.6 }}>${String(failure.message ?? failure)}</p><//></div></div>`
  }
  const handlers = { onSelect, onLeadMessage, onLeadHire, onLeadTasks }
  const drawn = uid => {
    const list = [...new Set([kinds[uid], ...[...leaving.current.keys()].filter(k => k.startsWith(`${uid}|`)).map(k => k.slice(uid.length + 1))].filter(Boolean))]
    return list
  }
  return html`<div ref=${boxRef} className=${`spv ${className}`} style=${style} onPointerDown=${onPointerDown} onPointerUp=${onPointerUp}>
    <div ref=${sceneRef} className="spv-scene"></div>
    ${loaded ? null : html`<div className="spv-loading sk-label">loading the space view…</div>`}
    <div className="spv-overlay">
      <svg className="spv-leaders" aria-hidden="true">${[...agentOf.keys()].map(id => html`<path key=${id} className="spv-leader" ref=${el => { if (el) lines.current.set(id, el); else lines.current.delete(id) }} />`)}</svg>
      ${groups.map(g => html`<div key=${`title|${g.session ?? ''}`} className="spv-title" ref=${el => measure(`title|${g.session ?? ''}`, el)}><div className="spv-measure" style=${{ display: 'inline-block' }}><h2>${g.team || g.folder}</h2><div className="sk-label">${[g.team ? g.folder : '', g.tag].filter(Boolean).join(' · ')}</div></div></div>`)}
      ${[...agentOf].flatMap(([uid, { agent, group }]) => drawn(uid).map(kind => {
        const state = agent.needsYou ? 'waiting' : normStatus(agent.status)
        const p = cardProps(agent, uid, selected, onSelect, group)
        if (kind === 'chip' && agent.isLead) {
          return html`<div key=${`${uid}|chip`} className="spv-chip spv-chip--lead" ref=${el => measure(`${uid}|chip`, el)}><${LeadDeck} variant="mini" ...${leadDeckProps(agent, group, handlers)} /></div>`
        }
        if (kind === 'chip') {
          return html`<button key=${`${uid}|chip`} type="button" className=${`spv-chip${group.alive === false ? ' spv-chip--lost' : ''}`} style=${{ '--hue': STATUS_HUE[agent.isLead ? 'lead' : state] }} ref=${el => measure(`${uid}|chip`, el)} onClick=${() => onSelect?.(group.session ?? null, agent.id)}><i></i><span>${agent.nickname || agent.name}</span></button>`
        }
        const needs = `${agent.needsYou && state !== 'waiting' ? ' spv-card--needs' : ''}${group.alive === false ? ' spv-card--lost' : ''}`
        const card = kind === 'lead' ? html`<${LeadDeck} variant="compact" ...${leadDeckProps(agent, group, handlers)} />` : html`<${AgentCard} ...${p} compact=${kind === 'compact'} orbs=${false} />`
        const hoverable = kind === 'compact' ? { onMouseEnter: () => setHover(uid), onMouseLeave: () => setHover(h => (h === uid ? null : h)) } : {}
        return html`<div key=${`${uid}|${kind}`} className=${`spv-card${kind === 'compact' ? ' spv-card--compact' : ''}${needs}`} ref=${el => measure(`${uid}|${kind}`, el)} ...${hoverable}>
          <div className="spv-measure" style=${kind === 'lead' ? { width: LEAD_WIDTH } : undefined}>${card}</div>
          ${kind === 'compact' && hover === uid ? html`<div className="spv-full"><${AgentCard} ...${p} orbs=${false} /></div>` : null}
        </div>`
      }))}
    </div>
  </div>`
}
