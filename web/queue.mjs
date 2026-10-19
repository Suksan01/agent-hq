// A session's action queue: the page's requests, checked, numbered, kept in a private file and printed until the mod
// acknowledges them. No dependencies.

import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isString } from './http.mjs'

const ROLE = /^[A-Za-z0-9_-]{1,48}$/
const AGENT = /^[A-Za-z0-9_@.:-]{1,128}$/
const textOf = (value, max = 4000) => (isString(value) ? value.trim().slice(0, max) : '')

const KEY = /^[A-Za-z0-9_-]{1,64}$/
const MAX_LINE = 16 * 1024 // a queue line longer than a request may be (a line of the file is never trusted more than a request)
const MAX_KEYS = 2000 // idempotency keys remembered

/**
 * The page's request as Agent HQ takes it, or why it is refused. Only these five kinds, with checked fields, and an
 * optional `key` (the page's own id for this click, 1-64 of A-Za-z0-9_-): sending the same key again, say after a
 * timeout, queues nothing new and answers the id the first one got.
 */
export function checkAction(action) {
  const key = action?.key
  if (key !== undefined && !(isString(key) && KEY.test(key))) return 'key must be 1 to 64 letters, digits, _ or -'
  const clean = checkKind(action)
  return isString(clean) || key === undefined ? clean : { ...clean, key }
}

function checkKind(action) {
  switch (action?.type) {
    case 'spawn': {
      const task = textOf(action.task)
      return isString(action.role) && ROLE.test(action.role) && task ? { type: 'spawn', role: action.role, task } : 'spawn needs a role id and a task'
    }
    case 'lead': {
      const text = textOf(action.text)
      return text ? { type: 'lead', text } : 'a message for the lead needs text'
    }
    case 'message': {
      const text = textOf(action.text)
      return isString(action.agent) && AGENT.test(action.agent) && text ? { type: 'message', agent: action.agent, text } : 'a message needs an agent id and text'
    }
    case 'stop':
      return isString(action.agent) && AGENT.test(action.agent) ? { type: 'stop', agent: action.agent } : 'stop needs an agent id'
    case 'finished':
      return ['hide', 'show', 'clear'].includes(action.mode) ? { type: 'finished', mode: action.mode } : 'finished needs mode hide, show or clear'
    default:
      return 'unknown action'
  }
}

/** `acked` is the highest id already handled (ids start above it); `print(action)` writes the AGENT_HQ_ACTION line. */
export function createQueue({ path, acked: initialAcked, print }) {
  let acked = Number.isFinite(initialAcked) ? initialAcked : 0
  let pending = [] // queued actions with id > acked, in id order
  let nextId = acked + 1
  const keys = new Map() // idempotency key -> the id it was given (remembered after the action is acknowledged, too)
  const remember = action => {
    if (!action.key) return
    keys.delete(action.key)
    keys.set(action.key, action.id)
    if (keys.size > MAX_KEYS) keys.delete(keys.keys().next().value)
  }

  /** The mod handled everything up to this id. Anything that is not a finite number acknowledges nothing. */
  function acknowledge(value) {
    if (!Number.isFinite(value) || value <= acked) return
    acked = value
    pending = pending.filter(action => action.id > acked)
  }

  /** Reloads the queue file, drops what the mod already handled (rewriting the file atomically) and prints the rest. */
  function restore() {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      nextId = acked + 1
      return
    }
    // each line is checked again as a request would be; whatever does not pass (hand-edited, damaged) is dropped
    const all = text.split('\n').flatMap(line => {
      if (line.length === 0 || line.length > MAX_LINE) return []
      try {
        const { id, ...request } = JSON.parse(line)
        if (!Number.isInteger(id) || id < 1) return []
        const clean = checkAction(request)
        return isString(clean) ? [] : [{ id, ...clean }]
      } catch {
        return []
      }
    })
    all.forEach(remember)
    nextId = all.reduce((max, action) => Math.max(max, action.id), acked) + 1
    pending = all.filter(action => action.id > acked)
    const tmp = `${path}.tmp`
    writeFileSync(tmp, pending.map(action => `${JSON.stringify(action)}\n`).join(''), { mode: 0o600 })
    renameSync(tmp, path)
    pending.forEach(print)
  }

  /** Queues the action durably, then prints it. Sync on purpose: ids are handed out in order and nothing is lost on a crash. */
  function enqueue(clean) {
    const earlier = clean.key ? keys.get(clean.key) : undefined
    if (earlier !== undefined) return earlier // the same click again: already queued (and printed), nothing new
    nextId = Math.max(nextId, acked + 1)
    const action = { id: nextId++, ...clean }
    appendFileSync(path, `${JSON.stringify(action)}\n`, { mode: 0o600 })
    pending.push(action)
    remember(action)
    print(action)
    return action.id
  }

  return {
    acknowledge,
    restore,
    enqueue,
    reprint: () => pending.forEach(print),
    /** Queued but not yet acknowledged by the mod. */
    pendingCount: () => pending.length,
    /** The id a key was given, if it was used before. */
    idOfKey: key => keys.get(key),
  }
}
