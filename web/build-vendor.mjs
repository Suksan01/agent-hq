// Rebuilds web/vendor/ (the page's only third-party code, served by server.mjs from this machine instead of a CDN).
//   node web/build-vendor.mjs
// Installs the packages pinned in vendor-build/package-lock.json (versions and hashes of every transitive package) with
// `npm ci` into a temp dir (never into the mod), bundles them into one minified ESM file with the locked esbuild, and
// copies the fonts. Then scans the result for banned patterns and writes vendor/SHA256SUMS (see
// vendor-guard.mjs). To change a version: edit vendor-build/package.json, run `npm install --package-lock-only
// --ignore-scripts` there, and review the lock's diff. Needs network + npm; the output is committed, so end users never run it.

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeSums } from './vendor-guard.mjs'

// every pinned version (vendor-build/package.json) was published at least two weeks before it was pinned; all are MIT or SIL OFL 1.1
const ENTRY = `import React from 'react'
export default React
export { Children, Fragment, StrictMode, Suspense, cloneElement, createContext, createElement, createRef, forwardRef, isValidElement, lazy, memo, startTransition, use, useActionState, useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useOptimistic, useReducer, useRef, useState, useSyncExternalStore, useTransition } from 'react'
export { createRoot } from 'react-dom/client'
export { default as htm } from 'htm'
export { BorderBeam } from 'border-beam'
export { ThinkingOrb } from 'thinking-orbs'
export { Liquid } from 'liquid-gooey'
`
// three.js is its own file (the live page's star field imports it, the design page too): the whole library, minified
const THREE_ENTRY = `export * from 'three'\n`

// the space theme's fonts: Doto (dot-matrix numerals), Space Grotesk (titles), JetBrains Mono (small labels)
const SPACE_FONTS = [
  { pkg: 'doto', family: 'Doto', weights: [400, 700, 900] },
  { pkg: 'space-grotesk', family: 'Space Grotesk', weights: [400, 500, 700] },
  { pkg: 'jetbrains-mono', family: 'JetBrains Mono', weights: [400] },
]
const FONT_WEIGHTS = [500, 700, 800]
const LATIN_RANGE = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const fontFace = (weight, family = 'Bricolage Grotesque', file = 'bricolage-grotesque') => `@font-face {
  font-family: '${family}';
  font-style: normal;
  font-display: swap;
  font-weight: ${weight};
  src: url(./${file}-latin-${weight}.woff2) format('woff2');
  unicode-range: ${LATIN_RANGE};
}
`

const WEB = dirname(fileURLToPath(import.meta.url))
const vendorDir = join(WEB, 'vendor')
const work = mkdtempSync(join(tmpdir(), 'agent-hq-vendor-'))
const run = (cmd, args) => execFileSync(cmd, args, { cwd: work, stdio: ['ignore', 'inherit', 'inherit'] })
try {
  for (const file of ['package.json', 'package-lock.json']) copyFileSync(join(WEB, 'vendor-build', file), join(work, file))
  writeFileSync(join(work, 'entry.js'), ENTRY)
  writeFileSync(join(work, 'three-entry.js'), THREE_ENTRY)
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']) // exactly the locked tree; fails if package.json and the lock disagree
  const esbuild = join(work, 'node_modules/.bin/esbuild')
  mkdirSync(vendorDir, { recursive: true })
  run(esbuild, [
    'entry.js', '--bundle', '--minify', '--format=esm', '--target=es2022', '--legal-comments=none',
    '--define:process.env.NODE_ENV="production"', `--outfile=${join(vendorDir, 'libs.js')}`,
  ])
  run(esbuild, [
    'three-entry.js', '--bundle', '--minify', '--format=esm', '--target=es2022', '--legal-comments=none',
    `--outfile=${join(vendorDir, 'three.module.js')}`,
  ])
  // the page's font (SIL OFL 1.1: the licence text travels with the files)
  const font = join(work, 'node_modules/@fontsource/bricolage-grotesque')
  for (const weight of FONT_WEIGHTS) {
    copyFileSync(join(font, `files/bricolage-grotesque-latin-${weight}-normal.woff2`), join(vendorDir, `bricolage-grotesque-latin-${weight}.woff2`))
  }
  const faces = FONT_WEIGHTS.map(w => fontFace(w))
  const licences = [`Bricolage Grotesque\n${readFileSync(join(font, 'LICENSE'), 'utf8')}`]
  for (const { pkg, family, weights } of SPACE_FONTS) {
    const dir = join(work, 'node_modules/@fontsource', pkg)
    for (const weight of weights) {
      copyFileSync(join(dir, `files/${pkg}-latin-${weight}-normal.woff2`), join(vendorDir, `${pkg}-latin-${weight}.woff2`))
      faces.push(fontFace(weight, family, pkg))
    }
    licences.push(`${family}\n${readFileSync(join(dir, 'LICENSE'), 'utf8')}`)
  }
  writeFileSync(join(vendorDir, 'fonts.css'), faces.join('\n'))
  // every font's licence text travels with the files; the libraries' MIT licences are listed beside them
  writeFileSync(join(vendorDir, 'OFL.txt'), licences.join('\n\n==========================================\n\n'))
  // (--legal-comments=none strips the notices from the bundles, so every bundled library's licence (MIT, and Apache-2.0 for htm) is kept here)
  const LIBRARIES = ['react', 'react-dom', 'htm', 'border-beam', 'thinking-orbs', 'liquid-gooey', 'three']
  const mit = LIBRARIES.map(name => {
    const version = JSON.parse(readFileSync(join(work, 'node_modules', name, 'package.json'), 'utf8')).version
    return `${name} ${version}\n${readFileSync(join(work, 'node_modules', name, 'LICENSE'), 'utf8')}`
  })
  writeFileSync(join(vendorDir, 'LICENSES.txt'), mit.join('\n\n==========================================\n\n'))
  for (const name of ['libs.js', 'three.module.js', 'fonts.css']) console.error(`${name}: ${statSync(join(vendorDir, name)).size} bytes`)
  const problems = writeSums(vendorDir) // the scan first: SHA256SUMS is written only for a clean build
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
