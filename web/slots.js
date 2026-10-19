// Where each agent's card stands in the space view, as fixed slots round its own system: worked out from the systems' places on the
// screen and the cards' sizes only, never from where a planet is just now, so the planets keep orbiting and the cards stay put (a thin
// leader line joins each card to its moving planet). No DOM, no imports but labellayout.js, so `node --test` can check it.
//
// planSlots places every agent in the fullest kind of card it can have (its `variants`, best first), most important first: outside its
// system's outermost ring, on the side its orbit starts on, clear of the other cards and titles, never over another system's rings or
// any star. A card that finds no such place takes the next smaller kind. createSlotKeeper makes the plan steady over time: it replans
// only when the camera has been still for a moment, and (data changes aside) at most once every couple of seconds, and the old slot
// is kept whenever it still fits.

import { cardRect, hit, hitDisc, inside } from './labellayout.js'

const GAP = 14 // between a card and the system's outer ring
const TIERS = [0, 36, 90, 160] // how far beyond the ring a slot may stand, nearest first
const INNER = [0.85, 0.7] // when nothing fits outside: a card's nearest edge this share of the ring's radius from the star
const SPREAD = 12 // angles tried each side of the preferred one, 15 degrees apart
const STEP = Math.PI / 12
const MARGIN = 8 // between two cards
const STAR_STEP = 28 // how much farther from its star each try for a lead's slot stands
const HOLE = 20 // the grid a last-resort search walks (phones)
const dirOf = angle => { const x = Math.cos(angle), y = Math.sin(angle) * 0.8; const length = Math.hypot(x, y); return [x / length, y / length] } // the camera looks down at a tilt, so rings are flatter than they are wide

/**
 * `systems`: Map key -> {x, y, r, rr, starR, visible} on screen (`r` the system's radius with its margin, `rr` its outermost ring). `agents`: [{id, key, angle, priority, variants, farOk}]: `angle` is the
 * side of its system (radians, screen) its orbit starts on, `nearStar` puts it as close to its own star as it fits (a lead), `farOk` lets it take any free hole when nothing near fits (a phone).
 * `sizeOf(id, kind)` -> {w, h}. `bounds`: the free rectangle. `titles`: Map key -> rectangle (kept clear of by every card).
 * `prev`: the last plan, so a slot that still fits is kept. Returns Map id -> {kind, w, h, dx, dy} (dx, dy: the card's top-left from its
 * system's centre), kind null when nothing fits.
 */
export function planSlots({ systems, agents, sizeOf, bounds, titles = new Map(), prev = new Map(), otherSystem = 0.8 }) {
  const placed = []
  const out = new Map()
  const order = [...agents].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || String(a.id).localeCompare(String(b.id)))
  for (const a of order) {
    const sys = systems.get(a.key)
    if (!sys) continue
    const keepOut = [{ x: sys.x, y: sys.y, r: (sys.starR ?? 0) + 8 }]
    if (!a.farOk) for (const [key, other] of systems) if (key !== a.key && other.visible) keepOut.push({ x: other.x, y: other.y, r: other.r * otherSystem })
    for (const [key, other] of systems) if (key !== a.key && other.starR) keepOut.push({ x: other.x, y: other.y, r: other.starR + 8 })
    const free = rect => inside(rect, bounds) && !placed.some(p => hit(rect, p, MARGIN)) && ![...titles.values()].some(t => hit(rect, t, 6)) && !keepOut.some(k => hitDisc(rect, k))
    let result = { kind: null }
    for (const kind of a.variants) {
      const { w, h } = sizeOf(a.id, kind)
      let found = null
      const before = prev.get(a.id)
      if (before?.kind === kind) {
        const rect = { x: sys.x + before.dx, y: sys.y + before.dy, w, h }
        if (free(rect)) found = rect
      }
      const ring = sys.rr ?? sys.r // the outermost ring as drawn
      // a lead stands beside its own star: the nearest free place first, then ever farther; a member outside its ring
      const distances = a.nearStar
        ? [...Array.from({ length: Math.ceil((ring + GAP - (sys.starR ?? 30)) / STAR_STEP) + 1 }, (_, i) => (sys.starR ?? 30) + 10 + i * STAR_STEP)]
        : [...TIERS.map(t => ring + GAP + t), ...INNER.map(f => ring * f)]
      search: for (const dist of found ? [] : distances) {
        for (let k = 0; k <= SPREAD * 2; k++) {
          const off = Math.ceil(k / 2) * STEP * (k % 2 === 1 ? 1 : -1)
          const raw = cardRect(sys.x, sys.y, w, h, dist, dirOf(a.angle + off))
          // a place that sticks out past the screen's edge slides back in, rather than being given up (the star's own disc still keeps it clear)
          const rect = { ...raw, x: Math.min(Math.max(raw.x, bounds.x), bounds.x + bounds.w - w), y: Math.min(Math.max(raw.y, bounds.y), bounds.y + bounds.h - h) }
          if (!free(rect)) continue
          found = rect
          break search
        }
      }
      if (!found && a.farOk) {
        let best = Infinity
        const aim = dirOf(a.angle)
        for (let y = bounds.y; y + h <= bounds.y + bounds.h; y += HOLE) {
          for (let x = bounds.x; x + w <= bounds.x + bounds.w; x += HOLE) {
            const away = Math.hypot(x + w / 2 - (sys.x + aim[0] * sys.r), y + h / 2 - (sys.y + aim[1] * sys.r))
            if (away >= best) continue
            const rect = { x, y, w, h }
            if (!free(rect)) continue
            best = away
            found = rect
          }
        }
      }
      if (found) { result = { kind, w, h, dx: found.x - sys.x, dy: found.y - sys.y }; placed.push(found); break }
    }
    out.set(a.id, result)
  }
  return out
}

const near = v => Math.round(v / 2) * 2 // pixels, to the nearest two: a hair of drift is no move
/** How many agents' kind or slot differ between two plans (a slot more than a pixel off counts). */
export function countChanges(before, after) {
  let n = 0
  for (const [id, slot] of after) {
    const was = before.get(id)
    if (!was || was.kind !== slot.kind || Math.abs((was.dx ?? 0) - (slot.dx ?? 0)) > 1 || Math.abs((was.dy ?? 0) - (slot.dy ?? 0)) > 1) n++
  }
  return n
}

/**
 * Keeps the plan steady. `update(now, input)` (input as planSlots takes it) returns {plan, moving, planId, changes}:
 *  - while the systems are on the move (the camera is flying, panning, zooming) nothing is replanned and `moving` is true: the cards
 *    follow their systems rigidly (place them at the system's centre plus dx, dy);
 *  - once they have been still for `settleMs` the plan is made again if the geometry, the agents' sizes or their wanted kinds changed;
 *  - but never twice within `holdMs`, except for the first plans, agents coming or going, and the `warmupMs` after the first call (when
 *    cards are being measured);
 *  - `changes` counts the slot and kind changes made so far (after the first plan).
 */
export function createSlotKeeper({ settleMs = 300, holdMs = 2000, warmupMs = 1500 } = {}) {
  let plan = new Map()
  let planned = false
  let started = null
  let geom = '', wish = '', ids = ''
  let planGeom = '', planWish = '', planIds = ''
  let movedAt = -Infinity, plannedAt = -Infinity
  let planId = 0, changes = 0
  return {
    update(now, input) {
      started ??= now
      const { systems, agents, sizeOf, bounds } = input
      const g = `${[...systems].map(([k, s]) => `${k}:${near(s.x)},${near(s.y)},${near(s.r)}`).join(';')}|${bounds.x},${bounds.y},${bounds.w},${bounds.h}`
      const w = agents.map(a => `${a.id}:${a.variants.map(v => { const s = sizeOf(a.id, v); return `${v}${Math.round(s.w / 8)}x${Math.round(s.h / 8)}` }).join(',')}`).join(';')
      const i = agents.map(a => a.id).sort().join(',')
      if (g !== geom) { geom = g; movedAt = now }
      const settled = now - movedAt >= settleMs
      const dirty = !planned || g !== planGeom || w !== planWish
      const allowed = !planned || i !== planIds || now - started < warmupMs || now - plannedAt >= holdMs
      if (dirty && settled && allowed) {
        const next = planSlots({ ...input, prev: plan })
        if (planned) changes += countChanges(plan, next)
        plan = next
        planned = true
        planGeom = g; planWish = w; planIds = i
        plannedAt = now
        planId++
      }
      return { plan, moving: !settled, planId, changes }
    },
  }
}
