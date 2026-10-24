// One async mutex for the work that reads the roster and then changes it (pick a name, count a role, record the
// assignment, start the agent, list it): two such runs interleaving would share a name or overfill a role. Module
// state on purpose: the page's spawn path and the lead's tools run in the same process and must queue on the same tail.
// A run that never settles (a spawn that hangs) would block every later one, so a run is given LOCK_TIMEOUT_MS: after
// that the lock is let go and the caller gets a LockTimeout. The abandoned work is not run again, but it is not cancelled
// either (a promise cannot be): a spawn that finally succeeds after the timeout still starts its agent, so a retry may
// start a second one. The timeout message says to check the sidebar first; only its result is dropped.
// withListLock is a second, separate lock for the task list (tasks.json read-change-write), so a hung spawn never stalls turn accounting.

export const LOCK_TIMEOUT_MS = 60_000

type Timer = { cancel: () => void }
type After = (ms: number, fn: () => void) => Timer

// the engine's clock (`$.clock.after`), set by register.tsx at session start: a hooks module has no timers of its own.
// Without one (a unit test that sets none) a run is simply not timed.
let after: After | null = null

export const configureLock = (timer: After | null) => {
  after = timer
}

export class LockTimeout extends Error {}

type LockOptions = { timeoutMs?: number; label?: string }

function within<T>(work: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const timeAfter = after
  if (!timeAfter) return Promise.resolve().then(work)
  return new Promise<T>((resolve, reject) => {
    const timer = timeAfter(timeoutMs, () => reject(new LockTimeout(`Agent HQ: ${label} took too long; check the sidebar before retrying`)))
    Promise.resolve()
      .then(work)
      .then(resolve, reject)
      .finally(() => timer.cancel())
  })
}

/** A mutex of its own: runs `work` once every earlier run of the same lock has settled; a failure or a timeout in one never blocks the next. */
function makeLock() {
  let tail: Promise<unknown> = Promise.resolve()
  return function lock<T>(work: () => Promise<T>, { timeoutMs = LOCK_TIMEOUT_MS, label = 'the request' }: LockOptions = {}): Promise<T> {
    const run = tail.then(() => within(work, timeoutMs, label))
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

/** The roster's lock (see the top of this file). */
export const withLock = makeLock()

/** The task list's own lock: a spawn that hangs under `withLock` must not stall turn accounting, nor a hung list write block spawning. */
export const withListLock = makeLock()
