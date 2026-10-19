// Guards for the live page's idle cost: no root re-render timer, no main-thread animation on idle cards, still islands.
// Static checks on the page's source (the page itself needs a browser).   node --test web/perf.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { islandCss } from './islands.js'

const WEB = dirname(fileURLToPath(import.meta.url))
const app = readFileSync(join(WEB, 'app.js'), 'utf8')
const page = readFileSync(join(WEB, 'index.html'), 'utf8')

test('the page has no timer that re-renders the whole tree: the pixel sprite counts its own frames, only while its agent works', () => {
  const root = app.slice(app.indexOf('function App()'))
  assert.ok(!/setBeat/.test(root), 'no beat state in App')
  assert.ok(!/beat=\$\{beat\}/.test(app), 'no beat passed down as a prop')
  const hook = app.slice(app.indexOf('function useBeat'), app.indexOf('function PixelBot'))
  assert.match(hook, /if \(!active\) return/, 'no timer unless the agent works')
  assert.match(hook, /document\.hidden/, 'no tick in a hidden tab')
  assert.match(app, /<\$\{PixelBot\} mascot=\$\{mascot\} running=\$\{tone === 'running'\}/)
})

test('avatars of agents that are not working are paused', () => {
  assert.match(app, /paused=\$\{tone !== 'running'\}/)
})

test('the card glow turns by transform, only on a working card, and animates no registered custom property', () => {
  assert.ok(!/@property/.test(page), 'no @property animation')
  assert.ok(!/--angle/.test(page))
  assert.match(page, /\.node\[data-tone="running"\] \.glow::before \{ animation: spin/)
  assert.match(page, /@keyframes spin \{ to \{ transform:/)
  assert.ok(!/\.node \.glow \{[^}]*animation/.test(page), 'the idle glow has no animation')
})

test('a hidden tab and an off-screen island or card hold their animations', () => {
  assert.match(page, /html\[data-hidden\] \*[^{]*\[data-offscreen\][^{]*\{ animation-play-state: paused !important/)
  assert.match(app, /toggleAttribute\('data-hidden', document\.hidden\)/)
  assert.match(app, /IntersectionObserver/)
  assert.match(app, /toggleAttribute\('data-offscreen'/)
})

test('only a busy island animates; a stormy one keeps its rain and lightning', () => {
  assert.match(islandCss, /\.isl:not\(\.isl-busy\) \*\{animation-play-state:paused\}/)
  assert.match(islandCss, /\.isl-stormy \.isl-rain,\.isl-stormy \.isl-flash\{animation-play-state:running\}/)
})

test('an idle page has no endless animation: the lead halo and the live dot ring run only while something works', () => {
  assert.ok(!/\.node\.lead::before \{[^}]*animation/.test(page), 'the halo is not always on')
  assert.match(page, /\.node\.lead\[data-tone="running"\]::before \{ animation: halo/)
  assert.ok(!/\.live i \{[^}]*animation/.test(page), 'the live dot does not ping while idle')
  assert.match(page, /\.live\.busy i::after \{[^}]*animation: ping/)
  assert.match(page, /@keyframes ping \{ 0% \{ transform: scale\(1\); opacity: 1; \} 80%, 100% \{ transform: scale\(2\.8\); opacity: 0; \} \}/, 'transform and opacity only')
  assert.match(app, /' busy'/)
})
