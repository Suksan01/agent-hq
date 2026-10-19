// XP, levels and badges for the team's agents (tests/xp.test.ts is the spec). Pure: events in, new stats out.

export type XpEventType = 'tool' | 'todo_done' | 'task_done' | 'tests_green' | 'tests_red' | 'review_approved' | 'agent_done' | 'agent_failed'

export type XpEvent =
  | { type: 'tool' | 'todo_done' | 'tests_green' | 'tests_red' | 'review_approved' | 'agent_done' | 'agent_failed' }
  | { type: 'task_done'; subject: string; startedAt?: number }

export type BadgeId = 'first_task' | 'ten_tools' | 'hundred_tools' | 'test_streak_5' | 'bug_squasher' | 'reviewer_eagle' | 'speedy' | 'comeback'
export type Badge = { id: BadgeId; title: string; hint: string }

export type XpStats = {
  xp: number
  level: number
  /** Ids of every badge earned so far. */
  badges: BadgeId[]
  tools: number
  tasks: number
  reviews: number
  /** Consecutive tests_green; tests_red resets it. */
  testStreak: number
  /** agent_failed events so far. */
  failures: number
}

export const XP: Record<XpEventType, number> = { tool: 1, todo_done: 5, task_done: 20, tests_green: 10, tests_red: 0, review_approved: 15, agent_done: 25, agent_failed: 0 }

const XP_PER_LEVEL_SQUARED = 50
const TOOLS_SMALL = 10
const TOOLS_BIG = 100
const STREAK = 5
const REVIEWS = 5
const SPEEDY_MS = 120_000
const BUG_WORDS = /\b(fix|fixes|fixed|bug|bugs)\b/i

export const BADGES: readonly Badge[] = [
  { id: 'first_task', title: 'First Task', hint: 'Finish your first task' },
  { id: 'ten_tools', title: 'Getting Handy', hint: 'Use 10 tools' },
  { id: 'hundred_tools', title: 'Toolbelt Titan', hint: 'Use 100 tools' },
  { id: 'test_streak_5', title: 'Green Streak', hint: 'Pass the tests 5 times in a row' },
  { id: 'bug_squasher', title: 'Bug Squasher', hint: 'Finish a task about a fix or a bug' },
  { id: 'reviewer_eagle', title: 'Reviewer Eagle', hint: 'Approve 5 reviews' },
  { id: 'speedy', title: 'Speedy', hint: 'Finish a task in under 2 minutes' },
  { id: 'comeback', title: 'Comeback', hint: 'Finish something after a failure' },
]

export const emptyStats = (): XpStats => ({ xp: 0, level: 1, badges: [], tools: 0, tasks: 0, reviews: 0, testStreak: 0, failures: 0 })

export const levelOf = (xp: number): number => Math.floor(Math.sqrt(xp / XP_PER_LEVEL_SQUARED)) + 1

/** Counters after an event, before XP and badges. */
function counted(stats: XpStats, event: XpEvent): XpStats {
  switch (event.type) {
    case 'tool':
      return { ...stats, tools: stats.tools + 1 }
    case 'task_done':
      return { ...stats, tasks: stats.tasks + 1 }
    case 'review_approved':
      return { ...stats, reviews: stats.reviews + 1 }
    case 'tests_green':
      return { ...stats, testStreak: stats.testStreak + 1 }
    case 'tests_red':
      return { ...stats, testStreak: 0 }
    case 'agent_failed':
      return { ...stats, failures: stats.failures + 1 }
    default:
      return stats
  }
}

/** Whether an event, with the counters before (`prior`) and after (`next`) it, earns a badge. */
function isEarned(id: BadgeId, event: XpEvent, prior: XpStats, next: XpStats, now: number): boolean {
  switch (id) {
    case 'first_task':
      return event.type === 'task_done'
    case 'ten_tools':
      return next.tools >= TOOLS_SMALL
    case 'hundred_tools':
      return next.tools >= TOOLS_BIG
    case 'test_streak_5':
      return next.testStreak >= STREAK
    case 'bug_squasher':
      return event.type === 'task_done' && BUG_WORDS.test(event.subject)
    case 'reviewer_eagle':
      return next.reviews >= REVIEWS
    case 'speedy':
      return event.type === 'task_done' && event.startedAt !== undefined && now - event.startedAt < SPEEDY_MS
    case 'comeback':
      return (event.type === 'task_done' || event.type === 'agent_done') && prior.failures > 0
  }
}

/** Immutable: `stats` is never changed; `levelUp` is the new level when it rose; `badges` are the ones this event earned. */
export function applyEvent(stats: XpStats, event: XpEvent, now: number): { stats: XpStats; levelUp: number | null; badges: Badge[] } {
  const next = counted(stats, event)
  const xp = stats.xp + XP[event.type]
  const level = levelOf(xp)
  const earned = BADGES.filter(b => !stats.badges.includes(b.id) && isEarned(b.id, event, stats, next, now))
  return {
    stats: { ...next, xp, level, badges: [...stats.badges, ...earned.map(b => b.id)] },
    levelUp: level > stats.level ? level : null,
    badges: [...earned],
  }
}
