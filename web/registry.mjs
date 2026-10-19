// The hub's registry file (hub.json in the live directory): its port, process id and secret, readable by the user only.
// Shared by the session servers (web/server.mjs) and the one-shot login (web/login.mjs). No dependencies.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const registryFile = liveDir => join(liveDir, 'hub.json')

/** The registry's content, or null when there is none or it is not shaped right. */
export function readRegistry(liveDir) {
  try {
    const info = JSON.parse(readFileSync(registryFile(liveDir), 'utf8'))
    return Number.isInteger(info.port) && Number.isInteger(info.pid) && typeof info.secret === 'string' && /^[0-9a-f]{32}$/.test(info.secret) ? info : null
  } catch {
    return null
  }
}

/** Replaces the registry in one step (a temp file renamed over it). */
export function writeRegistry(liveDir, info) {
  const path = registryFile(liveDir)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 })
  renameSync(tmp, path)
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}
