// The page's small joys, with no DOM and no imports so `node --test` can check them: the sea's colour through the day, which
// tasks have just been completed (confetti) and which agents have just levelled up (sparkles).

// ---- the sea through the day ------------------------------------------------------------------------------------

// [hour, sea, shallow water]: night is deep blue, dawn and dusk peach, the day the pale green-blue the islands were drawn on
const SKY = [
  [0, '#2F4272', '#46598B'], [5, '#2F4272', '#46598B'], [6.5, '#F1C9B5', '#F7DACB'], [8.5, '#DDF3F0', '#CDEFEA'],
  [16.5, '#DDF3F0', '#CDEFEA'], [18.5, '#F2C4A0', '#F8D8BF'], [20.5, '#2F4272', '#46598B'], [24, '#2F4272', '#46598B'],
]
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const toHex = c => `#${c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const blend = (a, b, m) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * m))

/** The sea and shallows at a local time, and how night it is (0 by day, 1 at the darkest), blended between the key hours. */
export function skyAt(date) {
  const hour = date.getHours() + date.getMinutes() / 60
  const next = SKY.findIndex(([h]) => h >= hour)
  const [h1, sea1, shallow1] = SKY[Math.max(0, next - 1)]
  const [h2, sea2, shallow2] = SKY[next === -1 ? SKY.length - 1 : next]
  const m = h2 === h1 ? 0 : (hour - h1) / (h2 - h1)
  const sea = blend(sea1, sea2, m)
  const dark = hex('#2F4272')
  const night = Math.max(0, Math.min(1, 1 - hex(sea).reduce((sum, v, i) => sum + Math.abs(v - dark[i]), 0) / (hex('#DDF3F0').reduce((sum, v, i) => sum + Math.abs(v - dark[i]), 0))))
  return { sea, shallow: blend(shallow1, shallow2, m), night }
}

// ---- what just happened ------------------------------------------------------------------------------------------

/** Each session's tasks and agents' levels, to compare with the next look. */
export function delightSummary(sessions) {
  const out = {}
  for (const s of sessions) {
    const tasks = {}
    for (const t of s.snapshot.tasks ?? []) tasks[t.id] = { status: t.status, owner: t.owner ?? null }
    const levels = {}
    for (const a of s.snapshot.agents ?? []) if (typeof a.xp?.level === 'number') levels[a.id] = a.xp.level
    out[s.session ?? ''] = { tasks, levels }
  }
  return out
}

/** Tasks that were not completed at the last look and are now: [{session, task, owner}]. Nothing on the first look. */
export function completedTasks(before, after) {
  if (!before) return []
  return Object.entries(after).flatMap(([key, now]) => {
    const was = before[key]
    if (!was) return []
    return Object.entries(now.tasks).filter(([id, t]) => t.status === 'completed' && was.tasks[id] && was.tasks[id].status !== 'completed').map(([id, t]) => ({ session: key === '' ? null : key, task: id, owner: t.owner }))
  })
}

/** Agents whose level rose since the last look: [{session, agent, level}]. */
export function levelUps(before, after) {
  if (!before) return []
  return Object.entries(after).flatMap(([key, now]) => {
    const was = before[key]
    if (!was) return []
    return Object.entries(now.levels).filter(([id, level]) => was.levels[id] !== undefined && level > was.levels[id]).map(([id, level]) => ({ session: key === '' ? null : key, agent: id, level }))
  })
}

// ---- confetti ---------------------------------------------------------------------------------------------------

export const CONFETTI_COLORS = ['#D9E85B', '#CDBDF7', '#F8C6E4', '#FBD965', '#A9EBC7', '#F59C8C', '#BDE0FA']

/** `count` pieces for one burst, the same for the same seed: how far and which way each flies, its turn, size, colour and delay. */
export function confettiPieces(seed, count = 28) {
  let a = [...String(seed)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0), 17)
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 + (next() - 0.5) * 0.5
    const reach = 150 + next() * 230
    return {
      dx: Math.round(Math.cos(angle) * reach),
      dy: Math.round(Math.sin(angle) * reach * 0.8 - 90), // thrown up, then it falls
      turn: Math.round((next() - 0.5) * 900),
      size: 10 + Math.round(next() * 10),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.round(next() * 120),
      round: next() > 0.6,
    }
  })
}
