// Watches one JSON file and calls back with its content whenever it changes. No dependencies.
//
// The mod writes state files atomically (temp + rename), which replaces the inode a file watch would hold, so the
// containing directory is watched and events are filtered by name. No such directory: the file is polled instead.
// Events are debounced; a torn (mid-write or invalid) file is read again shortly, and never reported.

import { readFileSync, unwatchFile, watch, watchFile } from 'node:fs'
import { basename, dirname } from 'node:path'

const DEBOUNCE_MS = 20 // state file events come in bursts; read once they settle
const RETRY_MS = 30 // a torn state file is read again this soon
const MAX_RETRIES = 40
const POLL_MS = 250 // watchFile fallback when fs.watch is unavailable

/** onChange(value, text) runs for each new complete JSON object. `read()` checks the file now (true unless it is torn). */
export function watchJson(path, onChange) {
  let text = null
  let value = null
  let timer
  let retries = 0
  let watcher = null
  let polling = false

  function read() {
    let next
    try {
      next = readFileSync(path, 'utf8')
    } catch {
      return true // no file (yet): keep what we have
    }
    if (next === text) return true
    let parsed
    try {
      parsed = JSON.parse(next)
    } catch {
      return false
    }
    if (typeof parsed !== 'object' || parsed === null) return false
    text = next
    value = parsed
    onChange(parsed, next)
    return true
  }

  function settle() {
    if (read()) retries = 0
    else if (++retries <= MAX_RETRIES) timer = setTimeout(settle, RETRY_MS)
    else {
      retries = 0
      console.error(`agent-hq web: ${path} is not valid JSON, waiting for the next write`)
    }
  }
  const kick = () => {
    clearTimeout(timer)
    timer = setTimeout(settle, DEBOUNCE_MS)
  }
  const poll = () => {
    polling = true
    watchFile(path, { interval: POLL_MS }, kick)
  }

  const name = basename(path)
  try {
    watcher = watch(dirname(path), (_event, file) => {
      if (!file || file === name) kick()
    })
    watcher.on('error', () => {
      watcher?.close()
      watcher = null
      poll()
    })
  } catch {
    poll()
  }

  return {
    read,
    get text() {
      return text
    },
    get value() {
      return value
    },
    close() {
      clearTimeout(timer)
      watcher?.close()
      if (polling) unwatchFile(path, kick)
    },
  }
}
