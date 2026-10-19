// Design-system section: the terminal sidebar and the band above the prompt, redrawn in the space palette.
// Drawn the way the terminal draws them: a grid of one-column cells, each a character with its own fg and bg, mascots as
// 12×10 sprites two pixels per cell (▀), tracks as braille dots. Geometry follows hooks/view.tsx and hooks/cells.ts.
// No network, no eval; the only motion is the sprite and track beat, and none under prefers-reduced-motion.

import { FRAMES, SMALL_W, SPRITE_H, SPRITE_W, STATUS_HUE, mascotOf, mix, spriteFrame, spritePalette } from './terminal-sprites.js'

export * from './terminal-sprites.js' // the proposed pixel maps and palette, for porting into hooks/sprites.ts

// ---------- the palette on cells ----------

export const TERM_BG = '#0C0C11' // the person's own terminal behind the band (a typical dark one)
export const PANEL_BG = '#050507' // the sidebar: the space canvas, a shade deeper than the terminal
const TEXT = '#F2F2F5'
const text2 = bg => mix(TEXT, bg, 0.38) // rgba(242,242,245,.62) over bg
const text3 = bg => mix(TEXT, bg, 0.62) // rgba(242,242,245,.38) over bg
const INK = '#050507' // text on a bright pill

// hooks/view.tsx TONE_OF, named by the space status hues
const TONE = { pending: 'working', running: 'working', waiting: 'waiting', idle: 'waiting', completed: 'done', failed: 'failed', killed: 'failed' }
const TONE_GLYPH = { working: '●', waiting: '?', failed: '!', done: '✓' }
const BEAT_MS = 1000 // the mock steps once a second to keep the page light (the terminal itself beats every 220 ms)
const SPRITE_ROWS = SPRITE_H / 2
const MAX_COMPACT = 4
const PCT_W = 5
export const STATUS_GLYPH = '🪐' // replaces 🏝 in the status line; ✦ stays the lead's mark so the two never blur

// ---------- a cell grid ----------

const WIDE = new Set(['🪐'])
const width = s => [...s].reduce((n, ch) => n + (WIDE.has(ch) ? 2 : 1), 0)
export const fit = (s, w) => {
  const chars = [...s]
  if (chars.length <= w) return s
  return w <= 1 ? '…'.slice(0, Math.max(0, w)) : chars.slice(0, w - 1).join('').trimEnd() + '…'
}

class Grid {
  constructor(columns, bg) {
    this.columns = columns
    this.bg = bg
    this.rows = []
  }
  row() {
    this.rows.push(Array.from({ length: this.columns }, () => ({ ch: ' ', fg: TEXT, bg: this.bg })))
    return this.rows.length - 1
  }
  set(x, y, cell) {
    const line = this.rows[y]
    if (line && x >= 0 && x < this.columns) line[x] = { ch: ' ', fg: TEXT, bg: line[x].bg, ...cell }
  }
  /** Writes `s` from column x; returns the column after it. A wide glyph takes two cells, the second left empty. */
  text(x, y, s, fg, opts = {}) {
    let at = x
    for (const ch of s) {
      const bg = opts.bg ?? this.rows[y]?.[at]?.bg ?? this.bg
      this.set(at, y, { ch, fg, bg, bold: opts.bold, wide: WIDE.has(ch) })
      if (WIDE.has(ch)) this.set(++at, y, { ch: '', fg, bg, skip: true })
      at++
    }
    return at
  }
}

// ---------- tracks: a dim dotted rail, the done share glowing in the status hue, the count as a pill at its head ----------

const BRAILLE = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]
const hash = (a, b, k) => {
  const v = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453
  return v - Math.floor(v)
}
const wave = (t, period, offset = 0) => 0.5 + 0.5 * Math.sin((t / period + offset) * Math.PI * 2)
const dots = (col, density) => {
  let bits = 0
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) if (hash(col * 2 + c, r, 1) <= density) bits |= BRAILLE[r][c]
  return bits ? String.fromCodePoint(0x2800 + bits) : ' '
}

/** One track row: `share` 0..1 of `W` cells; `sweep` when no share is known (a glow drifting along, the pill at the left). */
export function drawTrack(g, x0, y, W, { share = 0, tone = 'working', label = '', count = '', sweep = false }, t, base) {
  const hue = STATUS_HUE[tone]
  const fx = (tone === 'done' ? 1 : Math.min(1, share)) * W
  const rail = mix(base, '#FFFFFF', 0.2)
  for (let x = 0; x < W; x++) g.set(x0 + x, y, { ch: '⠒', fg: rail, bg: base }) // the dotted rail of 8.png
  if (sweep) {
    const head = ((t / 2400) % 1) * (W + 12) - 6
    for (let x = 0; x < W; x++) {
      const near = Math.max(0, 1 - Math.abs(x - head) / 6)
      if (near > 0) g.set(x0 + x, y, { ch: dots(x, 0.1 + 0.5 * near), fg: mix(rail, mix(hue, '#FFFFFF', 0.4), near), bg: mix(base, hue, 0.22 * near) })
    }
  }
  for (let x = 0; x < Math.ceil(fx); x++) {
    const u = (x + 0.5) / Math.max(1, fx) // brighter towards the head, a glow pushed along
    const blink = 1 - 0.45 * wave(t + Math.floor(hash(x, 0, 2) * 4) * 600, 2400, 0.25)
    const fill = mix(base, hue, 0.2 + 0.36 * u)
    g.set(x0 + x, y, { ch: dots(x, 0.25 + 0.4 * u), fg: mix(fill, mix(hue, '#FFFFFF', 0.55), (0.5 + 0.5 * u) * blink), bg: fill })
  }
  const icon = tone === 'working' ? '' : `${TONE_GLYPH[tone]} `
  const name = label ? fit(label, Math.max(3, Math.floor(W * (W < 60 ? 0.7 : 0.5)) - icon.length - count.length - 4)) : ''
  const shown = icon + name
  const pill = ` ${shown}${shown && count ? ' ' : ''}${count} `
  if (pill.trim() === '') return
  const kw = [...pill].length
  const kx = Math.round(Math.max(0, Math.min(W - kw, (sweep ? 0 : fx) - kw / 2)))
  g.text(x0 + kx, y, pill, INK, { bg: hue, bold: true })
}

const pct = p => (p.total === 0 ? 0 : p.done === p.total ? 100 : Math.min(99, Math.round((p.done / p.total) * 100)))
const pctText = p => `${String(pct(p)).padStart(3, ' ')}%`

// ---------- the sample team (BOOKING APP TEAM · app) ----------

const LEAD = { id: 'main', nickname: 'Sirius Prime', name: 'Tech Lead', status: 'running', tools: 41, now: 'Reviewing PR #42', secs: '8s', task: 'Plan the booking flow', next: 'Merge auth branch', todos: { done: 2, total: 5 } }
const MEMBERS = [
  { nickname: 'Kepler-7b', name: 'frontend-dev-1', role: 'Frontend Developer', status: 'running', time: '12m', now: 'Editing view.tsx', secs: '12s', task: 'Calendar picker', next: 'Write the picker tests', todos: { done: 3, total: 5 } },
  { nickname: 'Vega Prime', name: 'backend-dev-1', role: 'Backend Developer', status: 'running', time: '9m', now: 'Running npm test', secs: '4s', task: 'Booking API', next: 'Seed the rooms table', todos: { done: 1, total: 4 } },
  { nickname: 'Nyx', name: 'docs-1', role: 'Tech Writer', status: 'running', time: '1m', now: 'Reading README.md', secs: '2s', task: 'API reference', last: 'Outline the guide', tools: 3 },
  { nickname: 'Orion Drift', name: 'qa-1', role: 'QA Engineer', status: 'waiting', time: '6m' },
  { nickname: 'Zephyr-9', name: 'release-1', role: 'Release Manager', status: 'completed', time: '4m', last: 'Ship release' },
  { nickname: 'Lumen', name: 'designer-1', role: 'Designer', status: 'idle', time: '2m' },
  { nickname: 'Astra Nova', name: 'devops-1', role: 'DevOps', status: 'failed', time: '3m', last: 'Lint config' },
  { nickname: 'Tycho', name: 'reviewer-1', role: 'Reviewer', status: 'completed', time: '7m', last: 'Review #40' },
  { nickname: 'Calyx-4', name: 'reviewer-2', role: 'Reviewer', status: 'completed', time: '5m', last: 'Review #41' },
].map((m, i) => ({ ...m, ...mascotOf(i) }))
const TASKS = { done: 2, total: 5 }
const ASKS = 1 // the inbox: one ask waits on the person
const TASK_LIST = [
  { id: 3, status: 'in_progress', text: 'Building the calendar picker', owner: 'frontend-dev-1' },
  { id: 4, status: 'pending', text: 'Booking API', owner: 'backend-dev-1', waits: [3] },
  { id: 5, status: 'pending', text: 'API reference', owner: 'docs-1' },
  { id: 1, status: 'completed', text: 'Scaffold the app' },
  { id: 2, status: 'completed', text: 'Auth' },
]
const TASK_GLYPH = { in_progress: '◐', pending: '○', completed: '✓' }
const TASK_TONE = { in_progress: 'working', pending: 'working', completed: 'done' }

const isCompact = m => TONE[m.status] !== 'working'
const working = () => MEMBERS.filter(m => TONE[m.status] === 'working')

// ---------- the sidebar ----------

const textWidth = (cols, prefix, spriteW) => Math.max(14, cols - [...prefix].length - spriteW - 1)

/** hooks/view.tsx nameAndRole: the role gives way first, then the real name. */
function tailOf(m, room) {
  const left = room - width(m.nickname)
  const roleRoom = left - 1 - width(m.name) - 1
  if (roleRoom >= width(m.role)) return ` ${m.name} ${m.role}`
  if (roleRoom >= 4) return ` ${m.name} ${fit(m.role, roleRoom)}`
  if (left - 1 >= width(m.name)) return ` ${m.name}`
  return left - 1 >= 6 ? ` ${fit(m.name, left - 1)}` : ''
}

function drawSprite(g, x0, y0, rows, palette) {
  for (let r = 0; r < rows.length / 2; r++) {
    for (let x = 0; x < rows[0].length; x++) g.set(x0 + x, y0 + r, { ch: '▀', fg: palette[rows[r * 2][x]], bg: palette[rows[r * 2 + 1][x]], half: true })
  }
}

const LEAD_LOOK = { hue: ['#EFDB8E', '#EFDB8E'] } // the crowned star's gold, as hooks/sprites.ts LEAD

/** A full row: the bot, then five lines beside it (title, live line, task, next, track), the tree's lines down its left. */
function agentRow(g, x0, cols, a, prefix, indent, t, frame) {
  const bg = g.bg
  const isLead = a.id === 'main'
  const state = isLead ? 'working' : TONE[a.status]
  const y = g.row()
  for (let i = 1; i < SPRITE_ROWS; i++) g.row()
  for (let i = 0; i < SPRITE_ROWS; i++) g.text(x0, y + i, i === 0 ? prefix : indent, text3(bg))
  const sx = x0 + [...prefix].length
  const look = isLead ? LEAD_LOOK : a
  // the lead keeps its 12×10 crowned star; members are 8×6, three rows tall, so their text gains four columns
  const spriteW = isLead ? SPRITE_W : SMALL_W
  drawSprite(g, sx, y, spriteFrame({ mascot: look.mascot, state, lead: isLead, frame, small: !isLead }), spritePalette({ mascot: look.mascot, state, lead: isLead, base: bg }))
  const tx = sx + spriteW + 1
  const tw = textWidth(cols, prefix, spriteW)
  const time = isLead ? `${a.tools} tools` : a.time
  g.text(x0 + cols - time.length, y, time, text3(bg))
  const hue = look.hue[0]
  let at = tx
  if (isLead) at = g.text(at, y, '✦ ', STATUS_HUE.lead)
  const room = tw - time.length - 1 - (at - tx)
  at = g.text(at, y, fit(a.nickname, room), hue, { bold: true })
  const tail = isLead ? ` · ${a.name}` : tailOf(a, room)
  g.text(at, y, fit(tail, Math.max(0, room - width(a.nickname))), text3(bg))
  // the live line: the cursor blinks ▸/▹ each second; the words are cut, never the seconds
  const cursor = Math.floor(t / 1000) % 2 ? '▹' : '▸'
  const secs = ` · ${a.secs}`
  g.text(tx, y + 1, `${cursor} ${fit(a.now, tw - 2 - secs.length)}${secs}`, STATUS_HUE[state], { bold: true })
  // the lead's third line counts who is at work before its task
  const count = isLead ? `${working().length} of ${MEMBERS.length} working` : ''
  const taskRoom = tw - (count ? count.length + 3 : 0) - 6
  if (count && taskRoom < 6) g.text(tx, y + 2, fit(count, tw), text3(bg)) // too narrow for the task: the count alone
  else g.text(g.text(tx, y + 2, `${count ? `${count} · ` : ''}task: `, text3(bg)), y + 2, fit(a.task, taskRoom), text2(bg))
  g.text(tx, y + 3, fit(a.next ? `○ next: ${a.next}` : `✓ last: ${a.last}`, tw), text3(bg))
  if (a.todos) {
    const W = Math.max(6, tw - PCT_W - 1)
    drawTrack(g, tx, y + 4, W, { share: a.todos.done / a.todos.total, tone: 'working', count: `${a.todos.done}/${a.todos.total}` }, t, bg)
    g.text(tx + W + 1, y + 4, pctText(a.todos), text3(bg))
  } else {
    drawTrack(g, tx, y + 4, tw, { tone: 'working', label: `getting started · ${a.tools} tools`, sweep: true }, t, bg)
  }
}

const STATUS_WORD = { waiting: 'needs approval', idle: 'idle', completed: 'done', failed: 'failed', killed: 'stopped' }

/** A one-line row for an agent not at work: its hue as a dot, nickname, words, its status or last item, time at the right. */
function compactRow(g, x0, cols, m, prefix) {
  const bg = g.bg
  const y = g.row()
  const tone = TONE[m.status]
  const head = !m.last ? undefined : m.status === 'completed' ? '✓ ' : m.status === 'failed' ? '! ' : undefined
  const status = head ?? STATUS_WORD[m.status]
  const fixed = [...prefix].length + 2 + width(m.nickname) + 1 + status.length + 1 + m.time.length
  const lastRoom = m.last && head ? Math.min(width(m.last), 12) : 0
  const tail = tailOf(m, cols - fixed - lastRoom + width(m.nickname))
  let at = g.text(x0, y, prefix, text3(bg))
  at = g.text(at, y, '● ', m.hue[0])
  at = g.text(at, y, m.nickname, m.hue[0], { bold: true })
  at = g.text(at, y, tail, text3(bg))
  // the status stops short of the time, like the real row's truncating box
  at = g.text(at, y, fit(` ${status}`, Math.max(0, x0 + cols - m.time.length - 1 - at)), STATUS_HUE[tone])
  if (head) g.text(at, y, fit(m.last, Math.max(0, x0 + cols - m.time.length - 1 - at)), text2(bg))
  g.text(x0 + cols - m.time.length, y, m.time, text3(bg))
}

function section(g, x0, cols, title, aside) {
  g.row()
  const y = g.row()
  const label = ` ${title} ${aside ? `· ${aside} ` : ''}`
  const at = g.text(x0, y, label, TEXT, { bold: true })
  g.text(at, y, '─'.repeat(Math.max(0, cols - label.length)), text3(g.bg))
}

/** "BOOKING APP TEAM · app": the folder gives way before the team name does. */
function teamHeading(room) {
  const full = 'BOOKING APP TEAM · app'
  return width(full) <= room ? full : fit('BOOKING APP TEAM', room)
}

export function sidebarGrid(total, t) {
  const g = new Grid(total, PANEL_BG)
  const x0 = 1 // paddingX 1
  const cols = total - 2
  const frame = Math.floor(t / BEAT_MS) % FRAMES
  // header: the mark and the four counts
  g.row()
  let y = g.row()
  g.text(x0, y, '✦ ', STATUS_HUE.lead)
  g.text(x0 + 2, y, 'AGENT HQ', TEXT, { bold: true })
  const count = tone => MEMBERS.filter(m => TONE[m.status] === tone).length
  const counts = [['working', '●'], ['waiting', '?'], ['done', '✓'], ['failed', '!']].map(([tone, glyph]) => [`${glyph}${count(tone)}`, STATUS_HUE[tone]])
  let cx = x0 + cols - counts.reduce((n, [s]) => n + s.length + 1, -1)
  for (const [s, color] of counts) cx = g.text(cx, y, s, color) + 1
  const agents = `${MEMBERS.length} agents`
  section(g, x0, cols, teamHeading(cols - agents.length - 6), agents)
  agentRow(g, x0, cols, LEAD, '', '', t, frame)
  // the tree: working agents in full, up to four one-liners, the rest folded
  const compact = MEMBERS.filter(isCompact)
  const shown = [...working(), ...compact.slice(0, MAX_COMPACT)]
  const folded = compact.length - MAX_COMPACT
  shown.forEach((m, i) => {
    const isLast = i === shown.length - 1 && folded <= 0
    const prefix = isLast ? '└─ ' : '├─ '
    if (isCompact(m)) compactRow(g, x0, cols, m, prefix)
    else agentRow(g, x0, cols, m, prefix, isLast ? '   ' : '│  ', t, frame)
  })
  if (folded > 0) g.text(x0, g.row(), `└─ +${folded} more idle/done`, text3(g.bg))
  // the task board
  section(g, x0, cols, 'TASK BOARD', `${TASKS.done}/${TASKS.total}`)
  for (const task of TASK_LIST.filter(x => x.status !== 'completed')) {
    y = g.row()
    let at = g.text(x0, y, `${TASK_GLYPH[task.status]} `, STATUS_HUE[TASK_TONE[task.status]])
    at = g.text(at, y, `#${task.id} `, text3(g.bg))
    g.text(at, y, fit(task.text, x0 + cols - at), TEXT)
    const waits = task.waits ? ` · ⛓ waits on ${task.waits.map(n => `#${n}`).join(' ')}` : ''
    g.text(x0, g.row(), fit(`   @${task.owner}${waits}`, cols), text3(g.bg))
  }
  g.text(x0, g.row(), `✓ ${TASK_LIST.filter(x => x.status === 'completed').length} completed (hidden)`, text3(g.bg))
  g.row()
  y = g.row()
  let bx = x0
  for (const label of [' h  Hide done ', ' c  Clear done ']) bx = g.text(bx, y, label, TEXT, { bg: mix(PANEL_BG, '#FFFFFF', 0.1) }) + 1
  g.row()
  return g
}

// ---------- the band above the prompt, the prompt, the status line ----------

const BAND_TITLE_W = 6
const bandTrackWidth = cols => Math.max(12, Math.min(512, cols - BAND_TITLE_W - 10 - 13))

export function bandGrid(cols, t) {
  const g = new Grid(cols, TERM_BG)
  const bg = TERM_BG
  g.row()
  g.text(0, g.row(), fit('BOOKING APP TEAM · app', cols), text3(bg))
  // the live line, right under the heading: what each working agent is doing now; only the ▸ takes the running tone
  // up to three agents, newest first (the shortest running time)
  const live = [...working()].sort((x, y) => parseInt(x.time) - parseInt(y.time)).slice(0, 3).map(m => `${m.nickname}: ${m.now}`).join(' · ')
  g.text(g.text(0, g.row(), '▸ ', STATUS_HUE.working), g.rows.length - 1, fit(live, cols - 2), TEXT)
  const W = bandTrackWidth(cols)
  // waiting wins the team's tone while anyone waits on the person (hooks/view.tsx toneOf)
  const teamTone = MEMBERS.some(m => TONE[m.status] === 'waiting') ? 'waiting' : 'working'
  const rows = [
    ['Team', teamTone, TASKS, `${working().length} running`, true],
    ['Tasks', 'working', TASKS, 'Building the calendar picker', false],
  ]
  for (const [title, tone, p, label, isFirst] of rows) {
    const y = g.row()
    g.text(0, y, TONE_GLYPH[tone], STATUS_HUE[tone])
    g.text(2, y, title.padEnd(BAND_TITLE_W), TEXT)
    drawTrack(g, 2 + BAND_TITLE_W + 1, y, W, { share: p.done / p.total, tone, label, count: `${p.done}/${p.total}` }, t, bg)
    const at = g.text(2 + BAND_TITLE_W + 1 + W + 1, y, pctText(p), text3(bg))
    if (isFirst) g.text(g.text(at + 1, y, 'Agents ›', text3(bg)) + 1, y, '✕', text3(bg))
  }
  // the prompt between its rules, and the status line under it
  g.text(0, g.row(), '─'.repeat(cols), text3(bg))
  const py = g.row()
  g.text(0, py, '> ', TEXT)
  g.set(2, py, { ch: ' ', bg: TEXT })
  g.text(0, g.row(), '─'.repeat(cols), text3(bg))
  const status = `${STATUS_GLYPH} ${working().length} working · ${ASKS} needs you · ${TASKS.done}/${TASKS.total} tasks`
  g.text(2, g.row(), fit(status, cols - 2), text2(bg))
  g.row()
  return g
}

const SHEET_STATES = ['working', 'waiting', 'done', 'failed', 'idle', 'stopped']

/** The sprite sheet: four creatures in every state, then the lead (working, done), over the panel. */
export function sheetGrid(t) {
  const looks = [0, 1, 2, 3].map(mascotOf).concat([{ ...LEAD_LOOK, lead: true }])
  const g = new Grid(SHEET_STATES.length * (SPRITE_W + 2) + 1, PANEL_BG)
  const frame = Math.floor(t / BEAT_MS) % FRAMES
  for (const look of looks) {
    const y = g.row()
    for (let i = 1; i < SPRITE_ROWS; i++) g.row()
    SHEET_STATES.forEach((state, i) => {
      if (look.lead && state !== 'working' && state !== 'done') return // the lead is busy while any member is, else done
      drawSprite(g, 1 + i * (SPRITE_W + 2), y, spriteFrame({ mascot: look.mascot, state, lead: look.lead, frame }), spritePalette({ mascot: look.mascot, state, lead: look.lead, base: PANEL_BG }))
    })
    g.row()
  }
  // the members as the sidebar draws them: 8×6, three rows tall
  for (const look of looks.filter(l => !l.lead)) {
    const y = g.row()
    g.row()
    g.row()
    SHEET_STATES.forEach((state, i) => drawSprite(g, 1 + i * (SPRITE_W + 2) + 2, y, spriteFrame({ mascot: look.mascot, state, frame, small: true }), spritePalette({ mascot: look.mascot, state, base: PANEL_BG })))
    g.row()
  }
  return g
}

// ---------- drawing grids into the page ----------

const STYLE = `
.tm { display: grid; gap: 28px; color: var(--sk-text, #f2f2f5); min-width: 0; }
.tm-note { margin: 0; max-width: 680px; font: 400 14px/1.55 var(--sk-font-title, 'Space Grotesk', sans-serif); color: var(--sk-text-2, rgba(242,242,245,.62)); }
.tm-note code { font: 400 12.5px var(--sk-font-mono, monospace); color: var(--sk-text, #f2f2f5); }
.tm-row { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; min-width: 0; }
.tm-fig { margin: 0; display: grid; gap: 10px; min-width: 0; max-width: 100%; justify-self: start; }
.tm-cap { font: 400 10.5px var(--sk-font-mono, monospace); letter-spacing: .06em; text-transform: uppercase; color: var(--sk-text-3, rgba(242,242,245,.38)); }
.tm-win { max-width: 100%; overflow-x: auto; border-radius: 18px; padding: 10px 0; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08), 0 24px 60px -30px rgba(61,123,255,.35); }
.tm-screen { display: block; margin: 0 10px; }
.tm-text { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: pre; }
.tm-sw { display: flex; flex-wrap: wrap; gap: 8px 14px; font: 400 11px var(--sk-font-mono, monospace); color: var(--sk-text-2, rgba(242,242,245,.62)); }
.tm-sw span { display: inline-flex; align-items: center; gap: 6px; }
.tm-sw i { width: 14px; height: 14px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
`

// one canvas per screen, not thousands of spans: the page's style and layout never see the cells
const CELL = { cw: 7.5, ch: 16, font: 12.5 }
const BIG = { cw: 12, ch: 24, font: 20 }
const SMALL_BIG = { cw: 8, ch: 16, font: 13 } // the sprite sheet on a phone
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace"

/** Draws a grid onto `canvas`: each cell's background, then its glyph; a half block is its two pixels as two rectangles. */
function paint(canvas, g, size) {
  const { cw, ch, font } = size
  const scale = Math.min(2, globalThis.devicePixelRatio || 1)
  const w = Math.ceil(g.columns * cw)
  const h = g.rows.length * ch
  if (canvas.width !== Math.round(w * scale) || canvas.height !== Math.round(h * scale)) {
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
  }
  const c = canvas.getContext('2d')
  c.setTransform(scale, 0, 0, scale, 0, 0)
  c.textBaseline = 'middle'
  c.textAlign = 'center'
  g.rows.forEach((row, y) => {
    const top = y * ch
    row.forEach((cell, x) => {
      const left = x * cw
      if (cell.skip) return
      const span = cell.wide ? cw * 2 : cw
      if (cell.half) {
        c.fillStyle = cell.fg
        c.fillRect(left, top, cw + 0.5, ch / 2 + 0.5)
        c.fillStyle = cell.bg
        c.fillRect(left, top + ch / 2, cw + 0.5, ch / 2 + 0.5)
        return
      }
      c.fillStyle = cell.bg
      c.fillRect(left, top, span + 0.5, ch + 0.5)
      if (cell.ch && cell.ch !== ' ') {
        c.font = `${cell.bold ? 700 : 400} ${font}px ${MONO}`
        c.fillStyle = cell.fg
        c.fillText(cell.ch, left + span / 2, top + ch / 2 + 0.5)
      }
    })
  })
}

/** The screen's words for assistive tech and find-in-page: its text, row by row (half blocks left out). */
const textOf = g => g.rows.map(row => row.map(c => (c.half || c.skip ? ' ' : c.ch)).join('').trimEnd()).join('\n')

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function figure(caption, label) {
  const fig = el('figure', 'tm-fig')
  const win = el('div', 'tm-win')
  const screen = el('canvas', 'tm-screen')
  screen.setAttribute('role', 'img')
  screen.setAttribute('aria-label', label)
  const text = el('pre', 'tm-text')
  win.append(screen, text)
  fig.append(el('figcaption', 'tm-cap', caption), win)
  return { fig, screen, text }
}

/** A note: static copy written here, `code` spans marked with backticks. */
function note(copy) {
  const p = el('p', 'tm-note')
  copy.split('`').forEach((part, i) => p.append(i % 2 ? el('code', '', part) : part))
  return p
}

function swatches() {
  const box = el('div', 'tm-sw')
  const items = [['panel', PANEL_BG], ['terminal', TERM_BG], ['text', TEXT], ['text 2', text2(PANEL_BG)], ['text 3', text3(PANEL_BG)], ...Object.entries(STATUS_HUE)]
  for (const [name, color] of items) {
    const s = el('span')
    const i = el('i')
    i.style.background = color
    s.append(i, `${name} ${color}`)
    box.append(s)
  }
  return box
}

/** Mounts the section into `host`: the sidebar at 46 and 32 columns, the band at 72 and 46, the sprite sheet, the palette. */
export function mount(host) {
  if (!document.getElementById('tm-style')) {
    const style = el('style', '', STYLE)
    style.id = 'tm-style'
    document.head.append(style)
  }
  const root = el('div', 'tm')
  const side = el('div', 'tm-row')
  const band = el('div', 'tm-row')
  const views = [
    [side, 'Sidebar · 46 columns', 'Agent HQ terminal sidebar mock, 46 columns wide', t => sidebarGrid(46, t)],
    [side, 'Sidebar · 32 columns', 'Agent HQ terminal sidebar mock, 32 columns wide', t => sidebarGrid(32, t)],
    [band, 'Band, prompt and status line · 72 columns', 'Band above the prompt: team and task tracks, live line, prompt and status line, 72 columns', t => bandGrid(72, t)],
    [band, 'Band · 46 columns', 'The same band at 46 columns', t => bandGrid(46, t)],
  ].map(([parent, caption, label, draw]) => {
    const { fig, screen, text } = figure(caption, label)
    parent.append(fig)
    return { screen, text, draw, size: CELL }
  })
  const sheet = figure('Sprites · working, needs you, done, failed, idle, stopped · lead: working, done · members at 8×6 below', 'Glow blob sprite sheet: four creatures in six states, and the lead')
  views.push({ screen: sheet.screen, text: sheet.text, draw: sheetGrid, size: matchMedia('(max-width: 640px)').matches ? SMALL_BIG : BIG })
  root.append(
    note('Drawn as the terminal draws it: one-column cells, each a glyph with its own colour and background. Mascots are `12×10` sprites, two pixels per cell with `▀` (5 rows); tracks are braille dots on a dotted rail. Working agents get the full five-line row, everyone else one line; past four the rest fold into `+N more`.'),
    side,
    note(`The band sits on the person's own terminal background. Its live line, right under the heading, says what each working agent is doing right now. The status line opens with \`${STATUS_GLYPH}\`, a wide emoji like the 🏝 it replaces, so the line's width math holds; \`✦\` stays the lead's mark.`),
    band,
    sheet.fig,
    note('The Bot Avatars shapes as pixel sprites, as `hooks/sprites.ts` draws them: the lead is the crowned star at `12×10`; members are an `8×6` version of their own shape (clover, cat, flower, triangle, drop, circle, hexagon, alien), each in three rounds of colours for 24. Working bots hop, glance and blink; waiting ones look up; done ones sleep with drifting z’s; failed ones slump grey with red x-eyes and a bead of sweat. Only working bots move.'),
    swatches(),
  )
  host.append(root)

  const draw = t => views.forEach(v => paint(v.screen, v.draw(t), v.size))
  draw(0)
  for (const v of views) v.text.textContent = textOf(v.draw(0))
  document.fonts?.load(`${CELL.font}px ${MONO}`).then(() => draw(0), () => {}) // redraw once the mono face is in

  // the beat runs only while the section is on screen, the tab is visible and motion is welcome; otherwise no timer at all
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let visible = !('IntersectionObserver' in window)
  let timer = null
  const sync = () => {
    const run = visible && !document.hidden && !reduced.matches
    if (run && !timer) timer = setInterval(() => draw(performance.now()), BEAT_MS)
    if (!run && timer) timer = (clearInterval(timer), null)
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => ((visible = e.isIntersecting), sync())) : null
  io?.observe(root)
  document.addEventListener('visibilitychange', sync)
  reduced.addEventListener?.('change', sync)
  sync()
  return {
    dispose() {
      clearInterval(timer)
      io?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      reduced.removeEventListener?.('change', sync)
      root.remove()
    },
  }
}

export default mount
