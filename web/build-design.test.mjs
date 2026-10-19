// Tests for web/build-design.mjs: it builds the showcase into a folder, leaves other files in it alone, and keeps the
// readable copy of every source (the showcase's sections too).   node --test web/build-design.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const WEB = dirname(fileURLToPath(import.meta.url))
const hasShowcase = existsSync(join(WEB, 'design/showcase.js')) && existsSync(join(WEB, 'design/index.html'))

test('the showcase builds into a folder that works offline, keeps other files, and copies every imported section as a readable source', { skip: !hasShowcase && 'no showcase yet', timeout: 120_000 }, t => {
  const out = mkdtempSync(join(tmpdir(), 'agent-hq-design-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  mkdirSync(join(out, 'sections'))
  writeFileSync(join(out, 'sections/mine.js'), 'hand-made')
  writeFileSync(join(out, 'NOTES.txt'), 'keep me')
  writeFileSync(join(out, 'src-stale.txt'), 'x')
  writeFileSync(join(out, '.agent-hq-design'), 'ours') // a folder from an earlier build

  const run = spawnSync(process.execPath, [join(WEB, 'build-design.mjs'), out], { encoding: 'utf8' })

  assert.equal(run.status, 0, run.stderr)
  assert.equal(readFileSync(join(out, 'NOTES.txt'), 'utf8'), 'keep me')
  assert.equal(readFileSync(join(out, 'sections/mine.js'), 'utf8'), 'hand-made')
  const sheets = [...readFileSync(join(WEB, 'design/index.html'), 'utf8').matchAll(/href="\.\.\/([\w-]+\.css)"/g)].map(m => m[1])
  assert.ok(sheets.includes('space.css'))
  for (const name of ['index.html', 'showcase.bundle.js', 'vendor/fonts.css', ...sheets]) assert.ok(existsSync(join(out, name)), name)
  assert.ok(!readFileSync(join(out, 'index.html'), 'utf8').includes('../'), 'every stylesheet link is rewritten')
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /src="showcase\.bundle\.js"/)
  // three.js is a chunk of its own, added by the page when the Space view is first shown: the main bundle has none of it
  if (existsSync(join(WEB, 'design/enginechunk.js'))) {
    assert.ok(existsSync(join(out, 'engine.chunk.js')), 'engine.chunk.js')
    assert.ok(readFileSync(join(out, 'engine.chunk.js'), 'utf8').includes('WebGLRenderer'), 'the chunk holds three.js')
    assert.ok(!readFileSync(join(out, 'showcase.bundle.js'), 'utf8').includes('WebGLRenderer'), 'the main bundle does not')
    assert.ok(existsSync(join(out, 'src', 'design-enginechunk.js')), 'its readable source')
  }
  assert.ok(!/(?:src|href)=["']\//.test(readFileSync(join(out, 'index.html'), 'utf8')), 'no absolute paths in the page')

  // the sections the showcase imports are in the bundle, so their readable copies are in src/ (a file nothing imports is not built)
  const sections = [...readFileSync(join(WEB, 'design/showcase.js'), 'utf8').matchAll(/from '\.\/sections\/([\w-]+\.js)'/g)].map(m => m[1])
  for (const name of sections) assert.ok(existsSync(join(out, 'src', `design-sections-${name}`)), `src/design-sections-${name}`)
  assert.ok(existsSync(join(out, 'src', 'design-showcase.js')))
})

const refusal = (out, cwd) => spawnSync(process.execPath, [join(WEB, 'build-design.mjs'), out], { encoding: 'utf8', cwd })

test('a folder that is not empty and was not made by the script is refused, and nothing in it is touched', t => {
  const out = mkdtempSync(join(tmpdir(), 'agent-hq-design-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  mkdirSync(join(out, 'src'))
  writeFileSync(join(out, 'src/mine.js'), 'my project')
  writeFileSync(join(out, 'index.html'), 'my page')

  const run = refusal(out)

  assert.equal(run.status, 2)
  assert.match(run.stderr, /not empty and was not made by build-design\.mjs/)
  assert.equal(readFileSync(join(out, 'src/mine.js'), 'utf8'), 'my project')
  assert.equal(readFileSync(join(out, 'index.html'), 'utf8'), 'my page')
  assert.ok(!existsSync(join(out, '.agent-hq-design')))
})

test('`node web/build-design.mjs .` run inside a project folder refuses and leaves it alone', t => {
  const project = mkdtempSync(join(tmpdir(), 'agent-hq-project-'))
  t.after(() => rmSync(project, { recursive: true, force: true }))
  writeFileSync(join(project, 'package.json'), '{}')
  writeFileSync(join(project, 'index.html'), 'precious')

  const run = refusal('.', project)

  assert.equal(run.status, 2, run.stderr)
  assert.equal(readFileSync(join(project, 'index.html'), 'utf8'), 'precious')
  assert.equal(readFileSync(join(project, 'package.json'), 'utf8'), '{}')
})

test('the web folder itself and a plain file are refused', t => {
  const file = join(mkdtempSync(join(tmpdir(), 'agent-hq-file-')), 'out')
  t.after(() => rmSync(dirname(file), { recursive: true, force: true }))
  writeFileSync(file, 'a file')

  assert.equal(refusal(WEB).status, 2)
  assert.equal(refusal(file).status, 2)
  assert.equal(readFileSync(file, 'utf8'), 'a file')
})

test('the default out folder is inside the mod and git-ignored; no personal path is in the script', () => {
  const script = readFileSync(join(WEB, 'build-design.mjs'), 'utf8')
  assert.match(script, /join\(WEB, 'design\/out'\)/)
  assert.ok(!/\/Users\/|\/home\//.test(script), 'no hard-coded home path')
  assert.match(readFileSync(join(WEB, '../.gitignore'), 'utf8'), /^web\/design\/out\/$/m)
})

test('a new folder is built into and marked as the script\'s own', { skip: !hasShowcase && 'no showcase yet', timeout: 120_000 }, t => {
  const parent = mkdtempSync(join(tmpdir(), 'agent-hq-design-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const out = join(parent, 'fresh')

  const run = spawnSync(process.execPath, [join(WEB, 'build-design.mjs'), out], { encoding: 'utf8' })

  assert.equal(run.status, 0, run.stderr)
  assert.ok(existsSync(join(out, '.agent-hq-design')))
  assert.equal(spawnSync(process.execPath, [join(WEB, 'build-design.mjs'), out], { encoding: 'utf8' }).status, 0, 'a second build into the marked folder works')
})
