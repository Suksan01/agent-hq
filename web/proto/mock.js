// Prototype only (docs/specs/task-sidebar.md, phase 3): the same mock plan tasks as hooks/proto/mock.ts. Removed in phase 6.

export const PROTO_TASKS = [
  { n: 1, title: 'Task list store and hq_plan', status: 'done', who: null, doneBy: 'senior-dev-1', work: [
    { who: 'qa-1', role: 'qa', step: 'tests', min: 3, tokens: 41000, usd: 0.09 },
    { who: 'senior-dev-1', role: 'senior-dev', step: 'build', min: 9, tokens: 132000, usd: 0.31 },
    { who: 'reviewer-1', role: 'reviewer', step: 'review', min: 2, tokens: 27000, usd: 0.06 },
  ], events: [{ at: '10:02', text: 'started' }, { at: '10:14', text: 'review' }, { at: '10:17', text: 'done' }] },
  { n: 2, title: 'Price table', status: 'done', who: null, doneBy: 'senior-dev-2', work: [
    { who: 'senior-dev-2', role: 'senior-dev', step: 'build', min: 4, tokens: 38000, usd: 0.11 },
    { who: 'reviewer-1', role: 'reviewer', step: 'review', min: 1, tokens: 9000, usd: 0.02 },
  ], events: [{ at: '10:05', text: 'started' }, { at: '10:11', text: 'done' }] },
  { n: 3, title: 'plan_task on hq_assign and hq_review', status: 'working', who: 'senior-dev-1', doneBy: null, work: [
    { who: 'qa-1', role: 'qa', step: 'tests', min: 2, tokens: 22000, usd: 0.05 },
    { who: 'senior-dev-1', role: 'senior-dev', step: 'build', min: 6, tokens: 88000, usd: 0.21 },
  ], events: [{ at: '10:18', text: 'started' }] },
  { n: 4, title: 'Sidebar task table (ตารางงาน) <script>alert(1)</script>', status: 'review', who: 'reviewer-1', doneBy: null, work: [
    { who: 'senior-dev-2', role: 'senior-dev', step: 'build', min: 11, tokens: 160000, usd: 0.38 },
    { who: 'reviewer-1', role: 'reviewer', step: 'review', min: 1, tokens: 12000, usd: null },
  ], events: [{ at: '10:12', text: 'started' }, { at: '10:24', text: 'review' }] },
  { n: 5, title: 'Live page tasks panel', status: 'waiting', who: null, doneBy: null, work: [], events: [] },
  { n: 6, title: 'Guard tasks.json from members', status: 'waiting', who: null, doneBy: null, work: [], events: [] },
  { n: 7, title: 'Full test run', status: 'waiting', who: null, doneBy: null, work: [], events: [] },
]

/** The page's state from `?state=`: none, empty, loading, error, offline, many, or the full list. */
export function protoState() {
  const state = new URLSearchParams(location.search).get('state') ?? 'full'
  const tasks = state === 'empty' ? [] : state === 'many' ? Array.from({ length: 4 }, (_, i) => PROTO_TASKS.map(x => ({ ...x, n: x.n + i * 7 }))).flat() : PROTO_TASKS
  return { state, tasks }
}
