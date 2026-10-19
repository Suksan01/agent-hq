// The live diagram's geometry, with no DOM and no imports beyond ./world.js and ./starlayout.js, so `node --test` can check it.
// Each session is a group: the lead card in the middle, its agents in two stacks (left and right of it), each agent's helpers
// branching outward from it. Cards never overlap, connections run from a card's edge to the next card's edge without crossing a card,
// and groups are packed on the canvas with space between them.

import { packIslands } from './world.js'
import { normStatus } from './starlayout.js'

export const GAP_X = 120 // between the lead and its first column, and between a card and its helpers
export const GAP_Y = 28 // between cards in a stack
export const GROUP_PAD = 52
export const HEADER_H = 124 // room for the team name and the folder above the cards
export const GROUP_GAP = 150
export const NARROW = 0.9 // below this screen aspect (width to height) the agents all go to one side of the lead
const TITLE_CHAR = 24 // about how wide a character of the big team name is, to keep a long name inside its group

/** The sizes a card has before it has been measured: the lead, a full card, a compact one (the spacekit's widths). */
export const GUESS = { lead: { w: 600, h: 500 }, full: { w: 316, h: 250 }, compact: { w: 260, h: 96 } }
const COMPACT = new Set(['idle', 'done', 'stopped'])
/** Compact for an agent that is not at work; the full card for working, waiting, failed and the lead. */
export const isCompact = agent => !agent.isLead && COMPACT.has(normStatus(agent.status)) && !agent.needsYou
export const guessSize = agent => (agent.isLead ? GUESS.lead : isCompact(agent) ? GUESS.compact : GUESS.full)

/**
 * One group's cards. `agents`: [{id, parentId, isLead, status}]; `sizeOf(agent)` the card's {w, h}. Returns the nodes
 * (id -> {x, y, w, h, side, parent}) from the group's top-left corner of its cards, the edges (in that space) and the size.
 * `oneSide` puts every agent to the right of the lead, for a tall narrow screen.
 */
export function groupLayout(agents, sizeOf = guessSize, { oneSide = false } = {}) {
  const byId = new Map(agents.map(a => [a.id, a]))
  const lead = agents.find(a => a.isLead) ?? agents.find(a => !a.parentId || !byId.has(a.parentId)) ?? null
  if (!lead) return { nodes: new Map(), edges: [], width: 0, height: 0, lead: null }
  const kids = new Map()
  for (const a of agents) {
    if (a.id === lead.id) continue
    const parent = a.parentId && byId.has(a.parentId) && a.parentId !== a.id ? a.parentId : lead.id
    kids.set(parent, [...(kids.get(parent) ?? []), a])
  }
  const size = id => sizeOf(byId.get(id))
  const seen = new Set([lead.id])
  /** A subtree's band: its card's height, or its helpers' stack when that is taller. */
  const band = id => {
    const own = size(id).h
    const children = (kids.get(id) ?? []).filter(k => !seen.has(k.id) && seen.add(k.id)).map(k => ({ id: k.id, ...band(k.id) }))
    const stack = children.reduce((h, c) => h + c.h, 0) + GAP_Y * Math.max(0, children.length - 1)
    return { h: Math.max(own, stack), stack, children }
  }
  const members = (kids.get(lead.id) ?? []).filter(k => seen.add(k.id)).map(k => ({ id: k.id, ...band(k.id) }))
  // each member's whole branch goes to the shorter side, the first to the right
  const sides = { right: [], left: [] }
  const heightOf = list => list.reduce((h, b) => h + b.h, 0) + GAP_Y * Math.max(0, list.length - 1)
  for (const m of members) (oneSide || heightOf(sides.right) <= heightOf(sides.left) ? sides.right : sides.left).push(m)
  const leftH = heightOf(sides.left), rightH = heightOf(sides.right)
  const leadSize = size(lead.id)
  const total = Math.max(leftH, rightH, leadSize.h)
  const centre = total / 2

  const nodes = new Map()
  nodes.set(lead.id, { x: 0, y: centre - leadSize.h / 2, w: leadSize.w, h: leadSize.h, side: 'centre', parent: null })
  const place = (b, parentId, near, sign, top) => {
    const s = size(b.id)
    const x = sign > 0 ? near : near - s.w
    nodes.set(b.id, { x, y: top + (b.h - s.h) / 2, w: s.w, h: s.h, side: sign > 0 ? 'right' : 'left', parent: parentId })
    let y = top + (b.h - b.stack) / 2
    for (const c of b.children) {
      place(c, b.id, sign > 0 ? x + s.w + GAP_X : x - GAP_X, sign, y)
      y += c.h + GAP_Y
    }
  }
  for (const [list, sign, near] of [[sides.right, 1, leadSize.w + GAP_X], [sides.left, -1, -GAP_X]]) {
    let y = centre - heightOf(list) / 2
    for (const b of list) { place(b, lead.id, near, sign, y); y += b.h + GAP_Y }
  }
  // shift so the cards start at the corner
  const all = [...nodes.values()]
  const minX = Math.min(...all.map(n => n.x)), minY = Math.min(...all.map(n => n.y))
  for (const n of all) { n.x -= minX; n.y -= minY }
  const width = Math.max(...all.map(n => n.x + n.w)), height = Math.max(...all.map(n => n.y + n.h))

  const edges = []
  for (const [id, n] of nodes) {
    if (n.parent === null) continue
    const p = nodes.get(n.parent)
    const right = n.side === 'right'
    edges.push({ from: n.parent, to: id, x1: right ? p.x + p.w : p.x, y1: p.y + p.h / 2, x2: right ? n.x : n.x + n.w, y2: n.y + n.h / 2 })
  }
  return { nodes, edges, width, height, lead: lead.id }
}

/** An SVG path for an edge: a smooth S from one card's edge to the next, leaving and arriving horizontally. */
export const edgePath = e => {
  const mid = (e.x1 + e.x2) / 2
  return `M${e.x1} ${e.y1}C${mid} ${e.y1} ${mid} ${e.y2} ${e.x2} ${e.y2}`
}

// ---- the canvas: groups packed, and the camera ------------------------------------------------------------------

/**
 * Every group laid out and packed. `groups`: [{session, team, folder, tag?, agents}]; `sizes`: Map of `${session}|${id}` -> {w, h}
 * measured from the page (guesses are used for any card not measured yet); `aspect` is the screen's width to height, which the packing tries to fill. Returns the groups with their position and size, the
 * cards in canvas coordinates and the canvas size. Groups are in a stable order (team, then session).
 */
export function diagramWorld(groups, sizes = new Map(), aspect = 1.6) {
  const ordered = [...groups].sort((a, b) => String(a.team ?? a.folder ?? '').localeCompare(String(b.team ?? b.folder ?? '')) || String(a.session).localeCompare(String(b.session)))
  const laid = ordered.map(g => {
    const key = g.session ?? ''
    const layout = groupLayout(g.agents, a => sizes.get(`${key}|${a.id}`) ?? guessSize(a), { oneSide: aspect < NARROW })
    const title = (g.team || g.folder || '').length * TITLE_CHAR
    const w = Math.max(layout.width + 2 * GROUP_PAD, title + 2 * GROUP_PAD, 440)
    const h = HEADER_H + Math.max(layout.height, 120) + GROUP_PAD
    return { g, key, layout, w, h }
  })
  const packed = bestPacking(laid.map(l => ({ w: l.w, h: l.h })), aspect)
  const outGroups = [], cards = []
  laid.forEach((l, i) => {
    const at = { x: GROUP_GAP + (packed.spots[i]?.x ?? 0), y: GROUP_GAP + (packed.spots[i]?.y ?? 0) }
    const ox = at.x + (l.w - l.layout.width) / 2, oy = at.y + HEADER_H
    outGroups.push({ key: l.key, session: l.g.session ?? null, team: l.g.team, folder: l.g.folder, tag: l.g.tag, x: at.x, y: at.y, w: l.w, h: l.h, headerH: HEADER_H, edges: l.layout.edges.map(e => ({ ...e, x1: e.x1 + ox, y1: e.y1 + oy, x2: e.x2 + ox, y2: e.y2 + oy })), lead: l.layout.lead })
    for (const [id, n] of l.layout.nodes) cards.push({ uid: `${l.key}|${id}`, id, session: l.g.session ?? null, group: i, x: n.x + ox, y: n.y + oy, w: n.w, h: n.h, side: n.side, parent: n.parent === null ? null : `${l.key}|${n.parent}` })
  })
  return { groups: outGroups, cards, width: packed.width + 2 * GROUP_GAP, height: packed.height + 2 * GROUP_GAP }
}

/**
 * Rows of groups at the row width that shows them biggest on a screen of this aspect: every width at which a row could break
 * is tried, and the packing with the largest zoom (width and height both fitted) wins; ties go to the narrower.
 */
export function bestPacking(sizes, aspect, gap = GROUP_GAP) {
  const widest = Math.max(...sizes.map(s => s.w))
  const widths = new Set([widest])
  for (let i = 0; i < sizes.length; i++) {
    let w = -gap
    for (let j = i; j < sizes.length; j++) { w += sizes[j].w + gap; if (w >= widest) widths.add(w) }
  }
  let best = null
  for (const rowWidth of [...widths].sort((a, b) => a - b)) {
    const packed = packIslands(sizes, gap, rowWidth)
    const zoom = Math.min(aspect / Math.max(1, packed.width), 1 / Math.max(1, packed.height))
    if (!best || zoom > best.zoom * 1.001) best = { packed, zoom }
  }
  return best?.packed ?? packIslands(sizes, gap)
}

/** The part of the canvas to frame: the chosen group (by key) or all of them, with a little air around. */
export function regionOf(world, key) {
  const chosen = key === null || key === undefined ? world.groups : world.groups.filter(g => g.key === key)
  const list = chosen.length > 0 ? chosen : world.groups
  if (list.length === 0) return { x: 0, y: 0, w: Math.max(1, world.width), h: Math.max(1, world.height) }
  const x0 = Math.min(...list.map(g => g.x)), y0 = Math.min(...list.map(g => g.y))
  const x1 = Math.max(...list.map(g => g.x + g.w)), y1 = Math.max(...list.map(g => g.y + g.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export const ZOOM_MIN = 0.08, ZOOM_MAX = 1.6

/**
 * The pan and zoom that show `region` whole inside a viewport, centred in what is left after `inset` (the HUD's room at each edge),
 * never bigger than `max`. Returns {x, y, z}: translate then scale the canvas.
 */
export function fitTransform(region, viewport, inset = {}, max = 1) {
  const { top = 0, right = 0, bottom = 0, left = 0 } = inset
  const room = { w: Math.max(40, viewport.w - left - right), h: Math.max(40, viewport.h - top - bottom) }
  const z = Math.max(ZOOM_MIN, Math.min(max, ZOOM_MAX, room.w / region.w, room.h / region.h))
  return { z, x: left + (room.w - region.w * z) / 2 - region.x * z, y: top + (room.h - region.h * z) / 2 - region.y * z }
}
