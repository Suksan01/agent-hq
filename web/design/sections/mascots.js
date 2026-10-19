// Mascots: the glow-blob creatures (blobs.js) in every state, 24 distinct ones, and the lead.
import React, { createRoot } from '../../vendor/libs.js'
import { html } from '../../spacekit.js'
import { Cell, H3, Section } from '../frame.js'
import { STATES, blobSpec } from '../../blobs.js'
import { Blob, StatusPill, STATUS_LABEL } from '../../spacekit.js'

const SIX = ['working', 'waiting', 'done', 'failed', 'idle', 'stopped']
const NAMES = [
  'Kepler-7b', 'Vega Prime', 'Nyx', 'Orion Drift', 'Zephyr-9', 'Lumen', 'Astra Nova', 'Tycho', 'Calyx-4', 'Solenne', 'Io Halo', 'Rhea-3',
  'Cygni Echo', 'Halcyon', 'Pyxis', 'Nebulon', 'Xerra', 'Thalassa-5', 'Aurelia', 'Kestrel-2', 'Vanta', 'Selene-9', 'Draxis', 'Elara-6',
]

/* ---------- mascots ---------- */
export function Mascots() {
  const sigs = new Set(NAMES.map((n, i) => { const s = blobSpec(n, i); return `${s.lobes}-${s.hue}-${s.icon}` }))
  return html`<${Section}>
    <p className="sc-lede" style=${{ margin: '0 0 6px' }}>${sigs.size} distinct creatures below; two on screen are never the same.</p>
    <${H3}>24 creatures, from a seed each<//>
    <div className="sc-states" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }}>
      ${NAMES.map((n, i) => html`<div key=${n} className="sc-blobcell"><${Blob} seed=${n} index=${i} state="working" size=${84} /><span className="sc-cap">${n}</span></div>`)}
    </div>
    <${H3}>Six states: working breathes and swirls · needs you pulses amber · done and idle are still · failed is red with a spark · stopped is grey<//>
    <div className="sc-grid" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 22 }}>
      ${SIX.map((state, i) => html`<div key=${state} className="sc-blobcell" data-status=${state}><${Blob} seed=${NAMES[i * 2]} index=${i * 2} state=${state} size=${112} /><${StatusPill} status=${state} /></div>`)}
    </div>
    <div className="sc-grid" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 22, marginTop: 18 }}>
      ${SIX.map((state, i) => html`<div key=${state} className="sc-blobcell"><${Blob} seed=${NAMES[i * 2 + 13]} index=${i * 2 + 13} state=${state} size=${112} /><span className="sc-cap">${STATUS_LABEL[state]}</span></div>`)}
    </div>
    <${H3}>The lead: larger, brighter, a white-hot core and a ring with a moon<//>
    <div className="sc-grid" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 22 }}>
      ${SIX.map((state, i) => html`<div key=${state} className="sc-blobcell"><${Blob} seed="Sirius Prime" index=${5} state=${state} lead size=${140} /><span className="sc-cap">lead · ${STATUS_LABEL[state]}</span></div>`)}
    </div>
  <//>`
}


export function mount(el) {
  const root = createRoot(el)
  root.render(html`<${Mascots} />`)
  return { dispose: () => root.unmount() }
}
