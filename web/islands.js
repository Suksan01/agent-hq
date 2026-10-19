// Cartoon islands for the live page: one island per Claude Code session, drawn from the session id so every
// session keeps its own coastline, decorations and weather. Plain SVG through the `html` tag the page passes in
// (htm bound to React.createElement), no imports. Put `islandCss` in a <style> once; every class starts with `isl-`.
//
//   <svg>      Island({ html, seed, width, height, mood, label })
//   <svg>      Sea({ html, width, height })               the water behind the islands
//   {w, h}     islandSize(memberCount)                    the island's footprint for a lead card and its members
//   {x,y,w,h}  islandSafeRect(width, height)              the calm land rect (relative to the island) for cards

const CARD_W = 220, CARD_H = 150, CARD_GAP = 24
const SAFE = 0.62 // the central share of the island that is always flat land, for the cards
const GRASS = 0.87 // the grass edge as a share of the coast; the rest is beach
const SAMPLES = 64
const INK = '#2B140F'

const PALETTE = {
  ink: INK, sand: '#F6E3B4', sandd: '#E4C98C', grass: '#BFE3A0', grassd: '#94C97A', shallow: '#CDEFEA', sea: '#DDF3F0',
  white: '#FFFDF6', coral: '#F4948A', wood: '#C98F5A', leaf: '#8FD07A', gold: '#F7D154', lilac: '#CDB8F0', tan: '#F2C48D',
  rock: '#CFC3B5', lava: '#F28B6B', grey: '#B9C2CC', pink: '#F7B6D2',
}
// A session that has ended: the same island in fog-grey, drawn from the same classes.
const GONE = {
  ink: '#6B6560', sand: '#DAD7D0', sandd: '#C9C5BD', grass: '#C6CAC2', grassd: '#B3B8AF', shallow: '#DCE1E1', sea: '#E6E9E9',
  white: '#EFEFED', coral: '#BFBAB4', wood: '#ABA59E', leaf: '#B7BDB2', gold: '#D0CCC3', lilac: '#C9C7CD', tan: '#CBC6BE',
  rock: '#BAB6B0', lava: '#BFBAB4', grey: '#AEB1B3', pink: '#CFC9C8',
}
const vars = pal => Object.entries(pal).map(([k, v]) => `--isl-${k}:${v}`).join(';')
const fills = Object.keys(PALETTE).map(k => `.isl-f-${k}{fill:var(--isl-${k})}.isl-s-${k}{stroke:var(--isl-${k})}`).join('')

export const islandCss = `
.isl,.isl-sea{${vars(PALETTE)}}
.isl-gone{${vars(GONE)}}
.isl{overflow:visible;--isl-amp:2.5deg;--isl-sway:4.6s;--isl-flap:1.9s;--isl-puff:3.4s}
.isl-busy{--isl-amp:6deg;--isl-sway:1.5s;--isl-flap:.7s;--isl-puff:1.5s}
${fills}
.isl-k{stroke:var(--isl-ink);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.isl-nf{fill:none}
.isl-txt{font:800 11px "Bricolage Grotesque",system-ui,sans-serif;fill:var(--isl-ink);letter-spacing:.01em}
.isl-sway,.isl-frond,.isl-flutter,.isl-puff,.isl-wave,.isl-bob,.isl-twinkle,.isl-flap,.isl-breathe,.isl-beam,.isl-pupil,.isl-z,
.isl-rain,.isl-flash,.isl-scuttle,.isl-jitter{transform-box:fill-box}
.isl-sway{transform-origin:50% 100%;animation:isl-sway var(--isl-sway) ease-in-out infinite alternate}
.isl-frond{transform-origin:0 70%;animation:isl-frond var(--isl-flap) ease-in-out infinite alternate}
.isl-flutter{transform-origin:0 50%;animation:isl-flutter var(--isl-flap) ease-in-out infinite alternate}
.isl-puff{transform-origin:50% 100%;opacity:0;animation:isl-puff var(--isl-puff) ease-out infinite}
.isl-wave{animation:isl-dash 7s linear infinite}
.isl-wave.isl-rev{animation-direction:reverse;animation-duration:9s}
.isl-breathe{transform-origin:50% 50%;animation:isl-breathe 5s ease-in-out infinite alternate}
.isl-bob{transform-origin:50% 100%;animation:isl-bob 3.2s ease-in-out infinite alternate}
.isl-twinkle{transform-origin:50% 50%;animation:isl-twinkle 2.8s ease-in-out infinite}
.isl-drift{animation:isl-drift 60s linear infinite}
.isl-flap{transform-origin:50% 100%;animation:isl-flap .5s ease-in-out infinite alternate}
.isl-beam{animation:isl-beam 2.4s ease-in-out infinite}
.isl-pupil{animation:isl-pupil 3s ease-in-out infinite alternate}
.isl-z{opacity:0;animation:isl-z 3.6s ease-out infinite}
.isl-scuttle{animation:isl-scuttle 7s ease-in-out infinite alternate}
.isl-jitter{transform-origin:50% 100%;animation:isl-jitter .28s ease-in-out infinite alternate}
.isl-rain{animation:isl-rain .8s linear infinite}
.isl-flash{opacity:0;animation:isl-flash 3.2s linear infinite}
.isl-busy .isl-jitter{animation-duration:.14s}
.isl-calm .isl-puff{--isl-puff:5s}
@keyframes isl-sway{from{transform:rotate(calc(var(--isl-amp)*-1))}to{transform:rotate(var(--isl-amp))}}
@keyframes isl-frond{from{transform:rotate(-4deg) scaleY(.94)}to{transform:rotate(4deg) scaleY(1.05)}}
@keyframes isl-flutter{from{transform:scaleX(1) skewY(-5deg)}to{transform:scaleX(.88) skewY(5deg)}}
@keyframes isl-puff{0%{transform:translateY(0) scale(.35);opacity:0}15%{opacity:.95}100%{transform:translateY(-34px) scale(1.25);opacity:0}}
@keyframes isl-dash{to{stroke-dashoffset:-84px}}
@keyframes isl-breathe{from{transform:scale(.992)}to{transform:scale(1.012)}}
@keyframes isl-bob{from{transform:translateY(-1px) rotate(-3deg)}to{transform:translateY(3px) rotate(3deg)}}
@keyframes isl-twinkle{0%,100%{transform:scale(.2);opacity:0}50%{transform:scale(1);opacity:1}}
@keyframes isl-drift{0%{transform:translateX(0);opacity:0}8%{opacity:1}92%{opacity:1}100%{transform:translateX(var(--span));opacity:0}}
@keyframes isl-flap{from{transform:scaleY(1)}to{transform:scaleY(-.5)}}
@keyframes isl-beam{0%,100%{opacity:.15}50%{opacity:.7}}
@keyframes isl-pupil{from{transform:translateX(-2px)}to{transform:translateX(2px)}}
@keyframes isl-z{0%{transform:translate(0,0) scale(.6);opacity:0}25%{opacity:1}100%{transform:translate(8px,-20px) scale(1.2);opacity:0}}
@keyframes isl-scuttle{0%{transform:translateX(-24px)}100%{transform:translateX(24px)}}
@keyframes isl-jitter{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}
@keyframes isl-rain{from{transform:translateY(-6px);opacity:0}30%{opacity:1}to{transform:translateY(22px);opacity:0}}
@keyframes isl-flash{0%,86%,92%,100%{opacity:0}88%,90%{opacity:1}}
/* only a busy island animates (a stormy one keeps its rain and lightning): the rest hold still, which costs nothing */
.isl:not(.isl-busy) *{animation-play-state:paused}
.isl-stormy .isl-rain,.isl-stormy .isl-flash{animation-play-state:running}
.isl-gone *{animation:none!important}
.isl-gone .isl-puff,.isl-gone .isl-z,.isl-gone .isl-twinkle,.isl-gone .isl-beam{opacity:0}
@media (prefers-reduced-motion:reduce){.isl *{animation:none!important}.isl .isl-puff,.isl .isl-z,.isl .isl-twinkle{opacity:0}.isl .isl-drift{opacity:1}.isl .isl-beam{opacity:.4}}
`

/* ---- sizing ------------------------------------------------------------------------------------------------- */

/** The island's footprint for a lead card plus `memberCount` member cards: land for the card grid, plus beach and sea. */
export function islandSize(memberCount) {
  const cards = Math.max(0, Math.floor(memberCount || 0)) + 1
  const cols = cards <= 2 ? cards : Math.ceil(Math.sqrt(cards * 1.2))
  const rows = Math.ceil(cards / cols)
  const gridW = cols * CARD_W + (cols - 1) * CARD_GAP
  const gridH = rows * CARD_H + (rows - 1) * CARD_GAP
  return { width: Math.round(Math.max(640, gridW / SAFE)), height: Math.round(Math.max(470, gridH / SAFE)) }
}

/** The always-flat land rect inside an island of this size, in the island's own coordinates. */
export function islandSafeRect(width, height) {
  const w = width * SAFE, h = height * SAFE
  return { x: (width - w) / 2, y: (height - h) / 2, w, h }
}

/* ---- seeded randomness -------------------------------------------------------------------------------------- */

function rng(seed) {
  let h = 1779033703 ^ String(seed).length
  for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19) }
  h = Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)
  let a = (h ^ (h >>> 16)) >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.id = (h >>> 0).toString(36)
  return next
}
const pick = (r, list) => list[Math.floor(r() * list.length)]
const shuffle = (r, list) => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}
const n1 = v => Math.round(v * 10) / 10
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/* ---- the coastline ------------------------------------------------------------------------------------------ */

// Everything is in "unit" space: x = cx + rho*cos*W, y = cy + rho*sin*H, so one rho(theta) serves any island size.
function makeCoast(r, W, H) {
  const ring = 0.045 * Math.min(W, H) + 10 // shallow-water ring
  const waves = shuffle(r, [2, 3, 4, 5, 6, 7]).slice(0, 4).map(k => ({ k, amp: (0.03 + r() * 0.045) * (k > 4 ? 0.8 : 1), ph: r() * 6.283 }))
  // a few capes and coves, so no two coastlines share an outline
  const bumps = Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({ at: r() * 6.283, width: 0.18 + r() * 0.3, amp: (r() < 0.55 ? 1 : -1) * (0.05 + r() * 0.08) }))
  const power = 2.2 + r() * 1.2 // 2 is an ellipse, more is squarer
  const half = SAFE / 2
  const rho = theta => {
    const c = Math.abs(Math.cos(theta)), s = Math.abs(Math.sin(theta))
    const base = 0.43 / Math.pow(Math.pow(c, power) + Math.pow(s, power), 1 / power)
    let noise = 1
    for (const w of waves) noise += w.amp * Math.sin(w.k * theta + w.ph)
    for (const b of bumps) { const d = Math.atan2(Math.sin(theta - b.at), Math.cos(theta - b.at)); noise += b.amp * Math.exp(-(d * d) / (2 * b.width * b.width)) }
    const floor = (half / Math.pow(Math.pow(c, 4) + Math.pow(s, 4), 0.25)) / GRASS + 0.004 // the safe rect stays on grass
    const roof = Math.min((0.5 - ring / W) / Math.max(c, 1e-6), (0.5 - ring / H) / Math.max(s, 1e-6))
    return Math.min(roof, Math.max(floor, base * noise))
  }
  const pt = (theta, k = 1) => [W / 2 + rho(theta) * k * Math.cos(theta) * W, H / 2 + rho(theta) * k * Math.sin(theta) * H]
  const pts = Array.from({ length: SAMPLES }, (_, i) => pt((i / SAMPLES) * Math.PI * 2))
  // smooth closed curve through the samples (Catmull-Rom as cubic beziers)
  let d = `M${n1(pts[0][0])} ${n1(pts[0][1])}`
  for (let i = 0; i < SAMPLES; i++) {
    const p0 = pts[(i + SAMPLES - 1) % SAMPLES], p1 = pts[i], p2 = pts[(i + 1) % SAMPLES], p3 = pts[(i + 2) % SAMPLES]
    d += `C${n1(p1[0] + (p2[0] - p0[0]) / 6)} ${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)} ${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])} ${n1(p2[1])}`
  }
  return { d: d + 'Z', ring, rho, pt }
}
const aboutCentre = (W, H, sx, sy = sx) => `translate(${W / 2} ${H / 2}) scale(${n1(sx * 1000) / 1000} ${n1(sy * 1000) / 1000}) translate(${-W / 2} ${-H / 2})`

/* ---- decorations (drawn at 0,0 = their base, about 60px tall, upright) -------------------------------------- */

const P = c => `isl-k isl-f-${c}`
const LINE = 'isl-k isl-nf'
const LEAF = 'M0 0C10 -15 30 -15 42 5C28 -4 12 -2 0 0Z'
const delay = r => ({ animationDelay: `${n1(-r() * 5)}s` })

function palm(html, r, small = false) {
  const lean = (r() < 0.5 ? -1 : 1) * (7 + r() * 10)
  const height = (small ? 34 : 46) + r() * 12
  const leaves = small ? [[-45, 1], [-10, 1], [-45, -1], [-10, -1]] : [[-55, 1], [-20, 1], [20, 1], [-55, -1], [-20, -1], [20, -1]]
  return html`<g className="isl-sway" style=${delay(r)}>
    <path className="isl-k isl-nf" d=${`M0 0Q${n1(lean * 0.1)} ${n1(-height * 0.55)} ${n1(lean)} ${n1(-height)}`} style=${{ strokeWidth: 8 }} />
    <path className="isl-nf isl-s-wood" d=${`M0 0Q${n1(lean * 0.1)} ${n1(-height * 0.55)} ${n1(lean)} ${n1(-height)}`} style=${{ strokeWidth: 4.5, strokeLinecap: 'round' }} />
    <g transform=${`translate(${n1(lean)} ${n1(-height)})`}>
      <g className="isl-frond" style=${delay(r)}>
        ${leaves.map(([a, m], i) => html`<path key=${i} className=${P('leaf')} d=${LEAF} transform=${`scale(${m} 1) rotate(${a})`} />`)}
        <circle className=${P('wood')} cx="-3" cy="4" r="3.2" /><circle className=${P('wood')} cx="3.5" cy="4.5" r="3.2" />
      </g>
    </g>
  </g>`
}

const hut = (html, r) => html`<g>
  <rect className=${P('tan')} x="-16" y="-22" width="32" height="22" rx="3" />
  <path className=${P(pick(r, ['coral', 'lilac', 'gold']))} d="M-23 -20L0 -42L23 -20Z" />
  <rect className=${P('wood')} x="-4" y="-13" width="8" height="13" rx="4" />
  <circle className=${P('white')} cx="10" cy="-13" r="3" />
</g>`

const lighthouse = html => html`<g>
  <path className=${P('white')} d="M-9 0L-6 -44H6L9 0Z" />
  <path className="isl-f-coral" d="M-8.2 -10L8.2 -10L7.6 -20L-7.6 -20Z" /><path className="isl-f-coral" d="M-7 -30L7 -30L6.4 -40L-6.4 -40Z" />
  <rect className=${P('gold')} x="-8" y="-55" width="16" height="11" rx="3" />
  <circle className=${P('white')} cx="0" cy="-49.5" r="4.6" />
  <circle className="isl-pupil isl-f-ink" cx="0" cy="-49.5" r="2" />
  <path className=${P('coral')} d="M-10 -55L0 -66L10 -55Z" />
  <path className="isl-beam isl-f-gold" d="M9 -50L56 -64L56 -36Z" />
</g>`

const volcano = (html, r) => html`<g>
  <path className=${P('rock')} d="M-36 0L-13 -42H13L36 0Z" />
  <path className=${P('lava')} d="M-13 -42Q0 -35 13 -42Q0 -49 -13 -42Z" />
  <path className="isl-f-lava" d="M-5 -40Q-6 -28 -2 -23Q2 -28 3 -39Z" />
  <circle className="isl-f-ink" cx="-9" cy="-17" r="2.2" /><circle className="isl-f-ink" cx="9" cy="-17" r="2.2" />
  <path className=${LINE} d="M-6 -8Q0 -13 6 -8" />
  <circle className=${'isl-puff ' + P('white')} cx="0" cy="-48" r="7" style=${delay(r)} />
  <circle className=${'isl-puff ' + P('white')} cx="-4" cy="-48" r="6" style=${{ animationDelay: '-1.1s' }} />
  <circle className=${'isl-puff ' + P('white')} cx="4" cy="-48" r="5" style=${{ animationDelay: '-2.2s' }} />
</g>`

const rocks = html => html`<g>
  <path className=${P('rock')} d="M-26 0Q-28 -9 -19 -10Q-12 -11 -9 0Z" />
  <path className=${P('rock')} d="M4 0Q2 -9 9 -11Q18 -12 20 0Z" />
  <path className=${P('rock')} d="M-14 0Q-17 -17 -3 -21Q10 -22 13 -9Q16 -2 12 0Z" />
  <circle className=${P('white')} cx="-7" cy="-13" r="3.6" style=${{ strokeWidth: 1.3 }} /><circle className=${P('white')} cx="3" cy="-14" r="3.6" style=${{ strokeWidth: 1.3 }} />
  <circle className="isl-f-ink" cx="-6" cy="-12.4" r="1.4" /><circle className="isl-f-ink" cx="4.2" cy="-13.4" r="1.4" />
</g>`

function flowers(html, r) {
  const colours = ['pink', 'lilac', 'coral', 'gold']
  return html`<g>${[[-16, 0], [0, 4], [15, -1]].map(([x, y], i) => {
    const h = 12 + r() * 8
    return html`<g key=${i} transform=${`translate(${x} ${y})`}>
      <path className=${LINE} d=${`M0 0Q2 ${-h / 2} 0 ${-h}`} />
      <circle className=${P(pick(r, colours))} cx="0" cy=${-h - 3} r="5" /><circle className=${P('white')} cx="0" cy=${-h - 3} r="1.8" style=${{ strokeWidth: 1 }} />
    </g>`
  })}</g>`
}

const chest = html => html`<g>
  <path className=${LINE} d="M20 -2L29 7M29 -2L20 7" style=${{ strokeWidth: 3 }} />
  <rect className=${P('wood')} x="-13" y="-12" width="26" height="12" rx="2" />
  <path className=${P('wood')} d="M-13 -12Q-13 -23 0 -23Q13 -23 13 -12Z" />
  <path className="isl-nf isl-s-gold" d="M-5 -22V0M5 -22V0" style=${{ strokeWidth: 3 }} />
  <rect className=${P('gold')} x="-3" y="-15" width="6" height="6" rx="1.5" />
  <path className="isl-twinkle isl-f-gold isl-k" d="M10 -30Q11 -26 15 -25Q11 -24 10 -20Q9 -24 5 -25Q9 -26 10 -30Z" style=${{ strokeWidth: 1.2 }} />
</g>`

function hammock(html, r, mood) {
  const zs = mood === 'calm' ? html`<text className="isl-z isl-txt" x="2" y="-26">z</text><text className="isl-z isl-txt" x="9" y="-34" style=${{ animationDelay: '-1.8s' }}>z</text>` : ''
  return html`<g>
    <g transform="translate(-42 0)">${palm(html, () => 0.7, true)}</g>
    <g transform="translate(42 0)">${palm(html, () => 0.2, true)}</g>
    <path className=${P('lilac')} d="M-38 -33Q0 -2 38 -33Q0 -19 -38 -33Z" />
    <ellipse className=${P('gold')} cx="0" cy="-19" rx="10" ry="6.5" />
    <path className=${LINE} d="M-5 -20Q-3 -17.5 -1 -20M2 -20Q4 -17.5 6 -20" style=${{ strokeWidth: 1.3 }} />
    ${zs}
  </g>`
}

const crab = html => html`<g className="isl-scuttle"><g className="isl-jitter">
  <path className=${LINE} d="M-9 -4L-14 -1M-9 -1L-14 3M9 -4L14 -1M9 -1L14 3" />
  <ellipse className=${P('coral')} cx="0" cy="-6.5" rx="9.5" ry="6.5" />
  <circle className=${P('coral')} cx="-13" cy="-13" r="4" /><circle className=${P('coral')} cx="13" cy="-13" r="4" />
  <path className=${LINE} d="M-4 -11V-17M4 -11V-17" />
  <path className="isl-f-ink isl-k" d="M-8 -21H8V-17.5Q4.5 -14.5 0 -17.5Q-4.5 -14.5 -8 -17.5Z" style=${{ strokeWidth: 1.2 }} />
</g></g>`

const umbrella = (html, r) => html`<g>
  <path className=${P('lilac')} d="M-8 -2H20V6H-8Z" />
  <path className=${LINE} d="M0 0V-42" />
  <path className=${P(pick(r, ['coral', 'gold', 'pink']))} d="M-24 -40Q0 -66 24 -40Q12 -44 0 -40Q-12 -44 -24 -40Z" />
  <path className="isl-f-white" d="M-8 -53Q0 -57 8 -53L12 -42Q0 -39 -12 -42Z" />
</g>`

function flag(html, r, label) {
  const text = Array.from(label).slice(0, 16).join('') + (Array.from(label).length > 16 ? '…' : '')
  const w = Math.max(52, text.length * 7 + 22)
  return html`<g>
    <path className=${LINE} d="M0 0V-76" style=${{ strokeWidth: 3 }} />
    <circle className=${P('gold')} cx="0" cy="-77" r="3.2" />
    <g className="isl-flutter" style=${delay(r)}>
      <path className=${P(pick(r, ['coral', 'lilac', 'gold', 'pink']))} d=${`M1 -74Q${w / 2} -80 ${w} -74L${w - 11} -62L${w} -50Q${w / 2} -56 1 -50Z`} />
      <text className="isl-txt" x=${(w - 6) / 2 + 2} y="-59" textAnchor="middle">${text}</text>
    </g>
  </g>`
}

/* ---- sky and sea life --------------------------------------------------------------------------------------- */

const CLOUD = 'M-30 0A10 10 0 0 1 -26 -17A14 14 0 0 1 0 -24A12 12 0 0 1 24 -14A10 10 0 0 1 30 0Z'

function cloud(html, r, W, H, clip, i) {
  const x = -0.05 * W + r() * 0.3 * W, y = 0.1 * H + r() * 0.3 * H, k = 0.9 + r() * 0.7
  const drift = { '--span': `${n1(W * 0.95)}px`, animationDuration: `${n1(55 + r() * 40)}s`, animationDelay: `${n1(-r() * 80)}s` }
  return html`<g key=${i}>
    <g clipPath=${`url(#${clip})`}><g transform=${`translate(${n1(x + 12)} ${n1(y + 78)})`}><g className="isl-drift" style=${drift}>
      <path className="isl-f-ink" d=${CLOUD} transform=${`scale(${n1(k * 1.1)} ${n1(k * 0.5)})`} style=${{ opacity: 0.1 }} />
    </g></g></g>
    <g transform=${`translate(${n1(x)} ${n1(y)})`}><g className="isl-drift" style=${drift}>
      <path className=${P('white')} d=${CLOUD} transform=${`scale(${n1(k)})`} />
    </g></g>
  </g>`
}

function gull(html, r, W, H, i) {
  const y = 0.05 * H + r() * 0.22 * H, k = 0.9 + r() * 0.5
  const drift = { '--span': `${n1(W * 1.1)}px`, animationDuration: `${n1(22 + r() * 14)}s`, animationDelay: `${n1(-r() * 30)}s` }
  return html`<g key=${i} transform=${`translate(${n1(-0.08 * W + r() * 0.3 * W)} ${n1(y)})`}><g className="isl-drift" style=${drift}>
    <path className="isl-flap isl-k isl-nf" d="M-9 0Q-4.5 -7 0 0Q4.5 -7 9 0" transform=${`scale(${n1(k * 1.3)})`} />
  </g></g>`
}

const sparkle = (html, x, y, k, d, i) => html`<path key=${i} className="isl-twinkle isl-f-white isl-k" style=${{ strokeWidth: 1.4, animationDelay: `${d}s` }}
  d="M0 -6Q1 -1 6 0Q1 1 0 6Q-1 1 -6 0Q-1 -1 0 -6Z" transform=${`translate(${n1(x)} ${n1(y)}) scale(${k})`} />`

const WATER_LINE = html => html`<path className="isl-k isl-nf" d="M-18 3q4.5 -3.5 9 0t9 0t9 0t9 0" style=${{ opacity: 0.55, strokeWidth: 1.6 }} />`

const boat = (html, r) => html`<g><g className="isl-bob">
  <path className=${LINE} d="M0 -3V-28" />
  <path className=${P('white')} d="M1 -27V-5H15Z" />
  <path className=${P('coral')} d="M-14 -3H16L11 6H-9Z" />
  <path className=${P('gold')} d="M-1 -28L-9 -25L-1 -22Z" style=${{ strokeWidth: 1.3 }} />
</g>${WATER_LINE(html)}</g>`

const duck = html => html`<g><g className="isl-bob">
  <ellipse className=${P('gold')} cx="0" cy="-6" rx="12" ry="7" />
  <circle className=${P('gold')} cx="9" cy="-15" r="6" />
  <path className=${P('coral')} d="M14 -16L21 -14L14 -12Z" style=${{ strokeWidth: 1.4 }} />
  <circle className="isl-f-ink" cx="11" cy="-16.5" r="1.4" />
  <path className=${LINE} d="M-7 -7Q-2 -12 3 -7" style=${{ strokeWidth: 1.4 }} />
</g>${WATER_LINE(html)}</g>`

function stormCloud(html, W, H) {
  const x = W * 0.74, y = 0.17 * H
  return html`<g>
    <g transform=${`translate(${n1(x)} ${n1(y)})`}><g className="isl-bob">
      <path className=${P('grey')} d=${CLOUD} transform="scale(2.7)" />
      <circle className="isl-f-ink" cx="-14" cy="-26" r="3" /><circle className="isl-f-ink" cx="14" cy="-26" r="3" />
      <path className=${LINE} d="M-22 -37L-8 -32M22 -37L8 -32M-9 -12Q0 -19 9 -12" />
      <path className="isl-flash isl-f-gold isl-k" d="M4 8L-6 26H2L-4 42L12 20H3L9 8Z" style=${{ strokeWidth: 1.4 }} />
      ${[-34, -18, -2, 14, 30, 46].map((dx, i) => html`<path key=${i} className="isl-rain isl-k isl-nf" d=${`M${dx} 8l-3 9`} style=${{ animationDelay: `${(i % 3) * -0.27}s`, strokeWidth: 1.8, stroke: '#6E8CA8' }} />`)}
    </g></g>
  </g>`
}

function fog(html, W, H) {
  return html`<g>${[[0.5, 0.5, 0.52, 0.34], [0.3, 0.38, 0.3, 0.2], [0.7, 0.6, 0.3, 0.2], [0.55, 0.28, 0.25, 0.14]].map(([x, y, rx, ry], i) =>
    html`<ellipse key=${i} className="isl-f-white" cx=${n1(x * W)} cy=${n1(y * H)} rx=${n1(rx * W)} ry=${n1(ry * H)} style=${{ opacity: 0.5 }} />`)}</g>`
}

/* ---- the island --------------------------------------------------------------------------------------------- */

// half width and height of each decoration, for keeping them off the cards
const EXTENT = { palm: [24, 62], hut: [24, 44], lighthouse: [16, 68], volcano: [36, 60], rocks: [28, 24], flowers: [24, 28], chest: [30, 32], hammock: [58, 50], crab: [30, 24], umbrella: [30, 68], flag: [0, 80] }
const MOODS = new Set(['busy', 'calm', 'stormy', 'gone'])

export function Island({ html, seed = 'island', width = 760, height = 520, mood = 'calm', label = '' }) {
  const W = width, H = height, m = MOODS.has(mood) ? mood : 'calm'
  const r = rng(seed)
  const coast = makeCoast(r, W, H)
  const clip = `isl-clip-${r.id}`
  const k = clamp(Math.min(W, H) / 330, 1.1, 2)
  const ringX = (coast.ring * 0.92) / (0.44 * W), ringY = (coast.ring * 0.92) / (0.44 * H)

  // beach sand speckles and grass tufts, scattered between the cards' rect and the coast
  const specks = [], tufts = []
  for (let i = 0; i < 26; i++) {
    const t = r() * Math.PI * 2
    const [x, y] = coast.pt(t, GRASS + 0.02 + r() * (0.96 - GRASS))
    if (i < 14) specks.push(`M${n1(x)} ${n1(y)}h.1`)
    else { const [gx, gy] = coast.pt(t, 0.62 + r() * 0.2); tufts.push(`M${n1(gx - 4)} ${n1(gy - 5)}L${n1(gx)} ${n1(gy)}L${n1(gx + 4)} ${n1(gy - 5)}`) }
  }

  // decorations: the flag always, then 2 to 4 from the pool, each in its own sector around the coast
  const pool = ['palm', 'palm', 'hut', 'lighthouse', 'volcano', 'rocks', 'flowers', 'chest', 'hammock', 'crab', 'umbrella']
  const chosen = [...new Set(shuffle(r, pool))].slice(0, 3 + Math.floor(r() * 3))
  const sectors = shuffle(r, [0, 1, 2, 3, 4, 5, 6, 7])
  const flagSector = [4, 5, 6][Math.floor(r() * 3)] // the upper left: the pennant flies over the water, clear of the cards
  const rest = sectors.filter(s => s !== flagSector)
  const items = []
  const safe = islandSafeRect(W, H)
  const place = (kind, sector) => {
    const t = ((sector + 0.5 + (r() - 0.5) * 0.5) / 8) * Math.PI * 2
    const [hw, up] = EXTENT[kind]
    const left = kind === 'flag' ? 0 : hw * k
    const right = kind === 'flag' ? Math.max(52, label.length * 7 + 22) * k : hw * k
    // start on the beach edge of the grass and move out until the decoration clears the cards' rect
    let at = coast.pt(t, kind === 'crab' ? 0.94 : Math.sin(t) > 0.3 ? 0.97 : 0.86)
    for (let f = 0.86; f <= 1.05; f += 0.03) {
      at = coast.pt(t, kind === 'crab' ? 0.94 : f)
      const clear = at[0] + right < safe.x - 6 || at[0] - left > safe.x + safe.w + 6 || at[1] < safe.y - 6 || at[1] - up * k > safe.y + safe.h + 6
      if (clear || kind === 'crab') break
    }
    items.push({ kind, x: at[0], y: at[1] })
  }
  if (label) place('flag', flagSector)
  chosen.forEach((kind, i) => place(kind, rest[i]))
  items.sort((a, b) => a.y - b.y)
  const draw = it => {
    switch (it.kind) {
      case 'palm': return palm(html, r)
      case 'hut': return hut(html, r)
      case 'lighthouse': return lighthouse(html)
      case 'volcano': return volcano(html, r)
      case 'rocks': return rocks(html)
      case 'flowers': return flowers(html, r)
      case 'chest': return chest(html)
      case 'hammock': return hammock(html, r, m)
      case 'crab': return crab(html)
      case 'umbrella': return umbrella(html, r)
      default: return flag(html, r, label)
    }
  }

  // sea life in the corners, where no land reaches
  const corners = shuffle(r, [[-1, -1], [1, -1], [-1, 1], [1, 1]])
  const water = c => [W / 2 + c[0] * (0.448 - r() * 0.02) * W, H / 2 + c[1] * (0.45 - r() * 0.03) * H]
  const boatAt = water(corners[0])
  const sparks = [corners[1], corners[2], corners[3], corners[1]].map(water)
  const gone = m === 'gone', storm = m === 'stormy'

  return html`<svg className=${`isl isl-${m}`} width=${W} height=${H} viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${label ? `Island: ${label}` : 'Island'}>
    <defs><clipPath id=${clip}><path d=${coast.d} /></clipPath></defs>
    <path d=${coast.d} className="isl-f-shallow isl-s-shallow" style=${{ strokeWidth: coast.ring * 2, strokeLinejoin: 'round' }} />
    <g transform=${aboutCentre(W, H, 1 + ringX, 1 + ringY)}><g className="isl-breathe">
      <path className="isl-wave isl-k isl-nf" d=${coast.d} style=${{ strokeDasharray: '18 12 4 12', vectorEffect: 'non-scaling-stroke', opacity: 0.55 }} />
    </g></g>
    <g transform=${aboutCentre(W, H, 1 + ringX * 0.5, 1 + ringY * 0.5)}>
      <path className="isl-wave isl-rev isl-k isl-nf" d=${coast.d} style=${{ strokeDasharray: '6 14', vectorEffect: 'non-scaling-stroke', opacity: 0.3, strokeWidth: 1.5 }} />
    </g>
    <path className="isl-f-ink" d=${coast.d} transform="translate(0 9)" style=${{ opacity: 0.1 }} />
    <path className=${P('sand')} d=${coast.d} />
    <path className="isl-nf isl-s-sandd isl-k" d=${specks.join('')} style=${{ strokeWidth: 3 }} />
    <path className="isl-f-grass isl-k" d=${coast.d} transform=${aboutCentre(W, H, GRASS)} style=${{ strokeDasharray: '1 6', vectorEffect: 'non-scaling-stroke', strokeWidth: 1.6 }} />
    <path className="isl-nf isl-s-grassd isl-k" d=${tufts.join('')} style=${{ strokeWidth: 2 }} />
    ${gone ? '' : html`<g>${sparks.map(([x, y], i) => sparkle(html, x, y, 0.8 + (i % 3) * 0.25, n1(-i * 0.9), i))}</g>`}
    ${gone ? '' : html`<g transform=${`translate(${n1(boatAt[0])} ${n1(boatAt[1])}) scale(${n1(k)})`}>${(rng(seed + 'boat')() < 0.5) ? boat(html, r) : duck(html)}</g>`}
    ${items.map((it, i) => html`<g key=${i} transform=${`translate(${n1(it.x)} ${n1(it.y)}) scale(${n1(k)})`}>${draw(it)}</g>`)}
    ${gone || storm ? '' : html`<g>${Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => cloud(html, r, W, H, clip, i))}</g>`}
    ${gone ? '' : html`<g>${Array.from({ length: 1 + Math.floor(r() * 2) }, (_, i) => gull(html, r, W, H, i))}</g>`}
    ${storm ? stormCloud(html, W, H) : ''}
    ${gone ? fog(html, W, H) : ''}
  </svg>`
}

/* ---- the sea ------------------------------------------------------------------------------------------------ */

// A flat sea with ink wavelet doodles. The pattern tile keeps it two elements however big the canvas is.
const WAVELETS = [[16, 20], [88, 46], [140, 14], [52, 92], [118, 104], [26, 150], [92, 168], [148, 142]]
  .map(([x, y], i) => `M${x} ${y}q${5 + (i % 2) * 2} -5 10 0t10 0${i % 3 === 0 ? 't10 0' : ''}`).join('')

export function Sea({ html, width = 1600, height = 1000 }) {
  return html`<svg className="isl-sea" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`} aria-hidden="true">
    <defs><pattern id="isl-sea-tile" width="176" height="190" patternUnits="userSpaceOnUse">
      <path className="isl-k isl-nf" d=${WAVELETS} style=${{ opacity: 0.2, strokeWidth: 1.8 }} />
    </pattern></defs>
    <rect className="isl-f-sea" width=${width} height=${height} />
    <rect fill="url(#isl-sea-tile)" width=${width} height=${height} />
  </svg>`
}
