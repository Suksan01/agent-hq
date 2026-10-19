// Terminal drawing adapted from the plan-progress mod (MIT, see THIRD_PARTY_NOTICES.md): a Raster track of twinkling braille dots with a coloured
// pill at its head. Cells are packed per RasterProps: [char, fg, bg] as uint32s.

export type Tone = 'running' | 'needs_input' | 'error' | 'done'

// one lightness for every state (plan-progress's violet, amber, red and green), white on each reads at 4.5:1
export const TONE_COLOR: Record<Tone, string> = { running: '#7858CA', needs_input: '#AD6400', error: '#C5353E', done: '#18883A' }
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
// The mascots' glyphs were each checked against plan-progress's width table (the engine's own measure): one column.
const SAFE_GLYPHS = new Set([...'●↳…✓✕·│?!', ...'•ᴥωөᵔᴗᴖ‿◕◉⊙▽≧≦♪♫♥♡✦✧✿★ˇ°×'])
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

export type TrackSpec = { done: number; total: number; tone: Tone; label: string; count: string }

/** One-row progress track: dots fill the finished share and twinkle while `t` moves; the pill rides the head.
 * `base` is the background under the track (a panel's colour), the terminal's when left out. */
export function trackCells(spec: TrackSpec, W: number, t: number, isLight: boolean, base?: string): string {
  const g = new Grid(W, 1)
  const bgColor = base ? hex(base) : SCHEMES[isLight ? 'light' : 'dark'].bg
  const isDone = spec.tone === 'done'
  const fx = (isDone ? 1 : Math.min(1, spec.done / Math.max(1, spec.total))) * W
  const acc = hex(TONE_COLOR[spec.tone])
  const light = mix(acc, [255, 255, 255], 0.35)
  const grey = [120, 118, 128]
  const track = mix(bgColor, [128, 128, 128], isLight ? 0.14 : 0.18)
  const fill = mix(track, acc, isDone ? 0.3 : 0.17)
  for (let x = 0; x < W; x++) g.set(x, 0, ' ', DEFAULT, pack(x + 0.5 < fx ? fill : track))

  // dots grow denser and warmer towards the head, each twinkling on its own period
  const TWINKLE = [2200, 2800, 1900, 3300]
  for (let col = 0; col < Math.min(W, Math.ceil(fx)); col++) {
    const u = Math.min(1, (col + 0.5) / Math.max(1, fx))
    const dense = isDone ? 0.8 : 0.22 + 0.78 * Math.pow(u, 1.5)
    let bits = 0
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 2; c++) {
        const sx = col * 2 + c
        if (sx / 2 < fx && hash(sx, r, 1) <= dense * 0.6) bits |= BRAILLE_BITS[r]?.[c] ?? 0
      }
    }
    if (bits === 0) continue
    const cls = Math.floor(hash(col, 0, 2) * 4)
    const blink = 1 - (isDone ? 0.2 : 0.55) * wave(t + cls * 600, TWINKLE[cls] ?? 2200, 0.25)
    const tone = mix(grey, light, isDone ? 1 : q(Math.min(1, Math.pow(u, 0.9) * 1.1)))
    g.set(col, 0, 0x2800 + bits, pack(mix(fill, tone, q((0.35 + 0.65 * dense) * blink))), pack(fill))
  }

  const icon = spec.tone === 'running' ? '' : `${TONE_GLYPH[spec.tone]} `
  const name = fit(spec.label, Math.max(3, Math.floor(W * (W < 60 ? 0.7 : 0.5)) - icon.length - spec.count.length - 4))
  const shown = icon + name
  const gap = shown && spec.count ? 1 : 0
  const kw = [...shown].length + gap + spec.count.length + 2
  const kx = Math.round(Math.max(0, Math.min(W - kw, fx - kw / 2)))
  const white = pack([255, 255, 255])
  g.fill(0, kx, kx + kw, pack(acc))
  const at = kx + 1 + g.text(kx + 1, 0, shown, white, pack(acc))
  if (spec.count) g.text(at + gap, 0, spec.count, white, pack(acc))
  return g.encode()
}


// ---------- mascots: a little creature per agent, alive while it works ----------

type Species = {
  name: string
  color: string
  face: string // resting, eyes open
  busy: string // the working beat between resting ones
  blink: string
  happy: string
  sad: string
  think: string
  accent: string // floats beside it while it works, sits by it once done
}

// every face is five cells; each glyph is one column wide (see SAFE_GLYPHS)
const sp = (name: string, color: string, accent: string, [face, busy, blink, happy, sad, think]: string[]): Species => ({
  name, color, accent, face: face ?? '', busy: busy ?? '', blink: blink ?? '', happy: happy ?? '', sad: sad ?? '', think: think ?? '',
})
/** The main session's mascot. */
export const LEAD = sp('lead', '#FFB86C', '★', ['(◕ᴗ◕)', '(◕▽◕)', '(-ᴗ-)', '(≧▽≦)', '(×ᴗ×)', '(ˇᴗˇ)'])
export const SPECIES: readonly Species[] = [
  sp('cat', '#F2A65A', '♪', ['=•ω•=', '=°ω°=', '=-ω-=', '=ᵔωᵔ=', '=×ω×=', '=ˇωˇ=']),
  sp('bear', '#C99A6E', '♫', ['ʕ•ᴥ•ʔ', 'ʕ°ᴥ°ʔ', 'ʕ-ᴥ-ʔ', 'ʕᵔᴥᵔʔ', 'ʕ×ᴥ×ʔ', 'ʕˇᴥˇʔ']),
  sp('butterfly', '#F4A6C6', '✿', ['ʚ•ᴗ•ɞ', 'ʚ°ᴗ°ɞ', 'ʚ-ᴗ-ɞ', 'ʚᵔᴗᵔɞ', 'ʚ×ᴖ×ɞ', 'ʚˇᴗˇɞ']),
  sp('owl', '#B39DDB', '✦', ['{◉,◉}', '{⊙,⊙}', '{-,-}', '{ᵔ,ᵔ}', '{×,×}', '{ˇ,ˇ}']),
  sp('robot', '#7FC8F8', '✧', ['[•_•]', '[◕_◕]', '[-_-]', '[ᵔ‿ᵔ]', '[×_×]', '[ˇ_ˇ]']),
  sp('chick', '#FFD166', '♪', ['(•ө•)', '(°ө°)', '(-ө-)', '(ᵔөᵔ)', '(×ө×)', '(ˇөˇ)']),
  sp('puppy', '#E8C07D', '♥', ['U•ᴥ•U', 'U°ᴥ°U', 'U-ᴥ-U', 'UᵔᴥᵔU', 'U×ᴥ×U', 'UˇᴥˇU']),
  sp('spirit', '#9BE3C3', '✧', ['(◕‿◕)', '(◉‿◉)', '(-‿-)', '(≧‿≦)', '(×‿×)', '(ˇ‿ˇ)']),
]
export const speciesOf = (mascot: number | undefined) => (mascot === undefined ? LEAD : (SPECIES[mascot % SPECIES.length] ?? LEAD))

export const MASCOT_W = 9 // bounce (0-2) + face (5) + accent (1) + its drift (1)
const BOUNCE = [0, 1, 2, 1] // cells from the left, one step per beat
const BEAT_MS = 220

/** A mascot's text at time `t`: hopping, busy-faced and blinking with a drifting accent while running; a blinking
 * "?" while waiting; happy with its accent once done; x-eyed when it failed. Always MASCOT_W cells or fewer. */
export function mascotText(s: Species, tone: Tone, t: number): string {
  const beat = Math.floor(t / BEAT_MS)
  if (tone === 'running') {
    const face = beat % 17 === 0 ? s.blink : beat % 4 < 2 ? s.face : s.busy
    const at = BOUNCE[beat % BOUNCE.length] ?? 0
    const drift = beat % 6 < 3 ? 0 : 1
    return (' '.repeat(at) + face + ' '.repeat(drift) + s.accent).padEnd(MASCOT_W, ' ').slice(0, MASCOT_W)
  }
  if (tone === 'needs_input') return ` ${s.think}${beat % 4 < 2 ? '?' : ' '}`
  if (tone === 'done') return ` ${s.happy}${s.accent}`
  return ` ${s.sad}`
}

/** The mascot as one Raster row in its own colour (dimmed once it failed), over the panel's background. */
export function mascotCells(s: Species, tone: Tone, t: number, base: string): string {
  const g = new Grid(MASCOT_W, 1)
  const bg = pack(hex(base))
  const own = hex(s.color)
  const fg = pack(tone === 'error' ? mix(own, [128, 128, 128], 0.55) : own)
  g.fill(0, 0, MASCOT_W, bg)
  g.text(0, 0, mascotText(s, tone, t), fg, bg)
  return g.encode()
}
