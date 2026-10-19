// The space theme's five sounds as soft, deep, spacey tones: low sine and triangle pads, each voice a detuned pair, a slow attack, a
// long fall and a short reverb tail. Pure: a sound's name and a sample rate in, mono samples out, with no DOM and no
// imports, so the page plays exactly what scripts/make-space-sounds.mjs writes to WAV for the terminal.

export const SOUND_NAMES = ['start', 'done', 'needs_you', 'failed', 'levelup']

// note: f Hz, t start s, d length s, type sine|triangle, v level, glide semitones over the note, a attack s.
// A low, deep register (fundamentals about 90–330 Hz, everything low-passed at 2.5 kHz); triangles carry a few soft
// overtones so the tones still read on laptop speakers.
export const SPACE_SOUNDS = {
  start: {
    about: 'A deep sonar bloop rising a fourth: an agent lifts off.',
    reverb: 0.28,
    notes: [
      { f: 196, t: 0, d: 0.4, type: 'triangle', glide: 5, a: 0.035 },
      { f: 98, t: 0.02, d: 0.42, type: 'sine', v: 0.45, glide: 5, a: 0.05 },
    ],
  },
  done: {
    about: 'A low open fifth that settles, with a soft warm overtone: a task lands.',
    reverb: 0.32,
    notes: [
      { f: 164.81, t: 0, d: 0.6, type: 'triangle', a: 0.03 },
      { f: 246.94, t: 0.12, d: 0.75, type: 'triangle', v: 0.75, a: 0.03 },
      { f: 329.63, t: 0.24, d: 0.95, type: 'sine', v: 0.3, a: 0.07 },
    ],
  },
  needs_you: {
    about: 'A gentle two-pulse beacon in a low register, the second a step lower: someone is waiting on you.',
    reverb: 0.3,
    notes: [
      { f: 293.66, t: 0, d: 0.45, type: 'triangle', v: 0.75, a: 0.045 },
      { f: 293.66, t: 0.38, d: 0.45, type: 'triangle', v: 0.75, a: 0.045 },
      { f: 220, t: 0.38, d: 0.8, type: 'sine', v: 0.55, a: 0.08 },
    ],
  },
  failed: {
    about: 'A dark pad sinking a semitone, muffled: something went wrong, no alarm bell.',
    reverb: 0.26,
    lowpass: 900,
    notes: [
      { f: 110, t: 0, d: 0.6, type: 'triangle', glide: -1, a: 0.06 },
      { f: 87.31, t: 0.24, d: 0.9, type: 'triangle', glide: -1, a: 0.08 },
      { f: 174.61, t: 0.24, d: 0.75, type: 'sine', v: 0.22, glide: -1, a: 0.1 },
    ],
  },
  levelup: {
    about: 'A rising arpeggio from the low end into a held warm chord: a level up.',
    reverb: 0.38,
    notes: [
      { f: 130.81, t: 0, d: 0.55, type: 'triangle', a: 0.025 },
      { f: 164.81, t: 0.09, d: 0.55, type: 'triangle', a: 0.025 },
      { f: 196, t: 0.18, d: 0.6, type: 'triangle', a: 0.025 },
      { f: 246.94, t: 0.27, d: 0.75, type: 'triangle', v: 0.85, a: 0.025 },
      { f: 329.63, t: 0.36, d: 1.15, type: 'sine', v: 0.45, a: 0.04 },
      { f: 65.41, t: 0.36, d: 1.15, type: 'sine', v: 0.5, a: 0.15 },
    ],
  },
}

export const PEAK = 0.36 // quiet: these play beside the person's own music; a touch above the old 0.32, low tones read softer
const LOWPASS_HZ = 2500 // nothing bright: every sound is low-passed here
const DETUNE_CENTS = 7 // each voice is a pair this far apart: the gentle chorus of a pad
const TAIL_S = 1.1 // room for the reverb to ring out
const SILENCE = 1e-4

const wave = (type, phase) => {
  if (type === 'triangle') {
    const p = (phase / (2 * Math.PI)) % 1
    return 4 * Math.abs(p - 0.5) - 1
  }
  return Math.sin(phase)
}

function addNote(out, rate, n) {
  const start = Math.round(n.t * rate)
  const len = Math.round(n.d * rate)
  const attack = Math.max(1, Math.round((n.a ?? 0.02) * rate))
  const level = n.v ?? 1
  const phases = [0, 0]
  for (let i = 0; i < len && start + i < out.length; i++) {
    const glide = Math.pow(2, ((n.glide ?? 0) * i) / len / 12)
    const env = (i < attack ? i / attack : 1) * Math.exp((-5 * i) / len) // to about -43 dB by the note's end
    let s = 0
    for (let k = 0; k < 2; k++) {
      const cents = (k === 0 ? -1 : 1) * (DETUNE_CENTS / 2)
      phases[k] += (2 * Math.PI * n.f * glide * Math.pow(2, cents / 1200)) / rate
      s += wave(n.type, phases[k]) / 2
    }
    out[start + i] += s * env * level
  }
}

/** A one-pole low-pass: softens the triangles' edges. */
function lowpass(x, rate, hz) {
  const k = 1 - Math.exp((-2 * Math.PI * hz) / rate)
  let y = 0
  return x.map(v => (y += k * (v - y)))
}

/** A small Schroeder reverb (four damped combs into two all-passes), mixed in at `wet`. Deterministic, no noise. */
function reverb(x, rate, wet) {
  const scale = rate / 44100
  const combs = [1557, 1617, 1491, 1422].map(d => ({ buf: new Float32Array(Math.round(d * scale)), i: 0, low: 0 }))
  const passes = [556, 225].map(d => ({ buf: new Float32Array(Math.round(d * scale)), i: 0 }))
  const out = new Float32Array(x.length)
  for (let n = 0; n < x.length; n++) {
    let s = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.low = y * 0.6 + c.low * 0.4 // damping: the highs fade first, like a soft room
      c.buf[c.i] = x[n] * 0.25 + c.low * 0.8
      c.i = (c.i + 1) % c.buf.length
      s += y
    }
    for (const p of passes) {
      const y = p.buf[p.i]
      p.buf[p.i] = s + y * 0.5
      p.i = (p.i + 1) % p.buf.length
      s = y - s * 0.5
    }
    out[n] = x[n] * (1 - wet) + s * wet
  }
  return out
}

/** One sound as mono samples at `rate`, peaking at PEAK, trimmed where its tail falls silent. */
export function renderSound(name, rate = 44100) {
  const spec = SPACE_SOUNDS[name]
  if (!spec) throw new Error(`no such sound: ${name}`)
  const end = Math.max(...spec.notes.map(n => n.t + n.d)) + TAIL_S
  let x = new Float32Array(Math.ceil(end * rate))
  for (const n of spec.notes) addNote(x, rate, n)
  x = lowpass(x, rate, spec.lowpass ?? LOWPASS_HZ)
  return finish(reverb(x, rate, spec.reverb), rate, PEAK)
}

/** Scales `x` to peak at `level`, trimmed where its tail falls silent, with a short fade so the cut never clicks. */
function finish(x, rate, level) {
  const peak = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1
  let last = x.length - 1
  while (last > 0 && Math.abs(x[last]) / peak < SILENCE) last--
  const fade = Math.round(0.03 * rate)
  return x.slice(0, last + 1).map((v, i, a) => (v / peak) * level * Math.min(1, (a.length - i) / fade))
}

// ---------- the page's event sounds: the same clips, played through Web Audio ----------

// the page's event names (web/sounds.js soundsFor) and the sounds they play
const PAGE_EVENT = { start: 'start', done: 'done', needs: 'needs_you', needs_you: 'needs_you', failed: 'failed', levelup: 'levelup' } // soundsFor says 'needs'
export const EVENT_PEAK = 0.12 // on the page: a touch above the old blips' 0.1 (low tones read softer), well over the swooshes
const eventCache = new Map()

/** Plays one event sound on `ctx` (done, needs, failed, levelup, start), rendered once per sample rate. Returns whether it started. */
export function playEvent(ctx, name, volume = 1) {
  const sound = PAGE_EVENT[name]
  if (!sound) return false
  const key = `${sound}|${ctx.sampleRate}`
  let buffer = eventCache.get(key)
  if (!buffer) {
    const samples = renderSound(sound, ctx.sampleRate)
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buffer.copyToChannel(samples, 0)
    eventCache.set(key, buffer)
  }
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  source.buffer = buffer
  gain.gain.value = (EVENT_PEAK / PEAK) * Math.max(0, Math.min(1, volume))
  source.connect(gain).connect(ctx.destination)
  source.start()
  return true
}

// ---------- navigation: swooshes for moving round the page (page-only, never in the terminal) ----------

export const NAV_KINDS = ['travel', 'fit', 'view', 'select']
export const NAV_ABOUT = {
  travel: 'A deep, soft whoosh with a low Doppler bend, a sub swell and a warm glow on arrival: flying to a team. It follows the move (try the pad below); the further, the longer and deeper.',
  fit: 'A wide, low whoosh opening outward over a soft sub: Fit, or All.',
  view: 'A short low warp of rising detuned pads over a sub: Diagram ↔ Space.',
  select: 'A soft, low wooden tick: selecting a card.',
  nudge: 'A very soft low tick per wheel or drag burst, coloured by its direction.',
}
export const NAV_PEAK = 0.065 // well under the event blips (about 0.1): these play on every click; a little up for the low register
const NAV_LEVEL = { travel: 1, fit: 0.85, view: 0.7, select: 0.45, nudge: 0.3 }
const NAV_DEFAULT_MS = 650
const NAV_MIN_MS = 300
const NAV_MAX_MS = 1600

/** A small seeded generator, so a swoosh's noise is the same every time (and in tests). */
function noiseOf(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1
  }
}

/** Noise through a band-pass whose centre follows `hzAt(u)` (u 0..1 over the sound), shaped by `ampAt(u)`. */
function sweep(out, rate, { start = 0, len, hzAt, ampAt, q, seed }) {
  const noise = noiseOf(seed)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, b2 = 0, a1 = 0, a2 = 0
  for (let i = 0; i < len && start + i < out.length; i++) {
    const u = i / len
    if (i % 32 === 0) {
      // RBJ band-pass (constant peak gain), retuned every 32 samples as the centre glides
      const w = (2 * Math.PI * Math.min(hzAt(u), rate * 0.45)) / rate
      const alpha = Math.sin(w) / (2 * q)
      const a0 = 1 + alpha
      b0 = alpha / a0
      b2 = -alpha / a0
      a1 = (-2 * Math.cos(w)) / a0
      a2 = (1 - alpha) / a0
    }
    const x = noise()
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    out[start + i] += y * ampAt(u)
  }
}

/** A sine whose pitch follows `hzAt(u)`, shaped by `ampAt(u)`, from sample `start`. */
function glide(out, rate, { start = 0, len, hzAt, ampAt }) {
  let phase = 0
  for (let i = 0; i < len && start + i < out.length; i++) {
    const u = i / len
    phase += (2 * Math.PI * hzAt(u)) / rate
    out[start + i] += Math.sin(phase) * ampAt(u)
  }
}

const bell = (u, rise = 0.45) => (u < rise ? Math.sin((u / rise) * Math.PI * 0.5) : Math.cos(((u - rise) / (1 - rise)) * Math.PI * 0.5)) ** 1.5
const lerp = (a, b, u) => a + (b - a) * u
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * The direction of a camera move, normalised: `dx` / `dy` the screen-space move in viewport widths / heights (+x right,
 * +y down), `dz` the zoom change in doublings (+1 = twice as close, −1 = half). Each is quantised to quarters so a
 * handful of buffers covers every move. `size` is how big the move is, 0..1, unless `distance` is given.
 */
export function navDirection({ dx = 0, dy = 0, dz = 0, distance } = {}) {
  const q = v => Math.round(clamp(v, -2, 2) * 4) / 4 + 0 // + 0: no -0
  const dir = { dx: q(dx), dy: q(dy), dz: q(dz) }
  const size = distance ?? clamp(Math.hypot(dir.dx, dir.dy) / 2 + Math.abs(dir.dz) / 3, 0, 1)
  return { ...dir, size: Math.round(clamp(size, 0, 1) * 4) / 4 }
}

/** A soft sub-bass swell for weight: a low sine under travel, fit and view, shaped by `ampAt(u)`. */
const sub = (x, rate, len, hz, level, ampAt) => glide(x, rate, { len, hzAt: () => hz, ampAt: u => level * ampAt(u) })

/** The travel whoosh shaped by its direction (see navDirection), all in the low band: zoom bends pitch and brightness
 *  within it, x tilts pitch, y tints the filter (up airier, down warmer). */
function travel(x, rate, len, { dx, dy, dz, size }) {
  const zin = clamp(dz, 0, 2) / 2 // flying closer
  const zout = clamp(-dz, 0, 2) / 2 // pulling back
  const tilt = 2 ** (clamp(dx, -1, 1) * 1.5 / 12) // right a little higher, left a little lower
  const air = clamp(-dy, 0, 1) // going up: a more open filter
  const warm = clamp(dy, 0, 1) // going down: a closed, warmer one
  const low = (160 - 40 * size) * (1 + 0.35 * zin - 0.2 * zout) * (1 - 0.15 * warm)
  const top = Math.min(1500, 820 * (1 + 0.35 * zin - 0.3 * zout) * (1 + 0.3 * air - 0.3 * warm) * tilt)
  const q = (1.2 - 0.5 * zout) * (1 - 0.3 * air) // pulling back and going up both open the band
  sweep(x, rate, { len, q, seed: 7, hzAt: u => (u < 0.45 ? lerp(low, top, u / 0.45) : lerp(top, low * 1.4, (u - 0.45) / 0.55)), ampAt: u => bell(u) })
  // the Doppler bend, low: falls as the move passes; zooming in it rises within the band, zooming out it falls further
  const from = 220 * tilt * (1 - 0.3 * zin + 0.05 * zout)
  const to = (130 - 20 * size) * tilt * (1 + 0.75 * zin - 0.2 * zout)
  glide(x, rate, { len, hzAt: u => lerp(from, to, u), ampAt: u => (0.45 + 0.1 * warm) * bell(u, 0.5) })
  sub(x, rate, len, 55 - 8 * size, 0.4 + 0.15 * size, u => bell(u, 0.5))
  // arrival: a warm low glow, not a sparkle
  const arrive = Math.round(len * 0.8)
  for (const [hz, v] of [[330, 0.14], [494, 0.08], [659, 0.04]]) glide(x, rate, { start: arrive, len: Math.round(rate * 0.5), hzAt: () => hz * tilt * (1 + 0.06 * zin), ampAt: u => v * Math.min(1, u * 20) * Math.exp(-5 * u) })
}

/** A wheel or drag tick: a tiny low chirp up (zoom in) or down (zoom out), tilted by x, filter-brighter up, warmer down. */
function nudge(x, rate, { dx, dy, dz }) {
  const len = Math.round(rate * 0.1)
  const tilt = 2 ** (clamp(dx, -1, 1) * 2 / 12)
  const base = 220 * tilt
  const bend = 2 ** (clamp(dz, -1, 1) * 3 / 12)
  const band = 600 * (1 + 0.35 * clamp(-dy, 0, 1) - 0.3 * clamp(dy, 0, 1))
  glide(x, rate, { len, hzAt: u => base * lerp(1, bend, u), ampAt: u => Math.min(1, u * 15) * Math.exp(-6 * u) })
  sweep(x, rate, { len, q: 1.6, seed: 3, hzAt: u => band * lerp(1, bend, u), ampAt: u => 0.5 * Math.min(1, u * 15) * Math.exp(-8 * u) })
}

/**
 * A navigation sound as mono samples at `rate`, peaking at NAV_PEAK × its level. `duration` (ms) matches the camera move
 * (travel and fit); `dx`, `dy`, `dz` shape a travel or a nudge (see navDirection); `distance` 0..1 overrides its size.
 */
export function renderNav(kind, rate = 44100, { duration = NAV_DEFAULT_MS, ...move } = {}) {
  const dir = navDirection(move)
  const ms = clamp(duration, NAV_MIN_MS, NAV_MAX_MS) * (kind === 'travel' ? 1 + 0.3 * dir.size : 1)
  const len = Math.round((ms / 1000) * rate)
  let x = new Float32Array(len + Math.round(rate * 0.9))
  if (kind === 'travel') {
    travel(x, rate, len, dir)
  } else if (kind === 'fit') {
    sweep(x, rate, { len, q: 0.55, seed: 11, hzAt: u => lerp(1100, 150, u ** 0.7), ampAt: u => bell(u, 0.3) })
    glide(x, rate, { len, hzAt: u => lerp(110, 70, u), ampAt: u => 0.35 * bell(u, 0.3) })
    sub(x, rate, len, 50, 0.4, u => bell(u, 0.35))
  } else if (kind === 'view') {
    const vlen = Math.round(rate * 0.48)
    for (const [hz, v] of [[110, 0.5], [165, 0.35], [220, 0.25]]) {
      for (const cents of [-9, 9]) glide(x, rate, { len: vlen, hzAt: u => hz * 2 ** ((7 * u + cents / 100) / 12), ampAt: u => v * Math.min(1, u * 8) * (1 - u) ** 1.2 })
    }
    sweep(x, rate, { len: vlen, q: 2, seed: 5, hzAt: u => lerp(300, 1300, u), ampAt: u => 0.3 * bell(u, 0.6) })
    sub(x, rate, vlen, 55, 0.35, u => Math.min(1, u * 6) * (1 - u))
  } else if (kind === 'select') {
    const tlen = Math.round(rate * 0.14)
    for (const [hz, v] of [[440, 0.6], [660, 0.25], [880, 0.1]]) glide(x, rate, { len: tlen, hzAt: () => hz, ampAt: u => v * Math.min(1, u * 40) * Math.exp(-12 * u) })
  } else if (kind === 'nudge') {
    x = new Float32Array(Math.round(rate * 0.5))
    nudge(x, rate, dir)
  } else {
    throw new Error(`no such navigation sound: ${kind}`)
  }
  x = lowpass(lowpass(x, rate, LOWPASS_HZ), rate, LOWPASS_HZ) // twice: a steeper roll-off, nothing bright gets through
  x = reverb(x, rate, kind === 'select' || kind === 'nudge' ? 0.18 : 0.3)
  return finish(x, rate, NAV_PEAK * NAV_LEVEL[kind])
}

// ---------- playing them: one at a time, never on load, never when muted ----------

const CROSSFADE_S = 0.08 // a new swoosh fades the previous one out within this
const REPEAT_MS = 250 // a repeat click this soon after the last plays nothing
const BURST_MS = 150 // wheel or drag events closer than this are one gesture: one tick
const PAN_WIDTH = 0.8 // how far left or right a sideways move travels in the stereo field
const SOUND_KEY = 'agent-hq.sound' // the page's ♪ toggle (app.js useStored), JSON true/false
const nav = { ctx: null, current: null, lastAt: -Infinity, burstAt: -Infinity, cache: new Map() }

function soundOn() {
  try {
    const raw = globalThis.localStorage?.getItem(SOUND_KEY)
    return raw === null || raw === undefined ? true : JSON.parse(raw) !== false
  } catch {
    return true
  }
}

/**
 * Plays a navigation sound. `kind`: travel (a fly-to), fit, view, select, or nudge (a wheel / drag gesture: call it on
 * every event; one soft tick per burst). `duration` (ms) the camera move; `dx`, `dy` its screen-space move in viewport
 * widths / heights (+ right, + down) and `dz` its zoom change in doublings (+ closer), or `distance` 0..1 for size alone.
 * Silent when the ♪ toggle is off, before the person has touched the page, outside a fresh click or key (nudge: before
 * any), within 250 ms of the last (nudge: within a burst), or where audio cannot play. Returns whether it played.
 * `ctx` reuses an AudioContext; `volume` scales it; `muted` overrides the toggle.
 */
export function playNav(kind, { duration, ctx, volume = 1, muted, ...move } = {}) {
  if (!NAV_KINDS.includes(kind) && kind !== 'nudge') return false
  if (muted === true || (muted === undefined && !soundOn())) return false
  const activation = globalThis.navigator?.userActivation
  const now = globalThis.performance?.now() ?? Date.now()
  if (kind === 'nudge') {
    // wheel events grant no activation, so a gesture needs the page touched once; every event extends the burst
    const fresh = now - nav.burstAt >= BURST_MS
    nav.burstAt = now
    if (!fresh || (activation && !activation.hasBeenActive)) return false
  } else {
    if (activation && !activation.isActive) return false // no click or key just now: page load, a resize, a data update
    if (now - nav.lastAt < REPEAT_MS) return false
  }
  try {
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext
    const audio = ctx ?? (nav.ctx ??= Context ? new Context() : null)
    if (!audio) return false
    if (audio.state === 'suspended') audio.resume()
    if (kind !== 'nudge') nav.lastAt = now
    const dir = navDirection(move)
    const ms = Math.round((duration ?? NAV_DEFAULT_MS) / 50) * 50
    const key = [kind, audio.sampleRate, ms, dir.dx, dir.dy, dir.dz, dir.size].join('|')
    let buffer = nav.cache.get(key)
    if (!buffer) {
      const samples = renderNav(kind, audio.sampleRate, { duration: ms, ...dir, distance: dir.size })
      buffer = audio.createBuffer(1, samples.length, audio.sampleRate)
      buffer.copyToChannel(samples, 0)
      if (nav.cache.size > 48) nav.cache.clear()
      nav.cache.set(key, buffer)
    }
    const t = audio.currentTime
    if (nav.current) {
      const { source, gain } = nav.current
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(0, t + CROSSFADE_S)
      source.stop(t + CROSSFADE_S + 0.01)
    }
    const source = audio.createBufferSource()
    const gain = audio.createGain()
    source.buffer = buffer
    gain.gain.value = clamp(volume, 0, 1)
    // sideways moves travel across the stereo field from the side they start to the side they end; a tick sits on its side
    const side = clamp(dir.dx, -1, 1) * PAN_WIDTH
    const panner = side !== 0 && typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null
    if (panner && kind === 'nudge') panner.pan.value = side * 0.6
    else if (panner) {
      panner.pan.setValueAtTime(-side, t)
      panner.pan.linearRampToValueAtTime(side, t + (ms / 1000) * (1 + 0.3 * dir.size))
    }
    source.connect(gain)
    ;(panner ? gain.connect(panner) : gain).connect(audio.destination)
    source.start(t)
    const playing = { source, gain }
    nav.current = playing
    source.onended = () => {
      if (nav.current === playing) nav.current = null
    }
    return true
  } catch {
    return false // a swoosh that cannot play is not worth an error
  }
}
