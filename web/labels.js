// How a session is named on the page, and which of its results become toasts. Pure, no DOM and no imports, so `node --test`
// can check it; the page (whatever its look) takes its labels and toasts from here.

/**
 * Names for sessions: `team` is the team's name (the folder when the session has no team), `folder` the project folder, `tag`
 * "#1", "#2"… only when two alive sessions share both team name and folder (numbered in session id order). The text forms:
 * `flag` (the team as every title, list and toast shows it: "Web Team #2"), `sub` (smaller, under it: the folder), `chip`
 * (the flag, with the folder only when the same team name runs in another folder too), `prefix` (starts toasts: the flag).
 * Takes [{session, label, alive, snapshot}], returns a Map from session to its names.
 */
export function sessionNames(sessions) {
  const base = sessions.map(s => {
    const folder = s.label || 'session'
    const team = s.snapshot?.team?.name || folder
    return { session: s.session ?? null, alive: s.alive !== false, hasTeam: Boolean(s.snapshot?.team?.name), team, folder }
  })
  const twins = n => base.filter(o => o.alive && o.team === n.team && o.folder === n.folder).sort((x, y) => String(x.session).localeCompare(String(y.session)))
  const elsewhere = n => base.some(o => o.hasTeam && o.team === n.team && o.folder !== n.folder)
  const out = new Map()
  for (const n of base) {
    const alike = n.alive ? twins(n) : []
    const tag = alike.length > 1 ? `#${alike.indexOf(n) + 1}` : ''
    const flag = n.team + (tag ? ` ${tag}` : '')
    out.set(n.session, {
      team: n.team,
      folder: n.folder,
      tag,
      flag,
      sub: n.hasTeam ? n.folder : '',
      chip: n.hasTeam && elsewhere(n) ? `${n.team} · ${n.folder}${tag ? ` ${tag}` : ''}` : flag,
      prefix: flag,
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
