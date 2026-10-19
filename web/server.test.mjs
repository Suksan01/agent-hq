// Tests for web/server.mjs. Each test starts the server as a child process on a free port with a temp state file.
//   node --test web/server.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cleanLiveDir } from './cleanup.mjs'

const SERVER = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')
const WEB = dirname(SERVER)
const PAGE = readFileSync(join(WEB, 'index.html'), 'utf8')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Polls until `check()` (sync or async) returns something truthy (and returns it), or throws after `ms`. */
async function until(check, ms = 5000, what = 'condition') {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(20)
  }
}

const tempDir = t => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hq-web-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** One HTTP request with full control of path, Host and cookie. Resolves { status, body, headers } or { error }. */
function call(server, { method = 'GET', path = '/', host, body, headers = {}, cookie = server.cookie } = {}) {
  const sent = { ...(host ? { host } : {}), ...(cookie ? { cookie } : {}), ...headers }
  if (method === 'POST' && !Object.keys(sent).some(name => name.toLowerCase() === 'content-type')) sent['content-type'] = 'application/json'
  return new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path, headers: sent }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: text, headers: res.headers }))
    })
    req.on('error', error => resolve({ error: error.code ?? error.message }))
    req.end(body)
  })
}

/**
 * Starts the server on a free port and (unless login is false) trades its one-time code for the session cookie.
 * Everything it prints on stdout is collected in `out`; cleanup (kill + temp dir) runs after the test.
 */
async function startServer(t, { dir, name = 'state', cwd, args = [], env = {}, login = true } = {}) {
  const tmp = dir ?? tempDir(t)
  const statePath = join(tmp, `${name}.json`)
  if (cwd) mkdirSync(cwd, { recursive: true })
  const child = spawn(process.execPath, [SERVER, '--state', statePath, '--port', '0', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    cwd,
  })
  t.after(() => child.kill())
  const out = []
  const err = []
  for (const [stream, lines] of [[child.stdout, out], [child.stderr, err]]) {
    let partial = ''
    stream.setEncoding('utf8')
    stream.on('data', chunk => {
      const parts = (partial + chunk).split('\n')
      partial = parts.pop()
      lines.push(...parts)
    })
  }
  const exited = new Promise(resolve => child.on('exit', resolve))
  const urlLine = await until(() => out.find(line => line.startsWith('AGENT_HQ_URL ')), 5000, 'AGENT_HQ_URL')
  const match = /^AGENT_HQ_URL http:\/\/127\.0\.0\.1:(\d+)\/\?c=([0-9a-f]{32})$/.exec(urlLine)
  assert.ok(match, `unexpected URL line: ${urlLine}`)
  const server = {
    port: Number(match[1]), // the hub's, whichever session it is running in
    session: name,
    sessionPort: Number(/takes actions on 127\.0\.0\.1:(\d+)/.exec(err.join('\n'))?.[1]),
    code: match[2],
    cookie: null,
    statePath,
    queuePath: `${statePath}.queue.jsonl`,
    child,
    out,
    err,
    /** every AGENT_HQ_ACTION line printed so far, parsed (repeats included) */
    actions: () => out.filter(line => line.startsWith('AGENT_HQ_ACTION ')).map(line => JSON.parse(line.slice('AGENT_HQ_ACTION '.length))),
    stop: async (signal = 'SIGKILL') => {
      child.kill(signal)
      await exited
    },
  }
  if (login) server.cookie = (await redeem(server)).cookie
  return server
}

async function redeem(server, code = server.code) {
  const res = await call(server, { path: `/?c=${code}`, cookie: null })
  const cookie = /^(hq_\d+=[0-9a-f]{32});/.exec(res.headers?.['set-cookie'] ?? '')?.[1] ?? null
  return { ...res, cookie }
}

/** An action for the page's POST /action: objects get this server's session unless they name another. */
const post = (server, payload, options = {}) => {
  const forSession = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? { session: server.session, ...payload } : payload
  return call(server, { method: 'POST', path: '/action', body: typeof forSession === 'string' ? forSession : JSON.stringify(forSession), ...options })
}
const idOf = res => JSON.parse(res.body).id
/** The latest state one session has in a /state or /events payload (a v:2 envelope). */
const snapshotOf = (payload, session) => JSON.parse(payload).sessions.find(s => s.session === session)?.snapshot
const queued = server => (existsSync(server.queuePath) ? readFileSync(server.queuePath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])

/** The mod's way of writing the state file: a temp file renamed over it. */
function writeStateAtomically(server, state) {
  const tmp = `${server.statePath}.tmp`
  writeFileSync(tmp, typeof state === 'string' ? state : JSON.stringify(state))
  renameSync(tmp, server.statePath)
}

// ---- login and access ---------------------------------------------------------------------------------------------

test('the one-time code logs in once: 302 to / with an HttpOnly SameSite=Strict cookie, then it is dead', async t => {
  const server = await startServer(t, { login: false })
  const first = await redeem(server)
  assert.equal(first.status, 302)
  assert.equal(first.headers.location, '/')
  assert.match(first.headers['set-cookie'][0], new RegExp(`^hq_${server.port}=[0-9a-f]{32}; HttpOnly; SameSite=Strict; Path=\\/$`))
  assert.equal((await call(server, { cookie: first.cookie })).status, 200)
  assert.equal((await redeem(server)).status, 403, 'second use of the code')
})

test('a wrong code is refused and does not use up the real one', async t => {
  const server = await startServer(t, { login: false })
  for (const code of ['nope', '', 'a'.repeat(32), `${server.code}0`]) assert.equal((await redeem(server, code)).status, 403, code)
  assert.equal((await redeem(server)).status, 302)
})

test('the code expires', async t => {
  const server = await startServer(t, { login: false, env: { AGENT_HQ_CODE_TTL_MS: '300' } })
  await sleep(450)
  assert.equal((await redeem(server)).status, 403)
})

test('the old ?t= token no longer opens anything', async t => {
  const server = await startServer(t, { login: false })
  assert.equal((await call(server, { path: '/?t=anything', cookie: null })).status, 403)
})

test('every route is 403 without the cookie, and a POST queues nothing', async t => {
  const server = await startServer(t)
  for (const path of ['/', '/state', '/events', '/live.js', '/vendor/libs.js', '/nope']) {
    assert.equal((await call(server, { path, cookie: null })).status, 403, path)
  }
  assert.equal((await post(server, { type: 'lead', text: 'x' }, { cookie: null })).status, 403)
  assert.deepEqual(queued(server), [])
  assert.deepEqual(server.actions(), [])
})

test('the page routes say how to get back in, and the files and endpoints behind them just refuse', async t => {
  const server = await startServer(t)

  for (const path of ['/']) assert.match((await call(server, { path, cookie: null })).body, /open the page again with \/hq web/, path)
  for (const path of ['/state', '/events', '/space.css', '/live.js', '/vendor/libs.js', '/nope']) assert.equal((await call(server, { path, cookie: null })).body, 'forbidden', path)
})

test('403 with a wrong or malformed cookie', async t => {
  const server = await startServer(t)
  for (const cookie of ['hq=' + '0'.repeat(32), 'hq=', 'hq=zz', 'other=1', `x=1; hq=${'0'.repeat(32)}`]) {
    assert.equal((await call(server, { path: '/state', cookie })).status, 403, cookie)
  }
  assert.equal((await call(server, { path: '/state', cookie: `x=1; ${server.cookie}` })).status, 200, 'the right cookie among others')
})

test('403 with a foreign Host header even with the right cookie', async t => {
  const server = await startServer(t)
  for (const host of ['evil.example', `evil.example:${server.port}`, '192.168.1.5', '127.0.0.1.evil.example']) {
    assert.equal((await call(server, { host })).status, 403, host)
  }
  assert.equal((await post(server, { type: 'lead', text: 'x' }, { host: 'evil.example' })).status, 403)
  assert.deepEqual(queued(server), [])
})

test('accepts Host localhost with the cookie', async t => {
  const server = await startServer(t)
  assert.equal((await call(server, { host: `localhost:${server.port}` })).status, 200)
})

test('POST /action refuses a cross-site Origin and a cross-site fetch', async t => {
  const server = await startServer(t)
  const body = { type: 'lead', text: 'x' }
  for (const origin of ['http://evil.example', `http://127.0.0.1:${server.port + 1}`, 'null', `https://127.0.0.1:${server.port}`]) {
    assert.equal((await post(server, body, { headers: { origin } })).status, 403, origin)
  }
  for (const site of ['cross-site', 'same-site']) {
    assert.equal((await post(server, body, { headers: { 'sec-fetch-site': site } })).status, 403, site)
  }
  assert.deepEqual(queued(server), [])
  assert.equal((await post(server, body, { headers: { origin: `http://127.0.0.1:${server.port}`, 'sec-fetch-site': 'same-origin' } })).status, 202)
  assert.equal((await post(server, body, { headers: { origin: `http://localhost:${server.port}` } })).status, 202)
})

test('GET with a foreign Origin is refused too', async t => {
  const server = await startServer(t)
  assert.equal((await call(server, { path: '/state', headers: { origin: 'http://evil.example' } })).status, 403)
})

// ---- headers and static files -------------------------------------------------------------------------------------

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"

test('every response carries the CSP and the other security headers', async t => {
  const server = await startServer(t)
  const responses = [
    await call(server),
    await call(server, { path: '/state' }),
    await call(server, { path: '/nope' }),
    await call(server, { path: '/vendor/libs.js' }),
    await call(server, { path: '/vendor/missing.js' }),
    await call(server, { cookie: null }),
    await call(server, { path: '/?c=bad', cookie: null }),
    await call(server, { host: 'evil.example' }),
    await post(server, 'not json'),
    await redeem(server), // the 302
  ]
  for (const res of responses) {
    assert.equal(res.headers['content-security-policy'], CSP, res.status)
    assert.equal(res.headers['referrer-policy'], 'no-referrer', res.status)
    assert.equal(res.headers['x-content-type-options'], 'nosniff', res.status)
  }
})

test('the event stream carries the security headers', async t => {
  const server = await startServer(t)
  const stream = openEvents(server)
  t.after(stream.close)
  const headers = await stream.headers
  assert.equal(headers['content-security-policy'], CSP)
  assert.equal(headers['x-content-type-options'], 'nosniff')
})

test('GET / returns the page', async t => {
  const server = await startServer(t)
  const res = await call(server)
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/html/)
  assert.equal(res.body, PAGE)
})

test('/vendor serves the bundled libraries with the right content types', async t => {
  const server = await startServer(t)
  const libs = await call(server, { path: '/vendor/libs.js' })
  assert.equal(libs.status, 200)
  assert.match(libs.headers['content-type'], /^text\/javascript/)
  assert.equal(libs.body, readFileSync(join(WEB, 'vendor/libs.js'), 'utf8'))
  const css = await call(server, { path: '/vendor/heroui.min.css' })
  assert.equal(css.status, 200)
  assert.match(css.headers['content-type'], /^text\/css/)
})

test('every font fonts.css points at is served as font/woff2, and each family has its licence text beside it', async t => {
  const server = await startServer(t)
  const css = await call(server, { path: '/vendor/fonts.css' })
  assert.equal(css.status, 200)
  assert.match(css.headers['content-type'], /^text\/css/)
  const faces = [...css.body.matchAll(/@font-face \{[^}]*\}/g)].map(m => m[0])
  const byFamily = {}
  for (const face of faces) {
    const family = /font-family: '([^']+)'/.exec(face)[1]
    ;(byFamily[family] ??= []).push(Number(/font-weight: (\d+)/.exec(face)[1]))
    const name = /url\(\.\/([^)]+)\)/.exec(face)[1]
    const res = await call(server, { path: `/vendor/${name}` })
    assert.equal(res.status, 200, name)
    assert.equal(res.headers['content-type'], 'font/woff2', name)
  }
  assert.deepEqual(byFamily, {
    'Bricolage Grotesque': [500, 700, 800],
    Doto: [400, 700, 900],
    'Space Grotesk': [400, 500, 700],
    'JetBrains Mono': [400],
  })
  const licence = (await call(server, { path: '/vendor/OFL.txt' })).body
  assert.match(licence, /SIL OPEN FONT LICENSE/)
  for (const family of Object.keys(byFamily)) assert.ok(licence.includes(`${family}\n`), `${family} licence`)
})

test('the bundled libraries ship with their licence texts', async t => {
  const server = await startServer(t)
  const licence = await call(server, { path: '/vendor/LICENSES.txt' })
  assert.equal(licence.status, 200)
  for (const name of ['react', 'react-dom', 'htm', '@heroui/react', '@heroui/styles', 'bot-avatars', 'border-beam', 'thinking-orbs', 'liquid-gooey', 'three']) assert.match(licence.body, new RegExp(`^${name} \\d+\\.\\d+\\.\\d+$`, 'm'), name)
  assert.match(licence.body, /Permission is hereby granted, free of charge/)
  assert.match(licence.body, /Apache License/) // htm
})

test('libs.js exports exactly the names the page imports', async () => {
  const libs = await import(join(WEB, 'vendor/libs.js'))
  for (const name of ['useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useLayoutEffect', 'createRoot', 'htm', 'Card', 'Chip', 'ProgressBar', 'BotAvatar', 'BorderBeam', 'ThinkingOrb', 'Liquid']) {
    assert.ok(libs[name], name)
  }
  assert.equal(typeof libs.default.createElement, 'function')
})

test('three.module.js is served as JavaScript and exports the three.js API', async t => {
  const server = await startServer(t)
  const res = await call(server, { path: '/vendor/three.module.js' })
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /^text\/javascript/)
  const three = await import(join(WEB, 'vendor/three.module.js'))
  for (const name of ['Scene', 'WebGLRenderer', 'PerspectiveCamera', 'Points', 'BufferGeometry', 'Color', 'ShaderMaterial']) assert.equal(typeof three[name], 'function', name)
})

test('no vendored script evaluates strings: the page runs without unsafe-eval', () => {
  for (const name of ['libs.js', 'three.module.js']) {
    const code = readFileSync(join(WEB, 'vendor', name), 'utf8')
    assert.ok(!/\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(\s*["'`]/.test(code), `${name} uses eval or new Function`)
  }
})

test('/vendor serves only files listed in web/vendor: traversal and unknown names fail', async t => {
  const server = await startServer(t)
  const paths = [
    '/vendor/../server.mjs',
    '/vendor/%2e%2e/server.mjs',
    '/vendor/..%2fserver.mjs',
    '/vendor/%2e%2e%2fserver.mjs',
    '/vendor/..%5cserver.mjs',
    '/vendor/./../index.html',
    '/vendor//etc/passwd',
    '/vendor/%2fetc%2fpasswd',
    '/vendor/%00libs.js',
    '/vendor/%E0%A4%A',
    '/vendor/libs.js/',
    '/vendor/libs.js/..',
    '/vendor/',
    '/vendor',
    '/vendor/missing.js',
  ]
  for (const path of paths) {
    const res = await call(server, { path })
    assert.ok(res.status === 404 || res.status === 403, `${path} -> ${res.status ?? res.error}`)
    assert.ok(!/createServer|<!doctype/i.test(res.body ?? ''), path)
  }
})

test('/live.js and /panels.js serve their web/ files when they exist and are 404 otherwise', async t => {
  const server = await startServer(t)
  for (const name of ['live.js', 'panels.js']) {
    const res = await call(server, { path: `/${name}` })
    const file = join(WEB, name)
    if (existsSync(file)) {
      assert.equal(res.status, 200)
      assert.match(res.headers['content-type'], /^text\/javascript/)
      assert.equal(res.body, readFileSync(file, 'utf8'))
    } else {
      assert.equal(res.status, 404)
    }
  }
  // other web/ files stay private: server code, tests, odd names, traversal
  for (const path of ['/server.mjs', '/server.test.mjs', '/build-vendor.mjs', '/App.js', '/no-such.js', '/..%2Fhooks%2Fmodel.js', '/%2E%2E/x.js']) {
    assert.equal((await call(server, { path })).status, 404, path)
  }
})

test('the page\'s stylesheets are served from web/ as text/css, by plain lower-case names only', async t => {
  const server = await startServer(t)
  const sheets = readdirSync(WEB).filter(name => /^[a-z][a-z-]*\.css$/.test(name))
  assert.ok(sheets.includes('space.css'), 'web/space.css')
  for (const name of sheets) {
    const res = await call(server, { path: `/${name}` })
    assert.equal(res.status, 200, name)
    assert.match(res.headers['content-type'], /^text\/css/)
    assert.equal(res.body, readFileSync(join(WEB, name), 'utf8'))
  }
  assert.equal((await call(server, { path: '/space.css', cookie: null })).status, 403, 'like everything else, only with the cookie')
  for (const path of ['/no-such.css', '/Space.css', '/space.CSS', '/space.css.map', '/..%2Fvendor%2Fheroui.min.css', '/%2E%2E/hooks/x.css', '/vendor.css', '/design/out.css', '/space.css/']) {
    assert.equal((await call(server, { path })).status, 404, path)
  }
  assert.match((await call(server, { path: '/vendor/heroui.min.css' })).headers['content-type'], /^text\/css/) // the vendored one still works
})

test('/next is gone now that the new page is /', async t => {
  const server = await startServer(t)
  assert.equal((await call(server, { path: '/next' })).status, 404)
})

test('unknown path is 404', async t => {
  const server = await startServer(t)
  assert.equal((await call(server, { path: '/nope' })).status, 404)
})

// ---- state and events ---------------------------------------------------------------------------------------------

test('GET /state returns the state file', async t => {
  const dir = tempDir(t)
  const state = JSON.stringify({ v: 1, at: 5, team: 'demo', agents: [], tasks: [] })
  writeFileSync(join(dir, 'state.json'), state)
  const server = await startServer(t, { dir })
  const res = await call(server, { path: '/state' })
  assert.equal(res.status, 200)
  const envelope = JSON.parse(res.body)
  assert.equal(envelope.v, 2)
  assert.deepEqual(envelope.sessions.map(x => [x.session, x.alive, x.snapshot]), [['state', true, JSON.parse(state)]])
})

test('GET /state falls back to an empty state when the file is missing', async t => {
  const server = await startServer(t)
  const res = await call(server, { path: '/state' })
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body).sessions[0].snapshot.agents, [])
})

/** Opens /events and collects each `data:` payload with its arrival time; close() ends the stream. */
function openEvents(server) {
  const events = []
  const times = []
  let resolveHeaders
  const headers = new Promise(resolve => (resolveHeaders = resolve))
  const req = request({ host: '127.0.0.1', port: server.port, path: '/events', headers: { cookie: server.cookie ?? '' } }, res => {
    resolveHeaders(res.headers)
    let buffer = ''
    res.setEncoding('utf8')
    res.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (block.startsWith('data: ')) {
          events.push(block.slice(6))
          times.push(performance.now())
        }
      }
    })
  })
  req.on('error', () => {})
  req.end()
  const waitFor = async (count, ms = 5000) => {
    await until(() => events.length >= count, ms, `${count} events (got ${events.length})`)
    return events
  }
  return { events, times, headers, waitFor, close: () => req.destroy() }
}

test('GET /events streams the current state, then pushes again after the state file changes', async t => {
  const dir = tempDir(t)
  const first = JSON.stringify({ v: 1, at: 1, team: 'one' })
  writeFileSync(join(dir, 'state.json'), first)
  const server = await startServer(t, { dir })
  const stream = openEvents(server)
  t.after(stream.close)

  await stream.waitFor(1)
  assert.deepEqual(snapshotOf(stream.events[0], 'state'), JSON.parse(first))

  const second = JSON.stringify({ v: 1, at: 2, team: 'two-longer' })
  writeFileSync(server.statePath, second)
  await until(() => snapshotOf(stream.events.at(-1), 'state').team === 'two-longer', 5000, 'the second state')
  assert.deepEqual(snapshotOf(stream.events.at(-1), 'state'), JSON.parse(second))
})

test('GET /events pushes within 300 ms of an atomic rename write, again and again', async t => {
  const server = await startServer(t)
  const stream = openEvents(server)
  t.after(stream.close)
  await stream.waitFor(1)
  for (let n = 1; n <= 5; n += 1) {
    const state = JSON.stringify({ v: 1, at: n, team: `rename-${n}` })
    const before = performance.now()
    writeStateAtomically(server, state)
    await stream.waitFor(n + 1, 2000)
    const latency = stream.times[n] - before
    assert.deepEqual(snapshotOf(stream.events[n], 'state'), JSON.parse(state))
    assert.ok(latency < 300, `push ${n} took ${Math.round(latency)} ms`)
  }
})

test('GET /events pushes only when the content changed', async t => {
  const dir = tempDir(t)
  const state = JSON.stringify({ v: 1, at: 1, team: 'same' })
  writeFileSync(join(dir, 'state.json'), state)
  const server = await startServer(t, { dir })
  const stream = openEvents(server)
  t.after(stream.close)
  await stream.waitFor(1)
  writeStateAtomically(server, state)
  writeFileSync(server.statePath, state)
  await sleep(300)
  assert.equal(stream.events.length, 1)
  writeStateAtomically(server, JSON.stringify({ v: 1, at: 2, team: 'new' }))
  await stream.waitFor(2)
})

test('GET /events never pushes a half-written state file and picks it up once complete', async t => {
  const server = await startServer(t)
  const stream = openEvents(server)
  t.after(stream.close)
  await stream.waitFor(1)
  const full = JSON.stringify({ v: 1, at: 9, team: 'whole', agents: [{ id: 'a' }] })
  writeFileSync(server.statePath, full.slice(0, 20))
  await sleep(150)
  assert.equal(stream.events.length, 1, 'nothing pushed for the torn write')
  assert.deepEqual(snapshotOf((await call(server, { path: '/state' })).body, 'state').agents, [], '/state keeps the last complete state')
  writeFileSync(server.statePath, full)
  await stream.waitFor(2)
  assert.deepEqual(snapshotOf(stream.events[1], 'state'), JSON.parse(full))
})

test('GET /events refuses without the cookie', async t => {
  const server = await startServer(t)
  assert.equal((await call(server, { path: '/events', cookie: null })).status, 403)
})

// ---- actions ------------------------------------------------------------------------------------------------------

test('POST /action accepts each valid kind, numbers them 1, 2, 3, queues them and prints each', async t => {
  const server = await startServer(t)
  const sent = [
    { type: 'spawn', role: 'frontend-dev', task: 'build the page' },
    { type: 'lead', text: 'status please' },
    { type: 'message', agent: 'qa@team', text: 'run the suite' },
    { type: 'stop', agent: 'qa@team' },
    { type: 'finished', mode: 'hide' },
    { type: 'finished', mode: 'show' },
    { type: 'finished', mode: 'clear' },
  ]
  for (const [i, action] of sent.entries()) {
    const res = await post(server, action)
    assert.equal(res.status, 202, JSON.stringify(action))
    assert.deepEqual(JSON.parse(res.body), { session: 'state', id: i + 1 })
  }
  const expected = sent.map((action, i) => ({ id: i + 1, ...action }))
  assert.deepEqual(queued(server), expected)
  assert.deepEqual(server.actions().slice(0, 7), expected)
  const line = server.out.find(l => l.startsWith('AGENT_HQ_ACTION '))
  assert.equal(line, `AGENT_HQ_ACTION ${JSON.stringify(expected[0])}`, 'exact single-line format')
})

test('the queue file is private (mode 0600)', async t => {
  const server = await startServer(t)
  await post(server, { type: 'lead', text: 'x' })
  assert.equal(statSync(server.queuePath).mode & 0o777, 0o600)
})

test('nothing but AGENT_HQ_URL and AGENT_HQ_ACTION lines reaches stdout', async t => {
  const server = await startServer(t)
  await post(server, { type: 'lead', text: 'x' })
  await post(server, 'not json')
  await call(server, { path: '/nope' })
  assert.ok(server.out.every(line => /^AGENT_HQ_(URL|ACTION) /.test(line)), server.out.join('\n'))
})

test('POST /action refuses a body without a JSON content type with 415', async t => {
  const server = await startServer(t)
  const body = JSON.stringify({ session: 'state', type: 'lead', text: 'x' })
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonp', 'text/json']) {
    assert.equal((await post(server, body, { headers: { 'content-type': type } })).status, 415, type)
  }
  const none = await new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port: server.port, method: 'POST', path: '/action', headers: { cookie: server.cookie } }, res => {
      res.resume()
      resolve(res.statusCode)
    })
    req.end(body)
  })
  assert.equal(none, 415, 'no content-type at all')
  assert.deepEqual(queued(server), [])
  assert.equal((await post(server, body, { headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 202)
})

test('POST /action trims text and drops unknown fields', async t => {
  const server = await startServer(t)
  assert.equal((await post(server, { type: 'lead', text: '  hello  ', extra: 'x' })).status, 202)
  assert.deepEqual(queued(server), [{ id: 1, type: 'lead', text: 'hello' }])
})

test('POST /action truncates text to 4000 characters', async t => {
  const server = await startServer(t)
  assert.equal((await post(server, { type: 'lead', text: 'a'.repeat(5000) })).status, 202)
  assert.equal(queued(server)[0].text.length, 4000)
})

const refused = [
  ['unknown type', { type: 'rm-rf' }],
  ['missing type', { role: 'x', task: 'y' }],
  ['JSON null', null],
  ['JSON array', []],
  ['bad role id', { type: 'spawn', role: 'bad role!', task: 'do it' }],
  ['role id too long', { type: 'spawn', role: 'a'.repeat(49), task: 'do it' }],
  ['missing role', { type: 'spawn', task: 'do it' }],
  ['non-string role', { type: 'spawn', role: ['qa'], task: 'do it' }],
  ['empty task', { type: 'spawn', role: 'qa', task: '' }],
  ['whitespace-only task', { type: 'spawn', role: 'qa', task: '   ' }],
  ['non-string task', { type: 'spawn', role: 'qa', task: 5 }],
  ['empty lead text', { type: 'lead', text: '' }],
  ['missing lead text', { type: 'lead' }],
  ['bad agent id (message)', { type: 'message', agent: 'bad agent!', text: 'hi' }],
  ['missing agent (message)', { type: 'message', text: 'hi' }],
  ['non-string agent (message)', { type: 'message', agent: { toString: 'qa' }, text: 'hi' }],
  ['empty message text', { type: 'message', agent: 'qa', text: '' }],
  ['bad agent id (stop)', { type: 'stop', agent: '../etc' }],
  ['missing agent (stop)', { type: 'stop' }],
  ['mode not in the list', { type: 'finished', mode: 'explode' }],
  ['missing mode', { type: 'finished' }],
]
for (const [name, payload] of refused) {
  test(`POST /action refuses ${name} with 400 and queues nothing`, async t => {
    const server = await startServer(t)
    const res = await post(server, payload)
    assert.equal(res.status, 400)
    assert.equal(typeof JSON.parse(res.body).error, 'string')
    assert.deepEqual(queued(server), [])
    assert.deepEqual(server.actions(), [])
  })
}

test('POST /action refuses a non-JSON body with 400 and queues nothing', async t => {
  const server = await startServer(t)
  for (const body of ['not json', '', '{"type":']) assert.equal((await post(server, body)).status, 400, JSON.stringify(body))
  assert.deepEqual(queued(server), [])
})

test('POST /action answers a body over 16 KB with 400, queues nothing, and the server carries on', async t => {
  const server = await startServer(t)
  const res = await post(server, JSON.stringify({ type: 'lead', text: 'x'.repeat(20 * 1024) }))
  assert.equal(res.status, 400, `got ${JSON.stringify(res.status ?? res.error)}`)
  await sleep(200)
  assert.deepEqual(queued(server), [])
  assert.equal(JSON.parse((await post(server, { type: 'lead', text: 'ok' })).body).id, 1)
})

test('a refused action does not use up an id', async t => {
  const server = await startServer(t)
  await post(server, { type: 'lead', text: 'one' })
  await post(server, { type: 'nope' })
  const res = await post(server, { type: 'lead', text: 'two' })
  assert.equal(idOf(res), 2)
  assert.deepEqual(queued(server).map(l => l.id), [1, 2])
})

test('a burst of 50 concurrent actions is all queued and printed, in id order', async t => {
  const server = await startServer(t)
  const replies = await Promise.all(Array.from({ length: 50 }, (_, i) => post(server, { type: 'lead', text: `burst ${i}` })))
  assert.ok(replies.every(res => res.status === 202))
  assert.deepEqual(replies.map(res => JSON.parse(res.body).id).sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1))
  const firstSeen = [...new Set(server.actions().map(action => action.id))]
  assert.deepEqual(firstSeen, Array.from({ length: 50 }, (_, i) => i + 1), 'first print of each id is in id order')
  assert.deepEqual(queued(server).map(l => l.id), firstSeen)
  assert.equal(new Set(queued(server).map(l => l.text)).size, 50)
})

// ---- acknowledgement and replay -----------------------------------------------------------------------------------

test('an action is printed again every 2 s until the state file says lastAction covers it', async t => {
  const server = await startServer(t)
  await post(server, { type: 'lead', text: 'one' })
  await post(server, { type: 'lead', text: 'two' })
  const count = id => server.actions().filter(action => action.id === id).length
  await until(() => count(1) >= 3 && count(2) >= 3, 6000, 'repeated prints')

  writeStateAtomically(server, { v: 1, at: 1, lastAction: 1 })
  await sleep(150)
  const oneAfterAck = count(1)
  const twoAfterAck = count(2)
  await until(() => count(2) > twoAfterAck, 4000, 'id 2 still printed after acking only id 1')
  assert.equal(count(1), oneAfterAck, 'id 1 stops once acknowledged')

  writeStateAtomically(server, { v: 1, at: 2, lastAction: 2 })
  await sleep(150)
  const settled = server.actions().length
  await sleep(2600)
  assert.equal(server.actions().length, settled, 'nothing is printed once everything is acknowledged')
})

test('a lastAction that is not a finite number acknowledges nothing', async t => {
  const server = await startServer(t)
  await post(server, { type: 'lead', text: 'one' })
  for (const [i, lastAction] of [null, 'x', '1', [1], { n: 1 }].entries()) writeStateAtomically(server, { v: 1, at: i, lastAction })
  await sleep(150)
  const before = server.actions().length
  await until(() => server.actions().length > before, 4000, 'a re-print')
})

test('after a crash, unacknowledged actions are replayed with the same ids, and stop after the ack', async t => {
  const dir = tempDir(t)
  const first = await startServer(t, { dir })
  const sent = [
    { type: 'lead', text: 'a' },
    { type: 'stop', agent: 'qa' },
    { type: 'finished', mode: 'hide' },
  ]
  for (const action of sent) await post(first, action)
  const expected = sent.map((action, i) => ({ id: i + 1, ...action }))
  await first.stop('SIGKILL')

  const second = await startServer(t, { dir })
  await until(() => second.actions().length >= 3, 3000, 'the replay')
  assert.deepEqual(second.actions().slice(0, 3), expected, 'replayed exactly, in order, before the URL line')
  assert.ok(second.out.findIndex(l => l.startsWith('AGENT_HQ_ACTION ')) < second.out.findIndex(l => l.startsWith('AGENT_HQ_URL ')), 'replay comes before the URL')

  writeStateAtomically(second, { v: 1, at: 1, lastAction: 2 })
  await sleep(150)
  const mark = second.actions().length
  await until(() => second.actions().length > mark, 4000, 're-print of the one still unacknowledged')
  assert.deepEqual(second.actions().slice(mark).map(action => action.id), [3])
  assert.equal(JSON.parse((await post(second, { type: 'lead', text: 'next' })).body).id, 4)
  await second.stop('SIGKILL')

  // restarted once more with the ack on disk: only id 3 and 4 come back, the queue file was compacted to them
  const third = await startServer(t, { dir })
  await until(() => third.actions().length >= 2, 3000, 'second replay')
  assert.deepEqual(third.actions().slice(0, 2).map(action => action.id), [3, 4])
  assert.deepEqual(queued(third).map(l => l.id), [3, 4])
  assert.equal(statSync(third.queuePath).mode & 0o777, 0o600)

  writeStateAtomically(third, { v: 1, at: 2, lastAction: 4 })
  await sleep(150)
  const settled = third.actions().length
  await sleep(2600)
  assert.equal(third.actions().length, settled)
})

test('on start the queue file is compacted: acknowledged and corrupt lines go, ids continue past the highest', async t => {
  const dir = tempDir(t)
  const action = (id, text) => JSON.stringify({ id, type: 'lead', text })
  writeFileSync(join(dir, 'state.json.queue.jsonl'), [action(1, 'a'), action(7, 'b'), 'not json', action(3, 'c'), '{"id":"x"}', action(2, 'd')].join('\n') + '\n')
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ v: 1, at: 1, lastAction: 2 }))
  const server = await startServer(t, { dir })
  assert.deepEqual(queued(server).map(l => l.id), [7, 3])
  assert.deepEqual(server.actions().slice(0, 2).map(a => a.id), [7, 3])
  assert.equal(JSON.parse((await post(server, { type: 'lead', text: 'z' })).body).id, 8)
})

test('--acked sets the floor for ids, and the state file lastAction does too', async t => {
  const withArg = await startServer(t, { args: ['--acked', '41'] })
  assert.equal(JSON.parse((await post(withArg, { type: 'lead', text: 'a' })).body).id, 42)

  const dir = tempDir(t)
  writeFileSync(join(dir, 'state.json'), JSON.stringify({ v: 1, at: 1, lastAction: 9 }))
  const withState = await startServer(t, { dir })
  assert.equal(JSON.parse((await post(withState, { type: 'lead', text: 'b' })).body).id, 10)
})

test('--acked drops queued actions at or below it', async t => {
  const dir = tempDir(t)
  const first = await startServer(t, { dir })
  for (const text of ['a', 'b', 'c']) await post(first, { type: 'lead', text })
  await first.stop()
  const second = await startServer(t, { dir, args: ['--acked', '2'] })
  await until(() => second.actions().length >= 1, 3000, 'replay')
  assert.deepEqual(second.actions().map(a => a.id), [3])
  assert.deepEqual(queued(second).map(l => l.id), [3])
})

// ---- several sessions, one hub --------------------------------------------------------------------------------------

const FAST = { AGENT_HQ_HEARTBEAT_MS: '300', AGENT_HQ_DEAD_MS: '1500', AGENT_HQ_DROP_MS: '4000' }
const hubFile = server => join(dirname(server.statePath), 'hub.json')
const hubInfo = server => JSON.parse(readFileSync(hubFile(server), 'utf8'))
const hubCall = (server, path, { method = 'GET', secret, body, headers = {} } = {}) =>
  call(server, { method, path, cookie: null, body: body === undefined ? undefined : JSON.stringify(body), headers: { ...(secret ? { 'x-hq-secret': secret } : {}), ...headers } })
const sessionsOf = async server => {
  const res = await call(server, { path: '/state' })
  return res.status === 200 ? JSON.parse(res.body).sessions : []
}
/** Starts a live directory (made by the first server) and two or more sessions in it, each in its own working folder. */
function liveDirFor(t) {
  const root = tempDir(t)
  return { live: join(root, 'live'), cwd: name => join(root, name) }
}

test('two sessions share one hub: both are on the page, with their own state, and the registry is private', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  const b = await startServer(t, { dir: live, name: 'b', cwd: cwd('beta'), env: FAST })
  assert.equal(b.port, a.port, 'one page for both')
  assert.equal(b.cookie, a.cookie, 'a code from either session logs in to the same hub')
  assert.deepEqual(hubInfo(a), { port: a.port, pid: a.child.pid, secret: hubInfo(a).secret })
  assert.match(hubInfo(a).secret, /^[0-9a-f]{32}$/)
  assert.equal(statSync(live).mode & 0o777, 0o700)
  assert.equal(statSync(hubFile(a)).mode & 0o777, 0o600)

  const stream = openEvents(a)
  t.after(stream.close)
  writeStateAtomically(a, { v: 1, at: 1, team: 'A team', agents: [] })
  writeStateAtomically(b, { v: 1, at: 1, team: 'B team', agents: [] })
  await until(() => stream.events.length && snapshotOf(stream.events.at(-1), 'a')?.team === 'A team' && snapshotOf(stream.events.at(-1), 'b')?.team === 'B team', 5000, 'both teams')
  const sessions = JSON.parse(stream.events.at(-1)).sessions
  assert.deepEqual(sessions.map(x => x.session).sort(), ['a', 'b'])
  assert.deepEqual(sessions.map(x => [x.session, x.label, x.alive, x.cwd.endsWith(x.label)]).sort(), [['a', 'alpha', true, true], ['b', 'beta', true, true]])
  assert.ok(sessions.every(x => JSON.stringify(Object.keys(x).sort()) === '["alive","cwd","label","session","snapshot"]'))

  const before = stream.events.length
  writeStateAtomically(b, { v: 1, at: 2, team: 'B team', agents: [{ id: 'new' }] })
  await until(() => stream.events.length > before && snapshotOf(stream.events.at(-1), 'b').agents.length === 1, 3000, 'the change in b')
  assert.equal(snapshotOf(stream.events.at(-1), 'a').team, 'A team')
})

test('an action goes only to the session it names, which queues and prints it with its own ids', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  const b = await startServer(t, { dir: live, name: 'b', cwd: cwd('beta'), env: FAST })

  const forB = await post(a, { session: 'b', type: 'lead', text: 'for b' })
  assert.equal(forB.status, 202)
  assert.deepEqual(JSON.parse(forB.body), { session: 'b', id: 1 })
  const forA = await post(b, { session: 'a', type: 'stop', agent: 'qa' })
  assert.deepEqual(JSON.parse(forA.body), { session: 'a', id: 1 }, 'ids are per session')
  await post(a, { session: 'b', type: 'lead', text: 'for b again' })

  await until(() => b.actions().length >= 2 && a.actions().length >= 1, 3000, 'prints')
  assert.deepEqual(b.actions().slice(0, 2), [{ id: 1, type: 'lead', text: 'for b' }, { id: 2, type: 'lead', text: 'for b again' }])
  assert.deepEqual(a.actions(), [{ id: 1, type: 'stop', agent: 'qa' }])
  assert.deepEqual(queued(b).map(x => x.id), [1, 2])
  assert.deepEqual(queued(a).map(x => x.id), [1])
  assert.equal(statSync(b.queuePath).mode & 0o777, 0o600)
})

test('an action for a missing, unknown or non-string session is refused', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  assert.equal((await post(a, { session: 'nobody', type: 'lead', text: 'x' })).status, 404)
  assert.equal((await post(a, { session: 'a', type: 'nope' })).status, 400)
  assert.equal((await post(a, { session: ['a'], type: 'lead', text: 'x' })).status, 400)
  assert.equal((await post(a, { session: 5, type: 'lead', text: 'x' })).status, 400)
  assert.equal((await call(a, { method: 'POST', path: '/action', body: JSON.stringify({ type: 'lead', text: 'x' }) })).status, 400, 'no session')
  assert.equal((await post(a, { session: '__proto__', type: 'lead', text: 'x' })).status, 404)
  assert.deepEqual(a.actions(), [])
})

test('the hub answers 503, not 202, when the session cannot be reached', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  const closed = await new Promise(resolve => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
  const ghost = { session: 'ghost', cwd: '/tmp/ghost', statePath: join(live, 'ghost.json'), port: closed, secret: 'a'.repeat(32) }
  assert.equal((await hubCall(a, '/hub/register', { method: 'POST', secret: hubInfo(a).secret, body: ghost })).status, 200)
  const res = await post(a, { session: 'ghost', type: 'lead', text: 'x' })
  assert.equal(res.status, 503)
  assert.deepEqual(a.actions(), [])
})

test('/hub/* needs the registry secret, and a session server takes a forward only from the hub', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  const b = await startServer(t, { dir: live, name: 'b', cwd: cwd('beta'), env: FAST })
  const { secret } = hubInfo(a)
  const action = { type: 'lead', text: 'forged' }

  for (const [path, method] of [['/hub/ping', 'GET'], ['/hub/code', 'POST'], ['/hub/register', 'POST'], ['/hub/forward', 'POST'], ['/hub/anything', 'GET']]) {
    for (const given of [undefined, 'wrong', 'a'.repeat(32)]) {
      const res = await hubCall(a, path, { method, secret: given, body: method === 'POST' ? action : undefined })
      assert.equal(res.status, 403, `${method} ${path} with ${given}`)
    }
    assert.equal((await call(a, { method, path, body: method === 'POST' ? JSON.stringify(action) : undefined })).status, 403, `${path} with only the page cookie`)
  }
  assert.equal((await hubCall(a, '/hub/ping', { secret })).status, 200)
  const code = JSON.parse((await hubCall(a, '/hub/code', { method: 'POST', secret })).body).code
  assert.equal((await redeem(a, code)).status, 302)

  // straight to b's own server: refused without b's secret, from anywhere
  for (const [headers, host] of [[{}, undefined], [{ 'x-hq-secret': secret }, undefined], [{ 'x-hq-secret': 'b'.repeat(32) }, undefined], [{}, 'evil.example']]) {
    const res = await call({ port: b.sessionPort }, { method: 'POST', path: '/hub/forward', cookie: null, host, headers, body: JSON.stringify(action) })
    assert.equal(res.status, 403, JSON.stringify(headers))
  }
  assert.deepEqual(b.actions(), [])
  assert.deepEqual(queued(b), [])
})

test('/hub/register refuses malformed registrations and state files outside the live directory', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  const { secret } = hubInfo(a)
  const good = { session: 'x', cwd: '/tmp/x', statePath: join(live, 'x.json'), port: 4000, secret: 'c'.repeat(32) }
  const bad = [
    { ...good, session: ['x'] },
    { ...good, session: 'has space' },
    { ...good, cwd: 5 },
    { ...good, statePath: '/etc/passwd' },
    { ...good, statePath: join(live, '..', 'x.json') },
    { ...good, statePath: 'x.json' },
    { ...good, port: 0 },
    { ...good, port: '4000' },
    { ...good, secret: 'short' },
    null,
    [],
  ]
  for (const body of bad) assert.equal((await hubCall(a, '/hub/register', { method: 'POST', secret, body })).status, 400, JSON.stringify(body))
  assert.deepEqual((await sessionsOf(a)).map(x => x.session), ['a'])
})

test('no secret reaches the page: not in /state, not in /events', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  await startServer(t, { dir: live, name: 'b', cwd: cwd('beta'), env: FAST })
  const stream = openEvents(a)
  t.after(stream.close)
  await until(() => stream.events.length && JSON.parse(stream.events.at(-1)).sessions.length === 2, 5000, 'two sessions')
  const { secret } = hubInfo(a)
  const everything = [(await call(a, { path: '/state' })).body, ...stream.events].join('\n')
  for (const forbidden of [secret, a.cookie.slice(3), a.code, '"secret"', 'statePath']) assert.ok(!everything.includes(forbidden), forbidden)
  assert.ok(!everything.includes(String(a.sessionPort)) || !everything.includes('"port"'))
})

test('a session that stops heartbeating is marked stopped, refused actions, and then dropped', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  const b = await startServer(t, { dir: live, name: 'b', cwd: cwd('beta'), env: FAST })
  const stream = openEvents(a)
  t.after(stream.close)
  await until(async () => (await sessionsOf(a)).length === 2, 3000, 'both registered')
  const killedAt = Date.now()
  await b.stop('SIGKILL')

  const stateOf = async name => (await sessionsOf(a)).find(x => x.session === name)
  await until(async () => (await stateOf('b'))?.alive === false, 6000, 'b marked stopped')
  assert.ok((await stateOf('a')).alive)
  assert.equal((await post(a, { session: 'b', type: 'lead', text: 'x' })).status, 404)
  assert.ok(stream.events.some(event => JSON.parse(event).sessions.some(x => x.session === 'b' && !x.alive)), 'the page was told')

  await until(async () => (await stateOf('b')) === undefined, 8000, 'b dropped')
  assert.ok(Date.now() - killedAt >= 3500, 'not dropped before the drop delay')
  assert.deepEqual((await sessionsOf(a)).map(x => x.session), ['a'])
})

test('when the hub process dies a session server takes over, the others re-register, and the page reconnects', async t => {
  const { live, cwd } = liveDirFor(t)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  const b = await startServer(t, { dir: live, name: 'b', cwd: cwd('beta'), env: FAST })
  const c = await startServer(t, { dir: live, name: 'c', cwd: cwd('gamma'), env: FAST })
  assert.equal(hubInfo(a).pid, a.child.pid)
  const oldHub = hubInfo(a)
  const oldStream = openEvents(a)
  t.after(oldStream.close)
  await until(async () => (await sessionsOf(a)).length === 3, 3000, 'three sessions')

  await a.stop('SIGKILL')
  const survivors = async () => (await sessionsOf(a)).filter(x => x.alive).map(x => x.session).sort() // a.port is the hub's port, reused
  await until(async () => (await survivors()).join() === 'b,c', 10000, 'a new hub with b and c')
  const newHub = hubInfo(b)
  assert.notEqual(newHub.pid, oldHub.pid)
  assert.ok([b.child.pid, c.child.pid].includes(newHub.pid))
  assert.equal(newHub.port, oldHub.port, 'same address, so the open page reconnects')
  assert.equal(newHub.secret, oldHub.secret)

  // the browser's old cookie still works there, and a new event stream shows both
  const reconnected = openEvents(a)
  t.after(reconnected.close)
  await until(() => reconnected.events.length && JSON.parse(reconnected.events.at(-1)).sessions.filter(x => x.alive).length === 2, 5000, 'both on the new stream')

  // actions still land on exactly the session they name
  assert.equal((await post(a, { session: 'c', type: 'lead', text: 'after takeover' })).status, 202)
  await until(() => c.actions().length >= 1, 3000, 'c prints it')
  assert.deepEqual(b.actions(), [])

  // the dead hub's own session comes back and joins the new hub
  const again = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  assert.equal(again.port, oldHub.port)
  await until(async () => (await survivors()).join() === 'a,b,c', 5000, 'a back')
})

test('a stale hub.json (dead pid) does not stop a new session from becoming the hub', async t => {
  const { live, cwd } = liveDirFor(t)
  mkdirSync(live, { recursive: true })
  writeFileSync(join(live, 'hub.json'), JSON.stringify({ port: 1, pid: 2 ** 22 - 7, secret: 'd'.repeat(32) }))
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: FAST })
  assert.equal(hubInfo(a).pid, a.child.pid)
  assert.equal(hubInfo(a).secret, 'd'.repeat(32), 'the old secret is kept so a logged-in browser stays logged in')
  assert.notEqual(a.port, 1)
})

test('sessions that start together end up with one hub', async t => {
  const { live, cwd } = liveDirFor(t)
  const servers = await Promise.all(['a', 'b', 'c', 'd'].map(name => startServer(t, { dir: live, name, cwd: cwd(name), env: FAST })))
  assert.equal(new Set(servers.map(x => x.port)).size, 1)
  await until(async () => (await sessionsOf(servers[0])).length === 4, 5000, 'all four')
  assert.equal(servers.filter(x => x.err.some(line => line.includes('is the hub'))).length, 1)
})

// ---- tidying the live directory ------------------------------------------------------------------------------------

const DAY = 24 * 3600 * 1000
const aged = (path, text, ageMs) => {
  writeFileSync(path, text)
  const when = new Date(Date.now() - ageMs)
  utimesSync(path, when, when)
}

test('cleanLiveDir removes old files of sessions that are not registered, and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hq-clean-'))
  try {
    const old = ['gone.json', 'gone.json.queue.jsonl', 'gone.json.actions.jsonl', 'gone.json.tmp', 'gone.json.queue.jsonl.tmp']
    for (const name of old) aged(join(dir, name), 'x', 2 * DAY)
    aged(join(dir, 'alive.json'), '{}', 2 * DAY) // registered
    aged(join(dir, 'alive.json.queue.jsonl'), '', 2 * DAY)
    aged(join(dir, 'recent.json'), '{}', 1000) // an ended session's, but not old yet
    for (const name of ['hub.json', 'hub.lock', 'hub.json.tmp']) aged(join(dir, name), '{}', 9 * DAY)
    for (const name of ['notes.txt', 'team.json.bak', '.hidden.json']) aged(join(dir, name), 'x', 9 * DAY)
    mkdirSync(join(dir, 'sub.json'))

    const removed = cleanLiveDir(dir, { isRegistered: id => id === 'alive', olderThanMs: DAY })

    assert.deepEqual(removed.sort(), [...old].sort())
    for (const name of ['alive.json', 'alive.json.queue.jsonl', 'recent.json', 'hub.json', 'hub.lock', 'hub.json.tmp', 'notes.txt', 'team.json.bak', '.hidden.json', 'sub.json']) {
      assert.ok(existsSync(join(dir, name)), name)
    }
    assert.deepEqual(cleanLiveDir(join(dir, 'missing'), { isRegistered: () => false, olderThanMs: DAY }), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the hub tidies the live directory after its first delay: old files of ended sessions go, live sessions and the hub files stay', async t => {
  const { live, cwd } = liveDirFor(t)
  mkdirSync(live, { recursive: true })
  for (const name of ['old.json', 'old.json.queue.jsonl', 'old.json.actions.jsonl']) aged(join(live, name), '{}', 3 * DAY)
  aged(join(live, 'a.json'), '{}', 3 * DAY) // the session about to register, with a state file older than a day
  aged(join(live, 'fresh.json'), '{}', 1000)
  const a = await startServer(t, { dir: live, name: 'a', cwd: cwd('alpha'), env: { ...FAST, AGENT_HQ_CLEANUP_DELAY_MS: '600' } })

  await until(() => !existsSync(join(live, 'old.json')), 5000, 'old.json removed')

  for (const name of ['old.json.queue.jsonl', 'old.json.actions.jsonl']) assert.ok(!existsSync(join(live, name)), name)
  for (const name of ['a.json', 'fresh.json', 'hub.json']) assert.ok(existsSync(join(live, name)), name)
  assert.equal((await sessionsOf(a)).length, 1)
})

// ---- opening the page again (/hq web run twice) ------------------------------------------------------------------

test('a browser that is logged in is sent to the page whatever code the link carries, and its code is not used up', async t => {
  const server = await startServer(t)
  const spent = server.code // used by startServer to log in

  const withCookie = await call(server, { path: `/?c=${spent}` })
  assert.equal(withCookie.status, 302)
  assert.equal(withCookie.headers.location, '/')
  assert.equal(withCookie.headers['set-cookie'], undefined)
  assert.equal((await call(server, { path: '/?c=nonsense' })).status, 302, 'even a made-up code')

  const fresh = JSON.parse((await hubCall(server, '/hub/code', { method: 'POST', secret: hubInfo(server).secret })).body).code
  assert.equal((await call(server, { path: `/?c=${fresh}` })).status, 302)
  assert.equal((await redeem(server, fresh)).status, 302, 'the fresh code still works for a browser with no cookie')
})

test('without a cookie a used or made-up code is still refused', async t => {
  const server = await startServer(t)

  assert.equal((await call(server, { path: `/?c=${server.code}`, cookie: null })).status, 403)
  assert.equal((await call(server, { path: '/?c=nonsense', cookie: null })).status, 403)
})

/** Runs `node server.mjs --login --state <file>` and resolves { code, stdout, stderr }. */
function runLogin(statePath, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SERVER, '--login', '--state', statePath], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.on('exit', code => resolve({ code, stdout, stderr }))
  })
}

test('--login prints a fresh one-time link for the running hub, and starts nothing', async t => {
  const server = await startServer(t)
  const before = (await sessionsOf(server)).length

  const first = await runLogin(server.statePath)
  const second = await runLogin(server.statePath)

  assert.equal(first.code, 0, first.stderr)
  const link = /^AGENT_HQ_URL http:\/\/127\.0\.0\.1:(\d+)\/\?c=([0-9a-f]{32})\n$/.exec(first.stdout)
  assert.ok(link, first.stdout)
  assert.equal(Number(link[1]), server.port)
  assert.notEqual(link[2], server.code)
  assert.notEqual(link[2], /c=([0-9a-f]+)/.exec(second.stdout)[1], 'every call mints its own')
  assert.equal((await redeem(server, link[2])).status, 302, 'a browser with no cookie gets in')
  assert.equal((await redeem(server, link[2])).status, 403, 'and it works once')
  assert.equal((await sessionsOf(server)).length, before, 'no session was registered by the one-shot')
})

test('--login says why when there is no hub running, and prints no link', async t => {
  const dir = tempDir(t)
  const none = await runLogin(join(dir, 'a.json'))
  assert.equal(none.code, 1)
  assert.equal(none.stdout, '')
  assert.match(none.stderr, /no page is running/)

  writeFileSync(join(dir, 'hub.json'), JSON.stringify({ port: 1, pid: 2 ** 22 - 7, secret: 'e'.repeat(32) })) // a dead hub's file
  const dead = await runLogin(join(dir, 'a.json'))
  assert.equal(dead.code, 1)
  assert.equal(dead.stdout, '')
})

// ---- review fixes: cookie scope, idempotency keys, restored queue lines, flooding, tidy scope --------------------------

test('the login cookie is named for the hub\'s port: the same value under another name or port logs nobody in', async t => {
  const server = await startServer(t)
  const value = /=([0-9a-f]{32})$/.exec(server.cookie)[1]

  assert.match(server.cookie, new RegExp(`^hq_${server.port}=`))
  for (const cookie of [`hq=${value}`, `hq_${server.port + 1}=${value}`, `hq_${server.port}x=${value}`]) {
    assert.equal((await call(server, { path: '/state', cookie })).status, 403, cookie)
  }
  assert.equal((await call(server, { path: '/state', cookie: `hq=${value}; ${server.cookie}` })).status, 200, 'the right one among others')
})

test('POST /action with a key: sending it again queues and prints nothing new and answers the same id', async t => {
  const server = await startServer(t)

  const first = await post(server, { type: 'lead', text: 'once', key: 'click-1' })
  const again = await post(server, { type: 'lead', text: 'once', key: 'click-1' })
  const changed = await post(server, { type: 'lead', text: 'a different text', key: 'click-1' }) // the key decides, not the text
  const other = await post(server, { type: 'lead', text: 'once', key: 'click-2' })
  const unkeyed = await post(server, { type: 'lead', text: 'once' })

  assert.deepEqual([first, again, changed].map(r => [r.status, JSON.parse(r.body).id]), [[202, 1], [202, 1], [202, 1]])
  assert.deepEqual([other, unkeyed].map(r => JSON.parse(r.body).id), [2, 3])
  assert.deepEqual(queued(server).map(l => [l.id, l.key, l.text]), [[1, 'click-1', 'once'], [2, 'click-2', 'once'], [3, undefined, 'once']])
  assert.deepEqual([...new Set(server.actions().map(a => a.id))], [1, 2, 3])
  assert.equal(server.actions().filter(a => a.id === 1).length, 1, 'printed once (until the re-print period)')
})

test('a key must be 1 to 64 letters, digits, _ or -', async t => {
  const server = await startServer(t)

  for (const key of ['', 'a b', 'x'.repeat(65), 5, null, ['a'], 'é']) {
    const res = await post(server, { type: 'lead', text: 'x', key })
    assert.equal(res.status, 400, JSON.stringify(key))
    assert.match(JSON.parse(res.body).error, /key/)
  }
  assert.equal((await post(server, { type: 'lead', text: 'x', key: 'x'.repeat(64) })).status, 202)
  assert.equal((await post(server, { type: 'lead', text: 'x', key: 'A_b-9' })).status, 202)
})

test('a retry with the same key after the session server was killed runs once: the restarted queue knows the key', async t => {
  const dir = tempDir(t)
  const first = await startServer(t, { dir })
  const sent = await post(first, { type: 'spawn', role: 'qa', task: 'check it', key: 'k1' })
  assert.equal(JSON.parse(sent.body).id, 1)
  await first.stop('SIGKILL')

  const second = await startServer(t, { dir })
  await until(() => second.actions().length >= 1, 3000, 'the replay')
  const retried = await post(second, { type: 'spawn', role: 'qa', task: 'check it', key: 'k1' })

  assert.deepEqual([retried.status, JSON.parse(retried.body).id], [202, 1])
  assert.deepEqual(queued(second).map(l => l.id), [1])
  assert.deepEqual([...new Set(second.actions().map(a => a.id))], [1])
})

test('a restored queue line is checked like a request: damaged, oversized and unknown lines are dropped, extra fields stripped', async t => {
  const dir = tempDir(t)
  const good = { id: 1, type: 'lead', text: 'ok' }
  writeFileSync(
    join(dir, 'state.json.queue.jsonl'),
    [
      JSON.stringify(good),
      JSON.stringify({ id: '2', type: 'lead', text: 'string id' }),
      JSON.stringify({ id: 3, type: 'rm-rf' }),
      JSON.stringify({ id: 4, type: 'spawn', role: 'bad role!', task: 'x' }),
      JSON.stringify({ id: 0, type: 'lead', text: 'zero' }),
      JSON.stringify({ id: 6, type: 'lead', text: 'x'.repeat(20000) }),
      JSON.stringify({ id: 7, type: 'lead', text: 'extra', evil: 'field', key: 'k7' }),
      JSON.stringify({ id: 8, type: 'lead', text: 'bad key', key: 'no spaces' }),
      '{"id":9,"type":',
    ].join('\n') + '\n',
  )

  const server = await startServer(t, { dir })

  assert.deepEqual(queued(server), [good, { id: 7, type: 'lead', text: 'extra', key: 'k7' }])
  assert.deepEqual(server.actions().slice(0, 2).map(a => a.id), [1, 7])
  assert.equal(JSON.parse((await post(server, { type: 'lead', text: 'next' })).body).id, 8, 'ids go on above the highest kept')
})

test('a session with too many requests waiting for the mod answers 429, a retry of a queued one still answers 202, and room frees on acknowledgement', async t => {
  const server = await startServer(t, { env: { AGENT_HQ_MAX_PENDING: '3' } })

  for (const n of [1, 2, 3]) assert.equal((await post(server, { type: 'lead', text: `m${n}`, key: `k${n}` })).status, 202)
  const refused = await post(server, { type: 'lead', text: 'm4', key: 'k4' })
  assert.equal(refused.status, 429)
  assert.match(JSON.parse(refused.body).error, /waiting/)
  assert.deepEqual(queued(server).map(l => l.id), [1, 2, 3])
  assert.deepEqual([...(await post(server, { type: 'lead', text: 'm1', key: 'k1' })).body.matchAll(/"id":(\d+)/g)].map(m => m[1]), ['1'], 'a retry is not a new request')

  writeStateAtomically(server, { v: 1, at: 1, lastAction: 2 })
  await until(async () => (await post(server, { type: 'lead', text: 'm5' })).status === 202, 4000, 'room after the acknowledgement')
})

test('the hub takes only so many open pages, then answers 429', async t => {
  const server = await startServer(t, { env: { AGENT_HQ_MAX_CLIENTS: '2' } })
  const one = openEvents(server)
  const two = openEvents(server)
  t.after(() => (one.close(), two.close()))
  await one.waitFor(1)
  await two.waitFor(1)

  assert.equal((await call(server, { path: '/events' })).status, 429)
  one.close()
  await until(async () => (await sessionsOf(server)).length === 1 && (await probeEvents(server)) === 200, 4000, 'room after a page closes')
})
async function probeEvents(server) {
  const stream = openEvents(server)
  const headers = await Promise.race([stream.headers, sleep(1000).then(() => ({}))])
  stream.close()
  return headers[':status'] ?? (stream.events.length > 0 ? 200 : 429)
}

test('a hub run on a folder that is not named "live" never tidies it', async t => {
  const root = tempDir(t)
  const dev = join(root, 'dev')
  mkdirSync(dev)
  aged(join(dev, 'old.json'), '{}', 3 * DAY)
  await startServer(t, { dir: dev, name: 'a', cwd: join(root, 'alpha'), env: { ...FAST, AGENT_HQ_CLEANUP_DELAY_MS: '200' } })

  await sleep(900)

  assert.ok(existsSync(join(dev, 'old.json')))
})
