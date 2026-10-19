// End-to-end proof that the live page is realtime and lossless. Real processes, no mocks of the server side:
// one hub (inside whichever session server starts first) and two session servers (`node server.mjs --state <file>`),
// each fed by a scripted fake mod that does what the real mod does with the channel: read AGENT_HQ_ACTION lines from the
// server's stdout, handle each id once, acknowledge by writing `lastAction` into the state file, and write state changes.
// The page is a raw HTTP client with the login cookie (POST /action, and an SSE reader standing in for EventSource).
//   node --test --test-concurrency=1 web/e2e.test.mjs        (about 25 s on a quiet machine; prints the measured numbers)
// Run it alone, or with --test-concurrency=1 beside the other web tests: it is timing-sensitive and starts real servers.
// On a busy machine every wait and latency budget is scaled by SLOWDOWN (AGENT_HQ_TEST_SLOWDOWN=<n> sets it; otherwise it is
// derived from the 1-minute load per core and from how late this process's own timers fire), and the measured numbers are
// still printed. Nothing uses a fixed port.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { Agent, request } from 'node:http'
import { cpus, loadavg, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const SERVER = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const REPRINT_MS = 2000 // server.mjs prints unacknowledged actions again this often
const ENV = { AGENT_HQ_HEARTBEAT_MS: '250', AGENT_HQ_DEAD_MS: '1500' } // fast takeover; everything else as shipped

// ---- how slow is this machine right now? ---------------------------------------------------------------------------

/** Mean lateness of 20 10 ms timers, in ms: a measured baseline of how starved this process is. */
async function timerLag() {
  let late = 0
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now()
    await new Promise(resolve => setTimeout(resolve, 10))
    late += performance.now() - t0 - 10
  }
  return late / 20
}
const LOAD_PER_CORE = loadavg()[0] / cpus().length
const LAG_MS = await timerLag()
// 1 on a quiet machine. Load per core above 0.7 and timers more than 5 ms late each raise it; capped at 10.
const SLOWDOWN = Math.min(10, Math.max(1, Number(process.env.AGENT_HQ_TEST_SLOWDOWN) || 0, Math.ceil(LOAD_PER_CORE / 0.7), 1 + Math.floor(LAG_MS / 5)))
console.log(`[e2e] machine: load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores, timer lag ${LAG_MS.toFixed(1)} ms -> waits and latency budgets x${SLOWDOWN}${process.env.AGENT_HQ_TEST_SLOWDOWN ? ' (AGENT_HQ_TEST_SLOWDOWN)' : ''}`)
const slow = ms => ms * SLOWDOWN
const timeoutFor = ms => ({ timeout: slow(ms) })

async function until(check, ms = 8000, what = 'condition') {
  const deadline = Date.now() + slow(ms)
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(10)
  }
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] }
}
const fmt = s => `p50 ${s.p50.toFixed(0)} ms, p95 ${s.p95.toFixed(0)} ms, max ${s.max.toFixed(0)} ms (n=${s.n})`

// ---- cleanup: every child and temp dir goes, pass or fail ---------------------------------------------------------

const children = new Set()
process.on('exit', () => {
  for (const child of children) child.kill('SIGKILL')
})

function world(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hq-e2e-'))
  const mine = []
  const clients = []
  t.after(() => {
    for (const client of clients) client.stop()
    for (const child of mine) {
      child.kill('SIGKILL')
      children.delete(child)
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return {
    dir,
    track: child => (mine.push(child), children.add(child), child),
    trackClient: client => (clients.push(client), client),
  }
}

// ---- a session server, as the mod starts it -----------------------------------------------------------------------

/** Starts `node server.mjs --state <dir>/<name>.json` and resolves once it printed its page URL. */
async function startSession(w, name, mod, { port = 0 } = {}) {
  const statePath = join(w.dir, `${name}.json`)
  let lastError
  // a retry only for a start that raced (the server did not print its URL in time, or died on the way up)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const child = w.track(spawn(process.execPath, [SERVER, '--state', statePath, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...ENV } }))
    const err = []
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => err.push(chunk))
    const exited = new Promise(resolve => child.on('exit', resolve))
    const lines = mod.attach(child)
    try {
      const url = await until(() => lines.find(line => line.startsWith('AGENT_HQ_URL ')) ?? (child.exitCode !== null ? Promise.reject(new Error(`exited: ${err.join('').trim().split('\n').pop()}`)) : null), 8000, `${name} AGENT_HQ_URL`)
      const match = /^AGENT_HQ_URL http:\/\/127\.0\.0\.1:(\d+)\/\?c=([0-9a-f]{32})$/.exec(url)
      assert.ok(match, `unexpected URL line ${url}`)
      return {
        name,
        child,
        statePath,
        queuePath: `${statePath}.queue.jsonl`,
        hubPort: Number(match[1]),
        code: match[2],
        err,
        kill: async (signal = 'SIGKILL') => {
          child.kill(signal)
          await exited
        },
      }
    } catch (error) {
      lastError = error
      child.kill('SIGKILL')
      await exited
      console.log(`[e2e] ${name} did not start (attempt ${attempt}): ${error.message}`)
    }
  }
  throw lastError
}

/** The scripted mod: handles each action id once, acknowledges through the state file, writes state on demand. */
class FakeMod {
  constructor(name, w) {
    this.name = name
    this.statePath = join(w.dir, `${name}.json`)
    this.state = { v: 1, at: 0, team: null, agents: [], tasks: [], overall: { done: 0, active: 0, total: 0 }, tasksProgress: { done: 0, active: 0, total: 0 }, lastAction: 0, mark: 0 }
    this.lastHandled = 0
    this.handled = [] // { id, action, at } in the order handled
    this.printed = [] // every AGENT_HQ_ACTION line seen, repeats included: { action, at }
    this.dups = 0 // lines for ids already handled, ignored
    this.gaps = [] // an id that skipped ahead of the one expected
    this.hold = false // true: lines are kept, not handled (a busy mod)
    this.holdAcks = false // true: handled but not acknowledged
    this.held = []
    this.written = null
    this.writes = 0
    this.flush()
  }

  /** Reads the child's stdout; returns the (growing) list of its lines. */
  attach(child) {
    const lines = []
    let partial = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      const parts = (partial + chunk).split('\n')
      partial = parts.pop()
      for (const line of parts) {
        lines.push(line)
        if (line.startsWith('AGENT_HQ_ACTION ')) this.take(JSON.parse(line.slice('AGENT_HQ_ACTION '.length)))
      }
      this.flush()
    })
    return lines
  }

  take(action) {
    this.printed.push({ action, at: performance.now() })
    if (this.hold) this.held.push(action)
    else this.handle(action)
  }

  handle(action) {
    if (action.id <= this.lastHandled) return void this.dups++
    if (action.id !== this.lastHandled + 1) this.gaps.push({ expected: this.lastHandled + 1, got: action.id })
    this.lastHandled = action.id
    this.handled.push({ id: action.id, action, at: performance.now() })
  }

  /** Lets a busy mod catch up. */
  release() {
    this.hold = false
    for (const action of this.held.splice(0)) this.handle(action)
    this.flush()
  }

  /** Writes the state file the way the mod does (temp file, then rename); the acknowledgement rides along. */
  flush(extra = {}) {
    const ack = this.holdAcks ? this.state.lastAction : this.lastHandled
    this.state = { ...this.state, ...extra, lastAction: ack }
    const tmp = `${this.statePath}.tmp`
    const text = JSON.stringify(this.state)
    writeFileSync(tmp, text)
    renameSync(tmp, this.statePath)
    this.written = this.state
    this.writes++
  }

  releaseAcks() {
    this.holdAcks = false
    this.flush()
  }
}

// ---- the page: login, POST /action, SSE ---------------------------------------------------------------------------

function httpCall(port, { method = 'GET', path = '/', cookie, body, agent } = {}) {
  return new Promise(resolve => {
    const headers = { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }
    const req = request({ host: '127.0.0.1', port, method, path, headers, agent }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }))
    })
    req.on('error', error => resolve({ error: error.code ?? error.message }))
    req.setTimeout(5000, () => req.destroy())
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

async function login(session) {
  const res = await httpCall(session.hubPort, { path: `/?c=${session.code}` })
  assert.equal(res.status, 302, 'the one-time code logs in')
  return /^(hq_\d+=[0-9a-f]{32});/.exec(res.headers['set-cookie'][0])[1]
}

/** The page's POST /action. Resolves { ok, id, session, status }. */
async function postAction(port, cookie, session, text, agent) {
  const res = await httpCall(port, { method: 'POST', path: '/action', cookie, agent, body: { session, type: 'lead', text } })
  let parsed = null
  try {
    parsed = JSON.parse(res.body)
  } catch {}
  return { ok: res.status === 202, status: res.status ?? res.error, id: parsed?.id, session, text }
}

/** Posts `texts` (`[session, text]` pairs) with `parallel` in flight; calls `after(result, count)` as each answers. */
async function burst(port, cookie, items, { parallel = 12, after } = {}) {
  const agent = new Agent({ keepAlive: true, maxSockets: parallel })
  const results = []
  let next = 0
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < items.length) {
        const [session, text] = items[next++]
        const sentAt = performance.now()
        const result = { ...(await postAction(port, cookie, session, text, agent)), sentAt, answeredAt: performance.now() }
        results.push(result)
        await after?.(result, results.length)
      }
    }),
  )
  agent.destroy()
  return results
}

/** What EventSource does: GET /events with the cookie, parse `data:` events, optionally reconnect to the same URL. */
class Sse {
  constructor(port, cookie, { reconnect = false } = {}) {
    this.port = port
    this.cookie = cookie
    this.reconnect = reconnect
    this.messages = [] // { at, env }
    this.badJson = 0
    this.connects = 0
    this.statuses = []
    this.firstSeen = new Map() // `${session}:${mark}` -> first arrival time
    this.stopped = false
    this.req = null
  }

  start() {
    this.stopped = false
    this.connect()
    return this
  }

  connect() {
    if (this.stopped) return
    const req = request({ host: '127.0.0.1', port: this.port, path: '/events', headers: { cookie: this.cookie, accept: 'text/event-stream' } }, res => {
      this.statuses.push(res.statusCode)
      if (res.statusCode !== 200) {
        res.resume()
        return
      }
      this.connects++
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        buffer += chunk
        let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const data = block.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n')
          if (data) this.message(data)
        }
      })
      res.on('close', () => this.again())
    })
    req.on('error', () => this.again())
    req.end()
    this.req = req
  }

  again() {
    if (this.reconnect && !this.stopped) setTimeout(() => this.connect(), 100)
  }

  message(data) {
    const at = performance.now()
    let env
    try {
      env = JSON.parse(data)
    } catch {
      this.badJson++
      return
    }
    this.messages.push({ at, env })
    for (const s of env.sessions ?? []) {
      const mark = s.snapshot?.mark
      if (mark !== undefined && !this.firstSeen.has(`${s.session}:${mark}`)) this.firstSeen.set(`${s.session}:${mark}`, at)
    }
  }

  latest(session) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const found = this.messages[i].env.sessions?.find(s => s.session === session)
      if (found) return found
    }
    return undefined
  }

  stop() {
    this.stopped = true
    this.req?.destroy()
  }
}

/** Two session servers on one hub (the first started), their mods, a logged-in cookie and a live SSE client. */
async function pair(t, { reconnect = false } = {}) {
  const w = world(t)
  const modA = new FakeMod('a', w)
  const modB = new FakeMod('b', w)
  const a = await startSession(w, 'a', modA)
  const b = await startSession(w, 'b', modB)
  assert.equal(b.hubPort, a.hubPort, 'both sessions are on the first one hub')
  const cookie = await login(a)
  const sse = w.trackClient(new Sse(a.hubPort, cookie, { reconnect }).start())
  await until(() => sse.latest('a') && sse.latest('b'), 8000, 'both sessions on the page')
  return { w, modA, modB, a, b, cookie, sse, port: a.hubPort }
}

// ---- 1. exactly once, in order, none lost, to the right session ---------------------------------------------------

test('200 page actions over two sessions are each handled exactly once, by the right session, in id order', timeoutFor(40_000), async t => {
  const { modA, modB, cookie, port } = await pair(t)
  const items = Array.from({ length: 200 }, (_, i) => [i % 3 === 0 ? 'b' : 'a', `${i % 3 === 0 ? 'b' : 'a'}-${i}`])

  const started = performance.now()
  const results = await burst(port, cookie, items, { parallel: 16 })
  const posted = performance.now() - started
  assert.equal(results.filter(r => r.ok).length, 200, `every post is accepted: ${JSON.stringify(results.filter(r => !r.ok).slice(0, 3))}`)

  await until(() => modA.handled.length + modB.handled.length >= 200, 15_000, 'all 200 handled')
  await sleep(2500) // past one reprint: nothing may be handled twice, nothing new may appear

  for (const [mod, name] of [[modA, 'a'], [modB, 'b']]) {
    const mine = results.filter(r => r.session === name)
    assert.equal(mod.handled.length, mine.length, `${name}: handled count`)
    assert.deepEqual(mod.handled.map(h => h.id), mine.map((_, i) => i + 1), `${name}: ids are 1..n in order, no gap and no repeat`)
    assert.deepEqual(mod.gaps, [], `${name}: no id skipped`)
    const textOfId = new Map(mine.map(r => [r.id, r.text]))
    for (const h of mod.handled) {
      assert.equal(h.action.text, textOfId.get(h.id), `${name}: id ${h.id} carries the text posted for it`)
      assert.ok(h.action.text.startsWith(`${name}-`), `${name} never gets the other session's action`)
    }
    assert.equal(mod.state.lastAction, mine.length, `${name}: everything acknowledged`)
  }

  // post -> handled latency by text
  const handledAt = new Map([...modA.handled, ...modB.handled].map(h => [h.action.text, h.at]))
  const latency = stats(results.map(r => handledAt.get(r.text) - r.sentAt))
  console.log(`[e2e 1] 200 actions posted in ${posted.toFixed(0)} ms (${((200 / posted) * 1000).toFixed(0)}/s); post -> handled: ${fmt(latency)}; re-sent lines ignored: a=${modA.dups} b=${modB.dups}`)
  assert.ok(latency.max < slow(3000), `no action waits seconds to be handled (max ${latency.max.toFixed(0)} ms, budget ${slow(3000)} ms)`)
})

// ---- 2. a session server killed mid-burst -------------------------------------------------------------------------

test('kill -9 of a session server mid-burst: unacknowledged actions replay with the same ids and run exactly once', timeoutFor(40_000), async t => {
  const { w, modA, modB, b, cookie, port } = await pair(t)
  modB.hold = true // a busy mod: lines pile up unhandled and unacknowledged
  const items = Array.from({ length: 150 }, (_, i) => ['b', `b-${i}`])

  let killed = null
  const results = await burst(port, cookie, items, {
    parallel: 10,
    after: (_result, count) => {
      if (count === 60 && !killed) killed = b.kill('SIGKILL') // mid-burst; the rest of the burst runs into the dead server
    },
  })
  await killed
  const accepted = results.filter(r => r.ok)
  assert.ok(accepted.length >= 40 && accepted.length < 150, `the kill landed mid-burst (${accepted.length} accepted)`)

  // what the dead server left behind: the queue file holds every accepted action (and maybe one whose answer was lost)
  const queued = readFileSync(b.queuePath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  assert.deepEqual(queued.map(q => q.id), queued.map((_, i) => i + 1), 'queued ids are contiguous')
  for (const r of accepted) assert.equal(queued[r.id - 1].text, r.text, `accepted id ${r.id} is in the queue file with its text`)
  assert.equal(modB.state.lastAction, 0, 'nothing was acknowledged before the kill')

  // restart on the same state file: the unacknowledged actions come out again, same ids, same payloads
  await sleep(slow(300)) // whatever the dead server's pipe still held reaches the mod first
  const printedBefore = modB.printed.length
  const b2 = await startSession(w, 'b', modB)
  assert.equal(b2.hubPort, port, 'the restarted session joins the same hub')
  await until(() => modB.printed.length >= printedBefore + queued.length, 8000, 'the replay')
  const replay = modB.printed.slice(printedBefore, printedBefore + queued.length).map(p => p.action)
  assert.deepEqual(replay, queued, 'the replay is the queue, same ids and payloads, in order')

  modB.release() // the mod catches up on everything it was holding, then the replay's repeats are ignored
  await until(() => modB.state.lastAction === queued.length, 8000, 'acknowledgement of the whole queue')
  assert.deepEqual(modB.handled.map(h => h.id), queued.map(q => q.id), 'each id handled exactly once, in order')
  assert.deepEqual(modB.gaps, [])
  assert.ok(modB.dups > 0, 'the replayed lines were seen and ignored')
  assert.equal(modB.dups + modB.handled.length, modB.printed.length, 'every printed line was either handled once or ignored as a repeat')

  // the pipeline works again for new traffic, and the other session never noticed
  const after = await burst(port, cookie, [...Array.from({ length: 10 }, (_, i) => ['b', `b2-${i}`]), ...Array.from({ length: 10 }, (_, i) => ['a', `a2-${i}`])])
  assert.equal(after.filter(r => r.ok).length, 20)
  await until(() => modB.handled.length === queued.length + 10 && modA.handled.length === 10, 8000, 'new traffic handled')
  assert.deepEqual(modA.handled.map(h => h.id), Array.from({ length: 10 }, (_, i) => i + 1))
  console.log(`[e2e 2] kill -9 after ${accepted.length}/150 accepted: ${queued.length} queued, ${queued.length - accepted.length} unconfirmed-but-queued, ${modB.dups} repeats ignored, all handled once`)
})

// ---- 3. the hub killed mid-stream ---------------------------------------------------------------------------------

test('kill -9 of the hub: another session takes over on the same port and cookie, the page reconnects, both final states arrive', timeoutFor(40_000), async t => {
  const { w, modA, modB, a, b, cookie, sse, port } = await pair(t, { reconnect: true })
  // both mods keep writing state throughout, as busy sessions do
  let mark = 0
  const ticker = setInterval(() => {
    mark++
    modA.flush({ mark })
    modB.flush({ mark })
  }, 15)
  t.after(() => clearInterval(ticker))
  await until(() => sse.latest('a')?.snapshot?.mark > 5, 5000, 'state flowing')

  const info = JSON.parse(readFileSync(join(w.dir, 'hub.json'), 'utf8'))
  assert.equal(info.pid, a.child.pid, 'a is the hub')
  const killedAt = performance.now()
  await a.kill('SIGKILL')

  // b takes over: same port, same secret (so the same cookie), no new login
  await until(() => JSON.parse(readFileSync(join(w.dir, 'hub.json'), 'utf8')).pid === b.child.pid, 10_000, 'b became the hub')
  const newHub = JSON.parse(readFileSync(join(w.dir, 'hub.json'), 'utf8'))
  assert.equal(newHub.port, port, 'the new hub listens on the old hub port, so the open page reconnects to the same URL')
  assert.equal(newHub.secret, info.secret, 'and keeps the secret, so the cookie stays valid')
  const reconnectAt = await until(async () => sse.connects >= 2 && performance.now(), 10_000, 'the page reconnected')
  assert.ok(!sse.statuses.includes(403), 'no re-login was asked for')
  const takeoverMs = reconnectAt - killedAt

  // a comes back (the person runs /hq web again) and registers with the new hub
  const a2 = await startSession(w, 'a', modA)
  assert.equal(a2.hubPort, port)
  const final = 'final-state'
  clearInterval(ticker)
  mark++
  modA.flush({ mark, final })
  modB.flush({ mark, final })
  await until(() => sse.latest('a')?.snapshot?.final === final && sse.latest('b')?.snapshot?.final === final, 10_000, 'both final states on the page')
  assert.deepEqual(sse.latest('a').snapshot, modA.written)
  assert.deepEqual(sse.latest('b').snapshot, modB.written)
  assert.equal(sse.badJson, 0, 'every push parsed')

  // and the action path works through the new hub with the old cookie
  const results = await burst(port, cookie, [...Array.from({ length: 10 }, (_, i) => ['a', `a-${i}`]), ...Array.from({ length: 10 }, (_, i) => ['b', `b-${i}`])])
  assert.equal(results.filter(r => r.ok).length, 20, JSON.stringify(results.filter(r => !r.ok)[0]))
  await until(() => modA.handled.length === 10 && modB.handled.length === 10, 8000, 'actions handled through the new hub')
  console.log(`[e2e 3] hub kill -9 -> page reconnected on the same port in ${takeoverMs.toFixed(0)} ms (heartbeat 250 ms), ${sse.connects} connects, statuses ${[...new Set(sse.statuses)]}, new hub is session b`)
})

// ---- 4. rapid writes: the last state is the last state ------------------------------------------------------------

test('50 rapid state writes per session: the last push equals the last write, never stale, always valid JSON', timeoutFor(30_000), async t => {
  const { modA, modB, sse } = await pair(t)
  const lastMarks = { a: 0, b: 0 }

  await Promise.all(
    [modA, modB].map(async mod => {
      for (let i = 1; i <= 50; i++) {
        mod.flush({ mark: i, note: `${mod.name}-${i}` })
        await sleep(i % 10 === 0 ? 7 : 1) // mostly back to back, with a few breaths
      }
    }),
  )
  // and one torn write (a non-atomic writer caught mid-write), then the complete file
  writeFileSync(modA.statePath, JSON.stringify(modA.state).slice(0, 40))
  await sleep(15)
  modA.flush({ mark: 51, note: 'a-51' })

  await until(() => sse.latest('a')?.snapshot?.mark === 51 && sse.latest('b')?.snapshot?.mark === 50, 10_000, 'the last writes on the page')
  await sleep(slow(600)) // nothing stale may arrive after the final state
  assert.deepEqual(sse.latest('a').snapshot, modA.written, 'a: last push equals last write')
  assert.deepEqual(sse.latest('b').snapshot, modB.written, 'b: last push equals last write')
  assert.equal(sse.badJson, 0, 'every push is valid JSON')
  for (const msg of sse.messages) {
    assert.equal(msg.env.v, 2)
    for (const s of msg.env.sessions) {
      const mark = s.snapshot.mark
      if (mark === undefined) continue
      assert.ok(mark >= lastMarks[s.session], `${s.session}: mark ${mark} after ${lastMarks[s.session]} would be a stale push`)
      lastMarks[s.session] = mark
    }
  }
  const seenA = new Set(sse.messages.map(m => m.env.sessions.find(s => s.session === 'a').snapshot.mark))
  console.log(`[e2e 4] ${sse.messages.length} pushes for 101 writes (writes coalesce by design); final marks a=51 b=50 equal the files; ${seenA.size} distinct states seen for a; 0 bad JSON, 0 stale`)
})

// ---- 5. latency ---------------------------------------------------------------------------------------------------

// One write at a time, far enough apart that each is its own state: writes closer than about 50 ms can share one file-watch
// event on macOS (FSEvents batches for 50 ms), and the page then gets the latest of them. The final state is never lost
// (test 4); this test measures the delay of states that do arrive, and insists that all of them did.
const WRITE_GAP_MS = 100

test('state write to SSE arrival: p95 under 300 ms over 100 writes (budget scaled on a busy machine, one retry)', timeoutFor(70_000), async t => {
  const { modA, sse } = await pair(t)
  const budget = slow(300)
  let mark = 0
  const attempts = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sent = new Map()
    for (let i = 0; i < 100; i++) {
      mark++
      sent.set(mark, performance.now())
      modA.flush({ mark })
      await sleep(WRITE_GAP_MS)
    }
    await until(() => sse.firstSeen.has(`a:${mark}`), 5000, 'the last write on the page')
    const latencies = []
    for (const [m, at] of sent) {
      assert.ok(sse.firstSeen.has(`a:${m}`), `write ${m} reached the page`)
      latencies.push(sse.firstSeen.get(`a:${m}`) - at)
    }
    const s = stats(latencies)
    attempts.push(s)
    console.log(`[e2e 5] attempt ${attempt}: state write -> SSE arrival: ${fmt(s)} (budget p95 < ${budget} ms${SLOWDOWN > 1 ? `, machine busy x${SLOWDOWN}` : ''})`)
    if (s.p95 < budget) return
  }
  assert.fail(`p95 over ${budget} ms in both attempts: ${attempts.map(s => `${s.p95.toFixed(0)} ms`).join(', ')}`)
})

// ---- 6. duplicate delivery ----------------------------------------------------------------------------------------

test('unacknowledged actions are printed again and the mod ignores the repeats; after the ack the server stops', timeoutFor(30_000), async t => {
  const { modA, cookie, port } = await pair(t)
  modA.holdAcks = true // handled, but the acknowledgement is withheld
  const results = await burst(port, cookie, Array.from({ length: 5 }, (_, i) => ['a', `a-${i}`]))
  assert.equal(results.filter(r => r.ok).length, 5)

  await until(() => modA.handled.length === 5, 5000, 'first delivery')
  await until(() => modA.printed.length >= 10, REPRINT_MS * 2 + 2000, 'the server re-prints what is not acknowledged')
  assert.deepEqual(modA.handled.map(h => h.id), [1, 2, 3, 4, 5], 'the repeats ran nothing')
  assert.ok(modA.dups >= 5)

  modA.releaseAcks() // lastAction: 5 into the state file
  await sleep(slow(300)) // the server notices through its file watch
  const printed = modA.printed.length
  await sleep(REPRINT_MS * 2 + 500) // two full reprint periods
  assert.equal(modA.printed.length, printed, 'after the acknowledgement the server printed nothing more')
  assert.equal(modA.handled.length, 5)
  console.log(`[e2e 6] 5 actions: ${printed} lines printed in all (${printed - 5} repeats while unacknowledged), 0 after the ack, each handled once`)
})
