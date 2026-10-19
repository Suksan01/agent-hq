// Where everything is in the star-system scene, with no DOM and no three.js so `node --test` can check it: systems placed apart
// in space, each lead at its centre, members on their own orbit rings, helpers as moons round their parent.

export const STATUS_HUE = { working: '#3D7BFF', waiting: '#FFB547', done: '#3DF2B0', failed: '#FF5A5F', idle: '#8A8FA3', stopped: '#5A5D68', lead: '#B9A6FF' }

const STATUS_OF = { running: 'working', pending: 'working', completed: 'done', killed: 'stopped' }
/** The scene's six states, from the snapshot's statuses (running, pending, waiting, idle, completed, failed, killed) or its own. */
export const normStatus = status => (status in STATUS_HUE ? status : (STATUS_OF[status] ?? 'idle'))

export const LEAD_R = 64 // the star's own size
const FIRST_RING = 210, RING_STEP = 96 // each member has an orbit ring of its own
const MOON_R = 84, MOON_STEP = 22
const SYSTEM_GAP = 220
const TURN_SPEED = 34 // units a working member travels per second along its ring
const MOON_SPEED = 0.5 // radians per second for a working agent's moon

/** A number in [0, 1) from a string: the same string, the same number. */
export function unit(text, salt = 0) {
  let h = 2166136261 ^ salt
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

/**
 * One system's orbits. `agents`: [{id, parentId, status, isLead}]. Returns the lead's id, the outer radius and, for every agent,
 * {kind: 'lead'|'member'|'moon', parent, radius (from its parent), angle (where it starts), omega (radians per second)}.
 * A helper is a moon of its parent; a helper of a helper a smaller moon of that one.
 */
export function systemLayout(agents) {
  const byId = new Map(agents.map(a => [a.id, a]))
  const lead = agents.find(a => a.isLead) ?? agents.find(a => !a.parentId || !byId.has(a.parentId)) ?? null
  const out = new Map()
  if (!lead) return { lead: null, radius: LEAD_R + SYSTEM_GAP / 2, orbits: out }
  out.set(lead.id, { kind: 'lead', parent: null, radius: 0, angle: 0, omega: 0 })
  const isMember = a => a.id !== lead.id && (!a.parentId || a.parentId === lead.id || !byId.has(a.parentId))
  const members = agents.filter(isMember)
  members.forEach((a, i) => {
    const radius = FIRST_RING + i * RING_STEP
    // spread the members evenly round the star, by their place in the list, so none cluster
    const angle = ((i / members.length) * Math.PI * 2 + unit(a.id) * 0.25) % (Math.PI * 2)
    out.set(a.id, { kind: 'member', parent: lead.id, radius, angle, omega: normStatus(a.status) === 'working' ? TURN_SPEED / radius : 0 })
  })
  const placed = new Map() // parent id -> how many moons it has
  const addMoons = parentId => {
    for (const a of agents) {
      if (a.parentId !== parentId || out.has(a.id) || a.id === lead.id) continue
      const k = placed.get(parentId) ?? 0
      placed.set(parentId, k + 1)
      const depth = out.get(parentId)?.kind === 'moon' ? 0.5 : 1
      const radius = (MOON_R + k * MOON_STEP) * depth
      out.set(a.id, { kind: 'moon', parent: parentId, radius, angle: unit(a.id, 7) * Math.PI * 2, omega: (normStatus(a.status) === 'working' ? MOON_SPEED : 0) * (k % 2 === 0 ? 1 : -1) })
      addMoons(a.id)
    }
  }
  for (const a of members) addMoons(a.id)
  addMoons(lead.id) // a helper the lead started without a member
  const outer = members.length === 0 ? 0 : FIRST_RING + (members.length - 1) * RING_STEP
  const moonReach = Math.max(0, ...[...out.values()].filter(o => o.kind === 'moon').map(o => o.radius + 30))
  return { lead: lead.id, radius: Math.max(LEAD_R + 90, outer + moonReach + 60), orbits: out }
}

/** A point on an orbit of `radius` at `angle`, in the system's flat plane (x right, z towards the viewer). */
export const orbitPoint = (radius, angle) => ({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius })

/**
 * The systems spread through space, none overlapping: sorted by team then session, placed along a spiral at the first spot that
 * keeps `SYSTEM_GAP` between neighbours, each a little above or below the others. `systems`: [{session, team, radius}].
 * Returns [{x, y, z}] in the same order as given.
 */
export function placeSystems(systems) {
  const order = systems.map((s, i) => ({ s, i })).sort((a, b) => String(a.s.team ?? '').localeCompare(String(b.s.team ?? '')) || String(a.s.session).localeCompare(String(b.s.session)))
  const spots = []
  const at = []
  for (const { s, i } of order) {
    let spot = { x: 0, z: 0 }
    for (let step = 0; spots.length > 0; step++) {
      const d = 60 * Math.sqrt(step), a = step * 2.399963
      spot = { x: Math.cos(a) * d * 1.5, z: Math.sin(a) * d } // wider than deep: the screen is
      if (spots.every(p => Math.hypot(p.x - spot.x, p.z - spot.z) >= p.r + s.radius + SYSTEM_GAP)) break
    }
    spots.push({ ...spot, r: s.radius })
    at[i] = { x: spot.x, y: (unit(s.session, 3) - 0.5) * 240, z: spot.z }
  }
  return at
}

/** How far a camera with this field of view (degrees, vertical) and aspect must stand to see a sphere of `radius` whole. */
export function fitDistance(radius, fovDeg, aspect) {
  const v = (fovDeg * Math.PI) / 360 // half the vertical angle
  const half = Math.min(v, Math.atan(Math.tan(v) * aspect)) // the narrower of the two
  return (radius / Math.sin(half)) * 1.08
}

/** How far a camera must stand to see a box `halfW` wide and `halfH` tall (each from its middle) whole, on a screen of this aspect. */
export function fitDistanceBox(halfW, halfH, fovDeg, aspect) {
  const tan = Math.tan((fovDeg * Math.PI) / 360)
  return Math.max(halfH / tan, halfW / (tan * aspect)) * 1.1
}
