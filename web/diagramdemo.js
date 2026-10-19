// Sample sessions for the diagram, for the design-system showcase and for trying it by hand:
//   import { mountDiagramDemo } from './diagramdemo.js'
//   const view = mountDiagramDemo(containerElement)    // a box with a size; it also needs space.css, diagram.css and vendor/fonts.css
// Returns { update, fit, focus, dispose } (see mountDiagram in diagram.js).

import { mountDiagram } from './diagram.js'

const agent = (id, nickname, status, extra = {}) => ({ id, parentId: 'main', nickname, name: id, role: 'Developer', status, progress: 50, isLead: false, ...extra })
const lead = (nickname, extra = {}) => agent('main', nickname, 'running', { parentId: null, isLead: true, name: 'main', role: 'Tech Lead', progress: 48, task: 'Ship guest checkout', now: 'Splitting the work', next: 'Review what comes back', activity: 'Reading the QA report', elapsed: 40, ...extra })

export const demoGroups = [
  { session: 'booking', team: 'Booking App Team', folder: 'booking-app', agents: [
    lead('Sirius Prime'),
    agent('frontend-dev-1', 'Kepler-7b', 'running', { role: 'Frontend', progress: 62, task: 'Build the date picker', now: 'Wiring the range selection', next: 'Write the component tests', activity: 'Editing view.tsx', elapsed: 12 }),
    agent('qa-1', 'Vega Prime', 'waiting', { role: 'QA', progress: 40, task: 'Run the booking flow end to end', now: 'Waiting for your approval', next: 'Run the end-to-end suite', needsYou: true }),
    agent('backend-dev-1', 'Nyx', 'failed', { role: 'Backend', progress: 31, task: 'Add the reservations table', now: 'relation already exists', next: 'Fix the migration and retry' }),
    agent('reviewer-1', 'Orion Drift', 'completed', { role: 'Reviewer', progress: 100 }),
    agent('architect-1', 'Zephyr-9', 'idle', { role: 'Architect', progress: 0 }),
    agent('helper-1', 'Lumen', 'running', { parentId: 'frontend-dev-1', role: 'Explore', progress: 20, task: 'Find the date library', now: 'Searching the repo', activity: 'Grep', elapsed: 8 }),
  ] },
  { session: 'api', team: 'API Team', folder: 'api', agents: [
    lead('Polaris Major', { progress: 70 }),
    agent('api-dev-1', 'Astra Nova', 'running', { role: 'Backend', progress: 55, task: 'Paginate the bookings list', now: 'Adding the cursor', activity: 'Edit', elapsed: 30 }),
    agent('api-dev-2', 'Tau Ceti', 'completed', { role: 'Backend', progress: 100 }),
    agent('api-dev-3', 'Cygnus-4', 'killed', { role: 'Backend', progress: 18 }),
  ] },
  { session: 'docs', team: 'Docs Team', folder: 'docs', agents: [lead('Altair', { status: 'idle', progress: 0, task: undefined, now: undefined, next: undefined, activity: undefined })] },
]

export function mountDiagramDemo(container, props = {}) {
  return mountDiagram(container, { groups: demoGroups, inset: { top: 24, right: 24, bottom: 24, left: 24 }, ...props })
}
