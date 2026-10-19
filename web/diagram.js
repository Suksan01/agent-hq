// The live page's diagram: each session a group (a faint glass region headed by its team name and folder) holding the lead card
// and the agents' cards, joined by curves from card edge to card edge. Pan by dragging, zoom with the wheel or two fingers, Fit and
// focus a group. Cards are the space kit's (spacekit.js); the look is space.css plus diagram.css.
//
//   html`<${Diagram} groups=${groups} focus=${session|null} selected=${uid} inset=${{ top, right, bottom, left }} onSelect=${(session, id) => ...} onReady=${api => ...} />`
//   const view = mountDiagram(container, props)          the same in a root of its own: { update(props), fit(), focus(session), dispose() }
//
// groups: [{ session, team, folder, tag?, agents: [{ id, parentId, nickname, name, role, status, progress, isLead, needsYou?, task?, now?, next?,
// activity?, elapsed?, seed?, index? }] }]; onMove({dx, dy, dz, duration}) is called with the camera's move to a newly chosen group (for the navigation sounds); onSelect(null, null) is a click on the background; onReady's api: { fit(), focus(session|null), zoomBy(factor) }. With reduced motion nothing pulses or eases.

import React, { createRoot } from './vendor/libs.js'
import { AgentCard, html } from './spacekit.js'
import { LeadDeck } from './leadcard.js'
import { ZOOM_MAX, ZOOM_MIN, diagramWorld, edgePath, fitTransform, guessSize, isCompact, regionOf } from './diagramlayout.js'
import { STATUS_HUE, normStatus } from './starlayout.js'
import { ensureStyles } from './diagramstyle.js'
import { playNav } from './space-sounds.js'

const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React
const MEASURE_EPSILON = 1.5

function useReducedMotion() {
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  const [reduce, setReduce] = useState(Boolean(query?.matches))
  useEffect(() => {
    if (!query) return undefined
    const on = e => setReduce(e.matches)
    query.addEventListener('change', on)
    return () => query.removeEventListener('change', on)
  }, [])
  return reduce
}

/** What a group's glow says: amber when someone waits for the person, coral after a failure, else the quiet violet. */
function groupHue(agents) {
  const states = agents.map(a => (a.needsYou ? 'waiting' : normStatus(a.status)))
  return states.includes('waiting') ? STATUS_HUE.waiting : states.includes('failed') ? STATUS_HUE.failed : STATUS_HUE.lead
}

/** An edge's look comes from the child it leads to: working glows and carries a light; waiting is amber; the rest sit quiet. */
const edgeKind = agent => (agent.needsYou ? 'waiting' : normStatus(agent.status))

function Edge({ edge, agent }) {
  const kind = edgeKind(agent)
  const d = edgePath(edge)
  return html`<g className=${`dg-edge dg-edge--${kind}`} style=${{ '--hue': STATUS_HUE[kind] ?? STATUS_HUE.idle }}>
    <path className="dg-edge__line" d=${d} />
    ${kind === 'working' || kind === 'waiting' ? html`<path className="dg-edge__glow" d=${d} />` : null}
  </g>`
}

/** The light travelling along a working or waiting line: a small layer of its own (not part of the big SVG, which would be repainted whole every frame). */
function Pulse({ edge, agent, order }) {
  const kind = edgeKind(agent)
  return html`<div className="dg-pulse" aria-hidden="true" style=${{ '--hue': STATUS_HUE[kind], offsetPath: `path("${edgePath(edge)}")`, animationDuration: kind === 'working' ? '2.8s' : '4.2s', animationDelay: `${-(order % 7) * 0.4}s` }}></div>`
}

/** Marks `ref`'s element `.is-offscreen` while it is scrolled out of view, which pauses every CSS animation inside it (space.css). */
export function useOffscreenClass(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') return undefined
    const watcher = new IntersectionObserver(entries => el.classList.toggle('is-offscreen', !entries[entries.length - 1].isIntersecting))
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [])
}

export function cardProps(agent, uid, selected, onSelect, group) {
  return {
    nickname: agent.nickname || agent.name, name: agent.name, role: String(agent.role ?? '').toUpperCase(), status: normStatus(agent.status),
    pct: agent.progress ?? agent.pct, task: agent.task, activity: agent.activity, elapsed: agent.elapsed, now: agent.now, next: agent.next,
    seed: agent.seed ?? agent.nickname ?? agent.id, index: agent.index, selected: uid === selected, onSelect: onSelect ? () => onSelect(group.session ?? null, agent.id) : undefined,
  }
}

/** The lead deck's props from the lead agent and its group; the callbacks (`handlers`) are the page's: onSelect(session, id), onLeadMessage(session), onLeadHire(session), onLeadTasks(). */
export function leadDeckProps(agent, group, handlers = {}) {
  const session = group.session ?? null
  return {
    id: agent.id, nickname: agent.nickname || agent.name, title: agent.role || undefined, team: group.team || group.folder, seed: agent.seed ?? agent.nickname ?? agent.id, index: agent.index,
    status: normStatus(agent.status), pct: agent.progress ?? agent.pct, activity: agent.activity, elapsed: agent.elapsed, now: agent.now, next: agent.next,
    crew: group.agents.filter(m => !m.isLead).map(m => ({ id: m.id, nickname: m.nickname || m.name, seed: m.seed ?? m.nickname ?? m.id, index: m.index, status: normStatus(m.needsYou ? 'waiting' : m.status) })),
    onMessage: handlers.onLeadMessage ? () => handlers.onLeadMessage(session) : undefined,
    onHire: handlers.onLeadHire ? () => handlers.onLeadHire(session) : undefined,
    onTasks: handlers.onLeadTasks ? () => handlers.onLeadTasks(session) : undefined,
    onSelect: handlers.onSelect ? memberId => handlers.onSelect(session, memberId) : undefined,
    onOpen: handlers.onSelect ? () => handlers.onSelect(session, agent.id) : undefined,
  }
}

const LEAD_WIDTH = 600 // the full lead deck with its mission board is built for about this width

function Node({ card, agent, group, selected, onSelect, handlers, measure }) {
  const props = cardProps(agent, card.uid, selected, onSelect, group)
  const compact = isCompact(agent)
  const attention = agent.needsYou && props.status !== 'waiting'
  return html`<div className=${`dg-node${group.alive === false ? ' dg-node--lost' : ''}${agent.isLead ? ' dg-node--lead' : ''}${compact ? ' dg-node--compact' : ''}${attention ? ' dg-node--needs' : ''}`} data-uid=${card.uid} style=${{ left: card.x, top: card.y }}>
    <div className="dg-measure" ref=${el => measure(card.uid, el)} style=${agent.isLead ? { width: LEAD_WIDTH } : undefined}>
      ${agent.isLead ? html`<${LeadDeck} variant="full" ...${leadDeckProps(agent, group, handlers)} />` : html`<${AgentCard} ...${props} compact=${compact} orbs=${false} />`}
    </div>
    ${compact ? html`<div className="dg-full"><${AgentCard} ...${props} orbs=${false} /></div>` : null}
  </div>`
}

export function Diagram({ groups = [], focus = null, selected = null, inset, onSelect: choose, onLeadMessage, onLeadHire, onLeadTasks, onMove, onReady, className = '', style }) {
  const onSelect = choose ? (session, id) => { if (id !== null && id !== undefined) playNav('select'); choose(session, id) } : undefined // a card chosen makes a soft click
  const handlers = { onSelect, onLeadMessage, onLeadHire, onLeadTasks }
  useLayoutEffect(ensureStyles, [])
  const still = useReducedMotion()
  const root = useRef(null)
  useOffscreenClass(root)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [view, setView] = useState(null) // null: fitted; else { x, y, z } the person chose
  const [ease, setEase] = useState(false)
  const [sizes, setSizes] = useState(() => new Map())
  const drag = useRef(null)
  const pointers = useRef(new Map())
  const observer = useRef(null)
  const nodes = useRef(new Map()) // uid -> measured element

  // measure each card where it stands, so the layout follows what the cards really are
  const measure = useMemo(() => (uid, el) => {
    const was = nodes.current.get(uid)
    if (was === el) return
    if (was) observer.current?.unobserve(was)
    if (el) { nodes.current.set(uid, el); el.dataset.uid = uid; observer.current?.observe(el) } else nodes.current.delete(uid)
  }, [])
  useLayoutEffect(() => {
    observer.current = new ResizeObserver(entries => {
      setSizes(prev => {
        let next = null
        for (const entry of entries) {
          const uid = entry.target.dataset.uid
          const w = entry.target.offsetWidth, h = entry.target.offsetHeight
          const old = prev.get(uid)
          if (!uid || w === 0 || (old && Math.abs(old.w - w) < MEASURE_EPSILON && Math.abs(old.h - h) < MEASURE_EPSILON)) continue
          next ??= new Map(prev)
          next.set(uid, { w, h })
        }
        return next ?? prev
      })
    })
    for (const el of nodes.current.values()) observer.current.observe(el)
    const stage = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }))
    stage.observe(root.current)
    return () => { observer.current.disconnect(); stage.disconnect() }
  }, [])

  // the layout wants sizes by `${session}|${id}`, which is the card's uid
  const aspect = box.h > 0 ? Math.max(0.2, (box.w - (inset?.left ?? 0) - (inset?.right ?? 0)) / Math.max(1, box.h - (inset?.top ?? 0) - (inset?.bottom ?? 0))) : 1.6
  const world = useMemo(() => diagramWorld(groups, sizes, Math.round(aspect * 10) / 10), [groups, sizes, Math.round(aspect * 10) / 10])
  const agentOf = useMemo(() => {
    const map = new Map()
    for (const g of groups) for (const a of g.agents) map.set(`${g.session ?? ''}|${a.id}`, { agent: a, group: g })
    return map
  }, [groups])

  const [local, setLocal] = useState(undefined) // a focus asked for through the api; the prop wins again when it changes
  useEffect(() => setLocal(undefined), [focus])
  const aim = local !== undefined ? local : focus
  const region = useMemo(() => regionOf(world, aim), [world, aim])
  const fitted = useMemo(() => (box.w > 0 ? fitTransform(region, box, inset) : { x: 0, y: 0, z: 1 }), [region, box, inset])
  const v = view ?? fitted
  useEffect(() => { setView(null); setEase(!still) }, [aim])
  // the camera's move to a newly chosen group, in the units the navigation sounds take (screen fractions, zoom in doublings): `onMove`
  const lastView = useRef(null)
  const firstAim = useRef(true)
  useEffect(() => {
    const was = lastView.current
    if (firstAim.current) { firstAim.current = false; return }
    if (was && box.w > 0) onMove?.({ dx: -(fitted.x - was.x) / box.w, dy: -(fitted.y - was.y) / box.h, dz: Math.log2(fitted.z / was.z), duration: 550 })
  }, [aim])
  useEffect(() => { lastView.current = v })

  const api = useRef({})
  api.current = {
    fit: () => { setView(null); setEase(!still) },
    focus: key => setLocal(key ?? null),
    zoomBy: factor => zoomAt(factor, box.w / 2, box.h / 2),
  }
  useEffect(() => { onReady?.({ fit: () => api.current.fit(), focus: key => api.current.focus(key), zoomBy: f => api.current.zoomBy(f) }) }, [])

  const zoomAt = (factor, cx, cy) => {
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.z * factor))
    setEase(false)
    setView({ z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z })
  }
  useEffect(() => {
    const el = root.current
    const wheel = e => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      playNav('nudge', { dz: Math.log2(factor) })
      zoomAt(factor, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })

  const down = e => {
    if (e.target.closest('input, textarea, select')) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    drag.current = { moved: false, x: v.x, y: v.y, z: v.z, sx: e.clientX, sy: e.clientY, span: pointers.current.size > 1 ? span() : 0 }
  } // no pointer capture here: it would send the click that ends a press on a card to the canvas; a drag takes it in move()
  const span = () => { const [a, b] = [...pointers.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 }
  const move = e => {
    const p = pointers.current.get(e.pointerId)
    const d = drag.current
    if (!p || !d) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true
    if (!d.moved) return
    root.current.setPointerCapture?.(e.pointerId) // now it is a drag: keep its events even outside the canvas
    setEase(false)
    if (pointers.current.size >= 2) {
      const s = span()
      const r = root.current.getBoundingClientRect()
      const [a, b] = [...pointers.current.values()]
      if (d.span > 0 && s > 0) zoomAt(s / d.span, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top)
      d.span = s
    } else {
      playNav('nudge', { dx: -dx / Math.max(1, box.w), dy: -dy / Math.max(1, box.h) })
      setView(cur => ({ ...(cur ?? v), x: (cur ?? v).x + dx, y: (cur ?? v).y + dy }))
    }
  }
  const up = e => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) setTimeout(() => { drag.current = null }, 0) // after the click that ends a drag has been swallowed
  }
  const swallow = e => { if (drag.current?.moved) { e.stopPropagation(); e.preventDefault() } }
  // a click on the background, not on a card and not the end of a drag, selects nothing
  const background = e => { if (!drag.current?.moved && !e.target.closest('.dg-node')) choose?.(null, null) }

  const groupLost = new Map(groups.map(g => [g.session ?? '', g.alive === false])) // a session that has gone: dimmed and still
  const groupGlow = new Map(groups.map(g => [g.session ?? '', groupHue(g.agents)]))
  return html`<div ref=${root} className=${`sk-canvas dg${still ? ' dg--still' : ''} ${className}`} style=${style} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} onClickCapture=${swallow} onClick=${background}>
    <div className="sk-nebula sk-nebula--a"></div><div className="sk-nebula sk-nebula--b"></div><div className="sk-nebula sk-nebula--c"></div><div className="sk-stars"></div>
    <div className=${`dg-world${ease && !still ? ' dg-world--ease' : ''}`} style=${{ width: world.width, height: world.height, transform: `translate(${v.x}px, ${v.y}px) scale(${v.z})` }}>
      ${world.groups.map(g => html`<section key=${g.key} className=${`dg-group${groupLost.get(g.key) ? ' dg-group--lost' : ''}`} aria-label=${g.team || g.folder} style=${{ left: g.x, top: g.y, width: g.w, height: g.h, '--ghue': groupGlow.get(g.key) }}>
        <header className="dg-header">
          <h2 className="dg-team">${g.team || g.folder}</h2>
          <div className="dg-folder sk-label">${g.team ? g.folder : ''}</div>
        </header>
      </section>`)}
      <svg className="dg-edges" width=${world.width} height=${world.height} aria-hidden="true">
        ${world.groups.flatMap((g, gi) => g.edges.map((e, i) => {
          const hit = agentOf.get(`${g.key}|${e.to}`)
          return hit ? html`<${Edge} key=${`${g.key}|${e.to}`} edge=${e} agent=${hit.agent} />` : null
        }))}
      </svg>
      ${still ? null : world.groups.flatMap((g, gi) => g.edges.map((e, i) => {
        const hit = agentOf.get(`${g.key}|${e.to}`)
        return hit && !groupLost.get(g.key) && (edgeKind(hit.agent) === 'working' || edgeKind(hit.agent) === 'waiting') ? html`<${Pulse} key=${`${g.key}|${e.to}`} edge=${e} agent=${hit.agent} order=${gi * 5 + i} />` : null
      }))}
      ${world.cards.map(card => {
        const hit = agentOf.get(card.uid)
        return hit ? html`<${Node} key=${card.uid} card=${card} agent=${hit.agent} group=${hit.group} selected=${selected} onSelect=${onSelect} handlers=${handlers} measure=${measure} />` : null
      })}
    </div>
  </div>`
}

/** The diagram in a root of its own: for a page that is not React (the showcase). */
export function mountDiagram(container, props) {
  const reactRoot = createRoot(container)
  let handle = null
  let current = props
  const draw = () => reactRoot.render(html`<${Diagram} ...${current} onReady=${api => { handle = api; current.onReady?.(api) }} />`)
  draw()
  return {
    update(next) { current = { ...current, ...next }; draw() },
    fit: () => handle?.fit(),
    focus: key => { current = { ...current, focus: key ?? null }; draw() },
    dispose: () => reactRoot.unmount(),
  }
}

export { guessSize }
