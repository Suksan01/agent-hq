// Design-system section: the five event sounds retuned as soft, spacey tones, then the four navigation swooshes. Each is synthesised in the page by
// web/space-sounds.js and played through Web Audio, so what is heard here is
// sample for sample what scripts/make-space-sounds.mjs writes as the terminal's WAV clips. No files, no network.

import { NAV_ABOUT, NAV_KINDS, SOUND_NAMES, SPACE_SOUNDS, playNav, renderNav, renderSound } from '../../space-sounds.js'

// each sound's card glows in the status it belongs to
const CARDS = {
  start: { title: 'Start', hue: 'var(--st-working, #3D7BFF)', when: 'an agent starts' },
  done: { title: 'Done', hue: 'var(--st-done, #3DF2B0)', when: 'an agent finishes' },
  needs_you: { title: 'Needs you', hue: 'var(--st-waiting, #FFB547)', when: 'an agent waits on the person' },
  failed: { title: 'Failed', hue: 'var(--st-failed, #FF5A5F)', when: 'an agent fails' },
  levelup: { title: 'Level up', hue: 'var(--st-lead, #B9A6FF)', when: 'an agent gains a level' },
}
// the navigation swooshes: no status of their own, so the lead's violet and the working blue
const NAV_CARDS = {
  travel: { title: 'Travel', hue: 'var(--st-working, #3D7BFF)', when: 'a team chip flies the view to that team', opts: { duration: 650, distance: 0.5 } },
  fit: { title: 'Fit', hue: 'var(--st-lead, #B9A6FF)', when: 'Fit or All frames everything' },
  view: { title: 'View', hue: 'var(--st-lead, #B9A6FF)', when: 'Diagram ↔ Space' },
  select: { title: 'Select', hue: 'var(--st-idle, #8A8FA3)', when: 'a card is chosen' },
}
const PREVIEW_RATE = 8000 // enough to draw the shape; playback renders at the context's own rate
const BARS = 64

const STYLE = `
.snd { display: grid; gap: 22px; min-width: 0; }
.snd-note { margin: 0; max-width: 680px; font: 400 14px/1.55 var(--sk-font-title, 'Space Grotesk', sans-serif); color: var(--sk-text-2, rgba(242,242,245,.62)); }
.snd-note code { font: 400 12.5px var(--sk-font-mono, monospace); color: var(--sk-text, #f2f2f5); }
.snd-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 16px; }
.snd-card { position: relative; display: grid; gap: 12px; padding: 20px; border-radius: 28px; overflow: hidden; color: var(--sk-text, #f2f2f5);
  background: radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--hue) 34%, transparent), transparent 62%), #0a0a10;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 0 0 1px rgba(255,255,255,.06), 0 24px 50px -32px var(--hue);
  transition: box-shadow .6s var(--sk-ease, ease); }
.snd-card.is-playing { box-shadow: inset 0 1px 0 rgba(255,255,255,.2), inset 0 0 0 1px color-mix(in srgb, var(--hue) 45%, transparent), 0 24px 70px -22px var(--hue); }
.snd-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.snd-title { margin: 0; font: 500 18px/1.2 var(--sk-font-title, 'Space Grotesk', sans-serif); }
.snd-label { font: 400 10.5px var(--sk-font-mono, monospace); letter-spacing: .06em; text-transform: uppercase; color: var(--sk-text-3, rgba(242,242,245,.38)); }
.snd-about { margin: 0; font: 400 13.5px/1.5 var(--sk-font-title, 'Space Grotesk', sans-serif); color: var(--sk-text-2, rgba(242,242,245,.62)); }
.snd-play { flex: none; width: 44px; height: 44px; border: 0; border-radius: 999px; display: grid; place-items: center; cursor: pointer; color: #050507;
  background: var(--hue); box-shadow: 0 0 24px -4px var(--hue); transition: transform .2s var(--sk-ease, ease); }
.snd-play:hover { transform: scale(1.06); }
.snd-play:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
.snd-play svg { width: 16px; height: 16px; margin-left: 2px; }
.snd-wave { display: block; width: 100%; height: 36px; }
.snd-meta { display: flex; justify-content: space-between; font: 400 10.5px var(--sk-font-mono, monospace); letter-spacing: .06em; text-transform: uppercase; color: var(--sk-text-3, rgba(242,242,245,.38)); gap: 12px; }
.snd-meta span:first-child { flex: none; white-space: nowrap; }
.snd-pads { display: flex; flex-wrap: wrap; gap: 16px; }
.snd-pad { display: grid; gap: 14px; padding: 18px 20px; border-radius: 26px; background: #0a0a10; box-shadow: inset 0 1px 0 rgba(255,255,255,.12), inset 0 0 0 1px rgba(255,255,255,.06); }
.snd-pad__head { display: grid; gap: 4px; }
.snd-pad__keys { display: grid; grid-template-columns: repeat(3, 48px); grid-template-areas: 'out up in' 'left down right'; gap: 8px; }
.snd-key--up { grid-area: up; } .snd-key--down { grid-area: down; } .snd-key--left { grid-area: left; } .snd-key--right { grid-area: right; } .snd-key--in { grid-area: in; } .snd-key--out { grid-area: out; }
.snd-key { width: 48px; height: 48px; border: 0; border-radius: 16px; cursor: pointer; font: 500 20px var(--sk-font-mono, monospace); color: var(--sk-text, #f2f2f5); background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,.1); }
.snd-key:hover { background: rgba(255,255,255,.12); }
.snd-key:active { transform: scale(.94); }
.snd-key:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.snd-key--in, .snd-key--out { color: var(--st-lead, #B9A6FF); }
@media (prefers-reduced-motion: reduce) { .snd-card, .snd-play { transition: none; } .snd-play:hover { transform: none; } }
`

const PLAY_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>'

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

/** The clip's loudness in BARS buckets, 0..1, for the little bar graph. */
function envelope(samples) {
  const size = Math.ceil(samples.length / BARS)
  const peaks = Array.from({ length: BARS }, (_, b) => samples.subarray(b * size, (b + 1) * size).reduce((m, v) => Math.max(m, Math.abs(v)), 0))
  const top = Math.max(...peaks) || 1
  return peaks.map(p => p / top)
}

/** Lights a card while its sound plays: its glow, and its bars filling along with it unless motion is reduced. */
function light(card, wave, seconds, reduced) {
  card.classList.add('is-playing')
  const began = performance.now()
  const span = seconds * 1000
  const step = () => {
    const done = performance.now() - began >= span
    if (!reduced) wave.draw(done ? 0 : Math.ceil(((performance.now() - began) / span) * BARS))
    if (!done) return requestAnimationFrame(step)
    card.classList.remove('is-playing')
  }
  requestAnimationFrame(step)
}

const WAVE_W = 256 // the bar graph's drawing width; CSS stretches it to the card
const WAVE_H = 36
/** The clip's shape as one small canvas of bars (not 64 elements); `draw(lit)` brightens the first `lit` bars. */
function waveCanvas(levels, color) {
  const canvas = el('canvas', 'snd-wave')
  canvas.setAttribute('aria-hidden', 'true')
  canvas.width = WAVE_W * 2
  canvas.height = WAVE_H * 2
  const c = canvas.getContext('2d')
  const slot = canvas.width / levels.length
  canvas.draw = (lit = 0) => {
    c.clearRect(0, 0, canvas.width, canvas.height)
    levels.forEach((level, i) => {
      const h = Math.max(0.06, level) * canvas.height
      c.globalAlpha = i < lit ? 1 : 0.35
      c.fillStyle = color
      c.fillRect(i * slot, (canvas.height - h) / 2, Math.max(1, slot - 3), h)
    })
  }
  canvas.draw()
  return canvas
}
const fallbackOf = hue => /#[0-9a-f]{6}/i.exec(hue)?.[0] ?? '#8A8FA3' // the hex inside var(--st-x, #hex)

/** One glowing card: title, when it plays, a play button, what it sounds like, its shape, and a footnote. */
function soundCard({ title, hue, when, about, preview, rate, foot, onPlay }) {
  const card = el('article', 'snd-card')
  card.style.setProperty('--hue', hue)
  const head = el('div', 'snd-head')
  const titles = el('div')
  titles.append(el('h3', 'snd-title', title), el('span', 'snd-label', `When ${when}`))
  const button = el('button', 'snd-play')
  button.type = 'button'
  button.setAttribute('aria-label', `Play the ${title.toLowerCase()} sound`)
  button.innerHTML = PLAY_ICON // a constant icon written above
  head.append(titles, button)
  const wave = waveCanvas(envelope(preview), fallbackOf(hue))
  const meta = el('div', 'snd-meta')
  meta.append(el('span', '', `${(preview.length / rate).toFixed(2)} s`), el('span', '', foot))
  card.append(head, el('p', 'snd-about', about), wave, meta)
  button.addEventListener('click', () => {
    try {
      if (onPlay()) light(card, wave, preview.length / rate, matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch (err) {
      card.querySelector('.snd-label').textContent = 'No audio in this browser'
      console.error('space sounds: could not play', title, err)
    }
  })
  return card
}

// the direction pad: each button is a camera move (dx, dy in viewport widths/heights, + right/down; dz in doublings, + closer)
const MOVES = [
  ['up', '↑', 'Pan up', { dy: -0.6 }],
  ['left', '←', 'Pan left', { dx: -0.6 }],
  ['in', '+', 'Zoom in', { dz: 1 }],
  ['right', '→', 'Pan right', { dx: 0.6 }],
  ['down', '↓', 'Pan down', { dy: 0.6 }],
  ['out', '−', 'Zoom out', { dz: -1 }],
]

/** Two pads to audition the direction-aware sounds: a fly-to (travel) and a wheel or drag tick (nudge) per direction. */
function directionPad(audio) {
  const box = el('div', 'snd-pads')
  for (const [kind, title, hint] of [['travel', 'Fly', 'playNav(\'travel\', { dx, dy, dz, duration })'], ['nudge', 'Wheel / drag tick', 'playNav(\'nudge\', { dx, dy, dz })']]) {
    const pad = el('div', 'snd-pad')
    const head = el('div', 'snd-pad__head')
    head.append(el('span', 'snd-title', title), el('span', 'snd-label', hint))
    const keys = el('div', 'snd-pad__keys')
    keys.setAttribute('role', 'group')
    keys.setAttribute('aria-label', `${title} by direction`)
    for (const [id, glyph, label, move] of MOVES) {
      const b = el('button', `snd-key snd-key--${id}`, glyph)
      b.type = 'button'
      b.setAttribute('aria-label', `${title}: ${label}`)
      b.title = label
      // the tick normally fires per gesture burst; here each press is its own burst
      b.addEventListener('click', () => playNav(kind, { ...move, duration: 650, ctx: audio(), muted: false }))
      keys.append(b)
    }
    pad.append(head, keys)
    box.append(pad)
  }
  return box
}

/** Mounts the section into `host`: the five event sounds, then the four navigation swooshes, each with a play button. */
export function mount(host) {
  if (!document.getElementById('snd-style')) {
    const style = el('style', '', STYLE)
    style.id = 'snd-style'
    document.head.append(style)
  }
  let ctx = null
  const audio = () => {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }
  const buffers = {}
  const root = el('div', 'snd')
  const intro = el('p', 'snd-note')
  intro.append('A low, deep register: sine and triangle pads around 90–330 Hz, each voice a pair detuned by 7 cents, soft slow attacks, a short reverb tail, and everything low-passed at 2.5 kHz so nothing is bright. The page plays the same samples that ', el('code', '', 'scripts/make-space-sounds.mjs'), ' writes as WAV, so what you approve here is what the terminal plays.')
  const grid = el('div', 'snd-grid')
  for (const name of SOUND_NAMES) {
    const info = CARDS[name]
    grid.append(soundCard({
      ...info,
      about: SPACE_SOUNDS[name].about,
      preview: renderSound(name, PREVIEW_RATE),
      rate: PREVIEW_RATE,
      foot: `terminal clip: ${name.replace('_', '-')}`,
      onPlay() {
        const c = audio()
        if (!buffers[name]) {
          const samples = renderSound(name, c.sampleRate)
          buffers[name] = c.createBuffer(1, samples.length, c.sampleRate)
          buffers[name].copyToChannel(samples, 0)
        }
        const source = c.createBufferSource()
        source.buffer = buffers[name]
        source.connect(c.destination)
        source.start()
        return true
      },
    }))
  }
  const navNote = el('p', 'snd-note')
  navNote.append('Navigation: deep, soft swooshes for moving round the page (filtered noise around 150–1500 Hz, low glides, a gentle sub under travel, fit and view), far quieter than the events. Only one plays at a time (a new one fades the last out within 80 ms), a repeat click within 250 ms stays silent, and they play only straight after a click or key, so loading the page or a re-fit the page does by itself is silent. ', el('code', '', 'playNav(kind, { dx, dy, dz, duration })'), ' in web/space-sounds.js. A fly-to follows its direction: zooming in rises and brightens, zooming out falls, darkens and widens, a sideways move pans across the stereo field and tilts higher to the right, going up sounds airier and going down warmer; diagonals blend them. Wheel and drag gestures get one very soft tick per burst.')
  const navGrid = el('div', 'snd-grid')
  for (const kind of NAV_KINDS) {
    const info = NAV_CARDS[kind]
    navGrid.append(soundCard({
      ...info,
      about: NAV_ABOUT[kind],
      preview: renderNav(kind, PREVIEW_RATE, info.opts),
      rate: PREVIEW_RATE,
      foot: `playNav('${kind}')`,
      onPlay: () => playNav(kind, { ...info.opts, ctx: audio(), muted: false }),
    }))
  }
  root.append(intro, grid, navNote, navGrid, directionPad(audio))
  host.append(root)
  return {
    dispose() {
      ctx?.close()
      root.remove()
    },
  }
}

export default mount
