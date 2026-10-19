// Loads the Space view (and with it three.js, 0.7 MB) only when it is first asked for, so the default diagram page never pays for it.
// Not for the design showcase, which bundles its scripts into one file and passes SpaceView in directly.

import React from './vendor/libs.js'

const { useEffect, useState } = React
let loading = null

/** The SpaceView component once `active` has been true and the module has arrived; null until then (and if it cannot load). */
export function useLazySpace(active) {
  const [Space, setSpace] = useState(null)
  useEffect(() => {
    if (!active || Space) return
    loading ??= import('./spaceview.js')
    loading.then(module => setSpace(() => module.SpaceView)).catch(error => { console.warn('Agent HQ: the Space view did not load', error); loading = null })
  }, [active, Space])
  return Space
}
