// The helper the mod's tool.check holds in while the person answers a permission ask on the live page (0.7.0):
//   node approve.mjs --state <the session's state file>
// stdin: the request JSON { id, agent, role, tool, input, cwd, lang, at, timeoutMs }.
// stdout: one line, `allow`, `deny` or `ask`, then it exits 0. `ask` is also the answer to anything that goes wrong (no hub,
// a refused request, another approval open, no answer in time), so the person gets the terminal's own dialog.
// It reaches the hub the way the session servers do (hub.json beside the state file, its secret) and waits on
// POST /hub/approval; when this process ends early (Esc kills it) the connection closes and the hub withdraws the card.
// No dependencies.

import { basename, dirname, resolve } from 'node:path'
import { localRequest } from './http.mjs'
import { pidAlive, readRegistry } from './registry.mjs'

const DECISIONS = ['allow', 'deny', 'ask']
const DEFAULT_TIMEOUT_MS = 60_000
const GRACE_MS = 5000 // past the hub's own timeout, which answers `ask`

async function readStdin() {
  let text = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) text += chunk
  return text
}

async function decide() {
  const at = process.argv.indexOf('--state')
  const statePath = at > 0 ? process.argv[at + 1] : undefined
  if (!statePath) return 'ask'
  let request
  try {
    request = JSON.parse(await readStdin())
  } catch {
    return 'ask'
  }
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return 'ask'
  const info = readRegistry(dirname(resolve(statePath)))
  if (!info || !pidAlive(info.pid)) return 'ask'
  const session = basename(statePath).replace(/\.json$/, '')
  const waitMs = (Number.isInteger(request.timeoutMs) ? Math.min(request.timeoutMs, DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS) + GRACE_MS
  const answer = await localRequest(info.port, '/hub/approval', { method: 'POST', secret: info.secret, body: { ...request, session }, timeoutMs: waitMs })
  return answer?.status === 200 && DECISIONS.includes(answer.json?.decision) ? answer.json.decision : 'ask'
}

process.stdout.write(`${await decide().catch(() => 'ask')}\n`)
