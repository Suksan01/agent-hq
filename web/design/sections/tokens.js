// Tokens: colour (status hues included), the three typefaces, radii, glow and spacing, drawn from space.css's own variables.
import React, { createRoot } from '../../vendor/libs.js'
import { html } from '../../spacekit.js'
import { Cell, H3, Section } from '../frame.js'
import { DotNumber, GlassTile } from '../../spacekit.js'

const SWATCHES = [
  ['Canvas', '#050507'], ['Text', '#F2F2F5'], ['Indigo', '#3B2BFF'], ['Violet', '#8A3FFC'], ['Deep blue', '#0B3BFF'],
  ['Working', '#3D7BFF'], ['Needs you', '#FFB547'], ['Done', '#3DF2B0'], ['Failed', '#FF5A5F'], ['Idle', '#8A8FA3'], ['Stopped', '#5A5D68'], ['Lead', '#B9A6FF'],
]

export function Tokens() {
  return html`<${Section}>
    <${H3}>Colour<//>
    <div className="sc-grid" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
      ${SWATCHES.map(([name, hex]) => html`<${Cell} key=${name} caption=${`${name} ${hex}`}><div className="sc-swatch" style=${{ '--c': hex, width: '100%' }}></div><//>`)}
    </div>
    <${H3}>Text on the canvas<//>
    <div className="sc-row" style=${{ gap: 36 }}>
      <${Cell} caption="Primary #F2F2F5"><span style=${{ fontSize: 22, color: '#F2F2F5' }}>Tech Lead</span><//>
      <${Cell} caption="Secondary 62%"><span style=${{ fontSize: 22, color: 'rgba(242,242,245,.62)' }}>Building the date picker</span><//>
      <${Cell} caption="Faint 38%"><span style=${{ fontSize: 22, color: 'rgba(242,242,245,.38)' }}>2 minutes ago</span><//>
    </div>
    <${H3}>Type: Space Grotesk, JetBrains Mono, Doto<//>
    <div className="sc-grid" style=${{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 28 }}>
      <${GlassTile} status="lead" soft><div className="sk-label" style=${{ marginBottom: 14 }}>Space Grotesk 700 · titles</div>
        <div className="sk-title" style=${{ fontSize: 54 }}>Booking App</div><div className="sk-title" style=${{ fontSize: 30, marginTop: 14, fontWeight: 500 }}>Kepler-7b</div>
        <div className="sk-body-text" style=${{ marginTop: 10 }}>400 · The lead plans, the members build, the reviewers read. Body text sits at 13 to 15 px.</div><//>
      <${GlassTile} status="working" soft edge="bottom"><div className="sk-label" style=${{ marginBottom: 14 }}>JetBrains Mono 400 · labels, +6% tracking</div>
        <div style=${{ display: 'grid', gap: 14 }}><span className="sk-label" style=${{ fontSize: 13 }}>Frontend Developer</span><span className="sk-label">frontend-dev-1 · ROLE</span><span className="sk-label">NEXT · TOOLS · NOW</span>
        <span style=${{ font: '400 13px var(--sk-font-mono)', color: 'var(--sk-text-2)' }}>git push origin main</span></div><//>
      <${GlassTile} status="done" soft edge="left"><div className="sk-label" style=${{ marginBottom: 14 }}>Doto 700 · every number</div>
        <div style=${{ display: 'flex', gap: 28, alignItems: 'flex-end', flexWrap: 'wrap' }}><${DotNumber} value="3.3" size="xl" status="done" /><${DotNumber} value="23" suffix="%" size="lg" status="working" /><${DotNumber} value="2h" size="sm" /><${DotNumber} value="12:08" size="xs" /></div><//>
    </div>
    <${H3}>Names to build on: CSS variables<//>
    <div className="sc-row" style=${{ gap: 10 }}>${['--sk-canvas', '--sk-text', '--sk-text-2', '--sk-text-3', '--sk-line', '--st-working', '--st-waiting', '--st-done', '--st-failed', '--st-idle', '--st-stopped', '--st-lead', '--sk-font-title', '--sk-font-mono', '--sk-font-dot', '--sk-radius-tile', '--sk-radius-pill', '--sk-ease', '--hue', '--glow'].map(name => html`<code key=${name} className="sk-badge" style=${{ textTransform: 'none', color: 'var(--sk-text-2)', background: 'rgba(255,255,255,.06)', boxShadow: 'inset 0 0 0 1px var(--sk-line)' }}>${name}</code>`)}</div>
    <${H3}>Diagram tokens: group region, connection lines, view toggle<//>
    <div className="sc-row" style=${{ gap: 30, alignItems: 'flex-start' }}>
      <${Cell} caption=".sk-group: faint glass, hue edge glow, radius 40"><div className="sk-group" data-status="working" style=${{ width: 300, height: 150 }}><div className="sk-group__label"><span className="sk-group__team">Booking App Team</span><span className="sk-label">storefront</span></div></div><//>
      <${Cell} caption=".sk-link: idle, working, needs you, failed, done, stopped">
        <svg width="320" height="170" viewBox="0 0 320 170" aria-hidden="true">${[['idle', 'M10 14C120 14 200 14 310 14'], ['working', 'M10 42C120 42 200 42 310 42'], ['waiting', 'M10 70C120 70 200 70 310 70'], ['failed', 'M10 98C120 98 200 98 310 98'], ['done', 'M10 126C120 126 200 126 310 126'], ['stopped', 'M10 154C120 154 200 154 310 154']].map(([status, d]) => html`<path key=${status} className=${`sk-link sk-link--${status}`} d=${d} />`)}
          <circle className="sk-pulse" r="3.2" cx="0" cy="0" style=${{ offsetPath: "path('M10 42C120 42 200 42 310 42')" }} /></svg><//>
      <${Cell} caption=".sk-seg: the Diagram / Space toggle"><div className="sk-seg" role="group" aria-label="View"><button type="button" className="sk-seg__item" aria-pressed="true">Diagram</button><button type="button" className="sk-seg__item" aria-pressed="false">Space</button></div><//>
    </div>
    <${H3}>Radii, glow, spacing<//>
    <div className="sc-row" style=${{ gap: 28, alignItems: 'flex-end' }}>
      ${[['pill 999', 999], ['tile 30', 30], ['sm 18', 18]].map(([cap, r]) => html`<${Cell} key=${cap} caption=${cap}><div style=${{ width: 120, height: 64, borderRadius: r, background: 'rgba(255,255,255,.07)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.12)' }}></div><//>`)}
      ${[['glow soft', 0.55], ['glow 1', 1], ['glow bright', 1.25]].map(([cap, glow]) => html`<${Cell} key=${cap} caption=${cap}><${GlassTile} status="working" style=${{ width: 120, height: 84, padding: 0, '--glow': glow }}></${GlassTile}><//>`)}
      <${Cell} caption="spacing 4 · 8 · 12 · 16 · 24 · 40"><div style=${{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>${[4, 8, 12, 16, 24, 40].map(s => html`<i key=${s} style=${{ width: s, height: s, background: 'var(--st-lead)', borderRadius: 3, opacity: 0.7, display: 'block' }}></i>`)}</div><//>
    </div>
  <//>`
}


export function mount(el) {
  const root = createRoot(el)
  root.render(html`<${Tokens} />`)
  return { dispose: () => root.unmount() }
}
