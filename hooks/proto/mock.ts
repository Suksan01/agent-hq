// Prototype only (docs/specs/task-sidebar.md, phase 3): mock plan tasks for the task sidebar variants. Removed in phase 6.

export type ProtoStatus = 'waiting' | 'working' | 'review' | 'done'
export type ProtoWork = { who: string; role: string; step: 'tests' | 'build' | 'review' | 'fix'; min: number; tokens: number; usd: number | null }
export type ProtoTask = { n: number; title: string; status: ProtoStatus; who: string | null; doneBy: string | null; work: ProtoWork[]; events: { at: string; text: string }[] }

export const PROTO_TASKS: ProtoTask[] = [
  { n: 1, title: 'Task list store and hq_plan', status: 'done', who: null, doneBy: 'senior-dev-1', work: [
    { who: 'qa-1', role: 'qa', step: 'tests', min: 3, tokens: 41_000, usd: 0.09 },
    { who: 'senior-dev-1', role: 'senior-dev', step: 'build', min: 9, tokens: 132_000, usd: 0.31 },
    { who: 'reviewer-1', role: 'reviewer', step: 'review', min: 2, tokens: 27_000, usd: 0.06 },
  ], events: [{ at: '10:02', text: 'started' }, { at: '10:14', text: 'review' }, { at: '10:17', text: 'done' }] },
  { n: 2, title: 'Price table', status: 'done', who: null, doneBy: 'senior-dev-2', work: [
    { who: 'senior-dev-2', role: 'senior-dev', step: 'build', min: 4, tokens: 38_000, usd: 0.11 },
    { who: 'reviewer-1', role: 'reviewer', step: 'review', min: 1, tokens: 9_000, usd: 0.02 },
  ], events: [{ at: '10:05', text: 'started' }, { at: '10:11', text: 'done' }] },
  { n: 3, title: 'plan_task on hq_assign and hq_review', status: 'working', who: 'senior-dev-1', doneBy: null, work: [
    { who: 'qa-1', role: 'qa', step: 'tests', min: 2, tokens: 22_000, usd: 0.05 },
    { who: 'senior-dev-1', role: 'senior-dev', step: 'build', min: 6, tokens: 88_000, usd: 0.21 },
  ], events: [{ at: '10:18', text: 'started' }] },
  { n: 4, title: 'Sidebar task table (ตารางงาน)', status: 'review', who: 'reviewer-1', doneBy: null, work: [
    { who: 'senior-dev-2', role: 'senior-dev', step: 'build', min: 11, tokens: 160_000, usd: 0.38 },
    { who: 'reviewer-1', role: 'reviewer', step: 'review', min: 1, tokens: 12_000, usd: null },
  ], events: [{ at: '10:12', text: 'started' }, { at: '10:24', text: 'review' }] },
  { n: 5, title: 'Live page tasks panel', status: 'waiting', who: null, doneBy: null, work: [], events: [] },
  { n: 6, title: 'Guard tasks.json from members', status: 'waiting', who: null, doneBy: null, work: [], events: [] },
  { n: 7, title: 'Full test run', status: 'waiting', who: null, doneBy: null, work: [], events: [] },
]

/** Which mock list a state shows: `AGENT_HQ_PROTO=a:empty` and the like pick one. */
export function protoTasksFor(state: string | undefined): ProtoTask[] | null {
  if (state === 'none') return null
  if (state === 'empty') return []
  if (state === 'many') return Array.from({ length: 4 }, (_, i) => PROTO_TASKS.map(x => ({ ...x, n: x.n + i * 7 }))).flat()
  return PROTO_TASKS
}
