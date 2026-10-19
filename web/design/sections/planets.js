// Planets section of the design system: in the space view every agent is its own world (planets.js), the lead is the star and
// helpers are moons. Shown here: 36 agents with the planet each one gets beside its blob, every kind of world, one planet in
// every state, the star and the moons, and a small orbit.

import React, { createRoot } from '../../vendor/libs.js'
import { html } from '../../spacekit.js'
import { blobSvg } from '../../blobs.js'
import { FEATURE, PLANET_TYPES, TYPE_NAME, assignPlanets, planetSpec, planetSvg, pulseHtml } from '../../planets.js'
import { Cell, H3, Section } from '../frame.js'

// the first 36 names of the default nickname theme (hooks/themes.ts, "planets"); the lead's is a star name
const NICKNAMES = [
  'Kepler-7b', 'Vega Prime', 'Nyx', 'Orion Drift', 'Zephyr-9', 'Lumen', 'Astra Nova', 'Tycho', 'Calyx-4', 'Solenne', 'Io Halo', 'Rhea-3',
  'Cygni Echo', 'Halcyon', 'Pyxis', 'Nebulon', 'Xerra', 'Thalassa-5', 'Aurelia', 'Kestrel-2', 'Vanta', 'Selene-9', 'Draxis', 'Elara-6',
  'Corvus Reach', 'Mira Vale', 'Oberon Deep', 'Talos-12', 'Ceres Bloom', 'Zenara', 'Lyonesse', 'Proxima-b', 'Hydrus', 'Equinox', 'Novaterra', 'Arcadia-3',
]
const STATES = ['working', 'waiting', 'done', 'failed', 'idle', 'stopped']
const SLOTS = assignPlanets(NICKNAMES)

const { useMemo, useState } = React

const Svg = ({ markup, size }) => html`<span style=${{ display: 'inline-grid', position: 'relative', isolation: 'isolate', width: size, height: size }} dangerouslySetInnerHTML=${{ __html: markup }} />`
// A live planet: inline SVG, so it can turn (the states row and the orbit; working and waiting ones move on their own).
// a waiting planet gets the needs-you pulse behind it: an HTML ring that animates opacity and scale only (the planet never repaints)
const Planet = props => html`<${Svg} size=${props.size ?? 96} markup=${(props.state === 'waiting' ? pulseHtml({ d: `${Math.round((props.size ?? 96) * 0.82)}px` }) : '') + planetSvg({ size: 96, spin: 'hover', ...props })} />`

// The grids show pictures instead: an <img> of the SVG is drawn once and puts none of its elements in the page, where 50 inline
// planets and blobs (thousands of elements, each with gradients) cost style and layout work all the time.
const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'
const picture = (markup, css = '') => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup.replace('<svg ', `<svg ${SVG_NS} `).replace('>', css ? `><style>${css}</style>` : '>'))}`
const BLOB_CSS = '.sk-fill{fill:#fff;stroke:none}.sk-halo{opacity:0}' // what an idle blob takes from space.css, for its picture

/** A grid planet: a still picture; under the pointer the live SVG takes its place and turns on its axis. */
function GridPlanet({ size = 96, ...props }) {
  const [isLive, setLive] = useState(false)
  const src = useMemo(() => picture(planetSvg({ size, ...props, still: true })), [])
  return html`<span style=${{ display: 'inline-grid', width: size, height: size }} onPointerEnter=${() => setLive(true)} onPointerLeave=${() => setLive(false)}>
    ${isLive ? html`<span dangerouslySetInnerHTML=${{ __html: planetSvg({ size, ...props, spin: 'always' }) }} />` : html`<img src=${src} width=${size} height=${size} alt="" decoding="async" />`}
  </span>`
}
function BlobPicture({ seed, index, size }) {
  const src = useMemo(() => picture(blobSvg({ seed, state: 'idle', size, index }), BLOB_CSS), [])
  return html`<img src=${src} width=${size} height=${size} alt="" decoding="async" />`
}
const grid = min => ({ display: 'grid', gap: 18, gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))` })
const tile = { display: 'grid', justifyItems: 'center', gap: 8, padding: '14px 6px', borderRadius: 24, background: 'rgba(255,255,255,.03)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.05)' }

function Pairs() {
  return html`<div style=${grid(150)}>${NICKNAMES.map((name, i) => {
    const spec = planetSpec(name, SLOTS.get(name))
    return html`<div key=${name} style=${tile}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: 2 }}><${BlobPicture} seed=${name} index=${i} size=${34} /><${GridPlanet} seed=${name} index=${SLOTS.get(name)} size=${84} /></div>
      <span className="sk-name" style=${{ fontSize: 14 }}>${name}</span>
      <span className="sc-cap">${TYPE_NAME[spec.type]} · ${spec.family}</span>
    </div>`
  })}</div>`
}

function Kinds() {
  return html`<div style=${grid(150)}>${PLANET_TYPES.map((type, t) => html`<div key=${type} style=${tile}>
    <${GridPlanet} seed=${`kind-${type}`} index=${t} />
    <span className="sk-name" style=${{ fontSize: 14 }}>${TYPE_NAME[type]}</span><span className="sc-cap">${FEATURE[type]}</span>
  </div>`)}</div>`
}

const RINGS = [[120, 'working'], [190, 'waiting'], [260, 'idle']]
const ORBITERS = [['Kepler-7b', 'working', 120, 20], ['Vega Prime', 'waiting', 190, 150], ['Nyx', 'done', 190, 300], ['Orion Drift', 'failed', 260, 60], ['Zephyr-9', 'idle', 260, 220]]
const HUE = { working: 'var(--st-working)', waiting: 'var(--st-waiting)', idle: 'var(--st-idle)' }

/** An orbit, one SVG so it scales to any width: the lead's star in the middle, members on dotted rings, a helper moon. */
function orbitSvg() {
  const at = (x, y, size, markup) => `<g transform="translate(${Math.round(x - size / 2)} ${Math.round(y - size / 2)})">${markup}</g>`
  const rings = RINGS.map(([r, s]) => `<ellipse cx="300" cy="150" rx="${r}" ry="${r * 0.42}" fill="none" stroke="${HUE[s]}" stroke-opacity="${s === 'idle' ? 0.35 : 0.6}" stroke-dasharray="1.5 5" stroke-linecap="round"/>`).join('')
  const members = ORBITERS.map(([name, state, r, deg]) => {
    const a = (deg * Math.PI) / 180, x = 300 + Math.cos(a) * r, y = 150 + Math.sin(a) * r * 0.42
    const moon = name === 'Kepler-7b' ? at(x + 38, y - 22, 30, planetSvg({ kind: 'moon', seed: 'Kepler-7b helper', state: 'working', size: 30 })) : ''
    return at(x, y, 64, planetSvg({ seed: name, index: SLOTS.get(name), state, size: 64 })) + moon
  }).join('')
  // pulses for waiting members, as HTML behind the SVG: positions in % of the 600 x 300 box, size in cqw of its width
  const pulses = ORBITERS.filter(([, state]) => state === 'waiting').map(([, , r, deg]) => {
    const a = (deg * Math.PI) / 180
    return pulseHtml({ x: `${((300 + Math.cos(a) * r) / 6).toFixed(2)}%`, y: `${((150 + Math.sin(a) * r * 0.42) / 3).toFixed(2)}%`, d: `${((64 * 0.82) / 6).toFixed(2)}cqw` })
  }).join('')
  return `<div style="position:relative;isolation:isolate;container-type:inline-size;max-width:900px;margin:0 auto">${pulses}<svg viewBox="0 0 600 300" width="100%" role="img" aria-label="A lead's star with five member planets on three orbits and a helper moon" style="display:block;overflow:visible">${rings}${at(300, 150, 120, planetSvg({ kind: 'star', seed: 'Sirius Prime', state: 'working', size: 120 }))}${members}</svg></div>`
}

const Orbit = () => html`<div className="sk-canvas" style=${{ borderRadius: 34, padding: '24px 12px', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
  <div className="sk-stars"></div><div dangerouslySetInnerHTML=${{ __html: orbitSvg() }} />
</div>`

function Planets() {
  const one = { seed: 'Kepler-7b', index: SLOTS.get('Kepler-7b') }
  return html`<${Section}>
    <${H3}>36 agents, 36 different worlds: each beside its blob (the same id always gets the same planet)<//>
    <${Pairs} />
    <${H3}>Every kind of world<//>
    <${Kinds} />
    <${H3}>One planet in every state: working turns on its axis in a blue atmosphere, needs you pulses an amber beacon, the rest hold still (point at any planet to watch it turn)<//>
    <div style=${grid(130)}>${STATES.map(state => html`<${Cell} key=${state} caption=${state}><${Planet} ...${one} state=${state} /><//>`)}</div>
    <${H3}>The lead is a star, helpers are moons (still pictures here; the orbit below moves)<//>
    <div style=${grid(130)}>
      ${['working', 'waiting', 'done'].map(state => html`<${Cell} key=${state} caption=${`star · ${state}`}><${GridPlanet} kind="star" seed="Sirius Prime" state=${state} /><//>`)}
      ${['Kepler-7b helper', 'Vega Prime helper', 'Orion Drift helper'].map((seed, i) => html`<${Cell} key=${seed} caption=${`moon · ${STATES[i]}`}><${GridPlanet} kind="moon" seed=${seed} state=${STATES[i]} /><//>`)}
    </div>
    <${H3}>On their orbits<//>
    <${Orbit} />
  <//>`
}

export function mount(el) {
  const root = createRoot(el)
  root.render(html`<${Planets} />`)
  return { dispose: () => root.unmount() }
}
