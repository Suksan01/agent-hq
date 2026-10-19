// What the agent drawer shows besides the card's own lines, with no DOM and no imports so `node --test` can check it.

const XP_PER_LEVEL_SQUARED = 50 // hooks/xp.ts: level = floor(sqrt(xp / 50)) + 1

const BADGE_TITLES = {
  first_task: ['First Task', 'Finish your first task'],
  ten_tools: ['Getting Handy', 'Use 10 tools'],
  hundred_tools: ['Toolbelt Titan', 'Use 100 tools'],
  test_streak_5: ['Green Streak', 'Pass the tests 5 times in a row'],
  bug_squasher: ['Bug Squasher', 'Finish a task about a fix or a bug'],
  reviewer_eagle: ['Reviewer Eagle', 'Approve 5 reviews'],
  speedy: ['Speedy', 'Finish a task in under 2 minutes'],
  comeback: ['Comeback', 'Finish something after a failure'],
}

/** The agent's own events, newest first, at most `limit`: its status changes, steps, tools and messages. */
export function timelineOf(events, agentId, limit = 12) {
  return (events ?? []).filter(e => e.agent === agentId).sort((a, b) => b.n - a.n).slice(0, limit)
}

/** An agent's XP as the drawer draws it, or null when the snapshot carries none (the drawer then hides the section). */
export function levelOf(xp) {
  if (!xp || typeof xp.xp !== 'number' || !Number.isFinite(xp.xp)) return null
  const points = Math.max(0, xp.xp)
  const level = Math.floor(Math.sqrt(points / XP_PER_LEVEL_SQUARED)) + 1
  const from = XP_PER_LEVEL_SQUARED * (level - 1) ** 2, to = XP_PER_LEVEL_SQUARED * level ** 2
  return { level, xp: points, into: points - from, need: to - from, pct: Math.round(((points - from) / (to - from)) * 100), badges: badgesOf(xp.badges) }
}

/** Badges as {id, title, hint}, from ids or from objects; unknown ids get a title made from the id. */
export function badgesOf(badges) {
  return (Array.isArray(badges) ? badges : []).flatMap(b => {
    const id = typeof b === 'string' ? b : b?.id
    if (typeof id !== 'string') return []
    const [title, hint] = BADGE_TITLES[id] ?? [id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), '']
    return [{ id, title: (typeof b === 'object' && b.title) || title, hint: (typeof b === 'object' && b.hint) || hint }]
  })
}
