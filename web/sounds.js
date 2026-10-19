// Which of the page's sounds plays when, decided from two looks at the sessions, with no DOM and no imports so `node --test`
// can check it. The sounds themselves are space-sounds.js (playEvent): the same low tones the terminal plays.

const FINISHED = new Set(['completed'])
const FAILED = new Set(['failed', 'killed'])
const ORDER = ['failed', 'needs', 'levelup', 'done'] // when several happen at once, the most important first
const MAX_AT_ONCE = 2

/** What a look at the sessions says about sound: each agent's status and level, and how many asks wait on the person. */
export function soundSummary(sessions, inboxOf) {
  const out = {}
  for (const s of sessions) {
    const agents = {}
    for (const a of s.snapshot.agents) agents[a.id] = { status: a.status, level: a.xp?.level ?? null }
    out[s.session ?? ''] = { agents, asks: inboxOf(s.snapshot).length }
  }
  return out
}

/** The sounds to play between two summaries (nothing on the first look): at most two, the most important first. */
export function soundsFor(before, after) {
  if (!before) return []
  const heard = new Set()
  for (const [key, now] of Object.entries(after)) {
    const was = before[key]
    if (!was) continue // an island that has just appeared is not news
    if (now.asks > was.asks) heard.add('needs')
    for (const [id, a] of Object.entries(now.agents)) {
      const b = was.agents[id]
      if (!b) continue
      if (a.status !== b.status && FINISHED.has(a.status)) heard.add('done')
      if (a.status !== b.status && FAILED.has(a.status)) heard.add('failed')
      if (a.level !== null && b.level !== null && a.level > b.level) heard.add('levelup')
    }
  }
  return ORDER.filter(name => heard.has(name)).slice(0, MAX_AT_ONCE)
}
