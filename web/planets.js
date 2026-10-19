// Planets for the space view: every agent is its own world on its orbit, never two alike on screen. Twelve kinds (rocky and
// cratered, banded gas giant, ringed, ice with polar caps, lava with glowing cracks, ocean with clouds, cloudy jungle, a tiny moon,
// a twin-tone dwarf, crystal, storm with a great spot, desert with dunes) in six colour families, 72 in all. The choice is pure
// (`planetSpec`, `assignPlanets`, checked by `node --test`). Two painters, both procedural, no image files and no network: a canvas
// surface map for three.js (`paintSurface`, `paintRing`) and a flat SVG disc for the page (`planetSvg`, with a star and a moon).

import { unit } from './starlayout.js'

export const PLANET_TYPES = ['rocky', 'gas', 'ringed', 'ice', 'lava', 'ocean', 'terra', 'moon', 'twin', 'crystal', 'storm', 'desert']
/** What a kind shows on its surface: with the family it makes a planet's signature. TYPE_NAME is its display class name. */
export const FEATURE = { rocky: 'craters', gas: 'bands', ringed: 'ring', ice: 'polar caps', lava: 'glowing cracks', ocean: 'drifting clouds', terra: 'jungle and clouds', moon: 'small craters', twin: 'two tones', crystal: 'facets', storm: 'great spot', desert: 'dunes' }
export const TYPE_NAME = { rocky: 'Basalt world', gas: 'Aether giant', ringed: 'Halo giant', ice: 'Cryo world', lava: 'Magma world', ocean: 'Tide world', terra: 'Verdant world', moon: 'Moonlet', twin: 'Twin dwarf', crystal: 'Prism world', storm: 'Tempest giant', desert: 'Dune world' }
export const FAMILIES = ['ember', 'azure', 'violet', 'jade', 'rose', 'gold']
export const PLANET_COUNT = PLANET_TYPES.length * FAMILIES.length // 72
/** Light, middle and deep colour of each family, and a bright accent. */
export const PALETTE = {
  ember: ['#FFC49A', '#E8643A', '#5E1B12', '#FFD27A'],
  azure: ['#A9DCFF', '#3D7BFF', '#0C2563', '#9FF0FF'],
  violet: ['#E2CCFF', '#8A5CFF', '#27115F', '#F0B8FF'],
  jade: ['#B5F7DA', '#2FBF8A', '#093F31', '#E6FF9A'],
  rose: ['#FFC4E0', '#E8508F', '#521031', '#FFE0A0'],
  gold: ['#FFEDB0', '#E0A93A', '#573808', '#FFFFFF'],
}

const GIANTS = ['gas', 'ringed', 'storm']
const SMALL = ['rocky', 'moon', 'twin', 'crystal']
/** A planet's day in seconds, 12 to 60: giants 12-24, small rocky worlds 36-60, the rest 20-44. */
function rotationPeriod(type, seed) {
  const [low, span] = GIANTS.includes(type) ? [12, 12] : SMALL.includes(type) ? [36, 24] : [20, 24]
  return Math.round(low + unit(seed, 35) * span)
}

/** The kind of world and colour family of planet number `index` (0 to 71), and the little extras that make it its own.
 *  Families turn with the kinds, so neighbouring numbers differ in both. */
export function planetSpec(seed, index) {
  const i = ((index % PLANET_COUNT) + PLANET_COUNT) % PLANET_COUNT
  const type = PLANET_TYPES[i % PLANET_TYPES.length]
  const t = i % PLANET_TYPES.length
  const family = FAMILIES[(t + Math.floor(i / PLANET_TYPES.length)) % FAMILIES.length]
  return {
    index: i,
    type,
    family,
    palette: PALETTE[family],
    feature: FEATURE[type],
    ring: type === 'ringed',
    clouds: type === 'ocean' || (type === 'gas' && unit(seed, 31) > 0.5),
    tilt: (unit(seed, 32) - 0.5) * 0.6, // the axis' lean
    spin: 0.18 + unit(seed, 33) * 0.22, // radians per second while working
    phase: unit(seed, 34) * 6.28,
    period: rotationPeriod(type, seed), // seconds per turn on its own axis: giants fast, small rocky worlds slow
    retrograde: unit(seed, 36) < 0.17, // about one in six turns the other way
  }
}

/** A helper's planet number: the moon kind, in whichever family its id hashes to. */
export function moonNumber(id) {
  const family = Math.floor(unit(id, 41) * FAMILIES.length)
  const moon = PLANET_TYPES.indexOf('moon')
  return moon + ((family - moon + FAMILIES.length * 2) % FAMILIES.length) * PLANET_TYPES.length
}

/**
 * A planet number for every id, none shared while there are numbers left: each starts from the one its id hashes to and takes the
 * next free one. Helpers (`moons`) are always the small moon kind, in whichever family their id hashes to.
 */
export function assignPlanets(ids, moons = new Set()) {
  const taken = new Set()
  const out = new Map()
  for (const id of ids) {
    if (moons.has(id)) {
      out.set(id, moonNumber(id))
      continue
    }
    const start = Math.floor(unit(id, 40) * PLANET_COUNT)
    let pick = start
    for (let k = 0; k < PLANET_COUNT; k++) {
      const candidate = (start + k) % PLANET_COUNT
      if (PLANET_TYPES[candidate % PLANET_TYPES.length] === 'moon') continue // that kind is for helpers
      if (!taken.has(candidate)) { pick = candidate; break }
    }
    taken.add(pick)
    out.set(id, pick)
  }
  return out
}

// ---- painting ---------------------------------------------------------------------------------------------------

const rng = seed => { let n = 0; return () => unit(seed, ++n) }

/** Paints a planet's surface (an equirectangular map, 2:1) on a canvas context of `w` by `h`. */
export function paintSurface(ctx, w, h, spec, seed = 'planet') {
  const [light, mid, deep, accent] = spec.palette
  const r = rng(`${seed}|${spec.type}`)
  const fill = (color, x = 0, y = 0, ww = w, hh = h) => { ctx.fillStyle = color; ctx.fillRect(x, y, ww, hh) }
  const speckle = (n, colors, size) => { for (let i = 0; i < n; i++) { ctx.fillStyle = colors[i % colors.length]; ctx.globalAlpha = 0.08 + r() * 0.16; ctx.beginPath(); ctx.arc(r() * w, r() * h, 0.5 + r() * size, 0, 7); ctx.fill() } ctx.globalAlpha = 1 }
  const crater = (x, y, s) => {
    for (const dx of [0, -w, w]) {
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.arc(x + dx, y, s, 0, 7); ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = Math.max(1, s * 0.16); ctx.beginPath(); ctx.arc(x + dx, y, s, 3.6, 5.6); ctx.stroke()
    }
  }
  const bands = (colors, wobble, count) => {
    const band = h / count
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = colors[i % colors.length]
      ctx.beginPath(); ctx.moveTo(0, i * band)
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, i * band + Math.sin(x / w * 6.28 * (1 + i % 3) + i) * wobble)
      ctx.lineTo(w, (i + 1) * band + wobble); ctx.lineTo(0, (i + 1) * band + wobble); ctx.closePath(); ctx.fill()
    }
  }
  const blob = (color, x, y, rx, ry, alpha) => { ctx.globalAlpha = alpha; ctx.fillStyle = color; for (const dx of [0, -w, w]) { ctx.beginPath(); ctx.ellipse(x + dx, y, rx, ry, 0, 0, 7); ctx.fill() } ctx.globalAlpha = 1 }

  switch (spec.type) {
    case 'rocky': {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, mid); g.addColorStop(1, deep); fill(g)
      speckle(420, [light, deep, mid], 3)
      for (let i = 0; i < 16; i++) crater(r() * w, h * (0.15 + r() * 0.7), 6 + r() * 20)
      break
    }
    case 'gas':
    case 'ringed': {
      fill(mid)
      bands([light, mid, deep, mid, light, accent, mid, deep], spec.type === 'gas' ? 7 : 3, spec.type === 'gas' ? 14 : 18)
      ctx.globalAlpha = 0.3; speckle(160, [light, deep], 6)
      if (spec.type === 'gas') { blob(deep, r() * w, h * (0.4 + r() * 0.3), 30, 14, 0.7); blob(accent, r() * w, h * (0.3 + r() * 0.4), 18, 8, 0.4) }
      break
    }
    case 'ice': {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.2, light); g.addColorStop(0.5, mid); g.addColorStop(0.8, light); g.addColorStop(1, '#FFFFFF'); fill(g)
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2
      for (let i = 0; i < 26; i++) { ctx.beginPath(); let x = r() * w, y = h * (0.2 + r() * 0.6); ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.3) * 60; y += (r() - 0.5) * 24; ctx.lineTo(x, y) } ctx.stroke() }
      speckle(200, ['#FFFFFF', deep], 4)
      break
    }
    case 'lava': {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, deep); g.addColorStop(1, '#120606'); fill(g)
      speckle(300, [mid, '#000000'], 5)
      ctx.lineCap = 'round'
      for (const [lw, color, blur] of [[7, mid, 14], [3, accent, 8], [1.4, '#FFFFFF', 0]]) {
        ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.shadowColor = accent; ctx.shadowBlur = blur
        const q = rng(`${seed}|cracks`)
        for (let i = 0; i < 22; i++) { ctx.beginPath(); let x = q() * w, y = h * (0.12 + q() * 0.76); ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (q() - 0.5) * 70; y += (q() - 0.5) * 34; ctx.lineTo(x, y) } ctx.stroke() }
      }
      ctx.shadowBlur = 0
      break
    }
    case 'ocean': {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, light); g.addColorStop(0.35, mid); g.addColorStop(0.65, mid); g.addColorStop(1, light); fill(g)
      for (let i = 0; i < 9; i++) blob(deep, r() * w, h * (0.2 + r() * 0.6), 28 + r() * 60, 12 + r() * 26, 0.55)
      for (let i = 0; i < 9; i++) blob(accent, r() * w, h * (0.2 + r() * 0.6), 14 + r() * 30, 6 + r() * 12, 0.3)
      for (let i = 0; i < 16; i++) blob('#FFFFFF', r() * w, h * (0.1 + r() * 0.8), 30 + r() * 80, 4 + r() * 10, 0.4)
      break
    }
    case 'moon': {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#C9C7D2'); g.addColorStop(1, '#6E6C7C'); fill(g)
      ctx.globalAlpha = 0.28; fill(mid); ctx.globalAlpha = 1
      speckle(260, ['#FFFFFF', '#3A3947'], 4)
      for (let i = 0; i < 11; i++) crater(r() * w, h * (0.15 + r() * 0.7), 8 + r() * 24)
      break
    }
    case 'twin': {
      const g = ctx.createLinearGradient(0, 0, w, 0)
      g.addColorStop(0, light); g.addColorStop(0.42, mid); g.addColorStop(0.5, deep); g.addColorStop(0.92, accent); g.addColorStop(1, light)
      fill(g)
      speckle(240, ['#FFFFFF', deep], 4)
      blob('#FFFFFF', w * 0.25, h * 0.35, 40, 10, 0.25); blob('#000000', w * 0.7, h * 0.62, 44, 12, 0.25)
      break
    }
    case 'terra': {
      fill(mid)
      for (let i = 0; i < 12; i++) blob(deep, r() * w, h * (0.2 + r() * 0.6), 24 + r() * 50, 12 + r() * 26, 0.7)
      for (let i = 0; i < 10; i++) blob(accent, r() * w, h * (0.25 + r() * 0.5), 10 + r() * 24, 6 + r() * 12, 0.35)
      for (let i = 0; i < 22; i++) blob('#FFFFFF', r() * w, h * (0.1 + r() * 0.8), 30 + r() * 70, 5 + r() * 12, 0.45)
      break
    }
    case 'crystal': {
      fill(deep)
      const cell = w / 12
      for (let gx = 0; gx < 12; gx++) for (let gy = 0; gy < 6; gy++) for (const flip of [0, 1]) {
        const x = gx * cell, y = gy * cell
        ctx.fillStyle = [light, mid, accent, deep][Math.floor(r() * 4)]; ctx.globalAlpha = 0.45 + r() * 0.5
        ctx.beginPath()
        if (flip) { ctx.moveTo(x + cell, y); ctx.lineTo(x + cell, y + cell); ctx.lineTo(x, y + cell) } else { ctx.moveTo(x, y); ctx.lineTo(x + cell, y); ctx.lineTo(x, y + cell) }
        ctx.closePath(); ctx.fill()
        ctx.globalAlpha = 0.25; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1; ctx.stroke()
      }
      ctx.globalAlpha = 1
      break
    }
    case 'storm': {
      fill(mid)
      bands([mid, light, mid, deep, mid, light], 4, 12)
      const x = r() * w, y = h * 0.6
      blob(deep, x, y, 46, 24, 0.85); blob(accent, x, y, 30, 15, 0.7); blob(light, x - 6, y - 3, 12, 6, 0.6)
      break
    }
    case 'desert': {
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, light); g.addColorStop(0.5, mid); g.addColorStop(1, light); fill(g)
      ctx.strokeStyle = deep; ctx.lineWidth = 2
      for (let i = 0; i < 30; i++) {
        ctx.globalAlpha = 0.18 + r() * 0.2
        const y0 = r() * h, amp = 3 + r() * 6, k = 2 + Math.floor(r() * 4)
        ctx.beginPath(); for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y0 + Math.sin(x / w * 6.28 * k) * amp); ctx.stroke()
      }
      ctx.globalAlpha = 1
      for (let i = 0; i < 6; i++) blob(deep, r() * w, h * (0.2 + r() * 0.6), 14 + r() * 26, 6 + r() * 10, 0.35)
      break
    }
    default: fill(mid)
  }
  // the poles are a little darker, as a sphere wants
  const pole = ctx.createLinearGradient(0, 0, 0, h)
  pole.addColorStop(0, 'rgba(0,0,0,.22)'); pole.addColorStop(0.2, 'rgba(0,0,0,0)'); pole.addColorStop(0.8, 'rgba(0,0,0,0)'); pole.addColorStop(1, 'rgba(0,0,0,.22)')
  ctx.fillStyle = pole; ctx.fillRect(0, 0, w, h)
  if (spec.clouds && spec.type !== 'ocean') { for (let i = 0; i < 10; i++) blob('#FFFFFF', r() * w, h * (0.15 + r() * 0.7), 30 + r() * 70, 3 + r() * 8, 0.22) }
}

/** A ring's bands on a square canvas, concentric from the middle (the ring mesh maps this flat onto itself). */
export function paintRing(ctx, size, spec, seed = 'ring') {
  const [light, mid, , accent] = spec.palette
  const r = rng(`${seed}|ring`)
  const c = size / 2
  ctx.clearRect(0, 0, size, size)
  for (let ring = c; ring > c * 0.5; ring -= 2) {
    const t = (ring - c * 0.5) / (c * 0.5)
    const gap = r() < 0.12
    ctx.strokeStyle = gap ? 'rgba(0,0,0,0)' : [light, mid, accent][Math.floor(r() * 3)]
    ctx.globalAlpha = gap ? 0 : 0.35 + r() * 0.45 * (1 - t * 0.4)
    ctx.lineWidth = 2.4
    ctx.beginPath(); ctx.arc(c, c, ring, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.globalAlpha = 1
}

// ---- the flat SVG disc for the page -------------------------------------------------------------------------------

const STATE_HUE = { working: '#3D7BFF', waiting: '#FFB547', done: '#3DF2B0', failed: '#FF5A5F', idle: '#8A8FA3', stopped: '#5A5D68', lead: '#B9A6FF' }
const DIM = { done: 0.16, idle: 0.3, stopped: 0.4 }
const C = 60 // the centre of the 120 x 120 view box
const n1 = v => Math.round(v * 10) / 10
const GREY = ['#C4C6CE', '#7A7D88', '#2E3038', '#A3A6B0'] // a stopped planet's palette, so it needs no greyscale filter
/** A gradient of `color` that is solid in the middle and fades out at the edge: a soft shape without a blur filter. */
const softGradient = (id, color) => `<radialGradient id="${id}"><stop offset="0.35" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
/** A glow ring from radius `from` (clear) through a peak to `to` (clear), as one gradient fill: a halo without a blur filter. */
const ringGradient = (id, color, from, to, o) => `<radialGradient id="${id}" cx="${C}" cy="${C}" r="${to}" gradientUnits="userSpaceOnUse"><stop offset="${(from / to).toFixed(3)}" stop-color="${color}" stop-opacity="0"/><stop offset="${((from + (to - from) * 0.35) / to).toFixed(3)}" stop-color="${color}" stop-opacity="${o}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`
const esc = text => String(text).replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`)

/** One full turn of a planet's surface as SVG, a 4R x 2R strip (the disc shows half of it at a time). */
function svgSurface(spec, seed, R, id) {
  const [light, mid, deep, accent] = spec.palette
  const r = rng(`${seed}|svg|${spec.type}`)
  const W = 4 * R, H = 2.6 * R // taller than the disc, so it still covers it when the axis is tilted
  const out = []
  const op = v => v.toFixed(2)
  const base = (fill, o = 1) => out.push(`<rect width="${W + 2}" height="${H}" fill="${fill}" opacity="${o}"/>`) // overlaps the next copy on the right only: an edge over the same colour shows no seam
  const vgrad = stops => { out.push(`<linearGradient id="${id}-v" x1="0" y1="0" x2="0" y2="1">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`); base(`url(#${id}-v)`) }
  const dot = (x, y, rad, fill, o) => out.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(rad)}" fill="${fill}" opacity="${op(o)}"/>`)
  const softs = new Map() // soft edges are a radial gradient of the colour fading out, never a blur filter (cheap to paint and move)
  const soft = color => {
    if (!softs.has(color)) { softs.set(color, `${id}-f${softs.size}`); out.push(softGradient(softs.get(color), color)) }
    return `url(#${softs.get(color)})`
  }
  const oval = (x, y, rx, ry, fill, o, isSoft) => out.push(`<ellipse cx="${n1(x)}" cy="${n1(y)}" rx="${n1(rx)}" ry="${n1(ry)}" fill="${isSoft ? soft(fill) : fill}" opacity="${op(o)}"/>`)
  const waveYs = (y0, amp, k, ph) => Array.from({ length: 25 }, (_, i) => n1(y0 + Math.sin((i / 24) * 6.283 * k + ph) * amp))
  // one period across the strip, carried 2 past each end flat, so neighbouring copies overlap on identical paint
  const wavePoints = ys => [[-2, ys[0]], ...ys.map((y, i) => [n1((W * i) / 24), y]), [W + 2, ys[24]]]
  const wave = (y0, amp, k, ph) => wavePoints(waveYs(y0, amp, k, ph)).map(([x, y]) => `${x} ${y}`).join(' L')
  // bands are strips between two waves, each tucked a hair under the next: they never stack, so no anti-aliasing seam shows
  const bands = (colors, count, amp) => {
    const tops = Array.from({ length: count }, (_, i) => wavePoints(waveYs((H * i) / count, amp, 1 + (i % 3), i)))
    tops.forEach((top, i) => {
      const bottom = i + 1 < count ? tops[i + 1].map(([x, y]) => [x, n1(y + 0.8)]).reverse() : [[W + 2, H + 2], [-2, H + 2]] // a hair under the next band
      out.push(`<path d="M${[...top, ...bottom].map(([x, y]) => `${x} ${y}`).join(' L')}Z" fill="${colors[i % colors.length]}"/>`)
    })
  }
  const walk = (steps, dx, dy) => { let x = r() * W, y = H * (0.15 + r() * 0.7); const pts = [`${n1(x)} ${n1(y)}`]; for (let k = 0; k < steps; k++) { x += (r() - 0.5) * dx; y += (r() - 0.5) * dy; pts.push(`${n1(x)} ${n1(y)}`) } return pts.join(' L') }
  const crater = (x, y, s) => {
    dot(x, y, s, '#000', 0.28)
    out.push(`<path d="M${n1(x - s * 0.94)} ${n1(y - s * 0.34)} A${n1(s)} ${n1(s)} 0 0 1 ${n1(x + s * 0.34)} ${n1(y - s * 0.94)}" fill="none" stroke="#fff" stroke-width="${n1(Math.max(0.5, s * 0.18))}" opacity="0.35"/>`)
  }
  const speckle = (count, colors, size) => { for (let i = 0; i < count; i++) dot(r() * W, r() * H, 0.3 + r() * size, colors[i % colors.length], 0.1 + r() * 0.18) }

  switch (spec.type) {
    case 'rocky':
      vgrad([[0, mid], [1, deep]]); speckle(40, [light, deep, mid], 1.6)
      for (let i = 0; i < 10; i++) crater(r() * W, H * (0.15 + r() * 0.7), 2 + r() * 6)
      break
    case 'gas':
      base(mid); bands([light, mid, deep, mid, light, accent, mid, deep], 10, 2.2)
      oval(r() * W, H * 0.62, R * 0.32, R * 0.12, deep, 0.6, true)
      break
    case 'ringed':
      base(mid); bands([light, mid, light, accent, mid, light], 12, 0.8)
      break
    case 'ice':
      vgrad([[0, '#FFFFFF'], [0.25, light], [0.5, mid], [0.75, light], [1, '#FFFFFF']])
      for (let i = 0; i < 9; i++) out.push(`<path d="M${walk(4, R * 0.7, R * 0.3)}" fill="none" stroke="#fff" stroke-width="0.7" opacity="0.6"/>`)
      break
    case 'lava':
      vgrad([[0, deep], [1, '#120606']]); speckle(30, [mid, '#000'], 1.4)
      for (let i = 0; i < 8; i++) {
        const d = walk(5, R * 0.8, R * 0.4)
        out.push(`<path d="M${d}" fill="none" stroke="${mid}" stroke-width="3" stroke-linecap="round" opacity="0.55"/><path d="M${d}" fill="none" stroke="${accent}" stroke-width="1.2" stroke-linecap="round"/><path d="M${d}" fill="none" stroke="#fff" stroke-width="0.4" opacity="0.8"/>`)
      }
      break
    case 'ocean':
      vgrad([[0, light], [0.35, mid], [0.65, mid], [1, light]])
      for (let i = 0; i < 6; i++) oval(r() * W, H * (0.25 + r() * 0.5), R * (0.2 + r() * 0.4), R * (0.1 + r() * 0.2), deep, 0.55)
      for (let i = 0; i < 9; i++) oval(r() * W, H * (0.1 + r() * 0.8), R * (0.25 + r() * 0.5), R * (0.04 + r() * 0.06), '#FFFFFF', 0.5, true)
      break
    case 'terra':
      base(mid)
      for (let i = 0; i < 7; i++) oval(r() * W, H * (0.2 + r() * 0.6), R * (0.25 + r() * 0.4), R * (0.15 + r() * 0.25), deep, 0.75)
      for (let i = 0; i < 6; i++) oval(r() * W, H * (0.3 + r() * 0.4), R * (0.1 + r() * 0.2), R * (0.06 + r() * 0.1), accent, 0.4)
      for (let i = 0; i < 14; i++) oval(r() * W, H * (0.08 + r() * 0.84), R * (0.25 + r() * 0.45), R * (0.05 + r() * 0.09), '#FFFFFF', 0.6, true)
      break
    case 'moon':
      vgrad([[0, '#C9C7D2'], [1, '#6E6C7C']]); base(mid, 0.28) // grey rock, tinted by its family
      speckle(26, ['#FFFFFF', '#3A3947'], 1)
      for (let i = 0; i < 8; i++) crater(r() * W, H * (0.15 + r() * 0.7), 1.5 + r() * 4)
      break
    case 'twin':
      base(light) // the light half, then the dark half with a wavy edge on each side, so every view shows both tones
      out.push(`<path d="M${n1(W * 0.5)} 0 Q${n1(W * 0.5 + R * (r() - 0.5) * 1.6)} ${n1(H / 2)} ${n1(W * 0.5)} ${H} L${W} ${H} Q${n1(W + R * (r() - 0.5) * 1.6)} ${n1(H / 2)} ${W} 0Z" fill="${deep}"/>`)
      oval(W * 0.75, H * 0.5, R * 0.5, R * 0.3, accent, 0.35, true)
      speckle(30, ['#FFFFFF', deep], 1)
      break
    case 'crystal': {
      base(deep)
      const cols = 16, rows = 6, cw = W / cols, ch = H / rows
      for (let gx = 0; gx < cols; gx++) for (let gy = 0; gy < rows; gy++) for (const flip of [0, 1]) {
        const x = gx * cw, y = gy * ch
        const pts = flip ? [[x + cw, y], [x + cw, y + ch], [x, y + ch]] : [[x, y], [x + cw, y], [x, y + ch]]
        out.push(`<path d="M${pts.map(([a, b]) => `${n1(a)} ${n1(b)}`).join(' L')}Z" fill="${[light, mid, accent, deep][Math.floor(r() * 4)]}" opacity="${op(0.45 + r() * 0.5)}" stroke="#fff" stroke-opacity="0.22" stroke-width="0.4"/>`)
      }
      break
    }
    case 'storm': {
      base(mid); bands([mid, light, mid, deep, mid, light], 9, 1.4)
      const x = R * (0.6 + r() * 2.8), y = H * 0.62
      oval(x, y, R * 0.42, R * 0.22, deep, 0.9); oval(x, y, R * 0.28, R * 0.14, accent, 0.8)
      out.push(`<path d="M${n1(x - R * 0.3)} ${n1(y)} A${n1(R * 0.3)} ${n1(R * 0.14)} 0 1 1 ${n1(x + R * 0.12)} ${n1(y + R * 0.08)}" fill="none" stroke="${light}" stroke-width="0.8" opacity="0.8"/>`)
      break
    }
    case 'desert':
      vgrad([[0, light], [0.5, mid], [1, light]])
      for (let i = 0; i < 16; i++) out.push(`<path d="M${wave(r() * H, 1 + r() * 2.5, 3 + Math.floor(r() * 5), r() * 6)}" fill="none" stroke="${deep}" stroke-width="0.7" opacity="${op(0.2 + r() * 0.25)}"/>`)
      for (let i = 0; i < 4; i++) oval(r() * W, H * (0.25 + r() * 0.5), R * (0.12 + r() * 0.2), R * (0.06 + r() * 0.08), deep, 0.35)
      break
    default: base(mid)
  }
  return out.join('')
}

/** The planet's axis as an angle in degrees: its equator (the surface's scroll and the ring) lies along it. */
const axisAngle = spec => n1(-14 + (spec.tilt * 180) / Math.PI)

function ringSvg(spec, R, id, half) {
  const [light, mid, , accent] = spec.palette
  const angle = axisAngle(spec)
  const bands = [[1.24, light, 0.45, 1.2], [1.35, mid, 0.7, 2.4], [1.45, accent, 0.5, 1], [1.54, light, 0.35, 1.8]]
  return `<g transform="rotate(${angle} ${C} ${C})"><g clip-path="url(#${id}-${half})">${bands.map(([k, color, o, sw]) => `<ellipse cx="${C}" cy="${C}" rx="${n1(R * k)}" ry="${n1(R * k * 0.26)}" fill="none" stroke="${color}" stroke-width="${sw}" opacity="${o}"/>`).join('')}</g></g>`
}

function starSvg(seed, R, id) {
  const r = rng(`${seed}|star`)
  const rays = Array.from({ length: 16 }, (_, i) => `<ellipse cx="${C}" cy="${n1(C - R - 4)}" rx="1.4" ry="${n1(7 + r() * 10)}" fill="#E9E2FF" opacity="${(0.3 + r() * 0.4).toFixed(2)}" transform="rotate(${n1(i * 22.5 + r() * 8)} ${C} ${C})"/>`).join('')
  const granules = Array.from({ length: 9 }, () => `<circle cx="${n1(C + (r() - 0.5) * R * 1.4)}" cy="${n1(C + (r() - 0.5) * R * 1.4)}" r="${n1(2 + r() * 4)}" fill="#fff" opacity="0.3"/>`).join('')
  return `<defs>
    <radialGradient id="${id}-glow"><stop offset="0.35" stop-color="#B9A6FF" stop-opacity="0.6"/><stop offset="1" stop-color="#B9A6FF" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}-core" cx="45%" cy="42%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.45" stop-color="#FFF4DA"/><stop offset="0.82" stop-color="#D9CCFF"/><stop offset="1" stop-color="#B9A6FF"/></radialGradient>
  </defs>
  <circle cx="${C}" cy="${C}" r="${R + 24}" fill="url(#${id}-glow)"/>
  <g>${rays}</g>
  <circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}-core)"/>
  <g clip-path="url(#${id}-c)">${granules}</g>`
}

/**
 * The body: a surface strip that scrolls along the tilted equator behind fixed sphere shading, so the features turn round the
 * axis and wrap while the lit side stays put. One turn of the strip is one planet day (spec.period); retrograde ones run back.
 */
function planetBody(spec, seed, R, id, spinning) {
  const [light, mid] = spec.palette
  const W = 4 * R
  const offset = n1((C - R) - (spec.phase / 6.283) * W)
  const spin = `--pl-w:${W}px;--pl-t:${spec.period}s${spec.retrograde ? ';animation-direction:reverse' : ''}`
  const surface = svgSurface(spec, seed, R, id)
  const caps = spec.type === 'ice' ? `<ellipse cx="${C}" cy="${C - R}" rx="${n1(R * 0.78)}" ry="${n1(R * 0.34)}" fill="url(#${id}-cap)" opacity="0.95"/><ellipse cx="${C}" cy="${C + R}" rx="${n1(R * 0.6)}" ry="${n1(R * 0.24)}" fill="url(#${id}-cap)" opacity="0.9"/>` : ''
  return `<defs>
    <radialGradient id="${id}-s" cx="36%" cy="32%" r="78%"><stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="0.42" stop-color="#fff" stop-opacity="0"/><stop offset="0.72" stop-color="#000" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0.66"/></radialGradient>
    <clipPath id="${id}-back"><rect width="120" height="${C}"/></clipPath><clipPath id="${id}-front"><rect y="${C}" width="120" height="${C}"/></clipPath>
    ${softGradient(`${id}-cap`, '#FFFFFF')}${ringGradient(`${id}-h`, mid, R - 3, R + 10, 0.45)}
    <g id="${id}-m">${surface}</g>
  </defs>
  <circle cx="${C}" cy="${C}" r="${R + 10}" fill="url(#${id}-h)"/>
  ${spec.ring ? ringSvg(spec, R, id, 'back') : ''}
  <g clip-path="url(#${id}-c)">
    <g transform="rotate(${axisAngle(spec)} ${C} ${C})">
      <g transform="translate(${offset} ${n1(C - 1.3 * R)})"><g${spinning ? ` class="sk-planet__drift" style="${spin}"` : ''}>
        ${[-1, 0, 1, 2].map(k => `<use href="#${id}-m" x="${k * W}"/>`).join('')}
      </g></g>
      ${caps}
    </g>
    <circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}-s)"/>
  </g>
  <circle cx="${C}" cy="${C}" r="${n1(R - 0.4)}" fill="none" stroke="${light}" stroke-width="0.8" opacity="0.4"/>
  ${spec.ring ? ringSvg(spec, R, id, 'front') : ''}`
}

function stateSvg(state, R, id) {
  const hue = STATE_HUE[state]
  const ring = (rad, width, o) => `<circle cx="${C}" cy="${C}" r="${n1(rad)}" fill="none" stroke="${hue}" stroke-width="${width}" opacity="${o}"/>`
  const glow = (from, to, o) => `<defs>${ringGradient(`${id}-${state}`, hue, from, to, o)}</defs><circle cx="${C}" cy="${C}" r="${to}" fill="url(#${id}-${state})"/>`
  // the atmosphere and the beacon hold still: an animation on an SVG part repaints the whole planet every frame, so only the
  // surface turns (working) and the state shows as light
  if (state === 'working') return `<g>${glow(R - 1, R + 9, 0.9)}${ring(R + 1.2, 1, 0.85)}</g>`
  if (state === 'waiting') return `<g>${glow(R + 6, R + 16, 0.6)}${ring(R + 11, 1.6, 0.95)}${ring(R + 6, 0.8, 0.5)}</g>`
  if (state === 'failed') {
    const x = C + R * 0.8, y = C - R * 0.8, a = 15, b = 3
    const star = `M${n1(x)} ${n1(y - a)} L${n1(x + b)} ${n1(y - b)} L${n1(x + a)} ${n1(y)} L${n1(x + b)} ${n1(y + b)} L${n1(x)} ${n1(y + a)} L${n1(x - b)} ${n1(y + b)} L${n1(x - a)} ${n1(y)} L${n1(x - b)} ${n1(y - b)}Z`
    return `${glow(R - 1, R + 8, 0.85)}<path d="${star}" fill="${hue}"/><circle cx="${n1(x)}" cy="${n1(y)}" r="3" fill="#fff"/>`
  }
  const dim = DIM[state] ? `<circle cx="${C}" cy="${C}" r="${R}" fill="#000" opacity="${DIM[state]}"/>` : ''
  return state === 'done' ? `${dim}${ring(R + 1.2, 1, 0.6)}` : dim // done keeps a thin mint rim, so it reads apart from idle
}

/**
 * A planet as an SVG string, 120 x 120 view box drawn at `size` px. `index` is the agent's planet number (see assignPlanets), `seed`
 * its id; the same pair always draws the same world. `kind` 'star' is the lead (corona, white-hot core), 'moon' a helper (always the
 * small moon kind). States: working spins and glows in blue, waiting wears an amber beacon, failed a coral flare, done and idle sit
 * still and dimmer, stopped turns grey. The only motion is a working planet's surface turning (space.css .sk-planet__drift): the
 * glows, beacon and corona are still light, because animating an SVG part repaints the whole planet every frame. `still` stops
 * the turn too, for grids and previews. `spin: 'always' | 'hover'` turns any planet on its axis (a hero
 * planet; or a grid where only the one under the pointer turns): space.css .sk-planet--spin-always / --spin-hover. No SVG filters.
 */
export function planetSvg({ seed = 'planet', index = 0, state = 'idle', size = 96, kind = 'planet', label, still = false, spin } = {}) {
  const picked = planetSpec(seed, kind === 'moon' ? moonNumber(seed) : index)
  const spec = state === 'stopped' ? { ...picked, palette: GREY } : picked
  const spinning = !still && (state === 'working' || spin === 'always' || spin === 'hover')
  const id = `pl-${kind}-${spec.index}-${Math.floor(unit(seed, 50) * 1e8).toString(36)}${state === 'stopped' ? '-g' : ''}`
  const R = kind === 'star' ? 30 : spec.type === 'moon' ? 22 : spec.type === 'twin' ? 31 : 38
  const body = kind === 'star' ? starSvg(seed, R, id) : planetBody(spec, seed, R, id, spinning)
  const name = label ?? (kind === 'star' ? 'Star' : TYPE_NAME[spec.type])
  return `<svg class="sk-planet sk-planet--${state} sk-planet--${kind}${spinning && spin ? ` sk-planet--spin-${spin}` : ''}" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${esc(`${name}, ${state}`)}" data-planet="${spec.type}|${spec.family}">
  <defs>
    <clipPath id="${id}-c"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath>
  </defs>
  ${body}${stateSvg(state, R, id)}
</svg>`
}

/**
 * The needs-you pulse, an HTML ring that goes behind a waiting planet (outside its SVG, so the planet never repaints): only its
 * opacity and scale animate (space.css sk-attn + sk-breathe-fast), which the compositor runs. Centre it on the planet: `x`, `y` are CSS lengths in
 * the positioned parent (default its middle), `d` the ring's diameter (about 0.82 of the planet's drawn size). It sits at
 * z-index -1, so give the parent `isolation: isolate` and the planet stays on top.
 */
export function pulseHtml({ x = '50%', y = '50%', d = '80px' } = {}) {
  return `<span class="sk-planet-pulse" aria-hidden="true" style="position:absolute;z-index:-1;left:calc(${x} - ${d} / 2);top:calc(${y} - ${d} / 2);width:${d};height:${d};border-radius:50%;pointer-events:none;box-shadow:0 0 0 1.5px rgba(255,181,71,.7),0 0 24px 4px rgba(255,181,71,.38);animation:sk-attn 1.8s ease-in-out infinite,sk-breathe-fast 1.8s ease-in-out infinite"></span>`
}
