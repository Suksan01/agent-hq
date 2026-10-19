// The Agent HQ space design system, shown whole. This is the shell: it frames each section (a heading, an intro, a
// container) and mounts that section's module into it. What is on the page is the real kit (space.css, blobs.js,
// spacekit.js), so what is approved here is what ships. Nothing here fetches, evals or loads from a CDN.
//
// A section module exports `mount(el)` and returns `{ dispose() }` (or nothing); `el` is an empty container the shell
// has framed. Modules that draw their own heading (components, patterns) set `inner: true` below: the shell still
// frames them (so the heading and anchor exist before they mount) and hides their own heading. Modules import only from ../../vendor/libs.js, ../../spacekit.js, ../../blobs.js and ../frame.js.

import React, { createRoot } from '../vendor/libs.js'
import { SpaceCanvas, StatusPill, html } from '../spacekit.js'
import { pauseOffscreen } from '../motion.js'
import * as tokens from './sections/tokens.js'
import * as mascots from './sections/mascots.js'
import * as components from './sections/components.js'
import * as leadcard from './sections/leadcard.js'
import * as diagram from './sections/diagram.js'
import * as space from './sections/space.js'
import * as planets from './sections/planets.js'
import * as sounds from './sections/sounds.js'
import * as terminal from './sections/terminal.js'

const reactSection = Component => el => {
  const root = createRoot(el)
  root.render(html`<${Component} />`)
  return { dispose: () => root.unmount() }
}

export const SECTIONS = [
  { id: 'tokens', est: 1500, title: 'Tokens', lede: 'Deep space at night. A near-black canvas, light that bleeds from inside glass, three typefaces with one job each. Colour means state; nothing is outlined.', mount: tokens.mount },
  { id: 'mascots', est: 1900, title: 'Mascots', lede: 'Every agent is a glow blob: a puffy 4 to 7 lobed body, an indigo-to-violet glow, a swirl of its own hue, sometimes an icon, and a face that says how it is.', mount: mascots.mount },
  { id: 'components', est: 3600, title: 'Components', lede: 'Every kit component in every state it can be in. Hover and focus are pinned so they show on a still page.', inner: true, mount: reactSection(components.Components) },
  { id: 'leadcard', est: 1300, title: 'Lead card', lede: "The lead gets its own command deck, not a bigger agent card: the lead's star at its core, the team's progress as a ring around it, the crew as small blobs, big crew counts, a mission board and quick actions.", mount: leadcard.mount },
  { id: 'patterns', est: 2000, title: 'Patterns', lede: 'How the components come together on the live page: the title HUD, a grid of agents, the drawer, the feed, the inbox and the bottom bar.', inner: true, mount: reactSection(components.Patterns) },
  { id: 'diagram', est: 820, title: 'Live diagram', lede: 'The default view of the page: each session a group of glass cards joined by lines that glow with the work. The toggle switches to the optional space view.', mount: diagram.mount },
  { id: 'space', est: 900, heavy: true, title: 'Space view (optional)', lede: 'The same sessions as 3D star systems: the lead is the star, members orbit on thin dotted rings, helpers are moons. Drag to orbit, wheel to zoom, right-drag to pan. It needs WebGL and sits behind the toolbar toggle; the flat diagram stays the default.', mount: space.mount },
  { id: 'planets', est: 1500, title: 'Planets', lede: 'In the space view every agent is its own world: twelve kinds in six colour families, 72 in all, never two alike on screen. The same agent always gets the same planet. The lead is the star, helpers are moons.', mount: planets.mount },
  { id: 'sounds', est: 520, title: 'Sounds', lede: 'Soft spacey blips for done, needs you, failed, started and level up. Press play.', mount: sounds.mount },
  { id: 'terminal', est: 1100, title: 'Terminal', lede: 'The same palette in the sidebar and the band above the prompt: a deep black panel, status hues, the blobs redrawn as 12 by 10 half-block sprites, progress as a glowing track on a dim dotted one, the lead marked with a violet star.', mount: terminal.mount },
]

const NEAR = '1100px 0px' // a section is mounted while it is this close to the viewport, and unmounted when it is farther
const { useEffect, useRef, useState } = React

/**
 * One section: the frame the shell draws, and the container its module fills. A section mounts when it scrolls near (so the page
 * starts with the first screen's work only) and unmounts when it is far away again, keeping the room it took, so the DOM stays small.
 * A module that throws leaves a note, not a blank page.
 */
function Section({ spec }) {
  const frame = useRef(null)
  const host = useRef(null)
  const [active, setActive] = useState(false)
  const [height, setHeight] = useState(spec.est ?? 600)
  useEffect(() => {
    const watcher = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setActive(true)
      else setActive(false) // far away: its DOM, canvases and animations go, its height stays
    }, { rootMargin: NEAR })
    watcher.observe(frame.current)
    return () => watcher.disconnect()
  }, [])
  useEffect(() => {
    if (!active) return
    let live
    try {
      live = spec.mount(host.current)
      if (spec.inner) host.current.querySelectorAll('section[id]').forEach(el => el.removeAttribute('id')) // the shell's frame owns the anchor
    } catch (error) {
      console.warn(`section "${spec.id}" did not start`, error)
      host.current.textContent = `The ${spec.title} section did not start.`
    }
    return () => {
      setHeight(host.current?.offsetHeight || spec.est || 600) // keep the room it took, so the page does not jump
      live?.dispose?.()
    }
  }, [active])
  // a module that draws its own heading (`inner`) keeps its content; the shell's frame carries the heading and the anchor, so
  // both exist before the module mounts, and the module's own copies are hidden by index.html
  return html`<section ref=${frame} id=${spec.id} className="sc-sec" style=${{ '--sc-h': `${height}px` }}><h2>${spec.title}</h2><p className="sc-lede">${spec.lede}</p><div ref=${host} data-section=${spec.id} className=${spec.inner ? 'sc-inner' : undefined} style=${{ minHeight: active ? undefined : height }}></div></section>`
}

/** Scrolls to a section: its frame, or (for sections that draw their own) the section element they made. */
const goTo = id => event => {
  event.preventDefault()
  const target = document.getElementById(id) ?? document.querySelector(`[data-section="${id}"]`)
  target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}

function App() {
  return html`<${SpaceCanvas} style=${{ minHeight: '100vh' }}>
    <div className="sc-wrap">
      <nav className="sc-nav">${SECTIONS.map(s => html`<a key=${s.id} href=${`#${s.id}`} onClick=${goTo(s.id)}>${s.title}</a>`)}</nav>
      <header className="sc-hero">
        <span className="sk-label">Agent HQ · design system · space</span>
        <h1>A calm place for a busy team.</h1>
        <p>Deep space at night. Glass that glows from inside, dot-matrix numbers, little blob creatures that show how each agent feels. This page is the real kit: what you approve here is what ships.</p>
        <div className="sc-row"><${StatusPill} status="working" /><${StatusPill} status="waiting" /><${StatusPill} status="done" /><${StatusPill} status="failed" /></div>
      </header>
      ${SECTIONS.map(spec => html`<${Section} key=${spec.id} spec=${spec} />`)}
    </div>
  <//>`
}

createRoot(document.getElementById('app')).render(html`<${App} />`)
pauseOffscreen(document.getElementById('app'))
