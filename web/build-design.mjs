// Builds the design-system showcase for the space theme into a folder that opens from file://, offline:
//   node web/build-design.mjs [out-folder]
// Default out: web/design/out (inside the mod, git-ignored, not shipped). The folder must be new, empty, or one this script
// made before (it holds `.agent-hq-design`): the script replaces its own files there, so anything else is refused, never cleaned.
// The page's modules cannot load from file:// (browsers refuse module imports there), so everything is bundled into one
// classic script, showcase.bundle.js, plus engine.chunk.js: three.js and the star-system engine as a second classic script
// that the page adds only when the Space view is first shown. The folder gets: index.html, space.css, vendor/fonts.css +
// the space fonts + their licences, showcase.bundle.js, engine.chunk.js and src/ (the readable sources). Nothing is fetched, evaluated or loaded from a CDN; the
// script ends by checking its own output for that and for absolute URLs.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BANNED, remoteLoads } from './vendor-guard.mjs'

const ESBUILD = 'esbuild@0.28.2'
const WEB = dirname(fileURLToPath(import.meta.url))
const MARKER = '.agent-hq-design'
const OUT = resolve(process.argv[2] ?? join(WEB, 'design/out'))
const SPACE_FONT = /^(doto|space-grotesk|jetbrains-mono)-/

// before anything is removed: a folder that is not ours (a project, a home folder, `.`) is never written to
if (existsSync(OUT) && (!statSync(OUT).isDirectory() || (readdirSync(OUT).length > 0 && !existsSync(join(OUT, MARKER))))) {
  console.error(`${OUT} is not empty and was not made by build-design.mjs (no ${MARKER} in it); give a new or empty folder`)
  process.exit(2)
}
// what this script makes is replaced; anything else in the folder (notes, hand-made pages) is left alone
const page0 = readFileSync(join(WEB, 'design/index.html'), 'utf8')
// the stylesheets the page links from the mod source (`../space.css`, `../diagram.css`, ...) come along beside index.html
const STYLESHEETS = [...page0.matchAll(/<link[^>]*href="\.\.\/([A-Za-z0-9_-]+\.css)"/g)].map(m => m[1])
for (const generated of ['index.html', 'showcase.bundle.js', 'engine.chunk.js', 'src', 'vendor', ...STYLESHEETS]) rmSync(join(OUT, generated), { recursive: true, force: true })
mkdirSync(join(OUT, 'vendor'), { recursive: true })
writeFileSync(join(OUT, MARKER), 'made by web/build-design.mjs: it replaces index.html, showcase.bundle.js, src/, vendor/ and the stylesheets here\n')
mkdirSync(join(OUT, 'src'), { recursive: true })

// the page: the same index.html, pointed at the copied files and the classic bundle
const page = page0
  .replace('href="../vendor/fonts.css"', 'href="vendor/fonts.css"')
  .replace(/href="\.\.\/([A-Za-z0-9_-]+\.css)"/g, 'href="$1"')
  .replace('<script type="module" src="showcase.js"></script>', '<script src="showcase.bundle.js" defer></script>')
writeFileSync(join(OUT, 'index.html'), page)
for (const sheet of STYLESHEETS) copyFileSync(join(WEB, sheet), join(OUT, sheet))

// fonts: only the space theme's faces (Doto, Space Grotesk, JetBrains Mono), with their licence texts
const faces = readFileSync(join(WEB, 'vendor/fonts.css'), 'utf8').split(/\n\s*\n/).filter(block => /font-family: '(Doto|Space Grotesk|JetBrains Mono)'/.test(block))
writeFileSync(join(OUT, 'vendor/fonts.css'), faces.join('\n\n') + '\n')
for (const file of readdirSync(join(WEB, 'vendor')).filter(name => name.endsWith('.woff2') && SPACE_FONT.test(name))) copyFileSync(join(WEB, 'vendor', file), join(OUT, 'vendor', file))
for (const file of ['OFL.txt', 'MIT.txt', 'LICENSES.txt']) if (existsSync(join(WEB, 'vendor', file))) copyFileSync(join(WEB, 'vendor', file), join(OUT, 'vendor', file))

// two classic scripts, minified: the page (React, htm, border-beam, thinking-orbs, liquid-gooey and the kit) and the lazy
// engine chunk (three.js and the star system), which the page injects when the Space view is first shown.
// `fetch` is cut out (three.js carries a loader we never call), so the page cannot fetch even by accident.
const BUNDLES = [
  { entry: 'design/showcase.js', file: 'showcase.bundle.js' },
  { entry: 'design/enginechunk.js', file: 'engine.chunk.js' },
]
const metas = []
for (const { entry, file } of BUNDLES) {
  if (!existsSync(join(WEB, entry))) continue
  const meta = join(OUT, `src/.meta-${file}.json`)
  execFileSync(
    'npx',
    [
      '-y', ESBUILD, join(WEB, entry), '--bundle', '--minify', '--format=iife', '--target=es2022', '--legal-comments=none',
      '--define:process.env.NODE_ENV="production"', '--define:fetch=undefined', '--define:window.fetch=undefined', '--define:globalThis.fetch=undefined',
      `--outfile=${join(OUT, file)}`, `--metafile=${meta}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )
  metas.push(JSON.parse(readFileSync(meta, 'utf8')))
  rmSync(meta)
}

// readable copies in src/: the stylesheets and every source file the bundles were made from (not the vendored libraries,
// which are minified), named by their path in web/ with the slashes turned to dashes
const inputs = metas.flatMap(meta => Object.keys(meta.inputs))
const sources = [...STYLESHEETS, ...inputs.map(file => relative(WEB, resolve(file)))].filter(file => !file.startsWith('..') && !file.startsWith('vendor/'))
for (const file of new Set(sources)) copyFileSync(join(WEB, file), join(OUT, 'src', file.replaceAll('/', '-')))

// the policy check: no remote loads, no fetch, no eval, only relative paths
const problems = []
for (const { file } of BUNDLES) {
  if (!existsSync(join(OUT, file))) continue
  const bundle = readFileSync(join(OUT, file), 'utf8')
  for (const [what, pattern] of BANNED) {
    if (bundle.match(pattern)) problems.push(`${file} uses ${what}`)
  }
}
for (const file of ['index.html', ...STYLESHEETS, 'vendor/fonts.css']) {
  const text = readFileSync(join(OUT, file), 'utf8')
  const remote = remoteLoads(text)
  if (remote.length > 0) problems.push(`${file} loads from the network: ${remote.join(', ')}`)
}
const bytes = readdirSync(OUT, { recursive: true }).filter(f => statSync(join(OUT, f)).isFile()).reduce((sum, f) => sum + statSync(join(OUT, f)).size, 0)
console.log(`${OUT}\n${readdirSync(OUT).join(', ')}\n${Math.round(bytes / 1024)} KB`)
if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
