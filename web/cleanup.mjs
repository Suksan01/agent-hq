// Tidies the live directory (~/.claude/agent-hq/live): the state, queue and request files of sessions that ended.
// Run by the hub. Only files of this shape are ever touched, and never the hub's own (hub.json, hub.lock).
// No dependencies.

import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

// <session>.json, plus what hangs on it: .queue.jsonl, the old .actions.jsonl, and the .tmp of each
const SESSION_FILE = /^([A-Za-z0-9][A-Za-z0-9_.@:-]*?)\.json(?:\.(?:queue\.jsonl|actions\.jsonl))?(?:\.tmp)?$/
const HUB_FILES = /^(?:hub\.(?:json|lock)|pages\.json)(?:\.tmp)?$/ // pages.json: the hub's count of open pages, not a session named "pages"

/**
 * Deletes the files of sessions that are not registered and have not been written for `olderThanMs`. Returns the names
 * removed. A file that vanishes or cannot be removed is skipped (another hub may be tidying too).
 */
export function cleanLiveDir(dir, { isRegistered, olderThanMs, now = Date.now() }) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const removed = []
  for (const name of names) {
    const match = SESSION_FILE.exec(name)
    if (!match || HUB_FILES.test(name) || isRegistered(match[1])) continue
    const path = join(dir, name)
    try {
      const stat = statSync(path)
      if (!stat.isFile() || now - stat.mtimeMs < olderThanMs) continue
      unlinkSync(path)
      removed.push(name)
    } catch {}
  }
  return removed
}
