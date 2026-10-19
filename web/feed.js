// The activity feed's logic, with no DOM and no imports so `node --test` can check it. A session's snapshot carries its last
// 200 events, oldest first, numbered by `n` (which only rises); the page shows them newest first, and says so when it
// missed some, so no gap is hidden.

export const GLYPH = { tool: '▸', step: '✓', status: '●', message: '✉', action: '⚑' }

export const newestN = events => events.reduce((m, e) => Math.max(m, e.n), 0)

/**
 * What a push brought, given the highest `n` seen before (undefined on the first look, which shows nothing as new). `lost`
 * counts events numbered between the two looks that are no longer in the list (it keeps only the last 200).
 * A smaller `n` than before means the session restarted its feed: nothing is new, and the count starts over.
 */
export function arrivals(prevN, events) {
  const maxN = newestN(events)
  if (prevN === undefined || maxN < prevN) return { maxN, added: [], jumped: 0, lost: 0 }
  const added = events.filter(e => e.n > prevN)
  const jumped = maxN - prevN
  return { maxN, added, jumped, lost: Math.max(0, jumped - added.length) }
}

/** The "caught up" row for a push, when the page reconnected or some events fell out of the list; otherwise nothing. */
export function catchUpRow(session, label, seen, events, reconnected) {
  if (seen.jumped <= 0 || !(reconnected || seen.lost > 0)) return null
  const old = seen.lost > 0 ? ` (${seen.lost} too old to show)` : ''
  const at = events.length > 0 ? events[events.length - 1].at : 0
  return { key: `${session ?? ''}#caught-up-${seen.maxN}`, session, label, n: seen.maxN + 0.5, at, marker: true, text: `… caught up ${seen.jumped} event${seen.jumped === 1 ? '' : 's'}${old}` }
}

/** Events of the sessions shown (and the caught-up rows), newest first, with the agent each is about; at most `limit`. */
export function feedRows(sessions, markers = [], limit = 40) {
  const shown = new Set(sessions.map(s => s.session ?? ''))
  const rows = sessions.flatMap(s => {
    const agents = new Map(s.snapshot.agents.map(a => [a.id, a]))
    return (s.snapshot.events ?? []).map(e => ({ key: `${s.session ?? ''}#${e.n}`, session: s.session, label: s.label, n: e.n, at: e.at, kind: e.kind, text: e.text, agentId: e.agent, agent: agents.get(e.agent) ?? null }))
  })
  const extra = markers.filter(m => shown.has(m.session ?? ''))
  return [...rows, ...extra].sort((a, b) => b.at - a.at || b.n - a.n).slice(0, limit)
}

/**
 * What needs the person: the snapshot's `inbox` ([{agent, what, since}]; one agent may have several asks) when the mod sends one, else every agent waiting for
 * approval. Entries for agents the snapshot does not list are left out.
 */
export function inboxOf(snapshot) {
  const agents = snapshot.agents ?? []
  const listed = Array.isArray(snapshot.inbox)
    ? snapshot.inbox
    : agents.filter(a => a.status === 'waiting').map(a => ({ agent: a.id, text: 'Needs approval', since: null }))
  return listed.filter(item => agents.some(a => a.id === item.agent)).map(item => ({ agent: item.agent, text: item.what || item.text || 'Needs approval', since: item.since ?? null }))
}
