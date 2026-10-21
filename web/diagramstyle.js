// The diagram's and the space view's styles, as a string the components put in the page once (so a page that bundles its scripts
// into one file needs no extra stylesheet). They sit on space.css, which has the tokens and the cards.

const CSS = String.raw`/* The live diagram (diagram.js): groups, connections and cards on the space canvas. Needs space.css (tokens, glass, cards). */

.dg { position: relative; overflow: hidden; touch-action: none; cursor: grab; user-select: none; -webkit-user-select: none; width: 100%; height: 100%; }
.dg:active { cursor: grabbing; }
.dg-world { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
.dg-world--ease { transition: transform 0.55s var(--sk-ease); }

/* a session: a very faint glass region with a glow at its edge in the hue of what is going on in it */
.dg-group {
  --ghue: var(--st-lead);
  position: absolute;
  border-radius: 40px;
  background:
    radial-gradient(90% 60% at 50% 0%, color-mix(in srgb, var(--ghue) 13%, transparent), transparent 70%),
    rgba(255, 255, 255, 0.018);
  border: 1px solid rgba(255, 255, 255, 0.075);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 0 120px -70px var(--ghue), 0 0 110px -50px var(--ghue);
}
.dg-header { position: absolute; left: 52px; top: 42px; right: 52px; pointer-events: none; }
.dg-team { margin: 0; font: 700 40px/1.05 var(--sk-font-title); letter-spacing: -0.02em; color: var(--sk-text); text-shadow: 0 0 40px color-mix(in srgb, var(--ghue) 55%, transparent); }
.dg-folder { margin-top: 12px; font-size: 12px; }

/* what moves on a card moves only under the pointer (or the focus): twenty cards breathing at once cost the GPU more than they tell */
.dg-node:not(:hover):not(:focus-within) :is(.sk-blob, .sk-blob *, .sk-bar, .sk-bar *, .sk-orb, .sk-orb *, .sk-beam, .sk-beam *, .sk-agent, .sk-agent *),
.spv-card:not(:hover):not(:focus-within) :is(.sk-blob, .sk-blob *, .sk-bar, .sk-bar *, .sk-orb, .sk-orb *, .sk-beam, .sk-beam *, .sk-agent, .sk-agent *) { animation: none !important; }

/* a session that has gone (alive: false): dimmed, and nothing in it moves */
.dg-group--lost, .dg-node--lost, .spv-card.is-placed.spv-card--lost, .spv-chip.is-placed.spv-chip--lost { opacity: 0.45; }
.dg-node--lost *, .dg-node--lost *::before, .dg-node--lost *::after, .spv-card--lost *, .spv-card--lost *::before, .spv-card--lost *::after { animation: none !important; }

/* the connections: quiet dotted lines, a glowing line with a travelling light for work, amber for what needs the person */
.dg-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.dg-edge__line { fill: none; stroke: rgba(255, 255, 255, 0.22); stroke-width: 1.6; stroke-dasharray: 1.5 7; stroke-linecap: round; }
.dg-edge--working .dg-edge__line { stroke: color-mix(in srgb, var(--hue) 70%, #fff); stroke-dasharray: none; stroke-width: 2; opacity: 0.9; }
.dg-edge--waiting .dg-edge__line { stroke: var(--hue); stroke-dasharray: 2 6; stroke-width: 2.4; opacity: 0.95; }
/* the glow is a wide faint stroke and the light's halo a wide faint outline: no blur filters, which the GPU pays for every frame */
.dg-edge__glow { fill: none; stroke: var(--hue); stroke-width: 9; stroke-linecap: round; opacity: 0.14; }
.dg-pulse { position: absolute; left: 0; top: 0; width: 8px; height: 8px; border-radius: 50%; background: #fff; pointer-events: none; will-change: transform; offset-rotate: 0deg; animation: dg-travel 2.8s linear infinite;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--hue) 35%, transparent), 0 0 10px 2px var(--hue); }
@keyframes dg-travel { from { offset-distance: 0%; } to { offset-distance: 100%; } }

/* cards */
.dg-node { position: absolute; }
.dg-node--lead { z-index: 3; }
.dg-node--talk { z-index: 5; } /* its bubble stands over the cards around it */
.dg-measure { width: max-content; }
.dg-full { display: none; position: absolute; left: 0; top: 0; z-index: 30; }
.dg-node--compact:hover, .dg-node--compact:focus-within { z-index: 40; }
.dg-node--compact:hover .dg-full, .dg-node--compact:focus-within .dg-full { display: block; }
.dg-node--needs .sk-agent { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 0 1.5px var(--st-waiting), 0 0 46px -10px var(--st-waiting); }

.dg--still .dg-world--ease { transition: none; }
@media (prefers-reduced-motion: reduce) { .dg-world--ease { transition: none; } }

/* ---------- the space view (spaceview.js): the 3D scene with the cards and titles laid over it ---------- */
.spv { position: relative; width: 100%; height: 100%; overflow: hidden; background: #050507; color: var(--sk-text); font-family: var(--sk-font-title); }
.spv *, .spv *::before, .spv *::after { box-sizing: border-box; }
.spv-scene { position: absolute; inset: 0; }
.spv-overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.spv-leaders { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.spv-leader { stroke: rgba(255, 255, 255, 0.3); stroke-width: 1; stroke-dasharray: 2 4; stroke-linecap: round; fill: none; }
.spv-card, .spv-chip { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; opacity: 0; transition: opacity 250ms; transform-origin: 0 0; }
.spv-card.is-placed, .spv-chip.is-placed { pointer-events: auto; opacity: 1; }
.spv-measure { width: max-content; }
.spv-card--compact .spv-full { display: none; position: absolute; left: 0; top: 0; z-index: 30; }
.spv-card--compact:hover, .spv-card--compact:focus-within { z-index: 40; }
.spv-card--compact:hover .spv-full, .spv-card--compact:focus-within .spv-full { display: block; }
.spv-card--talk { z-index: 5; }
.spv-next { position: absolute; left: 0; top: 100%; width: 100%; } /* the lead's next steps hang under its deck, outside the measured box the slots fit */
.spv-card:has(.lc-next) { z-index: 6; }
.spv-next:empty { display: none; }
.spv-card--needs .sk-agent { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 0 0 1.5px var(--st-waiting), 0 0 46px -10px var(--st-waiting); }
.spv-chip {
  --hue: var(--st-idle);
  display: inline-flex; align-items: center; gap: 8px; max-width: 200px; padding: 6px 14px 6px 10px; border: 0; border-radius: 999px; color: var(--sk-text); font: 500 13px var(--sk-font-title); cursor: pointer;
  background: linear-gradient(135deg, color-mix(in srgb, var(--hue) 22%, rgba(20, 20, 32, 0.8)), rgba(10, 10, 18, 0.8)); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 0 24px -8px var(--hue);
}
.spv-chip--lead { padding: 0; background: none; box-shadow: none; max-width: none; border-radius: 0; }
.spv-chip i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--hue); box-shadow: 0 0 10px var(--hue); }
.spv-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spv-title { position: absolute; left: 0; top: 0; text-align: center; white-space: nowrap; pointer-events: none; will-change: transform; opacity: 0; transition: opacity 250ms; }
.spv-title.is-placed { opacity: 1; }
.spv-title h2 { margin: 0; font: 700 30px/1.05 var(--sk-font-title); letter-spacing: -0.02em; text-shadow: 0 0 34px rgba(138, 107, 255, 0.7); }
.spv-title .sk-label { margin-top: 8px; font-size: 11px; }
.spv-loading { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.spv-note { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; }
.spv-note .sk-tile { max-width: 520px; padding: 28px 30px; display: grid; gap: 10px; text-align: left; }
.spv-note h3 { margin: 0; font: 700 22px/1.1 var(--sk-font-title); }
.spv-note p { margin: 0; font: 400 14px/1.55 var(--sk-font-title); color: var(--sk-text-2); }
`

/** Adds the styles to the page, once. */
export function ensureStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-hq-diagram]')) return
  const style = document.createElement('style')
  style.dataset.hqDiagram = ''
  style.textContent = CSS
  document.head.append(style)
}
