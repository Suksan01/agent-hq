// The real-browser tests' own cleanup, without a real Chrome: a browser whose launch fails part way is closed with its
// test, not left running until the test process ends (or forever, when that process is killed).
//   node --test web/browser-kit.test.mjs
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// a stand-in for Chrome: it says it listens on a port where nothing does, so the launch fails at connecting, then stays up
const dir = mkdtempSync(join(tmpdir(), 'agent-hq-fake-chrome-'))
const pidFile = join(dir, 'pid')
const fake = join(dir, 'chrome')
writeFileSync(fake, `#!/bin/sh
echo $$ > '${pidFile}'
for arg; do case "$arg" in --user-data-dir=*) printf '1\\n/devtools/browser/x\\n' > "\${arg#--user-data-dir=}/DevToolsActivePort";; esac; done
exec sleep 60
`)
chmodSync(fake, 0o755)
process.env.CHROME_BIN = fake
const { launchBrowser, newWorld } = await import('./browser-kit.mjs')

const isAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('a browser whose launch fails part way is closed with its test, not left running', async t => {
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  await t.test('the launch', async st => {
    const world = newWorld(st)
    await assert.rejects(launchBrowser(world), /could not connect to Chrome/)
  })

  const pid = Number(readFileSync(pidFile, 'utf8'))
  assert.equal(isAlive(pid), false, `the stand-in Chrome (pid ${pid}) is still running after its test ended`)
})
