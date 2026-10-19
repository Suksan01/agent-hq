// Live diagram: the default view of the page, with the Diagram / Space toggle. Both views are fed the same sessions, focus and selection,
// as on the live page; the toggle is remembered in localStorage and is not offered where WebGL is off.
import React, { createRoot } from '../../vendor/libs.js'
import { PillButton, SystemChip, html } from '../../spacekit.js'
import { LiveView, ViewToggle, useViewMode } from '../../liveview.js'
import { SpaceView } from '../../spaceview.js'
import { setEngineChunk } from '../../spaceengine.js'
import { playNav } from '../../space-sounds.js'
import { demoGroups } from '../../diagramdemo.js'

setEngineChunk('engine.chunk.js') // the showcase is one classic script: the engine comes as a second one, on demand
const { useRef, useState } = React

function DiagramSection() {
  const [mode, setMode, canSpace, fallBack] = useViewMode()
  const [focus, setFocus] = useState(null)
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState(null)
  const api = useRef(null)
  const picked = selected ? demoGroups.flatMap(g => g.agents.map(a => ({ g, a }))).find(({ g, a }) => `${g.session}|${a.id}` === selected) : null
  return html`<div style=${{ display: 'grid', gap: 14 }}>
    <div style=${{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      <${ViewToggle} mode=${mode} onChange=${setMode} canSpace=${canSpace} />
      <${SystemChip} label="All" count=${demoGroups.length} active=${focus === null} onClick=${() => setFocus(null)} />
      ${demoGroups.map(g => html`<${SystemChip} key=${g.session} label=${g.team} count=${g.agents.length} active=${focus === g.session} attention=${g.agents.some(a => a.needsYou)} seed=${g.team} onClick=${() => setFocus(g.session)} />`)}
      <${PillButton} small onClick=${() => { playNav('fit', { duration: 600 }); api.current?.fit() }}>Fit<//>
      <span className="sc-cap" style=${{ marginLeft: 'auto' }}>${picked ? `selected: ${picked.a.nickname} · ${picked.g.team}` : 'click a card to select it'}</span>
    </div>
    <div style=${{ position: 'relative', height: 680, borderRadius: 34, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)', background: '#050507' }}>
      <${LiveView} mode=${mode} Space=${SpaceView} onFallback=${fallBack} onNotice=${setNotice} onMove=${move => playNav('travel', move)} onLeadMessage=${s => setNotice(`Message the ${s} lead (the page opens its drawer)`)} onLeadHire=${s => setNotice(`Add an agent to ${s} (the page opens Add agent)`)} onLeadTasks=${() => setNotice('Task board (the page toggles it)')} groups=${demoGroups} focus=${focus} selected=${selected} inset=${{ top: 16, right: 16, bottom: 16, left: 16 }}
        onSelect=${(session, id) => setSelected(`${session}|${id}`)} onReady=${a => { api.current = a }} />
    </div>
    ${notice ? html`<div className="sc-cap">${notice}</div>` : null}
    <p className="sc-cap" style=${{ maxWidth: 760, lineHeight: 1.6 }}>Drag to pan, wheel or pinch to zoom, a chip or Fit frames a group. Working lines glow in their hue with a light travelling along them; the amber dotted line is an agent that needs you; idle, done and failed ones sit quiet. Idle and done cards are compact, the full card opens on hover. ${canSpace ? 'The toggle switches to the 3D Space view with the same data.' : 'The Space toggle is hidden: this browser has WebGL off.'}</p>
  </div>`
}

export function mount(el) {
  const root = createRoot(el)
  root.render(html`<${DiagramSection} />`)
  return { dispose: () => root.unmount() }
}
