// Components and Patterns sections of the Agent HQ space design system. Every spacekit.js component in every state it
// can be in (default, hover, focus, working, needs you, done, failed, idle, stopped, lead), then the patterns the live
// page is made of. Hover and focus are pinned with the .is-hover / .is-focus classes so they show on a still page.

import React from '../../vendor/libs.js'
import {
  AddAgentDialog, AgentCard, Blob, ChipBar, DotNumber, DotProgress, Drawer, Elapsed, EmptyState, FeedTile, GlassTile, IconButton,
  InboxTile, LeadCard, LiquidMenu, PillButton, SegmentedToggle, SendButton, SendInput, SpaceCanvas, StatusPill, SystemChip, TextInput, TitleHud, Toast,
  ToastStack, Toolbar, html,
} from '../../spacekit.js'
import { TaskBoardTile } from '../../panels.js'

const { useState } = React
const STATES = ['working', 'waiting', 'done', 'failed', 'idle', 'stopped']

/* ---------- sample data: the Booking App Team ---------- */
const LEAD = {
  nickname: 'Sirius Prime', name: 'main', role: 'TECH LEAD', status: 'working', pct: 48, index: 5,
  activity: 'Reading the QA report', elapsed: 40, task: 'Ship guest checkout for the booking app',
  now: 'Splitting the checkout work', next: 'Review what comes back', crew: { working: 2, waiting: 1, done: 1, failed: 1 },
}
const AGENTS = {
  working: { nickname: 'Kepler-7b', name: 'frontend-dev-1', role: 'FRONTEND', pct: 62, index: 0, activity: 'Editing view.tsx', elapsed: 12, task: 'Build the date picker for the booking form', now: 'Wiring the range selection', next: 'Write the component tests' },
  waiting: { nickname: 'Vega Prime', name: 'qa-1', role: 'QA', pct: 40, index: 2, activity: 'Asking to run rm -rf build', elapsed: 95, task: 'Run the booking flow end to end', now: 'Waiting for your approval', next: 'Run the end-to-end suite' },
  done: { nickname: 'Nyx', name: 'reviewer-1', role: 'REVIEWER', index: 4, task: 'Review the payments module', now: 'Approved the booking flow' },
  failed: { nickname: 'Orion Drift', name: 'backend-dev-1', role: 'BACKEND', pct: 31, index: 6, activity: 'Migration failed', elapsed: 260, task: 'Add the reservations table', now: 'relation "reservations" already exists', next: 'Fix the migration and retry' },
  idle: { nickname: 'Zephyr-9', name: 'architect-1', role: 'ARCHITECT', pct: 0, index: 8, task: 'No task yet', next: 'Waits for the next assignment' },
  stopped: { nickname: 'Lumen', name: 'senior-dev-3', role: 'SENIOR DEV', pct: 18, index: 10, task: 'Refactor the price calculator', now: 'Stopped by you' },
}
const FEED = [
  { time: '12s', status: 'working', who: 'Kepler-7b', text: 'is editing view.tsx' },
  { time: '1m', status: 'waiting', who: 'Vega Prime', text: 'needs an approval' },
  { time: '3m', status: 'done', who: 'Nyx', text: 'approved the booking flow' },
  { time: '4m', status: 'failed', who: 'Orion Drift', text: 'hit a migration error' },
  { time: '9m', status: 'lead', who: 'Sirius Prime', text: 'started 5 agents' },
  { marker: true, text: 'Booking App: caught up 3 events' },
  { time: '11m', status: 'idle', who: 'Zephyr-9', text: 'is waiting for work' },
]
const INBOX = [{ uid: 'booking|qa-1', who: 'Vega Prime', role: 'qa-1 · QA', ask: 'Wants to run a command that deletes files.', command: 'Bash: rm -rf build', waited: 95 }]
const BOARD = [
  { key: 'booking', label: 'Booking App Team', progress: { done: 2, total: 5 }, tasks: [
    { id: '1', subject: 'Design the slot picker', status: 'completed', owner: 'Kepler-7b', blockedBy: [] },
    { id: '2', subject: 'Reservations table and migration', status: 'in_progress', owner: 'Orion Drift', blockedBy: [] },
    { id: '3', subject: 'Slots API', status: 'pending', owner: 'Orion Drift', blockedBy: ['2'] },
    { id: '4', subject: 'Date picker component', status: 'in_progress', owner: 'Kepler-7b', blockedBy: [] },
    { id: '5', subject: 'End-to-end booking test', status: 'completed', owner: 'Vega Prime', blockedBy: [] },
  ] },
  { key: 'docs', label: 'Docs', progress: { done: 0, total: 1 }, tasks: [{ id: '1', subject: 'Write the booking guide', status: 'pending', blockedBy: [] }] },
]
const TEAMS = [{ key: 'booking', label: 'Booking App Team' }, { key: 'docs', label: 'Docs' }]
// roles per team: picking the Docs chip swaps the role chips
const ROLES = {
  booking: [
    { id: 'frontend', title: 'Frontend', count: 2, active: 1 }, { id: 'backend', title: 'Backend', count: 1, active: 1 },
    { id: 'qa', title: 'QA', count: 1, active: 0 }, { id: 'reviewer', title: 'Reviewer', count: 1, active: 0 },
  ],
  docs: [{ id: 'writer', title: 'Writer', count: 2, active: 0 }, { id: 'editor', title: 'Editor', count: 1, active: 1 }],
}
const SYSTEMS = [
  { id: 'all', label: 'All', count: 3 },
  { id: 'booking', label: 'Booking App Team', count: 6, seed: 'Sirius Prime' },
  { id: 'medusa', label: 'Medusa Crew', count: 2, seed: 'Altair', attention: true },
  { id: 'docs', label: 'Docs', count: 1, seed: 'Deneb' },
]
const DRAWER = {
  ...AGENTS.working, status: 'working',
  stats: [['Running', 14, 'm'], ['Tools', 31], ['Files', 6]],
  level: 3, xp: 210, xpNext: 300, badges: ['First task', 'Getting handy', 'Night owl'],
  timeline: [
    { time: '12s', status: 'working', text: 'Editing view.tsx' },
    { time: '2m', status: 'done', text: 'Ran the unit tests, all green' },
    { time: '6m', status: 'working', text: 'Read DatePicker.tsx' },
    { time: '14m', status: 'lead', text: 'Got the task from Sirius Prime' },
  ],
}

/* ---------- layout helpers (showcase only; the components carry their own styles) ---------- */
const Section = ({ id, title, lede, children }) => html`<section id=${id} className="sc-sec"><h2>${title}</h2><p className="sc-lede">${lede}</p>${children}</section>`
const H3 = ({ children }) => html`<h3 className="sc-h3">${children}</h3>`
const Cell = ({ caption, children, style }) => html`<div className="sc-cell" style=${style}>${children}<span className="sc-cap">${caption}</span></div>`
const Row = ({ children, style }) => html`<div className="sc-row" style=${style}>${children}</div>`
const Grid = ({ min = 260, children, style }) => html`<div className="sc-grid" style=${{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, ...style }}>${children}</div>`
const noop = () => {}
// the inbox's Message pill opens the drawer's message box; here it focuses the demo drawer of the same section
const messageIn = section => () => document.querySelector(`#${section} .sk-drawer input`)?.focus()

/* ---------- components ---------- */
function Basics() {
  return html`
    <${H3}>Status pill: a coloured icon disc, a label, an edge glow<//>
    <${Row}>${[...STATES, 'lead'].map(s => html`<${Cell} key=${s} caption=${s}><${StatusPill} status=${s} /><//>`)}
      <${Cell} caption="ghost"><${StatusPill} status="working" ghost /><//><//>

    <${H3}>Dot-matrix numbers (Doto): every number in the product<//>
    <${Row} style=${{ gap: 34, alignItems: 'flex-end' }}>
      ${['xs', 'sm', undefined, 'lg', 'xl'].map(size => html`<${Cell} key=${size ?? 'md'} caption=${size ?? 'md'}><${DotNumber} value="23" suffix="%" size=${size} status="working" /><//>`)}
      <${Cell} caption="score"><${DotNumber} value="3.3" size="lg" status="lead" /><//>
      <${Cell} caption="timer"><${Elapsed} secs=${7200} size="lg" /><//>
      <${Cell} caption="done"><${DotNumber} value="100" suffix="%" size="lg" status="done" /><//>
      <${Cell} caption="failed"><${DotNumber} value="2" size="lg" status="failed" /><//>
    <//>

    <${H3}>Dotted progress: a track of dots, a glowing fill, a bright thumb<//>
    <${Grid} min=${240} style=${{ gap: 26 }}>
      ${[['working', 62], ['waiting', 40], ['done', 100], ['failed', 31], ['idle', 12], ['stopped', 18], ['lead', 48]].map(([s, v]) => html`<${Cell} key=${s} caption=${`${s} · ${v}%`}><div style=${{ width: '100%' }}><${DotProgress} value=${v} status=${s} /></div><//>`)}
      <${Cell} caption="working, no steps yet"><div style=${{ width: '100%' }}><${DotProgress} status="working" indeterminate /></div><//>
    <//>

    <${H3}>Glass tiles: light bleeds in from one edge in the tile's hue<//>
    <${Grid} min=${160} style=${{ gap: 18 }}>
      ${[['working', undefined], ['waiting', 'bottom'], ['done', 'left'], ['failed', 'right'], ['idle', undefined], ['stopped', 'bottom'], ['lead', 'left']].map(([s, e]) => html`<${GlassTile} key=${s} status=${s} edge=${e} lift style=${{ height: 130, padding: 18, display: 'flex', alignItems: 'flex-end' }}><span className="sk-label">${s}${e ? ` · ${e}` : ''}</span><//>`)}
      <${GlassTile} status="working" lift className="is-hover" style=${{ height: 130, padding: 18, display: 'flex', alignItems: 'flex-end' }}><span className="sk-label">hover</span><//>
      <${GlassTile} status="lead" bright style=${{ height: 130, padding: 18, display: 'flex', alignItems: 'flex-end' }}><span className="sk-label">bright</span><//>
      <${GlassTile} status="working" soft style=${{ height: 130, padding: 18, display: 'flex', alignItems: 'flex-end' }}><span className="sk-label">soft</span><//>
      <${GlassTile} status="working" dim style=${{ height: 130, padding: 18, display: 'flex', alignItems: 'flex-end' }}><span className="sk-label">dim (far)</span><//>
    <//>`
}

function Cards() {
  const [picked, setPicked] = useState('Kepler-7b')
  return html`
    <${H3}>Agent card: every state. Working carries the border beam, the thinking orb and the live activity line<//>
    <${Grid} min=${316} style=${{ gap: 22, alignItems: 'start' }}>
      ${STATES.map(s => html`<${Cell} key=${s} caption=${s === 'waiting' ? 'waiting · needs you' : s}><${AgentCard} ...${AGENTS[s]} status=${s} /><//>`)}
      <${Cell} caption="hover"><${AgentCard} ...${AGENTS.done} status="done" className="is-hover" /><//>
      <${Cell} caption="focus (keyboard)"><${AgentCard} ...${AGENTS.idle} status="idle" className="is-focus" onSelect=${noop} /><//>
      <${Cell} caption="selected, click to choose"><${AgentCard} ...${AGENTS.working} status="working" selected=${picked === 'Kepler-7b'} onSelect=${() => setPicked(p => p === 'Kepler-7b' ? '' : 'Kepler-7b')} /><//>
    <//>

    <${H3}>Compact card: blob, nickname, pill and %, for the quiet ones in the diagram<//>
    <${Grid} min=${260} style=${{ gap: 18, alignItems: 'start' }}>
      ${['idle', 'done', 'failed', 'stopped', 'waiting'].map(s => html`<${Cell} key=${s} caption=${`compact · ${s}`}><${AgentCard} ...${AGENTS[s]} status=${s} compact /><//>`)}
    <//>

    <${H3}>Lead card: brighter, with the crew's counts<//>
    <${Grid} min=${336} style=${{ gap: 22, alignItems: 'start' }}>
      <${Cell} caption="lead · working"><${LeadCard} ...${LEAD} /><//>
      <${Cell} caption="lead · needs you"><${LeadCard} ...${LEAD} status="waiting" activity="Asking which payment provider" elapsed=${30} /><//>
      <${Cell} caption="lead · done"><${LeadCard} ...${LEAD} status="done" activity=${undefined} now="Checkout shipped" next=${undefined} crew=${{ working: 0, waiting: 0, done: 5, failed: 0 }} /><//>
    <//>`
}

function Controls() {
  const [chip, setChip] = useState('booking')
  const [view, setView] = useState('diagram')
  return html`
    <${H3}>System chips and the chip bar (liquid-gooey: the selection moves like a drop of goo)<//>
    <${Row} style=${{ gap: 28 }}>
      <${Cell} caption="chip bar, click to move"><${ChipBar} items=${SYSTEMS} value=${chip} onChange=${setChip} /><//>
    <//>
    <${Row} style=${{ gap: 14, marginTop: 22 }}>
      <${Cell} caption="default"><${SystemChip} label="Docs" count=${1} /><//>
      <${Cell} caption="hover"><${SystemChip} label="Docs" count=${1} className="is-hover" /><//>
      <${Cell} caption="focus"><${SystemChip} label="Docs" count=${1} className="is-focus" /><//>
      <${Cell} caption="active"><${SystemChip} label="Docs" count=${1} active /><//>
      <${Cell} caption="needs you"><${SystemChip} label="Medusa Crew" count=${2} attention seed="Altair" /><//>
      <${Cell} caption="with blob"><${SystemChip} label="Booking App Team" count=${6} seed="Sirius Prime" /><//>
    <//>

    <${H3}>Round icon buttons, pill buttons, the toolbar<//>
    <${Row} style=${{ gap: 26 }}>
      <${Cell} caption="default"><${IconButton} icon="message" label="Message" /><//>
      <${Cell} caption="hover"><${IconButton} icon="message" label="Message" className="is-hover" /><//>
      <${Cell} caption="focus"><${IconButton} icon="fit" label="Fit" className="is-focus" /><//>
      <${Cell} caption="pressed"><${IconButton} icon="tasks" label="Tasks" pressed /><//>
      <${Cell} caption="primary"><${IconButton} icon="plus" label="Add agent" primary /><//>
      <${Cell} caption="notification"><${IconButton} icon="bell" label="Needs you" dot /><//>
      <${Cell} caption="disabled"><${IconButton} icon="stop" label="Stop" disabled /><//>
      <${Cell} caption="small"><${IconButton} icon="close" label="Close" small /><//>
    <//>
    <${Row} style=${{ gap: 18, marginTop: 22 }}>
      <${Cell} caption="pill"><${PillButton}>Fit all<//><//>
      <${Cell} caption="pill · hover"><${PillButton} className="is-hover">Fit all<//><//>
      <${Cell} caption="pill · focus"><${PillButton} className="is-focus">Fit all<//><//>
      <${Cell} caption="primary"><${PillButton} primary hint="⌘K">Message lead<//><//>
      <${Cell} caption="danger"><${PillButton} danger small>Stop agent<//><//>
      <${Cell} caption="disabled"><${PillButton} primary disabled>Add agent<//><//>
    <//>
    <${Row} style=${{ gap: 30, marginTop: 26, alignItems: 'flex-start' }}>
      <${Cell} caption="toolbar: round buttons and one pill"><${Toolbar}><${IconButton} icon="arrowL" label="Back" /><${IconButton} icon="fit" label="Fit" /><${IconButton} icon="bell" label="Needs you" dot /><${PillButton} primary hint="⌘K">Message lead<//><${IconButton} icon="plus" label="Add agent" primary /><//><//>
      <${Cell} caption="liquid menu: the plus splits into droplets"><div style=${{ width: 230, maxWidth: '100%', height: 62, display: 'flex', justifyContent: 'flex-end' }}><${LiquidMenu} actions=${[{ icon: 'message', label: 'Message' }, { icon: 'tasks', label: 'Tasks' }, { icon: 'fit', label: 'Fit' }]} /></div><//>
    <//>

    <${H3}>Segmented toggle<//>
    <${Row} style=${{ gap: 26 }}>
      <${Cell} caption="click to switch"><${SegmentedToggle} label="View" options=${[{ id: 'diagram', label: 'Diagram' }, { id: 'list', label: 'List', icon: 'tasks' }]} value=${view} onChange=${setView} /><//>
    <//>

    <${H3}>Text input and send button<//>
    <${Grid} min=${300} style=${{ gap: 26 }}>
      <${Cell} caption="message box (type, Enter sends)"><div style=${{ width: '100%' }}><${SendInput} /></div><//>
      <${Cell} caption="focus"><div style=${{ width: '100%' }}><${TextInput} className="is-focus" defaultValue="Ship the checkout today"><${SendButton} /><//></div><//>
      <${Cell} caption="field"><div style=${{ width: '100%' }}><${TextInput} placeholder="frontend-dev-3" aria-label="Name" /></div><//>
      <${Cell} caption="multiline"><div style=${{ width: '100%' }}><${TextInput} multiline placeholder="What should it do?" /></div><//>
    <//>`
}

function Panels() {
  const [shown, setShown] = useState(true)
  return html`
    <${H3}>Title HUD: big dot-matrix counts<//>
    <${Row} style=${{ alignItems: 'flex-start', gap: 26 }}>
      <${Cell} caption="one team"><${TitleHud} team="Booking App Team" folder="~/code/booking-app" counts=${{ working: 2, waiting: 1, done: 1, failed: 1 }} /><//>
      <${Cell} caption="all systems"><${TitleHud} team="3 systems" counts=${{ working: 7, waiting: 2, done: 9, failed: 0 }} /><//>
    <//>

    <${H3}>Drawer: agent detail (now, stats, level and badges, timeline, message, stop)<//>
    <${Row} style=${{ alignItems: 'flex-start', gap: 26 }}>
      <${Cell} caption="working"><${Drawer} ...${DRAWER} /><//>
      <${Cell} caption="stop: asks first, inline"><${Drawer} ...${AGENTS.failed} status="failed" stats=${[['Running', 4, 'm'], ['Tools', 9], ['Errors', 1]]} timeline=${[{ time: '4m', status: 'failed', text: 'Migration failed' }, { time: '5m', status: 'working', text: 'Wrote 002_reservations.sql' }]} confirmStop /><//>
      <${Cell} caption="finished: nothing to send or stop"><${Drawer} ...${AGENTS.done} status="done" team="Booking App Team" finished level=${5} xp=${480} xpNext=${500} badges=${['Sharp eye', 'Ten reviews']} stats=${[['Tools', 44], ['Time', 22, 'm'], ['Last', 'Read checkout.ts']]} /><//>
      <${Cell} caption="lead: message only"><${Drawer} nickname="Sirius Prime" name="main" role="Tech Lead" team="Booking App Team" status="working" lead seed="Sirius Prime" index=${5} activity="Reading the QA report" elapsed=${40} now="Splitting the checkout work" next="Review what comes back" stats=${[['Tools', 58], ['Time', 1, 'h'], ['Tokens', '182k']]} /><//>
    <//>

    <${H3}>Feed tile and inbox tile<//>
    <${Row} style=${{ alignItems: 'flex-start', gap: 26 }}>
      <${Cell} caption="feed: a caught-up gap, foldable, rows pulse their card"><${FeedTile} rows=${FEED} collapsible onPick=${noop} /><//>
      <${Cell} caption="feed · empty"><${FeedTile} rows=${[]} /><//>
      <${Cell} caption="inbox · needs you (Message focuses the drawer's box)"><${InboxTile} items=${INBOX} onMessage=${messageIn('components')} /><//>
      <${Cell} caption="inbox · empty"><${InboxTile} items=${[]} /><//>
    <//>

    <${H3}>Task board: one section per team, in progress first, owners and what each waits on<//>
    <${Row} style=${{ alignItems: 'flex-start', gap: 26 }}>
      <${Cell} caption="two teams"><${TaskBoardTile} sections=${BOARD} onClose=${noop} /><//>
      <${Cell} caption="empty"><${TaskBoardTile} sections=${[]} /><//>
    <//>

    <${H3}>Toasts<//>
    <div style=${{ display: 'grid', gap: 10, justifyItems: 'start' }}>
      ${[['working', html`<b>Kepler-7b</b> started the date picker`], ['waiting', html`<b>Vega Prime</b> needs you: run rm -rf build?`], ['done', html`<b>Nyx</b> approved the booking flow`], ['failed', html`<b>Orion Drift</b> failed: migration error`], ['idle', html`<b>Zephyr-9</b> is free for work`], ['stopped', html`<b>Lumen</b> was stopped`], ['lead', html`Level up: <b>Kepler-7b</b> reached level 3`]].map(([s, text]) => html`<${Toast} key=${s} status=${s} onClose=${noop}>${text}<//>`)}
    </div>

    <${H3}>Dialog (add an agent) and empty state<//>
    <${Row} style=${{ gap: 30, alignItems: 'flex-start' }}>
      <div style=${{ position: 'relative', width: 'min(520px, 100%)', height: 600 }}>
        ${shown ? html`<${AddAgentDialog} inline sessions=${TEAMS} roles=${ROLES} onClose=${() => setShown(false)} onAdd=${() => setShown(false)} />` : html`<${EmptyState} title="Dialog closed" text="Open it again to try the form."><${PillButton} primary onClick=${() => setShown(true)}>Add agent<//><//>`}
      </div>
      <${EmptyState} title="No agents yet" text="They appear here as soon as the lead starts one. Ask the lead for a team to begin."><${PillButton} primary>Message the lead<//><//>
    <//>`
}

/* ---------- patterns ---------- */
const ORBITS = [[150, 'working'], [230, 'waiting'], [310, 'idle']]
const MOONS = [['Kepler-7b', 'working', 0, 150, 0], ['Vega Prime', 'waiting', 2, 230, 130], ['Nyx', 'done', 4, 230, 250], ['Orion Drift', 'failed', 6, 310, 40], ['Zephyr-9', 'idle', 8, 310, 200]]

/** A still stand-in for the 3D scene: the lead's blob as a star, members on dotted rings. */
function Scene({ children, height = 600 }) {
  return html`<${SpaceCanvas} style=${{ position: 'relative', height, borderRadius: 34, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
    <div aria-hidden="true" style=${{ position: 'absolute', left: '50%', top: '52%', width: 0, height: 0 }}>
      ${ORBITS.map(([r, s]) => html`<div key=${r} data-status=${s} style=${{ position: 'absolute', left: -r, top: -r * 0.42, width: r * 2, height: r * 0.84, borderRadius: '50%', border: '1px dotted color-mix(in srgb, var(--hue) 55%, transparent)', opacity: s === 'idle' ? 0.35 : 0.75 }}></div>`)}
      <div style=${{ position: 'absolute', left: -48, top: -48 }}><${Blob} seed="Sirius Prime" state="working" lead size=${96} index=${5} /></div>
      ${MOONS.map(([seed, state, index, r, deg]) => {
        const a = (deg * Math.PI) / 180
        return html`<div key=${seed} style=${{ position: 'absolute', left: Math.cos(a) * r - 22, top: Math.sin(a) * r * 0.42 - 22 }}><${Blob} seed=${seed} state=${state} index=${index} size=${44} /></div>`
      })}
    </div>
    ${children}
  <//>`
}

// The toast stack is position: fixed on the page; a transform on its box pins it there instead.
export function Patterns() {
  const [chip, setChip] = useState('booking')
  const [toasts, setToasts] = useState([{ id: 1, status: 'waiting', text: html`<b>Vega Prime</b> needs you: run rm -rf build?` }])
  const push = () => setToasts(t => [...t.slice(-2), { id: Date.now(), status: 'done', text: html`<b>Kepler-7b</b> finished step ${t.length + 1}` }])
  return html`<${Section} id="patterns" title="Patterns" lede="How the components come together on the live page: a grid of agents, the HUD over the dark scene, the drawer open, the feed beside the inbox, and toasts arriving.">
    <${H3}>Card grid: the lead first, then the crew<//>
    <${Grid} min=${316} style=${{ gap: 22, alignItems: 'start' }}>
      <${LeadCard} ...${LEAD} />
      ${['working', 'waiting', 'failed', 'done', 'idle'].map(s => html`<${AgentCard} key=${s} ...${AGENTS[s]} status=${s} />`)}
    <//>

    <${H3}>HUD over the scene<//>
    <${Scene}>
      <div style=${{ position: 'absolute', left: 16, top: 16, maxWidth: 'calc(100% - 32px)' }}><${TitleHud} team="Booking App Team" folder="~/code/booking-app" counts=${{ working: 2, waiting: 1, done: 1, failed: 1 }} /></div>
      <div style=${{ position: 'absolute', left: 16, right: 16, bottom: 16, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <${ChipBar} items=${SYSTEMS} value=${chip} onChange=${setChip} />
        <${Toolbar}><${IconButton} icon="fit" label="Fit" /><${IconButton} icon="bell" label="Needs you" dot /><${PillButton} primary>Message lead<//><${IconButton} icon="plus" label="Add agent" primary /><//>
      </div>
    <//>

    <${H3}>Drawer open over the scene<//>
    <${Scene} height=${760}>
      <div style=${{ position: 'absolute', left: 16, top: 16 }}><${AgentCard} ...${AGENTS.working} status="working" compact selected /></div>
      <div style=${{ position: 'absolute', right: 16, top: 16, bottom: 16, overflow: 'auto', borderRadius: 30, maxWidth: 'calc(100% - 32px)' }}><${Drawer} ...${DRAWER} /></div>
    <//>

    <${H3}>Feed beside the inbox<//>
    <${Row} style=${{ alignItems: 'flex-start', gap: 22 }}><${FeedTile} rows=${FEED} /><${InboxTile} items=${INBOX} onMessage=${messageIn('patterns')} /><//>

    <${H3}>Toasts arriving<//>
    <${SpaceCanvas} style=${{ position: 'relative', height: 280, borderRadius: 34, transform: 'translateZ(0)', padding: 20, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08)' }}>
      <${PillButton} onClick=${push}>Show a toast<//>
      <${ToastStack}>${toasts.map(t => html`<${Toast} key=${t.id} status=${t.status} onClose=${() => setToasts(x => x.filter(y => y.id !== t.id))}>${t.text}<//>`)}<//>
    <//>
  <//>`
}

export function Components() {
  return html`<${Section} id="components" title="Components" lede="Each one in every state it can be in. Hover and focus are pinned so they show on a still page; everything else is live: click the chips, type in the boxes, try the dialog.">
    <${Basics} /><${Cards} /><${Controls} /><${Panels} />
  <//>`
}

export default function ComponentsSection() {
  return html`<${Components} /><${Patterns} />`
}
