// The page's geometry, with no DOM and no imports so `node --test` can check it: each session is an island, its lead and
// agents are cards on the island's safe land (a radial ring round the lead, or a grid when the team is big), the islands
// are packed on the sea without overlap, and Fit finds the zoom that keeps the cards clear of the floating panels.

export const NODE_W = 272, NODE_H = 196, CARD_H = 224, PAD = 40, LEAD_SCALE = 1.14
export const SAFE = 0.62 // the share of an island (width and height) that is always flat land: islands.js' islandSafeRect
const MIN_ISLAND = { w: 640, h: 470 }
const RING_MAX = 8 // up to this many members the team is a ring round its lead; more, and it is a grid
const GRID_GAP = 40
const ISLAND_GAP = 220 // sea between two islands (decorations rise about 100px above one)
const SEA_TOP = 150, SEA_SIDE = 80 // room above and beside the islands

// ---- one island's cards -----------------------------------------------------------------------------------------

const STRETCH = 1.3 // the ring's width to its height
const ARC = 300 // room each card takes along a ring

/** Radial: the lead in the middle, its agents in a ring round it (an ellipse, cards being wider than tall, big enough that
 * neighbours never overlap), and each agent's own helpers fanned further out in its direction. On a narrow (portrait)
 * screen the ring is a circle with more room per card. */
export function ringLayout(agents, narrow = false) {
  const stretch = narrow ? 1 : STRETCH, arc = narrow ? 340 : ARC
  const kids = new Map()
  for (const a of agents) if (a.parentId) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a.id])
  const center = new Map()
  const place = (id, cx, cy, angle, spread, depth) => {
    center.set(id, { x: cx, y: cy })
    const children = kids.get(id) ?? []
    const n = children.length
    if (n === 0) return
    if (depth === 0) {
      const r = Math.max(NODE_H + 100, (n * arc) / (2 * Math.PI))
      children.forEach((c, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
        place(c, cx + r * stretch * Math.cos(a), cy + r * Math.sin(a), a, (2 * Math.PI) / n, depth + 1)
      })
      return
    }
    const fan = Math.min(spread * 0.85, 1.4)
    // a few helpers need a longer reach, so their neighbours along the arc keep a card's room
    const r = n === 1 ? NODE_H + 120 : Math.max(NODE_H + 120, arc / ((fan / (n - 1)) * 1.1))
    children.forEach((c, i) => {
      const a = angle + (n === 1 ? 0 : (i / (n - 1) - 0.5) * fan)
      place(c, cx + r * stretch * Math.cos(a), cy + r * Math.sin(a), a, fan / n, depth + 1)
    })
  }
  agents.filter(a => !a.parentId).forEach((root, i) => place(root.id, i * 2000, 0, 0, 2 * Math.PI, 0))
  return boxed(center)
}

/** A grid for a big team: the lead in the middle cell, everyone else in tree order round it. */
export function gridLayout(agents) {
  const kids = new Map()
  for (const a of agents) if (a.parentId) kids.set(a.parentId, [...(kids.get(a.parentId) ?? []), a.id])
  const order = []
  const walk = id => { order.push(id); (kids.get(id) ?? []).forEach(walk) }
  agents.filter(a => !a.parentId).forEach(root => walk(root.id))
  const lead = agents.find(a => a.isMain)?.id ?? order[0]
  const others = order.filter(id => id !== lead)
  const cols = Math.ceil(Math.sqrt(order.length * 1.2)), rows = Math.ceil(order.length / cols)
  const leadCell = Math.floor(rows / 2) * cols + Math.floor(cols / 2)
  const cells = []
  for (let i = 0, o = 0; i < order.length; i++) cells.push(i === leadCell ? lead : others[o++])
  const center = new Map()
  cells.forEach((id, i) => center.set(id, { x: (i % cols) * (NODE_W + GRID_GAP), y: Math.floor(i / cols) * (CARD_H + GRID_GAP) }))
  return boxed(center)
}

/** The team's cards in a box of its own: centres from the box's top-left corner, and the box's size. */
function boxed(center) {
  const pts = [...center.values()]
  if (pts.length === 0) return { centers: new Map(), width: NODE_W + 2 * PAD, height: CARD_H + 2 * PAD }
  const minX = Math.min(...pts.map(p => p.x)) - NODE_W / 2 - PAD
  const minY = Math.min(...pts.map(p => p.y)) - CARD_H / 2 - PAD
  const maxX = Math.max(...pts.map(p => p.x)) + NODE_W / 2 + PAD
  const maxY = Math.max(...pts.map(p => p.y)) + CARD_H / 2 + PAD
  const centers = new Map([...center].map(([id, p]) => [id, { x: p.x - minX, y: p.y - minY }]))
  return { centers, width: maxX - minX, height: maxY - minY }
}

export const teamLayout = (agents, narrow) => (agents.filter(a => !a.isMain).length > RING_MAX ? gridLayout(agents) : ringLayout(agents, narrow))

// ---- the sea ----------------------------------------------------------------------------------------------------

/** How an island looks: gone when its session has stopped, stormy after a recent failure, busy while anyone works. */
export function moodOf(session, now = session.snapshot?.at ?? 0) {
  if (!session.alive) return 'gone'
  const agents = session.snapshot?.agents ?? []
  if (agents.some(a => a.tone === 'error' && now - (a.endedAt ?? 0) < 10 * 60 * 1000)) return 'stormy'
  if (agents.some(a => a.tone === 'running')) return 'busy'
  return 'calm'
}

/** Rows of islands, left to right, each row as wide as `rowWidth` (by default about 1.5 times its height's worth of area); every row centred. */
export function packIslands(sizes, gap = ISLAND_GAP, rowWidth) {
  if (sizes.length === 0) return { spots: [], width: 0, height: 0 }
  const area = sizes.reduce((sum, s) => sum + (s.w + gap) * (s.h + gap), 0)
  const rowW = rowWidth ?? Math.max(...sizes.map(s => s.w), Math.sqrt(area * 1.5))
  const rows = []
  for (const [i, s] of sizes.entries()) {
    const row = rows.at(-1)
    const used = row ? row.items.reduce((w, it) => w + sizes[it].w + gap, -gap) : 0
    if (row && used + gap + s.w <= rowW) row.items.push(i)
    else rows.push({ items: [i] })
  }
  const spots = []
  let y = 0, width = 0
  for (const row of rows) {
    const w = row.items.reduce((sum, it) => sum + sizes[it].w + gap, -gap)
    const h = Math.max(...row.items.map(it => sizes[it].h))
    let x = 0
    for (const it of row.items) { spots[it] = { x, y: y + (h - sizes[it].h) / 2 }; x += sizes[it].w + gap }
    row.w = w
    width = Math.max(width, w)
    y += h + gap
  }
  // centre each row under the widest
  for (const row of rows) for (const it of row.items) spots[it] = { x: spots[it].x + (width - row.w) / 2, y: spots[it].y }
  return { spots, width, height: y - gap }
}

/** A card's id across sessions (every session has a `main`). */
export const uidOf = (session, id) => `${session ?? ''}|${id}`

/**
 * The whole sea: an island per session in a stable order (label, then session id), each with its cards in world
 * coordinates (centres), and the sea's size. A card's `uid` is unique across sessions (every session has a `main`).
 */
export function buildWorld(sessions, narrow = false) {
  const ordered = [...sessions].sort((a, b) => (a.label ?? '').localeCompare(b.label ?? '') || String(a.session).localeCompare(String(b.session)))
  const layouts = ordered.map(s => teamLayout(s.snapshot?.agents ?? [], narrow))
  const sizes = layouts.map(lay => ({ w: Math.max(MIN_ISLAND.w, lay.width / SAFE), h: Math.max(MIN_ISLAND.h, lay.height / SAFE) }))
  const packed = packIslands(sizes)
  const islands = [], cards = []
  ordered.forEach((s, i) => {
    const size = sizes[i], lay = layouts[i]
    const at = { x: SEA_SIDE + (packed.spots[i]?.x ?? 0), y: SEA_TOP + (packed.spots[i]?.y ?? 0) }
    islands.push({ key: s.session ?? 'main', session: s.session, label: s.label, alive: s.alive, mood: moodOf(s), x: at.x, y: at.y, w: size.w, h: size.h, members: (s.snapshot?.agents ?? []).filter(a => !a.isMain).length, working: (s.snapshot?.agents ?? []).filter(a => !a.isMain && a.tone === 'running').length })
    const ox = at.x + (size.w - lay.width) / 2, oy = at.y + (size.h - lay.height) / 2
    const ids = new Set((s.snapshot?.agents ?? []).map(a => a.id))
    for (const agent of s.snapshot?.agents ?? []) {
      const p = lay.centers.get(agent.id)
      if (!p) continue
      cards.push({ uid: uidOf(s.session, agent.id), session: s.session, island: i, agent, x: ox + p.x, y: oy + p.y, parentUid: agent.parentId && ids.has(agent.parentId) ? uidOf(s.session, agent.parentId) : null })
    }
  })
  return { islands, cards, width: packed.width + 2 * SEA_SIDE, height: packed.height + SEA_TOP + 80 }
}

/** The part of the sea a selection fills (`keys` are island keys; none selected means all): a box with room for the decorations. */
export function regionOf(world, keys) {
  const chosen = keys && keys.length > 0 ? world.islands.filter(i => keys.includes(i.key)) : world.islands
  if (chosen.length === 0) return { x0: 0, y0: 0, width: Math.max(1, world.width), height: Math.max(1, world.height), cards: [] }
  const x0 = Math.min(...chosen.map(i => i.x)) - 40, y0 = Math.min(...chosen.map(i => i.y)) - 110
  const x1 = Math.max(...chosen.map(i => i.x + i.w)) + 40, y1 = Math.max(...chosen.map(i => i.y + i.h)) + 40
  const cards = world.cards.filter(c => chosen.some(i => i.key === (world.islands[c.island]?.key))).map(c => ({ x: c.x, y: c.y, k: c.agent.isMain ? LEAD_SCALE : 1 }))
  return { x0, y0, width: x1 - x0, height: y1 - y0, cards }
}

// ---- Fit --------------------------------------------------------------------------------------------------------

export const EDGE = 16, CLEAR = 10, FIT_MAX = 1.1, FIT_MIN = 0.1, FIT_STEP = 0.02
const SLIDES = [0.5, 0.25, 0.75, 0, 1] // where in the spare room to try the region, the middle first
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * The biggest zoom at which the region, slid about inside the free area, keeps every card clear of the floating panels
 * (title, task board, toolbar); `panels` are screen rectangles. Falls back to the plain fit when that would mean a far smaller zoom.
 */
export function fitView(region, box, boardOpen, panels) {
  const right = box.w - EDGE - (boardOpen && box.w >= 900 ? 340 + EDGE : 0)
  const room = { w: right - EDGE, h: box.h - 2 * EDGE }
  const plain = Math.max(FIT_MIN, Math.min(FIT_MAX, room.w / region.width, room.h / region.height)) // as if no panel were in the way
  const at = (z, sx, sy) => ({ x: EDGE + (room.w - region.width * z) * sx - region.x0 * z, y: EDGE + (room.h - region.height * z) * sy - region.y0 * z })
  for (let z = plain; z >= Math.max(FIT_MIN, plain * 0.6); z -= FIT_STEP) {
    for (const sy of SLIDES) for (const sx of SLIDES) {
      const { x, y } = at(z, sx, sy)
      const free = region.cards.every(c => {
        const w = NODE_W * c.k * z + 2 * CLEAR, h = CARD_H * c.k * z + 2 * CLEAR
        const rect = { x: x + c.x * z - w / 2, y: y + c.y * z - h / 2, w, h }
        return !panels.some(panel => overlaps(rect, panel))
      })
      if (free) return { z, ...at(z, sx, sy) }
    }
  }
  return { z: plain, ...at(plain, 0.5, 0.5) }
}
