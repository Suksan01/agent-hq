// Track drawing adapted from the plan-progress mod (MIT, see THIRD_PARTY_NOTICES.md): a Raster track of twinkling braille dots with a coloured
// pill at its head, and the same track as an Svg dot grid where the app draws pictures. Cells are packed per RasterProps: [char, fg, bg] as uint32s.

export type Tone = 'running' | 'needs_input' | 'error' | 'done'

// the space theme's status glows on a dark terminal: working electric blue, needs you amber, failed coral, done mint
export const TONE_COLOR: Record<Tone, string> = { running: '#3D7BFF', needs_input: '#FFB547', error: '#FF5A5F', done: '#3DF2B0' }
// on a light terminal the glows would wash out: one deeper lightness for every state, white on each reads at 4.5:1
export const TONE_COLOR_LIGHT: Record<Tone, string> = { running: '#3A5BD9', needs_input: '#AD6400', error: '#C5353E', done: '#18883A' }
export const tonesFor = (isLight: boolean) => (isLight ? TONE_COLOR_LIGHT : TONE_COLOR)
// the lead's mark (✦) and colour: violet-white
export const LEAD_COLOR = '#B9A6FF'
const INK = [5, 5, 7] // text on a bright pill
export const TONE_GLYPH: Record<Tone, string> = { running: '●', needs_input: '?', error: '!', done: '✓' }

const DEFAULT = 0x01000000
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]
// the terminal background the track's tint is mixed against
const SCHEMES = { dark: { bg: [24, 24, 27] }, light: { bg: [255, 255, 255] } } as const

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const mix = (a: readonly number[], b: readonly number[], m: number) => a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * m))
const pack = (c: readonly number[]) => ((c[0] ?? 0) << 16) | ((c[1] ?? 0) << 8) | (c[2] ?? 0)
const hash = (a: number, b: number, k: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453
  return x - Math.floor(x)
}
const wave = (t: number, periodMs: number, offset = 0) => 0.5 + 0.5 * Math.sin((t / periodMs + offset) * Math.PI * 2)
const q = (m: number) => Math.round(Math.max(0, Math.min(1, m)) * 8) / 8

// A Raster cell must be exactly one column wide or the engine refuses the whole tree.
// shortcut: anything outside ASCII, Latin and the glyphs drawn here becomes '·' (CJK/emoji names show as dots); port plan-progress's width table if that matters.
// The half block the sprites draw with was checked against plan-progress's width table (the engine's own measure): one column.
const SAFE_GLYPHS = new Set([...'●↳…✓✕·│?!▀✦≈◑○─—'])
const cellChar = (ch: string) => {
  const cp = ch.codePointAt(0) ?? 63
  const isPlain = (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0x2ff) || (cp >= 0x2800 && cp <= 0x28ff)
  return isPlain || SAFE_GLYPHS.has(ch) ? ch : '·'
}
export const cellText = (s: string) => [...s].map(cellChar).join('')
export const fit = (s: string, w: number) => {
  const chars = [...cellText(s)]
  if (chars.length <= w) return chars.join('')
  return w <= 1 ? '…'.slice(0, Math.max(0, w)) : chars.slice(0, w - 1).join('').trimEnd() + '…'
}

// ---------- Text lines: Thai shown whole. Never in a Raster cell: a mark has no column of its own there ----------

const isThai = (cp: number) => cp >= 0x0e00 && cp <= 0x0e7f
// the marks drawn over or under the consonant before them: no column of their own (sara am, U+0E33, is a spacing vowel)
const isThaiMark = (cp: number) => cp === 0x0e31 || (cp >= 0x0e34 && cp <= 0x0e3a) || (cp >= 0x0e47 && cp <= 0x0e4e)
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const clustersOf = (s: string) => Array.from(segmenter.segment(s), part => part.segment)
export const hasThai = (s: string) => [...s].some(ch => isThai(ch.codePointAt(0) ?? 0))

// เ แ โ ใ ไ are written before the consonant they are said after: a cut must not part them from it
const isLeadingVowel = (s: string) => /^[เ-ไ]$/.test(s)

/** A Text line's pieces with their columns: a Thai cluster whole (its marks take none), anything else as the cells draw it. */
function textPieces(s: string): { text: string; width: number }[] {
  const pieces = clustersOf(s).flatMap(cluster => {
    const points = [...cluster].map(ch => ch.codePointAt(0) ?? 0)
    if (isThai(points[0] ?? 0)) return [{ text: cluster, width: points.filter(cp => !isThaiMark(cp)).length }]
    return [...cluster].map(ch => ({ text: cellChar(ch), width: 1 }))
  })
  return pieces.reduce<{ text: string; width: number }[]>((out, piece) => {
    const last = out.at(-1)
    return last && isLeadingVowel(last.text) ? [...out.slice(0, -1), { text: last.text + piece.text, width: last.width + piece.width }] : [...out, piece]
  }, [])
}

/** How many columns a Text line takes; outside Thai, exactly what `cellText` gives. */
export const textWidth = (s: string) => textPieces(s).reduce((w, piece) => w + piece.width, 0)

/** `fit` for a Text line: Thai kept, and cut only between clusters, so a consonant never loses its marks. */
export function fitText(s: string, w: number): string {
  const pieces = textPieces(s)
  if (pieces.reduce((sum, piece) => sum + piece.width, 0) <= w) return pieces.map(piece => piece.text).join('')
  if (w <= 1) return '…'.slice(0, Math.max(0, w))
  let used = 0
  let out = ''
  for (const piece of pieces) {
    if (used + piece.width > w - 1) break
    used += piece.width
    out += piece.text
  }
  return `${out.trimEnd()}…`
}

/** The leading clusters of `s` that fit in `max` code units: raw text cut short without splitting a cluster. */
export function headOf(s: string, max: number): string {
  let out = ''
  for (const cluster of clustersOf(s)) {
    if (out.length + cluster.length > max) break
    out += cluster
  }
  return out
}

class Grid {
  readonly cells: number[][]
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.cells = Array.from({ length: columns * rows }, () => [32, DEFAULT, DEFAULT])
  }
  set(x: number, y: number, ch: string | number, fg: number, bg: number) {
    if (x < 0 || x >= this.columns || y < 0 || y >= this.rows) return
    this.cells[y * this.columns + x] = [typeof ch === 'number' ? ch : (ch.codePointAt(0) ?? 32), fg, bg]
  }
  fill(y: number, from: number, to: number, bg: number) {
    for (let x = from; x < to; x++) this.set(x, y, ' ', DEFAULT, bg)
  }
  text(x: number, y: number, s: string, fg: number, bg: number) {
    let i = 0
    for (const ch of cellText(s)) this.set(x + i++, y, ch, fg, bg)
    return i
  }
  encode() {
    const words = new Uint32Array(this.cells.length * 3)
    this.cells.forEach((c, i) => words.set(c, i * 3))
    return (new Uint8Array(words.buffer) as Uint8Array & { toBase64: () => string }).toBase64()
  }
}

/** The columns an agent's real name keeps in the sidebar before it is dropped: the name is how the person addresses an agent, so it stays readable down to here. */
export const MIN_NAME = 6

/** One cell holding `ch` in `color` on `base` (hex colours): a Raster a text glyph cannot stand in for, because only Rasters move on the animation tick. */
export function glyphCells(ch: string, color: string, base: string): string {
  const g = new Grid(1, 1)
  g.set(0, 0, ch, pack(hex(color)), pack(hex(base)))
  return g.encode()
}

/** `sweep`: no share is known, so a band of dots drifts along the track and the pill waits at the left (no percentage is implied). */
export type TrackSpec = { done: number; total: number; tone: Tone; label: string; count: string; sweep?: boolean }

/** One-row progress track: a dim dotted rail; the finished share glows in the status hue, brighter towards its head, its
 * dots twinkling while `t` moves; the count rides the head as a pill. `base` is the background under the track (a panel's
 * colour), the terminal's when left out. */
export function trackCells(spec: TrackSpec, W: number, t: number, isLight: boolean, base?: string): string {
  const g = new Grid(W, 1)
  const bgColor = base ? hex(base) : SCHEMES[isLight ? 'light' : 'dark'].bg
  const isDone = spec.tone === 'done'
  const fx = (isDone ? 1 : Math.min(1, spec.done / Math.max(1, spec.total))) * W
  const acc = hex(tonesFor(isLight)[spec.tone])
  const glow = mix(acc, isLight ? [0, 0, 0] : [255, 255, 255], isLight ? 0.25 : 0.5)
  const rail = mix(bgColor, isLight ? [0, 0, 0] : [255, 255, 255], 0.2)
  for (let x = 0; x < W; x++) g.set(x, 0, '⠒', pack(rail), pack(bgColor)) // the dotted rail

  const TWINKLE = [2200, 2800, 1900, 3300]
  if (spec.sweep) {
    // no share known: a glow drifts along the rail
    const head = ((t / 2400) % 1) * (W + 12) - 6
    for (let col = 0; col < W; col++) {
      const near = Math.max(0, 1 - Math.abs(col - head) / 6)
      if (near === 0) continue
      let bits = 0
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) if (hash(col * 2 + c, r, 1) <= 0.1 + 0.5 * near) bits |= BRAILLE_BITS[r]?.[c] ?? 0
      g.set(col, 0, bits ? 0x2800 + bits : ' ', pack(mix(rail, glow, q(near))), pack(mix(bgColor, acc, q(0.22 * near))))
    }
  }
  for (let col = 0; col < Math.min(W, Math.ceil(fx)); col++) {
    const u = Math.min(1, (col + 0.5) / Math.max(1, fx)) // brighter towards the head, a glow pushed along
    const fill = mix(bgColor, acc, q(isDone ? 0.4 : 0.2 + 0.36 * u))
    let bits = 0
    for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) if (hash(col * 2 + c, r, 1) <= 0.25 + 0.4 * u) bits |= BRAILLE_BITS[r]?.[c] ?? 0
    const cls = Math.floor(hash(col, 0, 2) * 4)
    const blink = 1 - (isDone ? 0.15 : 0.45) * wave(t + cls * 600, TWINKLE[cls] ?? 2200, 0.25)
    g.set(col, 0, bits ? 0x2800 + bits : ' ', pack(mix(fill, glow, q((0.5 + 0.5 * u) * blink))), pack(fill))
  }

  const icon = spec.tone === 'running' ? '' : `${TONE_GLYPH[spec.tone]} `
  const name = fit(spec.label, Math.max(3, Math.floor(W * (W < 60 ? 0.7 : 0.5)) - icon.length - spec.count.length - 4))
  const shown = (icon + name).trimEnd() // a glyph with no words keeps one space before the count, not two
  if (!shown && !spec.count) return g.encode()
  const gap = shown && spec.count ? 1 : 0
  const kw = [...shown].length + gap + spec.count.length + 2
  const kx = Math.round(Math.max(0, Math.min(W - kw, (spec.sweep ? 0 : fx) - kw / 2)))
  const ink = pack(isLight ? [255, 255, 255] : INK)
  g.fill(0, kx, kx + kw, pack(acc))
  const at = kx + 1 + g.text(kx + 1, 0, shown, ink, pack(acc))
  if (spec.count) g.text(at + gap, 0, spec.count, ink, pack(acc))
  return g.encode()
}

// ---------- the same track as an Svg, where the app draws pictures, not cells (desktop, vscode, mobile) ----------

export const TRACK_PX = 22 // an Svg track's height in CSS pixels, as plan-progress draws its bars
const SWEEP_PX = 48 // the drifting glow's width while no share is known
const PILL_FONT = "'Anthropic Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif"
const rgb = (c: readonly number[]) => `rgb(${c.join(',')})`
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
// about how wide a text runs in the pill's 12px font: narrow letters, wide ones, CJK
const textPx = (s: string) => [...s].reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 12 : /[ilI.,:;'|!]/.test(ch) ? 3.4 : /[mwMW]/.test(ch) ? 9.5 : 6.7), 0)

/** 2px dots on a 3px grid in 7 rows across `width` pixels, thicker towards its right end; each look (colour step, twinkle) one path. */
function gridDots(width: number): string {
  const dots = new Map<string, string>()
  for (let col = 0; col * 3 < width; col++) {
    const x = col * 3
    const u = Math.min(1, (x + 1.5) / width)
    const dense = 0.22 + 0.78 * Math.pow(u, 1.5)
    const step = Math.min(4, Math.floor(Math.min(1, Math.pow(u, 0.9) * 1.1) * 4.99))
    for (let r = 0; r < 7; r++) {
      if (hash(col, r, 1) > dense + 0.1) continue
      const cls = `b${step} t${Math.floor(hash(col, r, 2) * 4)}`
      dots.set(cls, `${dots.get(cls) ?? ''}M${x} ${1 + r * 3}h2v2h-2z`)
    }
  }
  return [...dots].map(([cls, d]) => `<path class="${cls}" d="${d}"/>`).join('')
}

/**
 * trackCells as an Svg `W` pixels wide, in plan-progress's look: a faint capsule, the done share filled with a dot grid
 * that warms from grey to the tone's colour over a tint deepening towards its head (twinkling while it runs), and the
 * pill at the head, a solid capsule of the tone. With no share known a short glow drifts along it, the pill at its start.
 */
export function trackSvg(spec: TrackSpec, W: number, isLight: boolean): string {
  const H = TRACK_PX
  const color = tonesFor(isLight)[spec.tone]
  const acc = hex(color)
  const fx = spec.sweep ? 0 : (spec.tone === 'done' ? 1 : Math.min(1, spec.done / Math.max(1, spec.total))) * W
  const light = mix(acc, [255, 255, 255], 0.32)
  const looks = [0, 1, 2, 3, 4]
    .map(b => {
      const dense = 0.22 + 0.78 * Math.pow(b / 4, 1.5)
      return `.b${b}{fill:${rgb(mix([132, 130, 138], light, b / 4))};fill-opacity:${(0.35 + 0.65 * dense).toFixed(2)}}`
    })
    .join('')
  // only a working track moves, as only a working bot does
  const motion =
    spec.tone !== 'running'
      ? ''
      : `.t0,.t1,.t2,.t3{animation:tw 2.2s ease-in-out infinite}.t1{animation-duration:2.8s;animation-delay:-.7s}` +
        `.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}` +
        `@keyframes tw{0%,100%{opacity:1}50%{opacity:.45}}` +
        `.sw{animation:sw 2.4s linear infinite}@keyframes sw{from{transform:translateX(-${SWEEP_PX}px)}to{transform:translateX(${W}px)}}` +
        `@media (prefers-reduced-motion:reduce){.t0,.t1,.t2,.t3,.sw{animation:none}}`
  const ink = rgb(isLight ? [255, 255, 255] : INK)
  const style = `<style>${looks}${motion}.kt{font:500 12px ${PILL_FONT};fill:${ink}}.kc{font-weight:400}</style>`
  const tint = `<linearGradient id="tint" x1="0" x2="${fx.toFixed(1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rgb(acc)}" stop-opacity=".05"/><stop offset="1" stop-color="${rgb(acc)}" stop-opacity=".33"/></linearGradient>`
  const fill = fx > 0 ? `<rect width="${fx.toFixed(1)}" height="${H}" fill="url(#tint)"/>${gridDots(fx)}` : ''
  const sweep = spec.sweep ? `<g class="sw">${gridDots(SWEEP_PX)}</g>` : ''

  // the pill says what the terminal's does, its label cut before its count is
  const icon = spec.tone === 'running' ? '' : `${TONE_GLYPH[spec.tone]} `
  const countPx = spec.count ? textPx(spec.count) + 6 : 0
  const maxPx = Math.max(80, W * 0.6)
  let label = spec.label
  while ([...label].length > 3 && 20 + textPx(icon + label) + countPx > maxPx) label = [...label].slice(0, -1).join('')
  const shown = icon + (label === spec.label ? label : `${label.trimEnd()}…`)
  let pill = ''
  if (shown.trim() || spec.count) {
    const kw = Math.round(20 + (shown.trim() ? textPx(shown) + countPx : countPx - 6))
    const kx = Math.max(kw / 2, Math.min(W - kw / 2, spec.sweep ? 0 : fx))
    const count = spec.count ? `<tspan class="kc"${shown.trim() ? ' dx="6"' : ''}>${esc(spec.count)}</tspan>` : ''
    pill =
      `<g transform="translate(${kx.toFixed(1)} 0)"><rect x="${-kw / 2}" width="${kw}" height="${H}" rx="${H / 2}" fill="${color}"/>` +
      `<text y="${H / 2 + 4.2}" text-anchor="middle" class="kt">${esc(shown.trim())}${count}</text></g>`
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${style}` +
    `<defs><clipPath id="track"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath>${tint}</defs>` +
    `<g clip-path="url(#track)"><rect width="${W}" height="${H}" fill="#808080" fill-opacity=".16"/>${fill}${sweep}</g>${pill}</svg>`
  )
}


// ---------- sprites: two pixels per cell, the upper as the half block's ink, the lower as its background ----------

/** A sprite frame (rows of palette letters) as Raster cells, over the panel's background; clear pixels show it. */
export function spriteCells(frame: readonly string[], palette: Record<string, string>, base: string): string {
  const width = Math.max(...frame.map(row => row.length))
  const rows = Math.ceil(frame.length / 2)
  const g = new Grid(width, rows)
  const bg = hex(base)
  const colorOf = (ch: string | undefined): number[] => {
    if (!ch || ch === '.') return bg
    const value = palette[ch] ?? '#ff00ff'
    // a see-through colour (a halo, a shadow) is mixed over the panel
    const see = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value)
    return see ? mix(bg, [Number(see[1]), Number(see[2]), Number(see[3])], Number(see[4])) : hex(value)
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) {
      g.set(x, y, '▀', pack(colorOf(frame[y * 2]?.[x])), pack(colorOf(frame[y * 2 + 1]?.[x])))
    }
  }
  return g.encode()
}
