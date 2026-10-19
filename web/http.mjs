// Small HTTP helpers shared by the hub and the session servers (web/hub.mjs, web/server.mjs). No dependencies.

import { createHash, timingSafeEqual } from 'node:crypto'
import { request } from 'node:http'

export const MAX_BODY = 16 * 1024

export const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

export const isString = value => typeof value === 'string'
export const plain = (res, status, text, headers) => res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers }).end(text)
export const json = (res, status, body, headers) => res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body))

const digest = value => createHash('sha256').update(value).digest()
/** Constant-time string equality (both sides hashed first, so lengths never leak). */
export const same = (a, b) => isString(a) && isString(b) && timingSafeEqual(digest(a), digest(b))

/** Only this machine's own address (DNS rebinding and other sites stay out). */
export const hostIsLocal = req => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  return host === '127.0.0.1' || host === 'localhost'
}

/** Calls the callback with the parsed JSON body, or answers 415 / 400 itself. */
export function readJson(req, res, handler) {
  if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
    req.resume()
    json(res, 415, { error: 'content-type must be application/json' })
    return
  }
  let body = ''
  let refused = false
  req.setEncoding('utf8')
  req.on('data', chunk => {
    if (refused) return // the rest of an oversized body is read and dropped
    body += chunk
    if (body.length > MAX_BODY) {
      // answer the refusal and let the client finish sending, rather than cutting the connection with no answer
      refused = true
      body = ''
      json(res, 400, { error: 'request too large' }, { connection: 'close' })
    }
  })
  req.on('end', () => {
    if (refused) return
    let value
    try {
      value = JSON.parse(body)
    } catch {
      json(res, 400, { error: 'not JSON' })
      return
    }
    handler(value)
  })
}

/** One request to a server on this machine. Resolves { status, json } or null if it could not be reached in time. */
export function localRequest(port, path, { method = 'GET', secret, body, timeoutMs = 1500 } = {}) {
  return new Promise(resolve => {
    const headers = {}
    if (secret) headers['x-hq-secret'] = secret
    if (body !== undefined) headers['content-type'] = 'application/json'
    const req = request({ host: '127.0.0.1', port, path, method, headers, timeout: timeoutMs }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (text += chunk))
      res.on('end', () => {
        let parsed = null
        try {
          parsed = JSON.parse(text)
        } catch {}
        resolve({ status: res.statusCode, json: parsed })
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}
