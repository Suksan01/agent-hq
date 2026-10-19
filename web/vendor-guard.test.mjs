// Tests for the supply-chain checks on web/vendor: the committed hashes, the banned-pattern scan and the vendor build's lock.
//   node --test web/vendor-guard.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SUMS_FILE, scanVendor, sumsOf, verifySums, writeSums } from './vendor-guard.mjs'

const WEB = dirname(fileURLToPath(import.meta.url))
const VENDOR = join(WEB, 'vendor')

const scratch = t => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hq-guard-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('every vendor file matches the committed SHA256SUMS, and none is missing or unlisted', () => {
  assert.deepEqual(verifySums(VENDOR), [])
  assert.match(readFileSync(join(VENDOR, SUMS_FILE), 'utf8'), /^[0-9a-f]{64} {2}libs\.js$/m)
})

test('the committed vendor files pass the banned-pattern scan (three\'s own fetch calls are the only allowance)', () => {
  assert.deepEqual(scanVendor(VENDOR), [])
})

test('a changed, an added and a removed vendor file are each reported', t => {
  const dir = scratch(t)
  writeFileSync(join(dir, 'a.js'), 'export const a = 1')
  writeFileSync(join(dir, 'b.css'), 'body{}')
  assert.deepEqual(writeSums(dir), [])
  assert.deepEqual(verifySums(dir), [])

  writeFileSync(join(dir, 'a.js'), 'export const a = 2')
  writeFileSync(join(dir, 'c.js'), '')
  rmSync(join(dir, 'b.css'))

  assert.deepEqual(verifySums(dir).sort(), [`a.js does not match ${SUMS_FILE}`, `b.css is listed in ${SUMS_FILE} but missing`, `c.js is not listed in ${SUMS_FILE}`])
})

test('a vendor folder without SHA256SUMS is a problem', t => {
  assert.deepEqual(verifySums(scratch(t)), [`${SUMS_FILE} is missing`])
})

test('the scan flags eval, new Function, fetch, XMLHttpRequest, importScripts and remote css loads', t => {
  const dir = scratch(t)
  writeFileSync(join(dir, 'bad.js'), 'eval("1");new Function("x");fetch("/a");new XMLHttpRequest();importScripts("x")')
  writeFileSync(join(dir, 'bad.css'), '@font-face{src:url(https://cdn.example/x.woff2)}')
  writeFileSync(join(dir, 'ok.css'), '/* https://tailwindcss.com */ a{background:url(./x.png)}')

  const problems = scanVendor(dir)

  assert.deepEqual(problems.filter(p => p.startsWith('bad.js')).length, 5)
  assert.ok(problems.some(p => p.startsWith('bad.css loads from the network')))
  assert.ok(!problems.some(p => p.startsWith('ok.css')))
  assert.deepEqual(writeSums(dir), problems, 'nothing is hashed for a failing scan')
  assert.deepEqual(verifySums(dir), [`${SUMS_FILE} is missing`])
})

test('the fetch allowance is exact: three.module.js may have three fetch( and no more, other files none', t => {
  const dir = scratch(t)
  const call = 'x;fetch(a);'
  writeFileSync(join(dir, 'three.module.js'), call.repeat(3))
  writeFileSync(join(dir, 'libs.js'), 'x;')
  assert.deepEqual(scanVendor(dir), [])

  writeFileSync(join(dir, 'three.module.js'), call.repeat(4))
  assert.deepEqual(scanVendor(dir), ['three.module.js has 4 x fetch( (3 allowed)'])
  writeFileSync(join(dir, 'three.module.js'), call.repeat(2))
  assert.deepEqual(scanVendor(dir), ['three.module.js has 2 x fetch( (3 allowed)'])

  writeFileSync(join(dir, 'three.module.js'), call.repeat(3))
  writeFileSync(join(dir, 'libs.js'), 'x;fetch(a)')
  assert.deepEqual(scanVendor(dir), ['libs.js has 1 x fetch( (0 allowed)'])
})

test('sumsOf lists every file once with a sha256, sorted, and not itself', t => {
  const dir = scratch(t)
  writeFileSync(join(dir, 'b.js'), 'b')
  writeFileSync(join(dir, 'a.js'), 'a')
  writeSums(dir)

  const lines = sumsOf(dir).trim().split('\n')

  assert.equal(lines.length, 2)
  assert.match(lines[0], /^ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb {2}a\.js$/)
  assert.match(lines[1], / {2}b\.js$/)
})

test('the vendor build installs from the lock: exact versions, every package hashed and from the npm registry', () => {
  const pkg = JSON.parse(readFileSync(join(WEB, 'vendor-build/package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(WEB, 'vendor-build/package-lock.json'), 'utf8'))
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is pinned exactly`)
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} is locked at ${version}`)
  }
  const locked = Object.entries(lock.packages).filter(([path]) => path !== '')
  assert.ok(locked.length > Object.keys(pkg.dependencies).length, 'the lock has the transitive packages too')
  for (const [path, entry] of locked) {
    assert.match(entry.integrity ?? '', /^sha512-/, `${path} has an integrity hash`)
    assert.equal(new URL(entry.resolved).host, 'registry.npmjs.org', `${path} comes from the npm registry`)
  }
})

test('build-vendor.mjs runs npm ci on the lock and the locked esbuild, scans, and writes the sums', () => {
  const script = readFileSync(join(WEB, 'build-vendor.mjs'), 'utf8')
  assert.match(script, /'npm', \['ci', '--ignore-scripts'/)
  assert.match(script, /vendor-build/)
  assert.ok(!/'npx'/.test(script), 'no unpinned npx download')
  assert.ok(!/'install'/.test(script), 'no npm install that could move a version')
  assert.match(script, /writeSums\(vendorDir\)/)
})
