// The hub: the one HTTP server the browser talks to. It serves the page, logs the browser in, collects every Claude Code
// session's state into one stream, and forwards the page's requests to the session they are for. Runs inside whichever
// session server won the election (see server.mjs). Session servers talk to it on /hub/* with the registry secret.
// It also holds the page approvals (approvals.mjs): web/approve.mjs waits on POST /hub/approval, the pages get SSE `approval`
// and `approval-withdrawn` events and answer on POST /approval/<id>. Dormant unless `config.approvals` (AGENT_HQ_APPROVALS=1
// in the hub's environment): then both routes are 404, so the helper says `ask`, and no approval ever reaches a page. And it keeps `pages.json` ({ count, at }: the pages open,
// each showing every session) in the live directory beside the state files, rewritten whenever a page connects or leaves and
// when the hub starts, for the mod to read.
// No dependencies.

import { createHmac, randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { checkAction } from './queue.mjs'
import { APPROVAL_ID, checkRequest, createApprovals, MAX_INPUT } from './approvals.mjs'
import { hostIsLocal, isString, json, localRequest, plain, readJson, same, SECURITY_HEADERS } from './http.mjs'
import { cleanLiveDir } from './cleanup.mjs'
import { watchJson } from './watch.mjs'

const HEARTBEAT_MS = 15000 // keeps proxies and the browser from closing an idle stream
const FORWARD_TIMEOUT_MS = 3000
const SESSION_ID = /^[A-Za-z0-9_.@:-]{1,128}$/
const HEX_SECRET = /^[0-9a-f]{32}$/
const EMPTY_STATE = { v: 1, at: 0, team: null, agents: [], tasks: [], overall: { done: 0, active: 0, total: 0 }, tasksProgress: { done: 0, active: 0, total: 0 } }
// the page's own modules: plain lowercase `name.js` files in web/ (server code is .mjs, tests .test.mjs, so never matched)
// the page's own modules and stylesheets, from web/: a plain lower-case name and one of these extensions (never server.mjs, a test, or a folder)
// the paths a browser is sent to
const PAGES = ['/']
const PAGE_FILE = /^\/[a-z][a-z0-9-]*(\.js|\.css)$/
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
}

/** `secret` is the registry secret (session servers present it on /hub/*); the browser's cookie is derived from it. */
export function createHub({ liveDir, webDir, secret, config }) {
  const vendorDir = join(webDir, 'vendor')
  // derived, so a hub that takes over from a dead one keeps the browser logged in
  const sessionCookie = createHmac('sha256', secret).update('agent-hq session cookie').digest('hex').slice(0, 32)
  const codes = new Map() // one-time login code -> expiry
  const sessions = new Map() // session id -> { session, cwd, statePath, port, secret, alive, lastSeen, watch }
  const clients = new Set()
  let lastEnvelope = ''

  // ---- login ------------------------------------------------------------------------------------------------

  function mintCode() {
    const now = Date.now()
    for (const [code, expires] of codes) if (expires < now) codes.delete(code)
    const code = randomBytes(16).toString('hex')
    codes.set(code, now + config.codeTtlMs)
    return code
  }

  /** Is this a live, unused code? It is spent either way. */
  function redeemCode(candidate) {
    for (const [code, expires] of codes) {
      if (!same(candidate, code)) continue
      codes.delete(code)
      return expires >= Date.now()
    }
    return false
  }

  // named by the hub's port: cookies are shared by every port of 127.0.0.1, so two hubs (or any other local server)
  // would otherwise overwrite one another's login
  const cookieName = () => `hq_${server.address().port}`
  const hasSession = req => same(new RegExp(`(?:^|;\\s*)${cookieName()}=([0-9a-f]+)`).exec(req.headers.cookie ?? '')?.[1], sessionCookie)

  // ---- sessions ---------------------------------------------------------------------------------------------

  /** What the page gets: every session with its latest state. Never anything a session server could be attacked with. */
  function envelope() {
    const list = [...sessions.values()].map(s => ({
      session: s.session,
      cwd: s.cwd,
      label: basename(s.cwd) || s.cwd,
      alive: s.alive,
      snapshot: s.watch.value ?? EMPTY_STATE,
    }))
    return JSON.stringify({ v: 2, sessions: list })
  }

  const send = (res, text) => res.write(`data: ${text.replace(/[\r\n]/g, '')}\n\n`)
  const sendEvent = (res, name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data).replace(/[\r\n]/g, '')}\n\n`)
  const approvals = createApprovals({ emit: (name, data) => { for (const res of clients) sendEvent(res, name, data) } })

  /** pages.json in the live directory: how many pages are open. Written whole (temp file renamed over it), user-only. */
  function writePages() {
    const path = join(liveDir, 'pages.json')
    try {
      writeFileSync(`${path}.tmp`, JSON.stringify({ count: clients.size, at: Date.now() }), { mode: 0o600 })
      renameSync(`${path}.tmp`, path)
    } catch (error) {
      console.error(`agent-hq web: could not write ${path}: ${error.message}`)
    }
  }
  writePages() // a new hub starts with none: a count left by a hub that died is not true any more

  /** Tells every open page, but only when something it would show has changed. */
  function publish() {
    const next = envelope()
    if (next === lastEnvelope) return
    lastEnvelope = next
    for (const res of clients) send(res, next)
  }

  /** Adds a session or refreshes it (a session server calls this every heartbeat). Returns an error text, or null. */
  function register(info) {
    const ok =
      typeof info === 'object' && info !== null && isString(info.session) && SESSION_ID.test(info.session) &&
      isString(info.cwd) && info.cwd.length <= 1024 &&
      isString(info.statePath) && isAbsolute(info.statePath) && dirname(info.statePath) === resolve(liveDir) &&
      Number.isInteger(info.port) && info.port > 0 && info.port < 65536 &&
      isString(info.secret) && HEX_SECRET.test(info.secret)
    if (!ok) return 'invalid session registration'
    let entry = sessions.get(info.session)
    if (entry && entry.statePath !== info.statePath) {
      entry.watch.close()
      entry = undefined
    }
    const fresh = !entry
    entry ??= { session: info.session, statePath: info.statePath }
    Object.assign(entry, { cwd: info.cwd, port: info.port, secret: info.secret, alive: true, lastSeen: Date.now() })
    if (fresh) {
      entry.watch = watchJson(info.statePath, () => publish())
      sessions.set(info.session, entry)
      entry.watch.read()
    }
    publish()
    return null
  }

  /** A session that stopped heartbeating is shown as stopped, then forgotten. */
  function sweep() {
    const now = Date.now()
    for (const [id, s] of sessions) {
      const age = now - s.lastSeen
      if (age > config.dropMs) {
        s.watch.close()
        sessions.delete(id)
      } else s.alive = age <= config.deadMs
    }
    publish()
  }
  setInterval(sweep, Math.max(50, Math.min(1000, config.deadMs / 4)))
  // files of sessions that ended; the first tidy waits, so sessions that are alive have registered by then
  const tidy = () => cleanLiveDir(liveDir, { isRegistered: id => sessions.has(id), olderThanMs: config.staleMs })
  // only the real live directory is ever tidied: a dev run with --state in some other folder leaves its folder alone
  if (basename(resolve(liveDir)) === 'live') {
    setTimeout(tidy, config.cleanupDelayMs)
    setInterval(tidy, 3600_000)
  }
  setInterval(() => {
    for (const res of clients) res.write(': ping\n\n')
  }, HEARTBEAT_MS).unref()

  // ---- routes -----------------------------------------------------------------------------------------------

  const fileOr404 = (res, path, type) => {
    let body
    try {
      body = readFileSync(path)
    } catch {
      return plain(res, 404, 'not found')
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body)
  }

  /** Serves only names that appear in a listing of web/vendor, so no request path can reach anything else. */
  function serveVendor(res, pathname) {
    let name
    try {
      name = decodeURIComponent(pathname.slice('/vendor/'.length))
    } catch {
      return plain(res, 404, 'not found')
    }
    const listed = readdirSync(vendorDir, { withFileTypes: true }).some(entry => entry.isFile() && entry.name === name)
    if (!listed) return plain(res, 404, 'not found')
    fileOr404(res, join(vendorDir, name), TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream')
  }

  /** Is this request from the page itself? Origin (when sent) must be our own; a browser fetch must be same-origin. */
  function fromOwnPage(req) {
    const port = server.address().port
    const origin = req.headers.origin
    if (origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return false
    if (req.method !== 'POST') return true
    const site = req.headers['sec-fetch-site']
    return site === undefined || site === 'same-origin' || site === 'none'
  }

  /** Session servers only: ping, register (also their heartbeat), and a login code for the page with the open page count. */
  function hubRoute(req, res, pathname) {
    if (!same(req.headers['x-hq-secret'], secret)) return plain(res, 403, 'forbidden')
    if (pathname === '/hub/ping' && req.method === 'GET') return json(res, 200, { pid: process.pid })
    if (pathname === '/hub/code' && req.method === 'POST') {
      req.resume()
      // with the open page count: /hq web opens no tab while one shows the page (it shows every session)
      return json(res, 200, { code: mintCode(), pages: clients.size })
    }
    if (pathname === '/hub/approval' && req.method === 'POST' && config.approvals) return holdApproval(req, res)
    if (pathname === '/hub/register' && req.method === 'POST') {
      return readJson(req, res, info => {
        const problem = register(info)
        if (problem) json(res, 400, { error: problem })
        else json(res, 200, { ok: true })
      })
    }
    plain(res, 404, 'not found')
  }

  /** web/approve.mjs waits here (the answer is { decision }) until a page answers, it times out, or the helper goes away. */
  function holdApproval(req, res) {
    readJson(req, res, body => {
      const { session, ...request } = body ?? {}
      const target = sessions.get(session)
      if (!target?.alive) return json(res, 404, { error: 'unknown or stopped session' })
      const problem = checkRequest(request)
      if (problem) return json(res, 400, { error: problem })
      const held = approvals.hold(request, basename(target.cwd) || target.cwd, decision => json(res, 200, { decision }))
      if (typeof held === 'string') return json(res, 409, { error: held === 'busy' ? 'another approval is open' : 'this approval was already settled' })
      res.on('close', () => { if (!res.writableEnded) held.gone() })
    }, MAX_INPUT + 4096)
  }

  /** A page's answer to the open approval: the cookie (checked by the caller), the page's exact origin, a same-origin fetch, JSON. */
  function answerApproval(req, res, id) {
    const port = server.address().port
    const origin = req.headers.origin
    const own = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
    if (!own.includes(origin) || origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] !== 'same-origin') return plain(res, 403, 'forbidden')
    readJson(req, res, body => {
      const status = approvals.answer(id, body)
      json(res, status, status === 200 ? { ok: true } : { error: { 400: 'decision must be allow, deny or ask', 403: 'forbidden', 404: 'no such approval', 409: 'already answered or withdrawn' }[status] })
    })
  }

  /** The page's request: checked here, then handed to the session it is for, and answered once that session queued it. */
  function takeAction(req, res) {
    readJson(req, res, async body => {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return json(res, 400, { error: 'unknown action' })
      const { session, ...rest } = body
      const clean = checkAction(rest)
      if (isString(clean)) return json(res, 400, { error: clean })
      if (!isString(session)) return json(res, 400, { error: 'an action needs a session' })
      const target = sessions.get(session)
      if (!target?.alive) return json(res, 404, { error: 'unknown or stopped session' })
      const answer = await localRequest(target.port, '/hub/forward', { method: 'POST', secret: target.secret, body: clean, timeoutMs: FORWARD_TIMEOUT_MS })
      if (answer?.status === 202 && Number.isFinite(answer.json?.id)) json(res, 202, { session, id: answer.json.id })
      else if (answer?.status === 429) json(res, 429, { error: 'too many requests are waiting for the session; try again shortly' })
      else json(res, 503, { error: 'the session did not accept the action' })
    })
  }

  function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!hostIsLocal(req) || !fromOwnPage(req)) return plain(res, 403, 'forbidden')
    if (url.pathname.startsWith('/hub/')) return hubRoute(req, res, url.pathname)

    const code = url.searchParams.get('c')
    // a browser that is logged in already goes to the page whatever code the link carries (a used link must not strand it)
    if (url.pathname === '/' && code !== null && hasSession(req)) return res.writeHead(302, { location: '/', 'cache-control': 'no-store' }).end()
    if (url.pathname === '/' && code !== null) {
      if (!redeemCode(code)) return plain(res, 403, 'forbidden')
      return res.writeHead(302, { location: '/', 'set-cookie': `${cookieName()}=${sessionCookie}; HttpOnly; SameSite=Strict; Path=/`, 'cache-control': 'no-store' }).end()
    }
    // the pages a person opens say how to get back in; the files and endpoints behind them just refuse
    if (!hasSession(req)) return plain(res, 403, PAGES.includes(url.pathname) ? 'forbidden: open the page again with /hq web' : 'forbidden')

    if (url.pathname === '/') {
      fileOr404(res, join(webDir, 'index.html'), 'text/html; charset=utf-8')
    } else if (PAGE_FILE.test(url.pathname)) {
      const name = url.pathname.slice(1)
      // only a file the directory listing names, like serveVendor, so nothing outside web/ is reachable
      const listed = readdirSync(webDir, { withFileTypes: true }).some(entry => entry.isFile() && entry.name === name)
      if (listed) fileOr404(res, join(webDir, name), TYPES[name.slice(name.lastIndexOf('.'))])
      else plain(res, 404, 'not found')
    } else if (url.pathname.startsWith('/vendor/')) {
      serveVendor(res, url.pathname)
    } else if (url.pathname === '/state') {
      for (const s of sessions.values()) s.watch.read()
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(envelope())
    } else if (url.pathname === '/action' && req.method === 'POST') {
      takeAction(req, res)
    } else if (config.approvals && url.pathname.startsWith('/approval/') && req.method === 'POST' && APPROVAL_ID.test(url.pathname.slice('/approval/'.length))) {
      answerApproval(req, res, url.pathname.slice('/approval/'.length))
    } else if (url.pathname === '/events') {
      if (clients.size >= config.maxClients) return plain(res, 429, 'too many pages are open')
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      send(res, envelope())
      const waiting = approvals.current()
      if (waiting) sendEvent(res, 'approval', waiting)
      clients.add(res)
      writePages()
      req.on('close', () => {
        clients.delete(res)
        writePages()
      })
    } else {
      plain(res, 404, 'not found')
    }
  }

  const server = createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value)
    try {
      route(req, res)
    } catch (error) {
      console.error(`agent-hq web: ${error.stack ?? error}`)
      if (!res.headersSent) plain(res, 500, 'server error')
      else res.destroy()
    }
  })

  /** Listens on the wanted port, or on any free one if it is taken or not allowed. Resolves the port. */
  function listen(wanted) {
    return new Promise((resolve, reject) => {
      const attempt = port => {
        const onError = error => {
          if (port !== 0 && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) attempt(0)
          else reject(error)
        }
        server.once('error', onError)
        server.listen(port, '127.0.0.1', () => {
          server.off('error', onError)
          server.on('error', error => console.error(`agent-hq web: ${error.message}`))
          resolve(server.address().port)
        })
      }
      attempt(wanted)
    })
  }

  return { listen, register, mintCode }
}
