// Shared by the real-browser tests (browser.test.mjs, live.test.mjs): a throwaway world (temp dir, children cleaned up even on
// failure), real session servers with scripted mods, and a headless Chrome of its own (throwaway profile, its own debugging
// port; the person's Chrome is never touched). Not a test file.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

export const SERVER = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs')
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const ENV = { AGENT_HQ_HEARTBEAT_MS: '250', AGENT_HQ_DEAD_MS: '1500' }
/** 1 on a quiet machine; AGENT_HQ_TEST_SLOWDOWN or the load per core raises every wait and timeout (capped at 10). */
export const SLOWDOWN = Math.min(10, Math.max(1, Number(process.env.AGENT_HQ_TEST_SLOWDOWN) || 0, Math.ceil(loadavg()[0] / cpus().length / 0.7)))
export const slow = ms => ms * SLOWDOWN
export const CHROME = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => p && existsSync(p))
export const skip = CHROME ? false : 'no Chrome found (set CHROME_BIN)'

export async function until(check, ms = 8000, what = 'condition') {
  const deadline = Date.now() + slow(ms)
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(25)
  }
}

const children = new Set()
process.on('exit', () => children.forEach(c => c.kill('SIGKILL')))
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => (children.forEach(c => c.kill('SIGKILL')), process.exit(130)))

// ---- sample snapshots (what hooks/live.ts writes) ---------------------------------------------------------------------

const COLORS = ['#8b7cff', '#3ee0a4', '#ffb84d', '#ff6b8a', '#4da3ff', '#c58bff']
const TONE = { running: 'running', pending: 'running', waiting: 'needs_input', idle: 'needs_input', completed: 'done', failed: 'error', killed: 'error' }
const FRAME = Array.from({ length: 10 }, () => 'oooooooooooo')

/** One agent row: status decides the tone and mascot state; `over` overrides any field. */
export function agentRow(id, nickname, status, over = {}) {
  const tone = TONE[status]
  const color = COLORS[Math.abs([...id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % COLORS.length]
  const isMain = id === 'main'
  const now = Date.now()
  return {
    id,
    parentId: isMain ? null : 'main',
    name: isMain ? 'main' : id,
    nickname,
    role: isMain ? 'Tech Lead' : 'Developer',
    status: isMain ? 'running' : status,
    tone: isMain && !over.tone ? (status === 'running' ? 'running' : 'done') : tone,
    isMain,
    mascot: { type: 'star', color, hat: 'none', state: tone === 'running' ? 'working' : tone === 'done' ? 'sleeping' : 'default', frames: [FRAME, FRAME, FRAME], palette: { o: color } },
    now: tone === 'running' ? 'Editing view.tsx' : isMain ? 'leading the team' : status === 'completed' ? 'done' : status,
    next: tone === 'running' ? 'Run the tests' : null,
    last: null,
    todos: null,
    tools: 5,
    lastTool: 'Edit',
    startedAt: now - 60_000,
    endedAt: tone === 'done' ? now - 5_000 : null,
    ...over,
  }
}

/** A LiveSnapshot: `agents` are [id, nickname, status] triples after the lead; `mark` shows in the team's purpose. */
export function buildSnapshot({ team, mark = 0, lead = 'running', agents = [['dev1', 'Mochi-chan', 'running']], tasks = [], events = [], notice = null, roles, hideFinished = false, lastAction = 0 }) {
  const rows = [agentRow('main', `Captain ${team}`, lead), ...agents.map(([id, nick, status, over]) => agentRow(id, nick, status, over))]
  const members = rows.filter(a => !a.isMain)
  const running = members.filter(a => a.tone === 'running').length
  const done = members.filter(a => a.tone === 'done').length
  return {
    v: 1,
    at: Date.now(),
    team: { name: team, purpose: `purpose ${mark}`, lead: 'Tech Lead' },
    overall: { done: 0, active: running, total: members.length },
    tasksProgress: { done: tasks.filter(t => t.status === 'completed').length, active: tasks.filter(t => t.status === 'in_progress').length, total: tasks.length },
    agents: rows,
    tasks,
    roles: roles ?? [{ id: 'dev', title: 'Developer', count: 5, active: running }],
    notice,
    hideFinished,
    events,
    lastAction,
    _done: done,
  }
}

// ---- a scripted mod: handles each action id once, acknowledges through the state file -------------------------------

export class Mod {
  /** `make(mark)` returns the snapshot to write; replace `this.make` to change what the session shows. */
  constructor(name, dir, make) {
    this.name = name
    this.make = typeof make === 'function' ? make : mark => buildSnapshot({ team: make, mark })
    this.statePath = join(dir, `${name}.json`)
    this.handled = [] // { id, action }
    this.last = 0
    this.mark = 0
    this.write()
  }

  attach(child) {
    let partial = ''
    const lines = []
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      const parts = (partial + chunk).split('\n')
      partial = parts.pop()
      for (const line of parts) {
        lines.push(line)
        if (!line.startsWith('AGENT_HQ_ACTION ')) continue
        const action = JSON.parse(line.slice('AGENT_HQ_ACTION '.length))
        if (action.id > this.last) (this.last = action.id), this.handled.push({ id: action.id, action })
      }
      this.write()
    })
    return lines
  }

  /** Writes the state the way the real mod does (temp file, then rename). `extra` is merged over the snapshot. */
  write(mark = this.mark, extra = {}) {
    this.mark = mark
    const { _done, ...snap } = this.make(mark)
    const tmp = `${this.statePath}.tmp`
    writeFileSync(tmp, JSON.stringify({ ...snap, ...extra, lastAction: this.last }))
    renameSync(tmp, this.statePath)
  }
}

export async function startSession(world, name, mod, { env = {} } = {}) {
  const cwd = join(world.dir, name) // the page labels an island by its folder name
  mkdirSync(cwd, { recursive: true })
  const child = spawn(process.execPath, [SERVER, '--state', mod.statePath, '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...ENV, ...env } })
  children.add(child)
  world.children.push(child)
  child.stderr.on('data', () => {})
  const exited = new Promise(resolve => child.on('exit', resolve))
  const lines = mod.attach(child)
  const url = await until(() => lines.find(l => l.startsWith('AGENT_HQ_URL ')), 10_000, `${name} AGENT_HQ_URL`)
  return { name, child, mod, url: url.slice('AGENT_HQ_URL '.length), kill: async signal => (child.kill(signal), signal === 'SIGKILL' && (await exited)) }
}

export function newWorld(t) {
  const world = { dir: mkdtempSync(join(tmpdir(), 'agent-hq-browser-')), children: [], browsers: [] }
  t.after(async () => {
    for (const b of world.browsers) await b.stop()
    for (const c of world.children) (c.kill('SIGCONT'), c.kill('SIGKILL'), children.delete(c))
    try {
      rmSync(world.dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
    } catch {} // a temp dir that will not go is the OS's to clean; it must never fail a test
  })
  return world
}

/** `alpha` starts first and becomes the hub; `beta` registers with it. Each has its own mod; `makes` are `[teamNameOrMakeFn, ...]`. */
export async function twoSessions(world, [alphaMake = 'Alpha Team', betaMake = 'Beta Team'] = []) {
  const alphaMod = new Mod('alpha', world.dir, alphaMake)
  const betaMod = new Mod('beta', world.dir, betaMake)
  const alpha = await startSession(world, 'alpha', alphaMod)
  const beta = await startSession(world, 'beta', betaMod)
  return { alpha, beta, alphaMod, betaMod }
}

// ---- a headless Chrome of its own ----------------------------------------------------------------------------------------

/** `size` is the window in CSS px; `webgl: false` starts Chrome with the 3D APIs off (the person's Chrome today). */
export async function launchBrowser(world, { width = 1400, height = 900, webgl = true, mobile = false } = {}) {
  const profile = join(world.dir, `chrome-profile-${world.browsers.length}`)
  mkdirSync(profile, { recursive: true })
  const flags = webgl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--disable-3d-apis', '--disable-gpu']
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', ...flags, `--window-size=${width},${height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] })
  children.add(chrome)
  let ws = null
  const stop = async () => {
    try {
      ws?.close()
    } catch {}
    const gone = new Promise(resolve => chrome.once('exit', resolve))
    chrome.kill('SIGKILL')
    await Promise.race([gone, sleep(3000)])
    await sleep(300) // Chrome's helper processes close their profile files a moment after it
    children.delete(chrome)
  }
  world.browsers.push({ stop }) // closed with its test even when the launch below fails
  const portFile = join(profile, 'DevToolsActivePort')
  await until(() => existsSync(portFile), 20_000, 'Chrome debugging port')
  await sleep(100)
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
  ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('could not connect to Chrome')), { once: true })
  })
  let id = 0
  const pending = new Map()
  const listeners = []
  ws.addEventListener('message', event => {
    const m = JSON.parse(String(event.data))
    if (m.id && pending.has(m.id)) {
      const w = pending.get(m.id)
      pending.delete(m.id)
      m.error ? w.reject(new Error(`${w.method}: ${m.error.message}`)) : w.resolve(m.result ?? {})
    } else if (m.method) for (const l of listeners) if (l.method === m.method) l.fn(m.params)
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id
      const timer = setTimeout(() => (pending.delete(n), reject(new Error(`${method} timed out`))), slow(30_000))
      pending.set(n, { method, resolve: v => (clearTimeout(timer), resolve(v)), reject: e => (clearTimeout(timer), reject(e)) })
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId)
  await send('Target.activateTarget', { targetId })
  const requests = new Map() // requestId -> { method, url, body, status, failed }
  const consoleErrors = []
  listeners.push({ method: 'Network.requestWillBeSent', fn: p => requests.set(p.requestId, { method: p.request.method, url: p.request.url, body: p.request.postData, at: performance.now(), type: p.type }) })
  listeners.push({ method: 'Network.responseReceived', fn: p => requests.has(p.requestId) && Object.assign(requests.get(p.requestId), { status: p.response.status, answeredAt: performance.now() }) })
  listeners.push({ method: 'Network.loadingFailed', fn: p => requests.has(p.requestId) && Object.assign(requests.get(p.requestId), { failed: p.errorText, answeredAt: performance.now() }) })
  await send('Runtime.enable', {}, sessionId)
  listeners.push({ method: 'Runtime.exceptionThrown', fn: p => consoleErrors.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text) })
  // a probe for idle cost: counts canvas draw calls per canvas (installed before the page's own scripts when asked for)
  const PROBE = `(() => { if (window.__probe) return; const P = (window.__probe = { canvases: [] }); const track = c => P.canvases.find(x => x.el === c) || (P.canvases.push({ el: c, calls: 0 }), P.canvases.at(-1)); const wrap = (proto, names) => { if (!proto) return; for (const n of names) { const o = proto[n]; if (typeof o === 'function') proto[n] = function (...a) { track(this.canvas).calls++; return o.apply(this, a) } } }; wrap(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, ['fillRect', 'clearRect', 'drawImage', 'fill', 'stroke', 'fillText', 'putImageData']); wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype, ['drawArrays', 'drawElements', 'clear']); wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'clear']); window.__probeReset = () => P.canvases.forEach(c => (c.calls = 0)) })()`
  const browser = {
    requests,
    /** Browser-level CDP (tracing and the like) and its events. */
    root: (method, params) => send(method, params),
    on: (method, fn) => listeners.push({ method, fn }),
    /** Call before open(): installs the canvas probe. */
    installProbe: () => send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE }, sessionId),
    /**
     * Leaves the page alone for `seconds` and reports what it cost: compositor frames per second (from a trace), running CSS
     * animations, and the canvases that kept drawing (with whether they are on screen). Needs installProbe() before open().
     */
    async idleCost(seconds = 5) {
      const events = []
      listeners.push({ method: 'Tracing.dataCollected', fn: p => events.push(...p.value) })
      let done
      const completed = new Promise(resolve => (done = resolve))
      listeners.push({ method: 'Tracing.tracingComplete', fn: () => done() })
      await browser.eval('window.__probeReset && window.__probeReset()')
      await send('Tracing.start', { categories: 'cc,viz,benchmark,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' })
      const t0 = performance.now()
      await sleep(seconds * 1000)
      const wall = (performance.now() - t0) / 1000
      await send('Tracing.end')
      await Promise.race([completed, sleep(slow(8000))])
      // DrawFrame is logged by every compositor (the page's, the browser UI's): the busiest tree is the page's. A headless Chrome has
      // no display clock, so it can draw faster than 60 a second; what matters is whether frames keep coming at all.
      const byTree = new Map()
      for (const e of events) if (e.name === 'DrawFrame') byTree.set(`${e.pid}/${e.args?.layerTreeId}`, (byTree.get(`${e.pid}/${e.args?.layerTreeId}`) ?? 0) + 1)
      const frames = Math.max(0, ...byTree.values()) / wall
      const page = await browser.eval(`(() => { const vw = innerWidth, vh = innerHeight; const inView = r => r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh && r.width > 0 && r.height > 0; return JSON.stringify({ animations: document.getAnimations().filter(a => a.playState === 'running').length, animationNames: document.getAnimations().filter(a => a.playState === 'running').map(a => (a.animationName || a.transitionProperty || 'script') + ' on ' + (a.effect && a.effect.target ? a.effect.target.tagName.toLowerCase() + (a.effect.target.className && typeof a.effect.target.className === 'string' ? '.' + a.effect.target.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : '?')), canvases: ((window.__probe && window.__probe.canvases) || []).filter(c => c.calls > 0).map(c => ({ calls: c.calls, connected: c.el.isConnected, inView: c.el.isConnected && inView(c.el.getBoundingClientRect()) })) }) })()`)
      return { framesPerSecond: +frames.toFixed(1), seconds: wall, ...JSON.parse(page) }
    },
    posts: () => [...requests.values()].filter(r => r.method === 'POST' && r.url.endsWith('/action')),
    consoleErrors,
    send: (method, params) => send(method, params, sessionId),
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    },
    async open(url) {
      await send('Page.navigate', { url }, sessionId)
    },
    text: () => browser.eval('document.body ? document.body.innerText : ""'),
    /** Sets a textarea/input the way a person typing does (React sees the input event). */
    async type(selector, value) {
      await browser.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    },
    /** Clicks the first element matching `selector` whose text matches `text` (a regex source), or any when omitted. */
    async click(selector, text) {
      const ok = await browser.eval(`(() => { const re = ${text ? `new RegExp(${JSON.stringify(text)}, 'i')` : 'null'}; const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => !re || [e.textContent.trim(), e.title || '', e.getAttribute('aria-label') || ''].some(x => re.test(x))); if (!el) return false; el.click(); return true })()`)
      if (!ok) throw new Error(`nothing to click for ${selector}${text ? ` /${text}/` : ''}`)
    },
    /** A real mouse click at CSS pixel (x, y): pointer events the way a person's click makes them. */
    async mouseClick(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId)
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId)
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId)
    },
    /** Clicks the centre of the first element matching `selector` (and, when given, whose text matches `text`) with a real mouse. */
    async mouseClickOn(selector, text) {
      const point = await browser.eval(`(() => { const re = ${text ? `new RegExp(${JSON.stringify(text)}, 'i')` : 'null'}; const el = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).find(e => !re || re.test(e.textContent.trim())); if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
      if (!point) throw new Error(`nothing to click for ${selector}${text ? ` /${text}/` : ''}`)
      await browser.mouseClick(point.x, point.y)
    },
    async shot(path) {
      writeFileSync(path, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64'))
    },
    stop,
  }
  return browser
}
