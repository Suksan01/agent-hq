// Loads the 3D engine (starsystem.js with three.js, 0.7 MB) the first time the Space view is shown, so a page that only ever shows the
// diagram never fetches or parses it. On the live page it is an ES module imported on demand. The design showcase is one classic script
// (it must open from file://, where modules cannot be loaded), so its sections call `setEngineChunk('engine.chunk.js')`: the build makes
// the engine a classic script of its own that puts itself on `globalThis.__hqEngine` when it runs (design/enginechunk.js), and this
// injects it beside the page.

const ENGINE = './starsystem.js' // in a variable so a bundler leaves the import alone
let chunk = null
let loading = null

/** Where the engine's classic script is, relative to the page; without it the engine is imported as a module. */
export const setEngineChunk = src => { chunk = src }

function injectScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = () => (globalThis.__hqEngine ? resolve(globalThis.__hqEngine) : reject(new Error(`${src} loaded but did not start the engine`)))
    script.onerror = () => reject(new Error(`${src} could not be loaded; build the showcase again`))
    document.head.append(script)
  })
}

/** The engine's exports ({ createStarSystems, ... }), once; a failed load can be tried again. */
export function loadEngine() {
  loading ??= (globalThis.__hqEngine ? Promise.resolve(globalThis.__hqEngine) : chunk ? injectScript(chunk) : import(ENGINE))
  loading.catch(() => { loading = null })
  return loading
}
