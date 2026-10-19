// The live page's optional 3D "Space" view: one star system per session floating in deep space. The lead is the glowing star at
// the centre; each member is its own planet on a thin dotted orbit ring (never two alike: see planets.js); helpers are small moons of
// their parent's planet. Every planet turns on its own tilted axis at its own speed; a working agent's sits in a soft atmosphere of its status hue and drifts along its orbit, a
// glowing arc trailing it on the ring; idle and done planets stand still and dim; a failed one flares coral; one that needs the
// person burns an amber beacon you can see from far away. No faces and no cards here: the HTML cards, the team titles and their
// collision-free layout belong to the overlay (spaceview.js), which asks this module where things are on screen.
//
//   const space = createStarSystems({ container, onContextLost, onFrame })
//   space.update([{ session, team, folder, tag?, agents: [{ id, parentId, status, hue?, isLead, needsYou?, seed? }] }])
//   space.focus(session | null)     fly to one system (null: all) and frame it            space.fit()    frame the current selection
//   space.project(agentId, session?) -> { x, y, visible, scale, depth, r }               a planet's screen position, and pixel radius r
//   space.systems() -> [{ session, team, folder, tag, x, y, r, title: { x, y }, visible }] each system's screen centre, radius and title anchor
//   space.dispose()
//
// `webglAvailable()` says whether WebGL works. createStarSystems throws a clear Error when it does not; `onContextLost` fires when the
// browser takes WebGL away later. Pauses while the tab is hidden; with `prefers-reduced-motion` nothing spins, drifts or orbits and
// the camera moves instantly. No network, no eval.

import * as THREE from './vendor/three.module.js'
import { LEAD_R, STATUS_HUE, fitDistanceBox, normStatus, orbitPoint, systemLayout, unit } from './starlayout.js'
import { assignPlanets, paintRing, paintSurface, planetSpec } from './planets.js'
import { bestPacking } from './diagramlayout.js'
import { webglAvailable } from './webgl.js'

export { webglAvailable }

const FOV = 50
const FRAME_MS = 1000 / 30 - 1 // a 30 fps cap while something moves; when nothing does there are no frames at all
const MAX_PIXEL_RATIO = 1.5
const CARD_ROOM = 120 // world units kept free round the systems at Fit, for the cards that stand beside the outer planets
const SYSTEM_SPACING = 340 // room kept between two systems, where the cards that stand off their planets go
const STAR_COUNT = 1800
const RADIUS = { member: 60, moon: 21 }
const MIN_DIST = 160, MAX_DIST = 60000
const TILT = 0.55 // radians from straight down: a gentle slant, orbits still read as circles
const ARC = 1.05 // radians of glowing arc trailing a working planet

const color = hex => new THREE.Color(hex)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** A radial gradient texture: bright in the middle, gone at the edge. */
function glowTexture(stops) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const [at, rgba] of stops) g.addColorStop(at, rgba)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  return canvasTexture(canvas)
}
function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
/** A four-pointed flare. */
function flareTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(64, 0); ctx.lineTo(70, 58); ctx.lineTo(128, 64); ctx.lineTo(70, 70); ctx.lineTo(64, 128); ctx.lineTo(58, 70); ctx.lineTo(0, 64); ctx.lineTo(58, 58)
  ctx.closePath()
  ctx.fill()
  return canvasTexture(canvas)
}

export function createStarSystems({ container, onContextLost, onFrame, onNudge } = {}) {
  if (!container) throw new Error('createStarSystems needs a container element')
  if (!webglAvailable()) throw new Error('WebGL is not available in this browser, so the space view cannot be drawn')
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  } catch (error) {
    throw new Error(`WebGL could not start: ${error?.message ?? error}`)
  }
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let reduced = motion.matches
  let dirty = true
  let lost = false
  let raf = 0
  let onscreen = true
  const runnable = () => !document.hidden && onscreen && !lost
  /** Frames are drawn on demand: something changed (mark), or something is moving; otherwise the loop is not scheduled at all. */
  function wake() { if (raf === 0 && runnable()) raf = requestAnimationFrame(loop) }
  function mark() { dirty = true; wake() }
  const onMotion = () => { reduced = motion.matches; mark() }
  motion.addEventListener?.('change', onMotion)

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO))
  renderer.setClearColor(0x050507, 1)
  const canvas = renderer.domElement
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none', outline: 'none' })
  container.append(canvas)
  const onLost = e => { e.preventDefault(); lost = true; onContextLost?.() }
  canvas.addEventListener('webglcontextlost', onLost)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 40000)
  const tmp = new THREE.Vector3()
  const toDispose = []
  const track = thing => { toDispose.push(thing); return thing }
  scene.add(new THREE.AmbientLight(0x6a6a96, 0.9))

  // ---- the backdrop: stars and a faint nebula ------------------------------------------------------------------
  const starGeometry = track(new THREE.BufferGeometry())
  const stars = new Float32Array(STAR_COUNT * 3)
  const tints = new Float32Array(STAR_COUNT * 3)
  for (let i = 0; i < STAR_COUNT; i++) {
    const u = unit(i, 1) * 2 - 1, a = unit(i, 2) * Math.PI * 2, r = 9000 + unit(i, 3) * 6000, s = Math.sqrt(1 - u * u)
    stars.set([Math.cos(a) * s * r, u * r, Math.sin(a) * s * r], i * 3)
    const b = 0.45 + unit(i, 4) * 0.55, warm = unit(i, 5)
    tints.set([b, b * (0.85 + warm * 0.15), b * (0.95 + (1 - warm) * 0.05)], i * 3)
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3))
  starGeometry.setAttribute('color', new THREE.BufferAttribute(tints, 3))
  scene.add(new THREE.Points(starGeometry, track(new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }))))
  const nebulaTexture = track(glowTexture([[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]))
  const nebulae = [['#3B2BFF', -5200, 900, -4200, 9000, 0.16], ['#8A3FFC', 4600, -700, -6000, 10000, 0.13], ['#0B3BFF', 600, 1500, 5200, 8000, 0.1]].map(([hex, x, y, z, size, opacity]) => {
    const sprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: nebulaTexture, color: color(hex), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })))
    sprite.position.set(x, y, z)
    sprite.scale.set(size, size, 1)
    sprite.userData.home = sprite.position.clone()
    scene.add(sprite)
    return sprite
  })

  // ---- shared textures and geometry ----------------------------------------------------------------------------
  const haloTexture = track(glowTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]))
  const flare = track(flareTexture())
  const sphere = track(new THREE.SphereGeometry(1, 40, 28))
  const surfaces = new Map()
  const rings = new Map()
  /** A planet's surface map, painted once per (seed, world). */
  function surfaceFor(seed, spec) {
    const key = `${seed}|${spec.index}`
    let texture = surfaces.get(key)
    if (!texture) {
      const surface = document.createElement('canvas')
      surface.width = 512; surface.height = 256
      paintSurface(surface.getContext('2d'), 512, 256, spec, seed)
      texture = track(canvasTexture(surface))
      surfaces.set(key, texture)
    }
    return texture
  }
  function ringFor(seed, spec) {
    let texture = rings.get(seed)
    if (!texture) {
      const surface = document.createElement('canvas')
      surface.width = surface.height = 256
      paintRing(surface.getContext('2d'), 256, spec, seed)
      texture = track(canvasTexture(surface))
      rings.set(seed, texture)
    }
    return texture
  }

  // ---- systems and agents ---------------------------------------------------------------------------------------
  /** session key -> {group, data, layout, agents: Map, at, goal, radius, light, key} */
  const systems = new Map()
  let focusKey = null
  let time = 0
  let framed = false

  /** A sprite of light: a soft additive glow in a colour. */
  function glow(map, hex, opacity = 0) {
    const sprite = new THREE.Sprite(track(new THREE.SpriteMaterial({ map, color: color(hex), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })))
    return sprite
  }

  function makeStar(sys) {
    const group = new THREE.Group()
    const corona = glow(haloTexture, '#8A6BFF', 0.5); corona.scale.set(LEAD_R * 6, LEAD_R * 6, 1)
    const mid = glow(haloTexture, '#B9A6FF', 0.75); mid.scale.set(LEAD_R * 3.2, LEAD_R * 3.2, 1)
    const core = glow(haloTexture, '#FFFFFF', 0.95); core.scale.set(LEAD_R * 1.5, LEAD_R * 1.5, 1)
    const cross = glow(flare, '#E9E2FF', 0.42); cross.scale.set(LEAD_R * 3.6, LEAD_R * 3.6, 1)
    const band = new THREE.Mesh(track(new THREE.RingGeometry(LEAD_R * 1.5, LEAD_R * 1.56, 96)), track(new THREE.MeshBasicMaterial({ color: color(STATUS_HUE.lead), transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })))
    band.rotation.x = -Math.PI / 2.6
    const light = new THREE.PointLight(0xe6dcff, 3.2, sys.radius * 1.5, 0)
    group.add(corona, mid, core, cross, band, light)
    sys.group.add(group)
    sys.star = { group, corona, mid, core, cross, band, light }
  }

  function makeAgent(sys, agent, orbit, index) {
    const kind = orbit.kind
    const state = normStatus(agent.status)
    const seed = agent.seed ?? agent.id
    const spec = planetSpec(seed, index)
    const r = RADIUS[kind]
    const group = new THREE.Group()
    const material = track(new THREE.MeshLambertMaterial({ map: surfaceFor(seed, spec), emissive: color(STATUS_HUE[state]), emissiveIntensity: 0 }))
    const body = new THREE.Mesh(sphere, material)
    body.scale.set(r, r, r)
    body.rotation.y = spec.phase
    // the axis leans (up to about 30 degrees, and one world in twelve is on its side like Uranus); the sphere turns about it, and a ring lies in the equator
    const lean = unit(seed, 37) < 0.08 ? (unit(seed, 38) < 0.5 ? 1 : -1) * (1.4 + unit(seed, 39) * 0.15) : spec.tilt * 1.7
    const axis = new THREE.Group()
    axis.rotation.z = lean
    axis.add(body)
    const atmosphere = glow(haloTexture, STATUS_HUE[state], 0.2)
    const flareSprite = glow(flare, STATUS_HUE.failed, 0)
    const beacon = glow(haloTexture, STATUS_HUE.waiting, 0)
    group.add(atmosphere, axis, flareSprite, beacon)
    sys.group.add(group)
    const entry = { id: agent.id, kind, group, body, material, atmosphere, flare: flareSprite, beacon, ring: null, glowArc: null, arcGroup: null, angle: orbit.angle, state, agent, spec, r, axis, omega: ((Math.PI * 2) / spec.period) * (spec.retrograde ? -1 : 1) * (kind === 'moon' ? 0.25 : 1), phase: unit(agent.id, 21) * 6.28, needs: false }
    if (spec.ring && kind === 'member') {
      const mesh = new THREE.Mesh(track(new THREE.RingGeometry(r * 1.35, r * 2.15, 72)), track(new THREE.MeshBasicMaterial({ map: ringFor(seed, spec), transparent: true, side: THREE.DoubleSide, opacity: 0.9, depthWrite: false })))
      mesh.rotation.x = -Math.PI / 2
      axis.add(mesh)
      entry.ringMesh = mesh
    }
    if (kind === 'member') addOrbit(sys, entry, orbit.radius)
    return entry
  }

  /** A member's orbit: a faint white dotted ring, and a soft arc that trails the planet and glows while it works. */
  function addOrbit(sys, entry, radius) {
    const count = Math.max(64, Math.round((Math.PI * 2 * radius) / 10))
    const points = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const p = orbitPoint(radius, (i / count) * Math.PI * 2)
      points.set([p.x, 0, p.z], i * 3)
    }
    const geometry = track(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
    entry.ring = new THREE.Points(geometry, track(new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.16, depthWrite: false })))
    const arcGroup = new THREE.Group()
    const arc = (inner, outer, opacity) => {
      const mesh = new THREE.Mesh(track(new THREE.RingGeometry(inner, outer, 48, 1, 0, ARC)), track(new THREE.MeshBasicMaterial({ color: color(STATUS_HUE[entry.state]), transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })))
      mesh.rotation.x = -Math.PI / 2
      arcGroup.add(mesh)
      return mesh
    }
    entry.arcs = [arc(radius - 1.4, radius + 1.4, 0), arc(radius - 8, radius + 8, 0)]
    entry.arcGroup = arcGroup
    sys.group.add(entry.ring, arcGroup)
  }

  function dropAgent(sys, entry) {
    sys.group.remove(entry.group)
    if (entry.ring) sys.group.remove(entry.ring, entry.arcGroup)
    sys.agents.delete(entry.id)
  }

  function update(data) {
    const incoming = new Map(data.map(d => [d.session ?? '', d]))
    for (const [key, sys] of systems) if (!incoming.has(key)) { scene.remove(sys.group); systems.delete(key) }
    for (const [key, d] of incoming) {
      let sys = systems.get(key)
      const layout = systemLayout(d.agents.map(a => ({ id: a.id, parentId: a.parentId, status: a.status, isLead: a.isLead })))
      if (!sys) {
        sys = { session: d.session ?? null, key, group: new THREE.Group(), agents: new Map(), at: null, star: null }
        sys.group.rotation.x = (unit(key, 5) - 0.5) * 0.16
        sys.group.rotation.z = (unit(key, 6) - 0.5) * 0.08
        scene.add(sys.group)
        systems.set(key, sys)
      }
      sys.data = d
      sys.layout = layout
      sys.radius = layout.radius
      if (!sys.star) makeStar(sys)
      sys.star.light.distance = sys.radius * 1.5
      // a world for every agent that is a planet, none shared
      const moons = new Set(d.agents.filter(a => layout.orbits.get(a.id)?.kind === 'moon').map(a => a.id))
      const planets = assignPlanets(d.agents.filter(a => !layout.orbits.get(a.id) || layout.orbits.get(a.id).kind !== 'lead').map(a => a.id), moons)
      const ids = new Set(d.agents.map(a => a.id))
      for (const entry of [...sys.agents.values()]) if (!ids.has(entry.id)) dropAgent(sys, entry)
      for (const agent of d.agents) {
        const orbit = layout.orbits.get(agent.id)
        if (!orbit || orbit.kind === 'lead') continue
        let entry = sys.agents.get(agent.id)
        if (entry && (entry.kind !== orbit.kind || entry.spec.index !== planets.get(agent.id))) { dropAgent(sys, entry); entry = null }
        if (!entry) { entry = makeAgent(sys, agent, orbit, planets.get(agent.id)); sys.agents.set(agent.id, entry) }
        const state = normStatus(agent.status)
        entry.agent = agent
        if (state !== entry.state) {
          entry.state = state
          entry.material.emissive.set(STATUS_HUE[state])
          entry.atmosphere.material.color.set(STATUS_HUE[state])
          entry.arcs?.forEach(a => a.material.color.set(STATUS_HUE[state]))
        }
        entry.needs = Boolean(agent.needsYou) || state === 'waiting'
        entry.orbit = orbit
      }
    }
    placeSystems()
    if (focusKey !== null && !systems.has(focusKey)) focusKey = null
    if (!framed && systems.size > 0) { framed = true; frame(true) }
    positionAgents(0)
    mark()
  }

  /** The systems in rows that fill the screen's shape, centred on the origin. */
  function placeSystems() {
    const list = [...systems.values()].sort((a, b) => String(a.data.team ?? a.data.folder ?? '').localeCompare(String(b.data.team ?? b.data.folder ?? '')) || a.key.localeCompare(b.key))
    if (list.length === 0) return
    const sizes = list.map(s => ({ w: s.radius * 2, h: s.radius * 2 }))
    const packed = bestPacking(sizes, free().aspect, SYSTEM_SPACING)
    list.forEach((s, i) => {
      const spot = packed.spots[i] ?? { x: 0, y: 0 }
      s.goal = { x: spot.x + s.radius - packed.width / 2, y: (unit(s.key, 3) - 0.5) * 120, z: spot.y + s.radius - packed.height / 2 }
      if (s.at === null || reduced) { s.at = { ...s.goal }; s.group.position.set(s.goal.x, s.goal.y, s.goal.z) }
    })
  }

  // ---- the camera ---------------------------------------------------------------------------------------------
  // the part of the screen not under panels (the toolbar, the chips): the scene is framed in it, not in the whole canvas
  let inset = { top: 0, right: 0, bottom: 0, left: 0 }
  function free() {
    const W = Math.max(1, container.clientWidth), H = Math.max(1, container.clientHeight)
    const w = Math.max(1, W - inset.left - inset.right), h = Math.max(1, H - inset.top - inset.bottom)
    return { W, H, w, h, aspect: w / h }
  }
  function applyInset() {
    const { W, H } = free()
    camera.setViewOffset(W, H, -(inset.left - inset.right) / 2, -(inset.top - inset.bottom) / 2, W, H)
    camera.updateProjectionMatrix()
  }
  const goal = { target: new THREE.Vector3(), theta: 0, phi: TILT, dist: 2000 }
  const cur = { target: new THREE.Vector3(), theta: 0, phi: TILT, dist: 2000 }
  let lastMove = null
  const selection = () => (focusKey !== null && systems.has(focusKey) ? [systems.get(focusKey)] : [...systems.values()])

  /** Aim the camera at the selected systems: their middle, far enough back to see them whole. */
  function frame(instant = false) {
    const chosen = selection()
    if (chosen.length === 0) return
    const centre = new THREE.Vector3()
    for (const s of chosen) centre.add(tmp.set(s.goal?.x ?? 0, s.goal?.y ?? 0, s.goal?.z ?? 0))
    centre.divideScalar(chosen.length)
    // the box the chosen systems fill as the camera sees it: across the screen (u) and away from it (v), turned by the camera's yaw
    const c = Math.cos(goal.theta), s = Math.sin(goal.theta)
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const sys of chosen) {
      const g = sys.goal ?? { x: 0, z: 0 }
      const u = g.x * c - g.z * s, v = g.x * s + g.z * c
      const reach = sys.radius - 40 + CARD_ROOM // what is drawn, without the room the layout keeps round it, and room for a card beside the outermost planet
      u0 = Math.min(u0, u - reach); u1 = Math.max(u1, u + reach); v0 = Math.min(v0, v - reach); v1 = Math.max(v1, v + reach)
    }
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2
    goal.target.set(uc * c + vc * s, centre.y, -uc * s + vc * c)
    // on a tall narrow screen a chosen system is framed closer than whole (its outer rings run off the sides), so its planets are far enough
    // apart for their cards to fit beside them
    const area = free()
    const closer = area.aspect < 0.8 && chosen.length === 1 ? 0.68 : 1
    // fitted into the free area: as far back as for a screen of its shape, and the whole screen is that much taller than the area
    goal.dist = clamp(fitDistanceBox((u1 - u0) / 2, ((v1 - v0) / 2) * Math.cos(TILT) + 90, FOV, area.aspect) * (area.H / area.h) * 0.94 * closer, MIN_DIST, MAX_DIST)
    goal.phi = TILT
    // how far the camera is about to move, for the navigation sounds: screen fractions (right, down) and zoom in doublings
    const viewH = 2 * cur.dist * Math.tan((FOV * Math.PI) / 360), delta = tmp.copy(goal.target).sub(cur.target)
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    lastMove = { dx: delta.dot(right) / (viewH * camera.aspect), dy: -delta.dot(up) / viewH, dz: Math.log2(cur.dist / goal.dist), duration: 650 }
    if (instant || reduced) { cur.target.copy(goal.target); cur.dist = goal.dist; cur.theta = goal.theta; cur.phi = goal.phi }
    mark()
    return lastMove
  }

  function stepCamera(dt) {
    const k = reduced ? 1 : 1 - Math.exp(-dt * 5)
    cur.target.lerp(goal.target, k)
    cur.theta += (goal.theta - cur.theta) * k
    cur.phi += (goal.phi - cur.phi) * k
    cur.dist += (goal.dist - cur.dist) * k
    const s = Math.sin(cur.phi)
    camera.position.set(cur.target.x + cur.dist * s * Math.sin(cur.theta), cur.target.y + cur.dist * Math.cos(cur.phi), cur.target.z + cur.dist * s * Math.cos(cur.theta))
    camera.lookAt(cur.target)
    camera.updateMatrixWorld()
    return Math.abs(goal.dist - cur.dist) + Math.abs(goal.theta - cur.theta) + Math.abs(goal.phi - cur.phi) + goal.target.distanceTo(cur.target) > 0.01
  }

  // pointer: drag to orbit, right-drag or shift-drag or two fingers to pan, wheel or pinch to zoom
  const pointers = new Map()
  let press = null
  const pan = (dx, dy) => {
    const unitsPerPixel = (2 * goal.dist * Math.tan((FOV * Math.PI) / 360)) / canvas.clientHeight
    goal.target.add(tmp.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-dx * unitsPerPixel))
    goal.target.add(tmp.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(dy * unitsPerPixel))
  }
  const touched = mark
  const pinchSpan = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 }
  const onDown = e => {
    canvas.setPointerCapture?.(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    press = { x: e.clientX, y: e.clientY, moved: false, button: e.button, shift: e.shiftKey, pinch: pointers.size > 1 ? pinchSpan() : 0 }
    touched()
  }
  const onMove = e => {
    const p = pointers.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) press.moved = true
    if (press?.moved && pointers.size === 1) onNudge?.({ dx: -dx / Math.max(1, canvas.clientWidth), dy: -dy / Math.max(1, canvas.clientHeight) })
    if (pointers.size >= 2) {
      const span = pinchSpan()
      if (press?.pinch && span > 0) goal.dist = clamp(goal.dist * (press.pinch / span), MIN_DIST, MAX_DIST)
      if (press) press.pinch = span
      pan(dx / 2, dy / 2)
    } else if (press && (press.button === 2 || press.shift)) pan(dx, dy)
    else {
      goal.theta -= dx * 0.006
      goal.phi = clamp(goal.phi - dy * 0.006, 0.12, Math.PI / 2 - 0.1)
    }
    if (reduced) { cur.target.copy(goal.target); cur.theta = goal.theta; cur.phi = goal.phi; cur.dist = goal.dist }
    touched()
  }
  const onUp = e => {
    pointers.delete(e.pointerId)
    if (pointers.size === 0) press = null
    touched()
  }
  const onWheel = e => {
    e.preventDefault()
    onNudge?.({ dz: (-e.deltaY * 0.0012) / Math.LN2 })
    goal.dist = clamp(goal.dist * Math.exp(e.deltaY * 0.0012), MIN_DIST, MAX_DIST)
    if (reduced) cur.dist = goal.dist
    touched()
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('contextmenu', e => e.preventDefault())

  // ---- per frame ----------------------------------------------------------------------------------------------
  function positionAgents(dt) {
    for (const sys of systems.values()) {
      for (const entry of sys.agents.values()) {
        const orbit = entry.orbit ?? sys.layout.orbits.get(entry.id)
        if (!orbit) continue
        if (!reduced) entry.angle += orbit.omega * dt
        const around = orbitPoint(orbit.radius, entry.angle)
        const base = orbit.kind === 'moon' ? sys.agents.get(orbit.parent)?.group.position : null
        entry.group.position.set((base?.x ?? 0) + around.x, (base?.y ?? 0) + (orbit.kind === 'moon' ? Math.sin(entry.angle * 1.3) * 8 : 0), (base?.z ?? 0) + around.z)
        if (entry.arcGroup) entry.arcGroup.rotation.y = -entry.angle
      }
    }
  }

  /** Advance the light, the worlds' turning and the systems' glide into place. Returns true while a system is still gliding. Time (and so
   *  the pulses and spins) runs while there are worlds and the view is drawn; with reduced motion nothing turns and frames are on demand. */
  function animate(dt) {
    const t = time
    const live = reduced ? 0 : 1
    let gliding = false
    for (const sys of systems.values()) {
      if (sys.goal && sys.at && !reduced) {
        const k = 1 - Math.exp(-dt * 3)
        sys.at.x += (sys.goal.x - sys.at.x) * k; sys.at.y += (sys.goal.y - sys.at.y) * k; sys.at.z += (sys.goal.z - sys.at.z) * k
        sys.group.position.set(sys.at.x, sys.at.y, sys.at.z)
        if (Math.abs(sys.goal.x - sys.at.x) + Math.abs(sys.goal.y - sys.at.y) + Math.abs(sys.goal.z - sys.at.z) > 0.5) gliding = true
      }
      const star = sys.star
      if (star) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.4 + unit(sys.key, 8) * 6) * live
        star.core.material.opacity = 0.85 + 0.1 * pulse
        star.corona.material.opacity = 0.42 + 0.1 * pulse
        star.cross.material.rotation = t * 0.12
        star.band.rotation.z = t * 0.35
      }
      for (const e of sys.agents.values()) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + e.phase) * live
        if (!reduced) e.body.rotation.y += e.omega * dt // every world turns on its own axis, at its own speed
        const dim = e.state === 'idle' || e.state === 'done' ? 0.62 : e.state === 'stopped' ? 0.38 : 1
        e.material.color.setScalar(dim)
        e.material.emissiveIntensity = e.state === 'failed' ? 0.2 + 0.12 * Math.sin(t * 8 + e.phase) * live : e.state === 'waiting' ? 0.1 + 0.08 * pulse : 0
        if (e.ringMesh) e.ringMesh.material.opacity = 0.9 * dim
        const size = e.r
        const atmosphere = size * (e.kind === 'moon' ? 3 : 3.4)
        e.atmosphere.scale.set(atmosphere, atmosphere, 1)
        e.atmosphere.material.opacity = { working: 0.4 + 0.1 * pulse, waiting: 0.4 + 0.18 * pulse, done: 0.08, failed: 0.4 + 0.2 * Math.sin(t * 9 + e.phase) * live, idle: 0.05, stopped: 0.02 }[e.state]
        e.flare.scale.set(size * 4.2, size * 4.2, 1)
        e.flare.material.opacity = e.state === 'failed' ? 0.5 + 0.3 * Math.sin(t * 6 + e.phase) * live : 0
        e.flare.material.rotation = t * 0.4
        const beacon = size * 7.5 * (1 + 0.12 * pulse)
        e.beacon.scale.set(beacon, beacon, 1)
        e.beacon.material.opacity = e.needs ? 0.42 + 0.3 * pulse : 0
        if (e.ring) {
          e.ring.material.opacity = e.state === 'working' ? 0.26 : 0.14
          e.arcs[0].material.opacity = e.state === 'working' ? 0.55 : e.state === 'failed' ? 0.3 : 0
          e.arcs[1].material.opacity = e.state === 'working' ? 0.13 : 0
        }
      }
    }
    nebulae.forEach((n, i) => n.position.set(n.userData.home.x + Math.sin(t * 0.02 + i) * 240, n.userData.home.y + Math.cos(t * 0.017 + i * 2) * 160, n.userData.home.z))
    return gliding
  }

  const view = new THREE.Vector3()
  /** Where a point is on screen: pixels in the container, whether it can be seen, and pixels per world unit there. */
  function screen(world) {
    const w = canvas.clientWidth, h = canvas.clientHeight
    const depth = -tmp.copy(world).applyMatrix4(camera.matrixWorldInverse).z
    const p = world.clone().project(camera)
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h, visible: depth > 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2, scale: h / (2 * Math.max(1, depth) * Math.tan((FOV * Math.PI) / 360)), depth }
  }
  function project(agentId, session) {
    const sys = session === undefined ? [...systems.values()].find(s => s.agents.has(agentId)) : systems.get(session ?? '')
    const entry = sys?.agents.get(agentId)
    if (!entry && sys?.star && sys.layout?.lead === agentId) {
      sys.star.group.getWorldPosition(view)
      const s = screen(view)
      return { ...s, r: LEAD_R * 1.5 * s.scale, kind: 'lead' }
    }
    if (!entry) return null
    entry.group.getWorldPosition(view)
    const s = screen(view)
    return { ...s, r: entry.r * s.scale, kind: entry.kind }
  }
  /** Each system's centre, radius and the point its team title belongs above (just beyond its farthest ring), on screen. */
  function systemsInfo() {
    return [...systems.values()].map(sys => {
      const centre = sys.group.localToWorld(new THREE.Vector3(0, 0, 0))
      const c = screen(centre)
      const top = sys.group.localToWorld(new THREE.Vector3(0, 0, -(sys.radius + 40)))
      const t = screen(top)
      return { session: sys.session, team: sys.data.team, folder: sys.data.folder, tag: sys.data.tag, x: c.x, y: c.y, r: sys.radius * c.scale, starR: LEAD_R * 1.5 * c.scale, title: { x: t.x, y: t.y }, visible: c.visible || t.visible }
    })
  }

  let last = performance.now()
  const anyWorlds = () => [...systems.values()].some(sys => sys.agents.size > 0)
  function loop(now) {
    raf = 0
    if (!runnable()) return
    if (now - last < FRAME_MS) { raf = requestAnimationFrame(loop); return }
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    dirty = false
    const working = !reduced && anyWorlds() // the worlds turn, so frames go on (at 30 fps, while the view is on screen and the tab shown)
    if (working) time += dt
    positionAgents(working ? dt : 0)
    const gliding = animate(reduced ? 0 : dt)
    const moving = stepCamera(dt)
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
    scene.updateMatrixWorld()
    renderer.render(scene, camera)
    onFrame?.()
    if (working || moving || gliding || dirty) raf = requestAnimationFrame(loop)
  }
  const onVisible = () => { last = performance.now(); if (!document.hidden) mark() }
  document.addEventListener('visibilitychange', onVisible)
  const watcher = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { onscreen = entries[entries.length - 1].isIntersecting; if (onscreen) mark() }) : null
  watcher?.observe(container)

  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    applyInset()
    if (systems.size > 0) { placeSystems(); if (!reduced) frame() }
    mark()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  return {
    update,
    /** Fly to one system (its session id), or back to all of them with null. */
    focus(session) {
      focusKey = session === null || session === undefined ? null : session
      return frame()
    },
    /** Both return the camera's move ({dx, dy, dz, duration}), or undefined when there was nothing to frame. */
    fit: () => frame(),
    /** The screen's edges that panels cover ({top, right, bottom, left} in pixels): the systems are framed inside what is left. */
    setInset(next) {
      const to = { top: next?.top ?? 0, right: next?.right ?? 0, bottom: next?.bottom ?? 0, left: next?.left ?? 0 }
      if (Object.keys(to).every(k => to[k] === inset[k])) return
      inset = to
      applyInset()
      if (systems.size > 0) { placeSystems(); frame() }
    },
    project,
    systems: systemsInfo,
    dispose() {
      cancelAnimationFrame(raf)
      observer.disconnect()
      watcher?.disconnect()
      document.removeEventListener('visibilitychange', onVisible)
      motion.removeEventListener?.('change', onMotion)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      for (const thing of toDispose) thing.dispose?.()
      renderer.dispose()
      canvas.remove()
    },
  }
}
