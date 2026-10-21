// Space view (optional): the same sessions as 3D star systems, behind the toolbar's Diagram / Space toggle. Needs WebGL; without it the
// section says so, and the stills below show what the view looks like (rendered once with software GL and saved beside the page as small WebP files).
import React, { createRoot } from '../../vendor/libs.js'
import { GlassTile, html } from '../../spacekit.js'
import { SpaceView } from '../../spaceview.js'
import { t } from '../../i18n.js'
import { setEngineChunk } from '../../spaceengine.js'
import { playNav } from '../../space-sounds.js'
import { webglAvailable } from '../../webgl.js'
import { demoGroups } from '../../diagramdemo.js'

setEngineChunk('engine.chunk.js') // the showcase is one classic script: the engine comes as a second one, on demand
const { useState } = React
const STILLS = [
  ['media/space-all.webp', 'All systems: a team title above each, full cards for working agents and those that need you, compact cards for the rest, the lead card by its star'],
  ['media/space-booking.webp', 'One system framed: the lead star, a planet on each ring, glass cards beside them with leader lines where they stand off'],
  ['media/space-planets.webp', 'Planets close up: each agent its own world, a moon for the helper, the working arc on its ring'],
]

function SpaceSection() {
  const [can] = useState(webglAvailable)
  const [focus, setFocus] = useState(null)
  return html`<div style=${{ display: 'grid', gap: 22 }}>
    ${can ? html`<div style=${{ position: 'relative', height: 680, borderRadius: 34, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)', background: '#020204' }}>
      <${SpaceView} groups=${demoGroups} focus=${focus} onSelect=${(session) => setFocus(session)} onMove=${move => playNav('travel', move)} inset=${{ top: 16, right: 16, bottom: 16, left: 16 }} />
    </div>` : html`<${GlassTile} style=${{ padding: '24px 28px', maxWidth: 640, display: 'grid', gap: 8 }}>
      <b style=${{ font: "700 20px 'Space Grotesk', sans-serif" }}>Space view unavailable</b>
      <span style=${{ font: "400 14px/1.55 'Space Grotesk', sans-serif", color: 'rgba(242,242,245,.62)' }}>${t('space.unavailable')}</span>
    <//>`}
    <div className="sc-h3" style=${{ margin: '8px 0 0' }}>Stills of the Space view</div>
    <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 18 }}>
      ${STILLS.map(([src, caption]) => html`<figure key=${src} style=${{ margin: 0, display: 'grid', gap: 10 }}>
        <img src=${src} alt=${caption} width="1200" height="760" loading="lazy" decoding="async" style=${{ width: '100%', height: 'auto', borderRadius: 24, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)', background: '#020204' }} />
        <figcaption className="sc-cap">${caption}</figcaption>
      </figure>`)}
    </div>
  </div>`
}

export function mount(el) {
  const root = createRoot(el)
  root.render(html`<${SpaceSection} />`)
  return { dispose: () => root.unmount() }
}
