// Glow-blob mascots for the space theme: a puffy, lobed creature with a glowing heart, a little face and, sometimes, an
// icon floating inside. Pure: a seed (an agent id or nickname) and a state in, SVG markup out. The same seed always
// gives the same creature, 24+ distinct ones come from silhouette x hue x icon, and the face says the state.
// Markup only (no eval, no new Function, nothing fetched); the colours are set here, the motion in space.css (`.sk-blob`).

export const STATES = ['working', 'waiting', 'done', 'failed', 'idle', 'stopped']
export const ICONS = ['star', 'cookie', 'heart', 'bolt', 'moon', 'orb']

// each creature's own hue pair (its inner glow and icon), apart from the status hue the card shows
const HUES = [
  ['#FF4FD8', '#7B5CFF'], // magenta
  ['#FFB547', '#FF5A8A'], // amber
  ['#3DF2B0', '#3D7BFF'], // mint
  ['#3D9BFF', '#B06BFF'], // blue
  ['#FF7A59', '#FF3D9A'], // coral
  ['#7CF3FF', '#6A7CFF'], // cyan
  ['#C58BFF', '#FF6FD0'], // lilac
  ['#F5E663', '#FF8A3D'], // lemon
]
const FAILED_HUE = ['#FF5A5F', '#FF2D6F']
const BODY = ['#8A6BFF', '#4B30DA', '#1C1272'] // the indigo-to-violet body, light to deep
const STOPPED_BODY = ['#8C8C98', '#54545E', '#24242B'] // stopped is grey, drawn grey (no CSS filter on a repeated element)
const STOPPED_HUE = ['#9A9AA6', '#6C6C78']
const VIEW = 100
const CX = 50
const CY = 53

/** A small stable generator from a seed string: the same seed, the same creature, in any session. */
function rng(seed) {
  let h = 2166136261
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  let a = h >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.tag = (h >>> 0).toString(36)
  return next
}

const n1 = v => Math.round(v * 10) / 10

/** What makes a creature itself: its lobes, hue and icon, from the seed alone (the first `i`-th pick avoids repeats). */
export function blobSpec(seed, index) {
  const r = rng(seed)
  const lobes = 4 + Math.floor(r() * 4) // 4 to 7
  const [hue, hue2] = HUES[(index ?? Math.floor(r() * HUES.length)) % HUES.length]
  const pick = Math.floor(r() * ICONS.length)
  // with an index the hue and icon are dealt out in turn, so 24 creatures in a row are all different pairs
  const icon = ICONS[index === undefined ? pick : (index + 2 * Math.floor(index / HUES.length)) % ICONS.length]
  return {
    lobes,
    amp: 0.1 + r() * 0.1,
    phase: r() * Math.PI * 2,
    squash: 0.84 + r() * 0.1,
    hue,
    hue2,
    icon,
    tilt: (r() - 0.5) * 50,
    tag: r.tag,
  }
}

/** The puffy outline: round lobes with soft valleys, as a smooth closed path. */
function silhouette(spec, scale = 1) {
  const count = spec.lobes * 10
  const points = Array.from({ length: count }, (_, i) => {
    const t = (i / count) * Math.PI * 2
    const lobe = Math.pow(Math.abs(Math.sin((spec.lobes * t) / 2 + spec.phase)), 0.85)
    const radius = 38 * scale * (1 - spec.amp + 2 * spec.amp * lobe)
    return [CX + radius * Math.cos(t), CY + radius * Math.sin(t) * spec.squash]
  })
  let d = `M${n1(points[0][0])} ${n1(points[0][1])}`
  for (let i = 0; i < count; i++) {
    const p0 = points[(i + count - 1) % count], p1 = points[i], p2 = points[(i + 1) % count], p3 = points[(i + 2) % count]
    d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)} ${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)} ${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])} ${n1(p2[1])}`
  }
  return d + 'Z'
}

const ICON_PATHS = {
  star: 'M0 -13L3.8 -4.6L13 -3.8L6.2 2.4L8.2 11.4L0 6.8L-8.2 11.4L-6.2 2.4L-13 -3.8L-3.8 -4.6Z',
  heart: 'M0 11C-14 2 -13 -9 -6 -10C-2 -11 0 -8 0 -6C0 -8 2 -11 6 -10C13 -9 14 2 0 11Z',
  bolt: 'M3 -13L-8 2H-1L-4 13L9 -3H2Z',
  moon: 'M5 -12A13 13 0 1 0 12 5A10 10 0 0 1 5 -12Z',
  orb: '',
}

function spiral(cx, cy) {
  const pts = Array.from({ length: 19 }, (_, i) => {
    const t = i / 18
    const angle = t * Math.PI * 3.4
    const radius = 0.8 + t * 4.6
    return `${n1(cx + radius * Math.cos(angle))} ${n1(cy + radius * Math.sin(angle))}`
  })
  return `M${pts.join('L')}`
}

const eyes = {
  working: () => '<path d="M40.5 46.5l-1 8M59.5 46.5l-1 8"/>', // the little quote-mark dashes
  waiting: () => '<path d="M37.5 46l7 4l-7 4M62.5 46l-7 4l7 4"/>', // > <
  done: () => '<path d="M36 51q5 -3.4 10 0M54 51q5 -3.4 10 0"/>', // closed, content
  failed: () => `<path d="${spiral(41, 51)}"/><path d="${spiral(59, 51)}"/>`, // @ @
  idle: () => '<circle cx="41" cy="51" r="1.9" class="sk-fill"/><circle cx="59" cy="51" r="1.9" class="sk-fill"/>', // · ·
  stopped: () => '<path d="M37.5 47.5l7 7m0 -7l-7 7M55.5 47.5l7 7m0 -7l-7 7"/>', // x x
}

function icon(spec, id) {
  const path = ICON_PATHS[spec.icon]
  const place = `translate(${CX + (spec.tilt > 0 ? 6 : -6)} ${CY - 2}) rotate(${n1(spec.tilt)}) scale(.9)`
  if (spec.icon === 'orb') return `<circle class="sk-icon" cx="${CX + 5}" cy="${CY + 6}" r="11" fill="url(#o${id})"/>`
  if (spec.icon === 'cookie') {
    return `<g class="sk-icon" transform="${place}"><circle r="12.5" fill="url(#o${id})"/><circle cx="-4" cy="-3" r="1.6" fill="#1C1272" opacity=".7"/><circle cx="4" cy="1" r="1.4" fill="#1C1272" opacity=".7"/><circle cx="-1" cy="6" r="1.5" fill="#1C1272" opacity=".7"/></g>`
  }
  return `<path class="sk-icon" d="${path}" transform="${place}" fill="url(#o${id})"/>`
}

/**
 * One creature as SVG markup. `seed` picks its look; `state` is working, waiting, done, failed, idle or stopped;
 * `lead` gives the brighter, larger star with an orbiting ring and a white-hot core. The class names (`sk-blob`,
 * `sk-working`, `sk-swirl`, ...) are what space.css moves.
 */
export function blobSvg({ seed = 'blob', state = 'idle', lead = false, size = 96, index, label } = {}) {
  const status = STATES.includes(state) ? state : 'idle'
  const spec = blobSpec(seed, index)
  const [hue, hue2] = status === 'failed' ? FAILED_HUE : status === 'stopped' ? STOPPED_HUE : [spec.hue, spec.hue2]
  const body_ = status === 'stopped' ? STOPPED_BODY : BODY
  const id = `${spec.tag}${status.slice(0, 2)}${lead ? 'L' : ''}`
  const body = silhouette(spec)
  const inner = silhouette(spec, 0.8)
  const aria = label ? `role="img" aria-label="${String(label).replace(/[<>&"]/g, '')}"` : 'aria-hidden="true"'
  const swirlRotation = n1(spec.tilt * 2)
  return `<svg class="sk-blob sk-${status}${lead ? ' sk-lead' : ''}" width="${size}" height="${size}" viewBox="0 0 ${VIEW} ${VIEW}" ${aria}>
<defs>
<radialGradient id="b${id}" cx="38%" cy="28%" r="85%"><stop offset="0" stop-color="${body_[0]}"/><stop offset=".5" stop-color="${body_[1]}"/><stop offset="1" stop-color="${body_[2]}"/></radialGradient>
<radialGradient id="o${id}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${hue2}"/><stop offset="1" stop-color="${hue}"/></radialGradient>
<radialGradient id="h${id}" cx="50%" cy="50%" r="50%"><stop offset=".55" stop-color="${hue}" stop-opacity=".0"/><stop offset=".8" stop-color="${hue}" stop-opacity=".45"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></radialGradient>
<radialGradient id="c${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></radialGradient>
<radialGradient id="p${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${hue}" stop-opacity=".85"/><stop offset=".55" stop-color="${hue}" stop-opacity=".4"/><stop offset="1" stop-color="${hue}" stop-opacity="0"/></radialGradient>
<radialGradient id="q${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${hue2}" stop-opacity=".85"/><stop offset=".55" stop-color="${hue2}" stop-opacity=".4"/><stop offset="1" stop-color="${hue2}" stop-opacity="0"/></radialGradient>
<clipPath id="k${id}"><path d="${body}"/></clipPath>
</defs>
<circle class="sk-halo" cx="${CX}" cy="${CY}" r="49" fill="url(#h${id})"/>
<g class="sk-body">
<path d="${body}" fill="url(#b${id})"/>
<g clip-path="url(#k${id})">
<g class="sk-swirl" style="transform-origin:${CX}px ${CY}px" transform="rotate(${swirlRotation} ${CX} ${CY})">
<ellipse cx="${CX - 8}" cy="${CY + 8}" rx="34" ry="23" fill="url(#p${id})"/>
<ellipse cx="${CX + 14}" cy="${CY - 6}" rx="25" ry="18" fill="url(#q${id})"/>
</g>
${icon(spec, id)}
</g>
<path d="${inner}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1.2"/>
<path d="${body}" fill="none" stroke="#D9CFFF" stroke-opacity=".5" stroke-width="1.3"/>
<path class="sk-gloss" d="M${CX - 26} ${CY - 22}q10 -15 26 -15" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2.4" stroke-linecap="round"/>
${lead ? `<circle class="sk-core" cx="${CX}" cy="${CY + 12}" r="12" fill="url(#c${id})"/>` : ''}
<g class="sk-face" fill="none" stroke="#fff" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"${lead ? ' transform="translate(0 -4)"' : ''}>${eyes[status]()}</g>
</g>
${lead ? `<g class="sk-ring" transform="rotate(-18 ${CX} ${CY})"><ellipse cx="${CX}" cy="${CY}" rx="44" ry="12" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1" stroke-dasharray="1 3.4" stroke-linecap="round"/><circle class="sk-moon" cx="0" cy="0" r="2.6" fill="#fff" style="offset-path:path('M${CX - 44} ${CY}a44 12 0 1 0 88 0a44 12 0 1 0 -88 0Z')"/></g>` : ''}
${status === 'failed' ? `<path class="sk-spark" d="M82 20l2.6 6l6 2.6l-6 2.6l-2.6 6l-2.6 -6l-6 -2.6l6 -2.6Z" fill="#FFD7D8"/>` : ''}
</svg>`
}
