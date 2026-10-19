// Agent HQ's local live page. One of these runs per Claude Code session (started by `/hq web`):
//   node server.mjs --state <file> [--port <n>] [--acked <n>]
// Each is a session server: it owns its session's action queue and prints its requests on stdout. All the session
// servers of one user share a single hub (web/hub.mjs) that serves the page: the first one to start becomes the hub
// (wanted port --port, default 4870, else any free one) and the others register with it; if the hub dies, the next
// session server to notice takes over. The hub's address and secret live in hub.json beside the state files.
//
// Stdout protocol (one line each; anything else goes to stderr):
//   AGENT_HQ_URL http://127.0.0.1:<hub port>/?c=<one-time code>   once, when this session is on the page
//   AGENT_HQ_ACTION {"id":<n>,"type":...}                        every page request for this session not yet acknowledged
// Actions: the hub forwards the page's POST /action to this session's server, which queues it in
// `<state>.queue.jsonl` (mode 0600) and prints it. The mod acknowledges by writing `"lastAction": <highest id handled>`
// into the state file; until then the server prints it again every 2 s, and after a restart it prints the
// unacknowledged ones again. Ids rise from max(queue max, --acked, state lastAction).

import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, mkdirSync, openSync, statSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHub } from './hub.mjs'
import { printLoginUrl } from './login.mjs'
import { pidAlive, readRegistry, writeRegistry } from './registry.mjs'
import { hostIsLocal, isString, json, localRequest, plain, readJson, same, SECURITY_HEADERS } from './http.mjs'
import { checkAction, createQueue } from './queue.mjs'
import { watchJson } from './watch.mjs'

const arg = name => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
const statePath = arg('state') && resolve(arg('state'))
if (!statePath) {
  console.error('agent-hq web: --state <file> is required')
  process.exit(2)
}
// one-shot: print a fresh login link for the running hub and stop (nothing of a session server starts)
if (process.argv.includes('--login')) process.exit(await printLoginUrl(statePath))
const wantedPort = Number(arg('port') ?? 4870)
const liveDir = dirname(statePath)
const sessionId = basename(statePath).replace(/\.json$/, '')
const webDir = dirname(fileURLToPath(import.meta.url))

const numberFrom = (name, fallback) => Number(process.env[name]) || fallback // the env names are test hooks
const config = {
  codeTtlMs: numberFrom('AGENT_HQ_CODE_TTL_MS', 120_000), // a login code lives this long
  deadMs: numberFrom('AGENT_HQ_DEAD_MS', 6000), // no heartbeat for this long: shown as stopped
  dropMs: numberFrom('AGENT_HQ_DROP_MS', 60_000), // ... and forgotten after this long
  maxPending: numberFrom('AGENT_HQ_MAX_PENDING', 200), // requests waiting for the mod, per session: more are refused with 429
  maxClients: numberFrom('AGENT_HQ_MAX_CLIENTS', 20), // pages open on the hub at once: more are refused with 429
  staleMs: numberFrom('AGENT_HQ_STALE_MS', 24 * 3600_000), // files of sessions that ended are deleted after this long
  cleanupDelayMs: numberFrom('AGENT_HQ_CLEANUP_DELAY_MS', 30_000), // the first tidy waits for live sessions to register
}
const HEARTBEAT_MS = numberFrom('AGENT_HQ_HEARTBEAT_MS', 2000) // register with the hub, or take over from a dead one
const REPRINT_MS = 2000 // unacknowledged actions are printed again this often
const LOCK_STALE_MS = 5000

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms))
const sessionSecret = randomBytes(16).toString('hex') // what the hub must present to forward an action here

// ---- this session's queue -----------------------------------------------------------------------------------------

mkdirSync(liveDir, { recursive: true, mode: 0o700 })
try {
  chmodSync(liveDir, 0o700)
} catch {}
const queue = createQueue({
  path: `${statePath}.queue.jsonl`,
  acked: Number(arg('acked') ?? 0),
  print: action => process.stdout.write(`AGENT_HQ_ACTION ${JSON.stringify(action)}\n`),
})
const stateWatch = watchJson(statePath, state => queue.acknowledge(state.lastAction))
stateWatch.read() // first, so the state file's lastAction counts as an acknowledgement when the queue is restored
queue.restore()
setInterval(() => {
  stateWatch.read() // also catches a state write the file watch missed
  queue.reprint()
}, REPRINT_MS)

// ---- this session's server: takes forwarded actions from the hub ----------------------------------------------------

const sessionServer = createServer((req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
  if (!hostIsLocal(req) || !same(req.headers['x-hq-secret'], sessionSecret)) return plain(res, 403, 'forbidden')
  if (req.url !== '/hub/forward' || req.method !== 'POST') return plain(res, 404, 'not found')
  readJson(req, res, body => {
    const clean = checkAction(body)
    if (isString(clean)) return json(res, 400, { error: clean })
    const earlier = clean.key ? queue.idOfKey(clean.key) : undefined
    if (earlier !== undefined) return json(res, 202, { id: earlier }) // a retry of a request already queued
    // the mod is not keeping up (or is not running): stop taking more, rather than fill the queue file without end
    if (queue.pendingCount() >= config.maxPending) return json(res, 429, { error: 'too many requests are waiting for the session' })
    json(res, 202, { id: queue.enqueue(clean) })
  })
})

// ---- finding or becoming the hub ----------------------------------------------------------------------------------

const lockPath = join(liveDir, 'hub.lock')
let sessionPort = 0
let hub = null // set when this process is the hub
let hubPort = 0 // where the hub is, for the page URL
let hubSecret = ''
let hubFailures = 0 // in a row: the hub named in hub.json has a live pid but did not take our registration
const HUB_FAILURES_BEFORE_TAKEOVER = 3

const me = () => ({ session: sessionId, cwd: process.cwd(), statePath, port: sessionPort, secret: sessionSecret })

const readRegistryNow = () => readRegistry(liveDir)

/** shortcut: a lock left by a crashed holder is broken by age, so two processes breaking it at once could both win; the re-check under the lock and the port bind make that harmless in practice */
function acquireLock() {
  try {
    closeSync(openSync(lockPath, 'wx', 0o600))
    return true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) unlinkSync(lockPath)
    } catch {}
    return false
  }
}

async function registerWith(info) {
  const answer = await localRequest(info.port, '/hub/register', { method: 'POST', secret: info.secret, body: me() })
  return answer?.status === 200
}

/** Registers with the live hub named in hub.json, if there is one. */
async function joinHub() {
  const info = readRegistryNow()
  if (!info || !pidAlive(info.pid)) return false
  if (!(await registerWith(info))) {
    hubFailures += 1
    return false
  }
  hubFailures = 0
  ;({ port: hubPort, secret: hubSecret } = info)
  return true
}

/** Starts the hub in this process, keeping the old hub's secret (so the browser stays logged in) and port (so its page reconnects). */
async function becomeHub() {
  if (!acquireLock()) return false
  try {
    if (await joinHub()) return true // someone else won while we waited for the lock
    const old = readRegistryNow()
    // a hub whose process is alive is left alone unless it has repeatedly ignored us (a reused pid, or a hung hub)
    if (old && pidAlive(old.pid) && hubFailures < HUB_FAILURES_BEFORE_TAKEOVER) return false
    const secret = old?.secret ?? randomBytes(16).toString('hex')
    const candidate = createHub({ liveDir, webDir, secret, config })
    const port = await candidate.listen(old?.port ?? wantedPort)
    writeRegistry(liveDir, { port, pid: process.pid, secret })
    hub = candidate
    hubPort = port
    hubSecret = secret
    hub.register(me())
    console.error(`agent-hq web: this session is the hub, on 127.0.0.1:${port}`)
    return true
  } finally {
    try {
      unlinkSync(lockPath)
    } catch {}
  }
}

/** Makes sure this session is registered with a live hub: joins one, or becomes it. */
async function connectToHub() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (hub) {
      hub.register(me())
      return
    }
    if ((await joinHub()) || (await becomeHub())) return
    await sleep(150)
  }
  throw new Error('could not reach or become the hub')
}

let beating = false
async function heartbeat() {
  if (beating) return
  beating = true
  try {
    await connectToHub()
  } catch (error) {
    console.error(`agent-hq web: ${error.message}`)
  } finally {
    beating = false
  }
}

async function loginCode() {
  if (hub) return hub.mintCode()
  const answer = await localRequest(hubPort, '/hub/code', { method: 'POST', secret: hubSecret })
  if (!isString(answer?.json?.code)) throw new Error('the hub did not give a login code')
  return answer.json.code
}

// ---- start ----------------------------------------------------------------------------------------------------------

await new Promise((resolveListen, rejectListen) => {
  sessionServer.once('error', rejectListen)
  sessionServer.listen(0, '127.0.0.1', resolveListen)
})
sessionPort = sessionServer.address().port
console.error(`agent-hq web: session ${sessionId} takes actions on 127.0.0.1:${sessionPort}`)
try {
  await connectToHub()
  console.log(`AGENT_HQ_URL http://127.0.0.1:${hubPort}/?c=${await loginCode()}`)
} catch (error) {
  console.error(`agent-hq web: ${error.message}`)
  process.exit(1)
}
setInterval(heartbeat, HEARTBEAT_MS)
