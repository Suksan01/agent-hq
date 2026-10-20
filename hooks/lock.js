// One async mutex for the work that reads the roster and then changes it (pick a name, count a role, record the
// assignment, start the agent, list it): two such runs interleaving would share a name or overfill a role. Module
// state on purpose: the page's spawn path and the lead's tools run in the same process and must queue on the same tail.
// A run that never settles (a spawn that hangs) would block every later one, so a run is given LOCK_TIMEOUT_MS: after
// that the lock is let go and the caller gets a LockTimeout. The abandoned work is not run again, but it is not cancelled
// either (a promise cannot be): a spawn that finally succeeds after the timeout still starts its agent, so a retry may
// start a second one. The timeout message says to check the sidebar first; only its result is dropped.
export const LOCK_TIMEOUT_MS = 60000;
let tail = Promise.resolve();
// the engine's clock (`$.clock.after`), set by register.tsx at session start: a hooks module has no timers of its own.
// Without one (a unit test that sets none) a run is simply not timed.
let after = null;
export const configureLock = (timer) => {
    after = timer;
};
export class LockTimeout extends Error {
}
function within(work, timeoutMs, label) {
    const timeAfter = after;
    if (!timeAfter)
        return Promise.resolve().then(work);
    return new Promise((resolve, reject) => {
        const timer = timeAfter(timeoutMs, () => reject(new LockTimeout(`Agent HQ: ${label} took too long; check the sidebar before retrying`)));
        Promise.resolve()
            .then(work)
            .then(resolve, reject)
            .finally(() => timer.cancel());
    });
}
/** Runs `work` once every earlier `withLock` has settled; a failure or a timeout in one never blocks the next. */
export function withLock(work, { timeoutMs = LOCK_TIMEOUT_MS, label = 'the request' } = {}) {
    const run = tail.then(() => within(work, timeoutMs, label));
    tail = run.then(() => undefined, () => undefined);
    return run;
}
