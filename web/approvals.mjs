// The hub's page approvals (0.7.0): a permission ask the mod holds for at most a minute while the person answers it on the
// page. In memory only, one at a time. web/approve.mjs registers one and waits; the open pages get it as an SSE `approval`
// event (with a token that only ever goes over that stream); the first valid answer from a page settles it, and every way it
// ends (answered, timed out, the helper gone) tells the pages `approval-withdrawn`. No dependencies.

import { randomBytes } from 'node:crypto'
import { isString, same } from './http.mjs'

export const APPROVAL_ID = /^[A-Za-z0-9_-]{1,128}$/ // a tool_use_id
export const DECISIONS = ['allow', 'deny', 'ask']
export const MAX_INPUT = 20 * 1024 // a larger input is answered in the terminal
const MAX_TIMEOUT_MS = 60_000
const MAX_TEXT = 200
const MAX_REASON = 2000
const CLOSED_REMEMBERED = 100 // ids already settled, so a late or repeated answer gets 409 rather than 404

const shortText = (value, optional) => (optional && value === null) || (isString(value) && value.length > 0 && value.length <= MAX_TEXT)

/** The request the helper sends, checked; returns an error text or null. */
export function checkRequest(r) {
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return 'not a request'
  if (!isString(r.id) || !APPROVAL_ID.test(r.id)) return 'a bad id'
  if (!shortText(r.agent) || !shortText(r.tool) || !shortText(r.role ?? null, true)) return 'agent, tool and role must be short text'
  if (!shortText(r.setting ?? null, true) || !shortText(r.hook ?? null, true)) return 'setting and hook must be names or null'
  const reason = r.reason ?? null
  if (reason !== null && (!isString(reason) || reason.length > MAX_REASON)) return 'the reason must be text up to 2000 characters, or null'
  if (r.input === undefined || JSON.stringify(r.input).length > MAX_INPUT) return 'the input is missing or too large'
  if (!Number.isInteger(r.timeoutMs) || r.timeoutMs < 1 || r.timeoutMs > MAX_TIMEOUT_MS) return 'timeoutMs must be 1 to 60000'
  return null
}

/** `emit(event, data)` tells every open page. */
export function createApprovals({ emit }) {
  let open = null // { card, settle }
  const closed = []

  const close = id => {
    closed.push(id)
    if (closed.length > CLOSED_REMEMBERED) closed.shift()
    emit('approval-withdrawn', { id })
  }

  /**
   * Holds one approval until a page answers, it times out (ask), or the returned `gone()` is called (the helper left).
   * `done(decision)` is called once with allow | deny | ask (never after `gone()`). Returns { gone }, or 'busy' when another
   * one is open, or 'seen' for an id already settled.
   */
  function hold(request, label, done) {
    if (open) return 'busy'
    if (closed.includes(request.id)) return 'seen'
    const now = Date.now()
    const card = {
      id: request.id, token: randomBytes(16).toString('hex'), agent: request.agent, role: request.role ?? null, tool: request.tool, input: request.input,
      reason: request.reason || null, setting: request.setting ?? null, hook: request.hook ?? null, label, at: now, expiresAt: now + request.timeoutMs,
    }
    const timer = setTimeout(() => settle('ask'), request.timeoutMs)
    const settle = decision => {
      if (open?.card !== card) return
      clearTimeout(timer)
      open = null
      close(card.id)
      if (decision) done(decision)
    }
    open = { card, settle }
    emit('approval', card)
    return { gone: () => settle(null) }
  }

  /** A page's answer: the HTTP status for it. */
  function answer(id, body) {
    if (open?.card.id !== id) return closed.includes(id) ? 409 : 404
    if (typeof body !== 'object' || body === null || !same(body.token, open.card.token)) return 403
    if (!DECISIONS.includes(body.decision)) return 400
    open.settle(body.decision)
    return 200
  }

  return { hold, answer, current: () => open?.card ?? null }
}
