// How a session is named on the page, and which of its results become toasts. Pure, no DOM and no imports, so `node --test`
// can check it; the page (whatever its look) takes its labels and toasts from here.

const TAG_LENGTH = 4

/**
 * Names for sessions: `team` is the team's name (the folder when the session has no team), `folder` the project folder, `tag`
 * the first 4 characters of the session id, only when two alive sessions share both team name and folder. The text forms:
 * `flag` (the big one on the system), `sub` (smaller, under it), `chip` ("Team · folder"), `prefix` (starts toasts and the drawer's
 * "on …": the team, or the folder when there is no team).
 * Takes [{session, label, alive, snapshot}], returns a Map from session to its names.
 */
export function sessionNames(sessions) {
  const base = sessions.map(s => {
    const folder = s.label || 'session'
    const team = s.snapshot?.team?.name || folder
    return { session: s.session ?? null, alive: s.alive !== false, hasTeam: Boolean(s.snapshot?.team?.name), team, folder }
  })
  const alikeAlive = n => base.filter(o => o.alive && o.team === n.team && o.folder === n.folder).length
  const out = new Map()
  for (const n of base) {
    const tag = n.alive && alikeAlive(n) > 1 ? String(n.session ?? '').slice(0, TAG_LENGTH) : ''
    const sub = n.hasTeam ? n.folder : ''
    const suffix = tag ? ` · ${tag}` : ''
    out.set(n.session, {
      team: n.team,
      folder: n.folder,
      tag,
      flag: n.team + suffix,
      sub,
      chip: (n.hasTeam ? `${n.team} · ${n.folder}` : n.folder) + suffix,
      prefix: n.team + suffix,
    })
  }
  return out
}

// ---- result toasts ------------------------------------------------------------------------------------------------

const FAILURE = /^(failed|blocked)\b/i

/**
 * The toasts for a session's push, from its numbered feed (`events`, oldest first, `n` rising): every event of kind 'action' with
 * an `n` above the last seen one, so two results in the same push both show. `lastN` is undefined on the first look, which only
 * records where the feed stands (old events never toast). Returns the toasts and the new `lastN`.
 */
export function actionToasts(lastN, events) {
  const newest = events.reduce((m, e) => Math.max(m, e.n), 0)
  if (lastN === undefined || newest < lastN) return { toasts: [], lastN: newest } // first look, or a feed that started over
  const toasts = events
    .filter(e => e.kind === 'action' && e.n > lastN)
    .sort((a, b) => a.n - b.n)
    .map(e => ({ n: e.n, agent: e.agent, ok: !FAILURE.test(e.text), text: e.text.replace(/^failed:\s*/i, '') }))
  return { toasts, lastN: newest }
}
