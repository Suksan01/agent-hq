// The live page's canvas: the 2D diagram (the default) or the 3D Space view, switched with a toggle, both fed the same groups, focus,
// selection and insets, so the chips, the drawer and the HUD around them do not care which one is showing. The choice is remembered
// in localStorage (try/catch). Where WebGL is off the toggle is not offered and the diagram stays; if WebGL is taken away while the
// Space view is open the page falls back to the diagram for this load only (the saved choice stays "space") and says so through `onNotice`.
//
// The Space component is passed in (`Space`), so a page that never opens it need not load three.js: the live page gets it with
// `useLazySpace(mode === 'space')` (lazyspace.js, a dynamic import); the design showcase passes SpaceView from ./spaceview.js.
//
//   const [mode, setMode, canSpace, fallBack] = useViewMode()
//   const Space = useLazySpace(mode === 'space')
//   html`<${LiveView} mode=${mode} Space=${Space} onFallback=${fallBack} onNotice=${text => toast(text)} groups=${...} focus=${...} selected=${...} inset=${...} onSelect=${...} />`
//   html`<${ViewToggle} mode=${mode} onChange=${setMode} />`        the Diagram / Space switch (nothing when WebGL is off)

import React from './vendor/libs.js'
import { html } from './spacekit.js'
import { t } from './i18n.js'
import { Diagram } from './diagram.js'
import { webglAvailable } from './webgl.js'
import { playNav } from './space-sounds.js'

const { useCallback, useMemo, useState } = React
export const VIEW_KEY = 'agent-hq.view'

const read = () => { try { return localStorage.getItem(VIEW_KEY) === 'space' ? 'space' : 'diagram' } catch { return 'diagram' } }
const write = mode => { try { localStorage.setItem(VIEW_KEY, mode) } catch { /* the choice lasts until the page closes */ } }

/** The view to show (the saved choice, unless WebGL is off or was lost), a setter that saves, whether Space can be offered, and `fallBack`: diagram for now, saved choice kept. */
export function useViewMode() {
  const canSpace = useMemo(() => webglAvailable(), [])
  const [stored, setStored] = useState(read)
  const [forced, setForced] = useState(false)
  const set = useCallback(mode => { setStored(mode); setForced(false); write(mode) }, [])
  const fallBack = useCallback(() => setForced(true), [])
  return [canSpace && !forced ? stored : 'diagram', set, canSpace, fallBack]
}

/** The Diagram / Space switch, in the kit's segmented toggle classes. Not shown when WebGL is off. */
export function ViewToggle({ mode, onChange, canSpace = webglAvailable() }) {
  if (!canSpace) return null
  return html`<div className="sk-seg" role="group" aria-label=${t('view.label')}>
    ${[['diagram', t('view.diagram')], ['space', t('view.space')]].map(([id, label]) => html`<button key=${id} type="button" className="sk-seg__item" aria-pressed=${mode === id} onClick=${() => { if (id !== mode) playNav('view'); onChange(id) }}>${label}</button>`)}
  </div>`
}

export function LiveView({ mode = 'diagram', Space = null, onFallback, onNotice, ...view }) {
  const lost = useCallback(() => { onFallback?.(); onNotice?.(t('view.lost')) }, [onFallback, onNotice])
  const failed = useCallback(() => { onFallback?.() }, [onFallback])
  // until the Space component has loaded (or where there is none) the diagram stays on screen
  return mode === 'space' && Space
    ? html`<${Space} key="space" ...${view} onContextLost=${lost} onError=${failed} />`
    : html`<${Diagram} key="diagram" ...${view} />`
}
