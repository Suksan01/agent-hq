// The terminal's mascots for the design system, the same as hooks/sprites.ts draws them: the Bot Avatars shapes as 12×10
// pixel sprites, two pixels per cell with half blocks. The lead is the crowned star at 12×10; members are an 8×6 version
// of their own shape in the sidebar. Working bots hop and glance, waiting ones look up, done ones sleep, failed ones slump
// grey with x-eyes. Pure data and functions, no DOM and no imports.

export const SPRITE_W = 12
export const SPRITE_H = 10
export const SMALL_W = 8
export const SMALL_H = 6
export const FRAMES = 8 // a working bot's loop, one per beat

// the status glow hues (DESIGN.md tokens, the --st-* vars in web/space.css), for lines and tracks
export const STATUS_HUE = {
  working: '#3D7BFF',
  waiting: '#FFB547',
  done: '#3DF2B0',
  failed: '#FF5A5F',
  idle: '#8A8FA3',
  stopped: '#5A5D68',
  lead: '#B9A6FF',
}

// Palette letters: . clear, o outline, b body, l sheen, E eye, k visor, a accent (crown, antenna), s shadow, r failed eye,
// d sweat, z sleep mark
export const LETTERS = '.olbEkasrdz'

export const LEAD = {
  type: 'star',
  color: '#EFDB8E',
  hat: 'crown',
  art: ['...a.aa.a...', '...aaaaaa...', '...oooooo...', '..obbbbbbo..', '.obbbbbbbbo.', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '...ssssss...'],
  small: ['.a.aa.a.', '.aaaaaa.', 'obEbbEbo', 'obbbbbbo', '.oooooo.', '..ssss..'],
}

export const SPECIES = [
  { type: 'clover', color: '#41C4FF', art: ['............', '..ooo..ooo..', '.obbbooobbo.', '.obbbbbbbbo.', '..obEbbEbo..', '..obbbbbbo..', '.obbbbbbbbo.', '.obbo..obbo.', '..oo....oo..', '...ssssss...'], small: ['.oo..oo.', 'obboobbo', 'obEbbEbo', 'obbbbbbo', '.oo..oo.', '..ssss..'] },
  { type: 'cat', color: '#EAA06F', art: ['............', '..o......o..', '.obo....obo.', '.obboooobbo.', '.obbbbbbbbo.', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '...ssssss...'], small: ['o......o', 'oboooobo', 'obEbbEbo', 'obbbbbbo', '.oooooo.', '..ssss..'] },
  { type: 'flower', color: '#2FCB7A', art: ['............', '...oo..oo...', '..obboobbo..', '.obbbbbbbbo.', 'obbbEbbEbbbo', '.obbbbbbbbo.', '..obboobbo..', '...oo..oo...', '............', '...ssssss...'], small: ['.o.oo.o.', 'obobbobo', 'obEbbEbo', 'obbbbbbo', '.o.oo.o.', '..ssss..'] },
  { type: 'triangle', color: '#DC48FF', art: ['............', '.....oo.....', '....obbo....', '...obbbbo...', '..obEbbEbo..', '..obbbbbbo..', '.obbbbbbbbo.', '.oooooooooo.', '............', '...ssssss...'], small: ['...oo...', '..obbo..', '.oEbbEo.', 'obbbbbbo', 'oooooooo', '..ssss..'] },
  { type: 'drop', color: '#1ED3C6', art: ['............', '.....oo.....', '....obbo....', '...obbbbo...', '..obbbbbbo..', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '...ssssss...'], small: ['...oo...', '..obbo..', '.obbbbo.', 'obEbbEbo', '.obbbbo.', '..oooo..'] },
  { type: 'circle', color: '#9A62FF', art: ['............', '............', '....oooo....', '..oobbbboo..', '.obbbbbbbbo.', '.obbEbbEbbo.', '.obbbbbbbbo.', '..oobbbboo..', '....oooo....', '...ssssss...'], small: ['..oooo..', '.obbbbo.', 'obEbbEbo', 'obbbbbbo', '.obbbbo.', '..oooo..'] },
  { type: 'hexagon', color: '#EB7575', art: ['............', '...oooooo...', '..obbbbbbo..', '.obbbbbbbbo.', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '............', '...ssssss...'], small: ['.oooooo.', 'obbbbbbo', 'obEbbEbo', 'obbbbbbo', '.oooooo.', '..ssss..'] },
  { type: 'alien', color: '#9CD66A', art: ['.o........o.', '..o......o..', '...oooooo...', '..obbbbbbo..', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '....o..o....', '...ssssss...'], small: ['o......o', '.oooooo.', 'obEbbEbo', 'obbbbbbo', '.oooooo.', '..o..o..'] },
]

const ROUNDS = [
  ['#FFB020', '#5B8CFF', '#FF5FA2', '#14C8A0', '#B66DFF', '#FF7A45', '#2EC4FF', '#C6E04A'],
  ['#E8C547', '#7B61FF', '#FF8DC7', '#3DDC97', '#F25F5C', '#4ECDC4', '#9D8DF1', '#FFA62B'],
]
export const MASCOT_COUNT = SPECIES.length * (ROUNDS.length + 1)

export function speciesOf(mascot) {
  if (mascot === undefined) return LEAD
  const shape = SPECIES[mascot % SPECIES.length]
  const round = Math.floor(mascot / SPECIES.length) % (ROUNDS.length + 1)
  return round === 0 ? shape : { ...shape, color: ROUNDS[round - 1][mascot % SPECIES.length] }
}

/** The n-th member's mascot, and its colour for the nickname. */
export const mascotOf = index => ({ mascot: index, hue: [speciesOf(index).color, speciesOf(index).color] })

// ---------- poses ----------

// the design states as the terminal's tones
const TONE = { working: 'running', waiting: 'needs_input', idle: 'needs_input', done: 'done', failed: 'error', stopped: 'error' }
const POSES = {
  running: [{ eyes: 'open' }, { eyes: 'open', hop: true }, { eyes: 'right', hop: true }, { eyes: 'open' }, { eyes: 'left' }, { eyes: 'open', hop: true }, { eyes: 'blink', hop: true }, { eyes: 'open' }],
  needs_input: [{ eyes: 'up' }],
  done: [{ eyes: 'shut', z: 2 }],
  error: [{ eyes: 'x', sweat: true }],
}

function renderPose(s, pose, small) {
  const art = small ? s.small : s.art
  const width = small ? SMALL_W : SPRITE_W
  const height = small ? SMALL_H : SPRITE_H
  const grid = art.map(row => [...row])
  const at = (x, y) => grid[y]?.[x]
  const put = (x, y, ch) => {
    if (grid[y] && x >= 0 && x < width) grid[y][x] = ch
  }
  const top = grid.findIndex(row => row.includes('b'))
  if (top >= 0) {
    const x = grid[top + 1]?.indexOf('b') ?? -1
    if (x >= 0) put(x, top + 1, 'l')
  }
  const eyes = []
  grid.forEach((row, y) => row.forEach((ch, x) => ch === 'E' && eyes.push([x, y])))
  for (const [x, y] of eyes) {
    if (pose.eyes === 'open') continue
    put(x, y, 'b')
    if (pose.eyes === 'blink' || pose.eyes === 'shut') put(x, y, 'o')
    else if (pose.eyes === 'x') put(x, y, 'r')
    else {
      const [nx, ny] = pose.eyes === 'left' ? [x - 1, y] : pose.eyes === 'right' ? [x + 1, y] : [x, y - 1]
      const face = at(nx, ny) === 'b' || at(nx, ny) === 'k'
      put(face ? nx : x, face ? ny : y, 'E')
    }
  }
  if (pose.hop && grid[0].every(ch => ch === '.')) {
    const shadow = grid[height - 1]
    grid.splice(0, height, ...grid.slice(1, height - 1), [...'.'.repeat(width)], shadow.map((ch, x) => (ch === 's' && x > 3 && x < width - 4 ? 's' : '.')))
  }
  if (pose.z === 2) (put(width - 2, 1, 'z'), put(width - 1, 0, 'z'))
  if (pose.sweat) put(width - 2, 2, 'd')
  return grid.map(row => row.join(''))
}

/** One frame: `mascot` picks the member (none for the lead), `state` the design state, `small` the 8×6 member size. */
export function spriteFrame({ mascot, state = 'idle', lead = false, frame = 0, small = false } = {}) {
  const poses = POSES[TONE[state] ?? 'needs_input']
  return renderPose(lead ? LEAD : speciesOf(mascot), poses[frame % poses.length], small)
}

// ---------- colours ----------

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const toHex = c => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
export const mix = (a, b, m) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * m))
const grey = h => {
  const [r, g, b] = hex(h)
  const y = (0.3 * r + 0.59 * g + 0.11 * b) * 0.75
  return toHex([y, y, y])
}

/** The colours of a mascot's letters over the panel `base`; a failed or stopped bot is drawn in greys. */
export function spritePalette({ mascot, state = 'idle', lead = false, base = '#050507' } = {}) {
  const s = lead ? LEAD : speciesOf(mascot)
  const body = TONE[state] === 'error' ? grey(s.color) : s.color
  return {
    '.': base,
    o: mix(body, '#000000', 0.55),
    b: body,
    l: mix(body, '#ffffff', 0.55),
    E: '#17171f',
    k: '#1d2433',
    a: s.hat === 'crown' ? '#ffcf3f' : '#ff5d5d',
    s: mix(base, '#000000', 0.35),
    r: '#ff5d5d',
    d: '#7fc8f8',
    z: '#aab4ff',
  }
}
