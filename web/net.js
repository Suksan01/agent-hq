// How the live page talks to the local server, apart from the page: `postAction` sends one click safely (one idempotency
// key per click, kept across retries, so a retry the server already queued is not run twice) and `connectEvents` keeps the
// state stream open (the browser retries a dropped stream itself, but never one the server ended with an error such as 429).
// Pure: the browser's fetch, EventSource and timers are passed in, so web/net.test.mjs runs it without a browser.

const RETRY_STATUS = new Set([429, 503])
const BACKOFF_MS = 300 // before the first retry, doubled for the next
const EVENTS_FIRST_MS = 1000
const EVENTS_CAP_MS = 30_000
const CLOSED = 2 // EventSource.CLOSED
const LOGIN_LOST_AFTER = 3 // consecutive 403s: the page's cookie is gone, and no retry brings it back

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One key per click: 1-64 of A-Za-z0-9_- (what the server accepts). */
export function newKey(random = Math.random) {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid
  return Array.from({ length: 32 }, () => Math.floor(random() * 36).toString(36)).join('') // no crypto here (an old browser): random enough for a click id
}

/**
 * POSTs an action to /action with one idempotency key, and sends the SAME key again (up to `retries` more times, after a
 * short backoff) while the answer is 503, 429 or the network fails. Any other answer is final: a 400 or 404 never retries.
 * @returns {Promise<{ ok: boolean, status: number }>} `status` is 0 when the server was never reached
 */
export async function postAction(action, { fetch = globalThis.fetch, retries = 2, wait = sleep, key = newKey() } = {}) {
  const body = JSON.stringify({ ...action, key })
  let status = 0
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await wait(BACKOFF_MS * 2 ** (attempt - 1))
    const res = await fetch('/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => null)
    status = res?.status ?? 0
    if (res?.ok) return { ok: true, status }
    if (res && !RETRY_STATUS.has(status)) break
  }
  return { ok: false, status }
}

/**
 * Opens the state stream and keeps it open: when it ends for good (readyState CLOSED, e.g. a 429 because too many pages
 * are open) it is opened again after 1 s, doubling to 30 s, with jitter; a message or an open starts the wait over.
 * While the browser is retrying by itself (CONNECTING) nothing is done here.
 * An EventSource cannot say why it ended, so each time it ends for good `probe` asks the server (an authenticated GET, by
 * default /state) and a 403 three times in a row means the login cookie is lost: reconnecting stops and `onError('login-lost')`
 * is called (every other call is `onError()`).
 * `named` handles the stream's named events (event name -> handler), such as the hub's `approval` and `approval-withdrawn`.
 * @param {{ onMessage?: (event: MessageEvent) => void, onOpen?: () => void, onError?: (reason?: 'login-lost') => void, named?: Record<string, (event: MessageEvent) => void> }} handlers
 * @returns {() => void} closes the stream and stops reconnecting
 */
export function connectEvents(url, handlers, {
  EventSource = globalThis.EventSource, setTimeout: later = globalThis.setTimeout, clearTimeout: cancel = globalThis.clearTimeout, random = Math.random,
  probe = () => globalThis.fetch('/state').then(res => res.status, () => 0),
} = {}) {
  let source = null
  let timer = null
  let failures = 0
  let denied = 0 // consecutive 403s from the probe
  let stopped = false
  const schedule = () => {
    const wait = Math.min(EVENTS_CAP_MS, EVENTS_FIRST_MS * 2 ** failures++)
    timer = later(open, Math.round(wait * (0.8 + 0.4 * random())))
  }
  const open = () => {
    timer = null
    source = new EventSource(url)
    source.onopen = () => {
      failures = denied = 0
      handlers.onOpen?.()
    }
    source.onmessage = event => {
      failures = denied = 0
      handlers.onMessage?.(event)
    }
    for (const [name, handle] of Object.entries(handlers.named ?? {})) source.addEventListener(name, handle)
    source.onerror = () => {
      handlers.onError?.()
      if (stopped || source.readyState !== CLOSED) return
      Promise.resolve(probe()).catch(() => 0).then(status => {
        if (stopped) return
        denied = status === 403 ? denied + 1 : 0
        if (denied < LOGIN_LOST_AFTER) return schedule()
        stopped = true
        handlers.onError?.('login-lost')
      })
    }
  }
  open()
  return () => {
    stopped = true
    if (timer !== null) cancel(timer)
    source?.close()
  }
}
