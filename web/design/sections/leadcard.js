// Lead card: the lead's command deck with its mission board (web/leadcard.js), in three variants and five states.
import { createRoot } from '../../vendor/libs.js'
import { html } from '../../spacekit.js'
import { H3, Section } from '../frame.js'
import { LeadDeck } from '../../leadcard.js'

const NAMES = ['Kepler-7b', 'Vega Prime', 'Nyx', 'Orion Drift', 'Zephyr-9', 'Lumen', 'Astra Nova', 'Tycho', 'Calyx-4', 'Solenne', 'Io Halo']
const crewOf = statuses => statuses.map((status, i) => ({ id: `m${i}`, nickname: NAMES[i], seed: NAMES[i], index: i, status }))
const planOf = (done, now, next) => [...done.map(text => ({ text, status: 'done' })), ...(now ? [{ text: now, status: 'now' }] : []), ...next.map(text => ({ text, status: 'next' }))]

// one sample per state: a crew whose mix makes that state, the lead's live line and its plan
const SAMPLES = [
  { state: 'working', caption: 'Working', status: 'working', pct: 42, activity: 'Planning the sprint', elapsed: 12,
    crew: crewOf(['working', 'working', 'working', 'done', 'idle', 'working', 'done', 'idle', 'working', 'done', 'idle']),
    plan: planOf(['Read the brief', 'Split the booking flow'], 'Assign the calendar picker', ['Review Kepler-7b’s picker', 'Merge auth branch']) },
  { state: 'idle', caption: 'Idle', status: 'idle', pct: 25, activity: 'Waiting for your next message',
    crew: crewOf(['idle', 'idle', 'done', 'idle']), plan: planOf(['Scaffold the app'], null, ['Plan the API docs']) },
  { state: 'needs-you', caption: 'Needs you', status: 'working', pct: 58, activity: 'Asking you to approve npm test', elapsed: 40,
    crew: crewOf(['waiting', 'working', 'waiting', 'done', 'working']), plan: planOf(['Booking API', 'Auth'], 'Hold the merge until QA', ['Merge auth branch']) },
  { state: 'all-done', caption: 'All done', status: 'idle', pct: 100, activity: 'Shipped the release',
    crew: crewOf(['done', 'done', 'done', 'done', 'done']), plan: planOf(['Calendar picker', 'Booking API', 'Release notes', 'Ship release'], null, []) },
  { state: 'failure', caption: 'Failure in team', status: 'working', pct: 63, activity: 'Re-planning after a failed build', elapsed: 6,
    crew: crewOf(['failed', 'working', 'done', 'working', 'idle', 'done']), plan: planOf(['Calendar picker'], 'Reassign Kepler-7b’s lint task', ['Re-run the checks', 'Merge']) },
]
const LEAD = { nickname: 'Polaris Major', title: 'Tech Lead', team: 'Booking App Team', seed: 'Polaris Major', index: 5 }
const noop = () => {}

const Deck = ({ sample, variant }) => html`<${LeadDeck} ...${LEAD} ...${sample} variant=${variant} onMessage=${noop} onHire=${noop} onTasks=${noop} onSelect=${noop} onOpen=${noop} />`
const cell = (sample, variant) => html`<div key=${sample.state} className="sc-cell" style=${{ justifyItems: 'stretch', minWidth: 0 }}><${Deck} sample=${sample} variant=${variant} /><span className="sc-cap">${sample.caption}</span></div>`

export function LeadCards() {
  return html`<${Section}>
    <${H3}>Full · the command deck and its mission board, the diagram's centre. The chevron folds the board; the choice is remembered<//>
    <div className="sc-grid" style=${{ gap: 48, maxWidth: 660 }}>${SAMPLES.map(s => cell(s, 'full'))}</div>
    <${H3}>Compact · the deck alone, beside the star in the space view<//>
    <div className="sc-grid" style=${{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '40px 24px' }}>${SAMPLES.map(s => cell(s, 'compact'))}</div>
    <${H3}>Mini · a chip: core, name, counts<//>
    <div className="sc-row" style=${{ gap: 18 }}>${SAMPLES.map(s => html`<div key=${s.state} className="sc-cell"><${Deck} sample=${s} variant="mini" /><span className="sc-cap">${s.caption}</span></div>`)}</div>
  <//>`
}

export function mount(el) {
  const root = createRoot(el)
  root.render(html`<${LeadCards} />`)
  return { dispose: () => root.unmount() }
}
