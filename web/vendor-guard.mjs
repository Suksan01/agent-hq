// The supply-chain checks for the shipped third-party code: the banned-pattern scan (shared with build-design.mjs) and
// web/vendor/SHA256SUMS, the hash of every vendor file as built.
//   node web/vendor-guard.mjs            verify: scan + hashes, exit 1 on any problem
//   node web/vendor-guard.mjs --write    scan, then rewrite SHA256SUMS (build-vendor.mjs does this after a build)

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUMS_FILE = 'SHA256SUMS'

// what no bundle we serve may do: run code from strings or reach the network on its own
export const BANNED = [
  ['eval(', /\beval\(/g],
  ['new Function', /new Function\(/g],
  ['fetch(', /[^.\w]fetch\(/g],
  ['XMLHttpRequest', /XMLHttpRequest/g],
  ['importScripts', /importScripts/g],
]

// An exact count per file and pattern; any other count (more or fewer) is a problem, so a new version is looked at again.
// three.module.js: FileLoader and ImageBitmapLoader call fetch() to load files the page itself names (the star field
// loads none: no loader is ever called), plus ImageBitmapLoader's "fetch() not supported" message. All three are three's own.
export const ALLOWED = { 'three.module.js': { 'fetch(': 3 } }

/** Remote loads in a stylesheet or page: a src/href or url() that is not a relative path. */
export const remoteLoads = text => [...text.matchAll(/(?:src|href)=["'](https?:)?\/\/[^"']+|url\(\s*["']?(https?:)?\/\/[^)"']+/g)].map(m => m[0])

const filesOf = dir => readdirSync(dir).filter(name => name !== SUMS_FILE && !name.startsWith('.')).sort()
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')

/** What the banned patterns and remote loads find in the vendor folder, beyond the allowlist. */
export function scanVendor(dir) {
  const problems = []
  for (const name of filesOf(dir)) {
    if (name.endsWith('.js')) {
      const text = readFileSync(join(dir, name), 'utf8')
      for (const [what, pattern] of BANNED) {
        const found = text.match(pattern)?.length ?? 0
        const allowed = ALLOWED[name]?.[what] ?? 0
        if (found !== allowed) problems.push(`${name} has ${found} x ${what} (${allowed} allowed)`)
      }
    } else if (name.endsWith('.css')) {
      const remote = remoteLoads(readFileSync(join(dir, name), 'utf8'))
      if (remote.length > 0) problems.push(`${name} loads from the network: ${remote.join(', ')}`)
    }
  }
  return problems
}

/** The SHA256SUMS text for the folder: `<hash>  <name>` per file, sorted by name. */
export const sumsOf = dir => filesOf(dir).map(name => `${sha256(join(dir, name))}  ${name}`).join('\n') + '\n'

/** Every file against SHA256SUMS: changed, missing and unlisted files are problems. */
export function verifySums(dir) {
  let listed
  try {
    listed = readFileSync(join(dir, SUMS_FILE), 'utf8')
  } catch {
    return [`${SUMS_FILE} is missing`]
  }
  const expected = Object.fromEntries(listed.split('\n').filter(Boolean).map(line => [line.slice(66), line.slice(0, 64)]))
  const actual = Object.fromEntries(sumsOf(dir).split('\n').filter(Boolean).map(line => [line.slice(66), line.slice(0, 64)]))
  return [
    ...Object.keys(actual).filter(name => expected[name] && expected[name] !== actual[name]).map(name => `${name} does not match ${SUMS_FILE}`),
    ...Object.keys(actual).filter(name => !expected[name]).map(name => `${name} is not listed in ${SUMS_FILE}`),
    ...Object.keys(expected).filter(name => !actual[name]).map(name => `${name} is listed in ${SUMS_FILE} but missing`),
  ]
}

/** Scans, then writes SHA256SUMS; returns the scan's problems (nothing is written when there are any). */
export function writeSums(dir) {
  const problems = scanVendor(dir)
  if (problems.length === 0) writeFileSync(join(dir, SUMS_FILE), sumsOf(dir))
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'vendor')
  const problems = process.argv.includes('--write') ? writeSums(dir) : [...scanVendor(dir), ...verifySums(dir)]
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  console.log(process.argv.includes('--write') ? `${SUMS_FILE} written` : 'vendor files match SHA256SUMS and pass the scan')
}
