import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sessionNames } from './labels.js'
import { signatureOf, agentStatus, addRequest, attentionOf, boardSections, countsOf, drawerOf, feedItems, groupsOf, hudOf, inboxItems, keyOf, nicknamed, pctOf, progressOf, sessionsOf, statusOf, whoOf } from './livemap.js'

const agent = (id, over = {}) => ({ id, parentId: 'main', name: id, nickname: id.toUpperCase(), role: 'Dev', status: 'running', isMain: false, now: 'Working', next: null, last: null, todos: null, fallback: null, tools: 3, lastTool: 'Edit', activity: null, startedAt: 1000, endedAt: null, xp: null, ...over })
const session = (id, label, agents, extra = {}) => ({ session: id, label, alive: true, snapshot: { at: 5000, team: { name: `${label} Team`, purpose: 'p', lead: 'Lead' }, agents, tasks: [], roles: [], overall: { done: 1, active: 0, total: 4 }, tasksProgress: { done: 1, active: 1, total: 2 }, events: [], ...extra } })
const lead = agent('main', { parentId: null, isMain: true, nickname: 'Sirius Prime', role: 'Tech Lead' })

test('sessions are ordered by name then id, and an old single snapshot is one session', () => {
  const out = sessionsOf({ v: 2, sessions: [session('b', 'zeta', []), session('a', 'alpha', []), session('c', 'alpha', [])] })
  assert.deepEqual(out.map(s => `${s.label}/${s.session}`), ['alpha/a', 'alpha/c', 'zeta/b'])
  const old = sessionsOf({ at: 1, agents: [], team: { name: 'Solo' } })
  assert.equal(old.length, 1)
  assert.equal(old[0].label, 'Solo')
  assert.equal(keyOf(old[0]), 'main')
  assert.equal(sessionsOf(null).length, 0) // nothing recognisable: no sessions, never a throw
})

test('engine statuses become the six states', () => {
  for (const [from, to] of [['running', 'working'], ['pending', 'working'], ['waiting', 'waiting'], ['idle', 'idle'], ['completed', 'done'], ['failed', 'failed'], ['killed', 'stopped'], ['odd', 'idle']]) assert.equal(statusOf(from), to, from)
})

test('progress comes from steps, else the owned task, else it is unknown', () => {
  assert.equal(pctOf({ done: 1, total: 4 }), 25)
  assert.equal(pctOf({ done: 4, total: 4 }), 100)
  assert.equal(pctOf({ done: 3999, total: 4000 }), 99)
  assert.equal(progressOf(agent('a', { todos: { done: 2, total: 4 } })), 50)
  assert.equal(progressOf(agent('a', { fallback: { kind: 'task', status: 'in_progress' } })), 50)
  assert.equal(progressOf(agent('a', { fallback: { kind: 'sweep' } })), undefined)
})

test('groups carry each session with its names, the lead first, needs-you marked and elapsed time from the engine clock', () => {
  const s1 = session('s1', 'app', [agent('qa', { status: 'waiting' }), lead, agent('dev', { activity: { text: 'Editing view.tsx', since: 2000 } })], { inbox: [{ agent: 'qa', what: 'rm -rf build', since: 3000 }] })
  const sessions = sessionsOf({ v: 2, sessions: [s1] })
  const groups = groupsOf(sessions, sessionNames(sessions), () => 9000)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].team, 'app Team')
  assert.equal(groups[0].folder, 'app')
  assert.deepEqual(groups[0].agents.map(a => a.id), ['main', 'dev', 'qa'])
  assert.equal(groups[0].agents[0].isLead, true)
  const dev = groups[0].agents[1]
  assert.equal(dev.status, 'working')
  assert.equal(dev.activity, 'Editing view.tsx')
  assert.equal(dev.elapsed, 7)
  const qa = groups[0].agents[2]
  assert.equal(qa.needsYou, true)
  assert.equal(qa.status, 'waiting')
  assert.deepEqual(groups[0].agents.map(a => a.index), [0, 1, 2]) // each creature a look of its own
})

test('a working agent that waits for the person is shown as waiting; finished ones are not', () => {
  const s1 = session('s1', 'app', [lead, agent('a', { status: 'running' }), agent('b', { status: 'completed' })], { inbox: [{ agent: 'a', what: 'Needs approval' }] })
  const g = groupsOf(sessionsOf({ v: 2, sessions: [s1] }), sessionNames([s1]), () => 0)[0]
  assert.equal(g.agents.find(a => a.id === 'a').status, 'waiting')
  assert.equal(g.agents.find(a => a.id === 'b').status, 'done')
})

test('counts exclude the lead and fold stopped into failed; the HUD names one team or says how many systems', () => {
  const a = session('a', 'app', [lead, agent('1'), agent('2', { status: 'waiting' }), agent('3', { status: 'completed' }), agent('4', { status: 'killed' }), agent('5', { status: 'failed' })])
  const b = session('b', 'docs', [lead, agent('6')])
  assert.deepEqual(countsOf([a]), { working: 1, waiting: 1, done: 1, failed: 2 })
  // members that left the page after their grace are still counted, from the snapshot's `folded`
  const folded = session('c', 'ops', [lead, agent('7', { status: 'completed' })], { folded: { done: 39, failed: 16 } })
  assert.deepEqual(countsOf([a, folded]), { working: 1, waiting: 1, done: 41, failed: 18 })
  const one = hudOf([a], sessionNames([a, b]))
  assert.equal(one.title, 'app Team')
  assert.equal(one.folder, 'app')
  assert.equal(one.pct, 25)
  const two = hudOf([a, b], sessionNames([a, b]))
  assert.equal(two.title, '2 systems')
  assert.equal(two.folder, 'app Team · docs Team')
  assert.deepEqual(two.counts, { working: 2, waiting: 1, done: 1, failed: 2 })
})

test('the inbox lists every waiting agent with its ask, on any session; the board keeps only open blockers', () => {
  const a = session('a', 'app', [lead, agent('qa', { status: 'waiting' })], { inbox: [{ agent: 'qa', what: 'rm -rf build', since: 4000 }, { agent: 'ghost', what: 'x' }], tasks: [{ id: '1', subject: 'Plan', status: 'completed', owner: null, blockedBy: [] }, { id: '2', subject: 'Build', status: 'in_progress', owner: 'qa', blockedBy: ['1'] }, { id: '3', subject: 'Ship', status: 'pending', owner: null, blockedBy: ['2'] }] })
  const sessions = sessionsOf({ v: 2, sessions: [a] })
  const names = sessionNames(sessions)
  const items = inboxItems(sessions, names, false)
  assert.equal(items.length, 1)
  assert.equal(items[0].who, 'QA')
  assert.equal(items[0].command, 'rm -rf build')
  assert.equal(items[0].uid, 'a|qa')
  const [section] = boardSections(sessions, names)
  assert.deepEqual(section.tasks.map(t => [t.id, t.blockedBy]), [['1', []], ['2', []], ['3', ['2']]])
  assert.equal(section.label, 'app Team')
})

test('feed rows say how long ago, use the agent state for colour and mark caught-up gaps', () => {
  const rows = [
    { key: 'a#2', session: 'a', label: 'app', at: 4000, kind: 'tool', text: 'used Edit', agentId: 'dev', agent: agent('dev') },
    { key: 'a#caught', session: 'a', label: 'app', at: 3000, marker: true, text: '… caught up 3 events' },
  ]
  const items = feedItems(rows, () => 10_000, true, () => 'app Team')
  assert.deepEqual(items[0], { time: '6s', status: 'working', who: 'DEV', text: 'used Edit · app Team' })
  assert.deepEqual(items[1], { marker: true, text: 'app: … caught up 3 events' })
})

test('the drawer shows stats, level and timeline; a finished agent is flagged', () => {
  const s = session('a', 'app', [lead], { events: [{ n: 1, at: 2000, kind: 'tool', agent: 'dev', text: 'used Edit' }, { n: 2, at: 3000, kind: 'step', agent: 'other', text: 'done: x' }] })
  const d = drawerOf(agent('dev', { xp: { level: 3, xp: 210, badges: [{ id: 'first_task', title: 'First Task', hint: '' }] }, endedAt: 4000, status: 'completed' }), s, 125_000)
  assert.equal(d.status, 'done')
  assert.equal(d.finished, true)
  assert.equal(d.level, 3)
  assert.deepEqual(d.badges, ['First Task'])
  assert.deepEqual(d.stats.slice(0, 2), [['Tools', 3], ['Time', 0, 'm']])
  assert.deepEqual(d.timeline, [{ time: '2m', status: 'working', text: 'used Edit' }])
  assert.equal(drawerOf(agent('x'), s, 4000).finished, false)
})

test('toasts name agents by nickname with the real name in brackets, whole words only, never the lead', () => {
  const agents = [lead, agent('dev-1', { nickname: 'Kepler-7b' }), agent('dev-12', { nickname: 'Nyx' }), agent('same', { nickname: 'same' })]
  assert.equal(nicknamed('message sent to dev-1', agents), 'message sent to Kepler-7b (dev-1)')
  assert.equal(nicknamed('dev-12 and dev-1 stopped', agents), 'Nyx (dev-12) and Kepler-7b (dev-1) stopped')
  assert.equal(nicknamed('same finished; main too', agents), 'same finished; main too')
  assert.equal(nicknamed('plain', []), 'plain')
  assert.equal(whoOf(agents[1]), 'Kepler-7b (dev-1)')
  assert.equal(whoOf(agents[3]), 'same')
})

test('Hide done drops finished members but never the lead, and re-hangs helpers of a hidden parent on the lead', () => {
  const s1 = session('s1', 'app', [lead, agent('a', { status: 'completed' }), agent('h', { parentId: 'a' }), agent('b', { status: 'killed' }), agent('c')], { hideFinished: true })
  const g = groupsOf(sessionsOf({ v: 2, sessions: [s1] }), sessionNames([s1]), () => 0)[0]
  assert.deepEqual(g.agents.map(a => a.id), ['main', 'c', 'h'])
  assert.equal(g.agents.find(a => a.id === 'h').parentId, 'main')
  const shown = groupsOf(sessionsOf({ v: 2, sessions: [{ ...s1, snapshot: { ...s1.snapshot, hideFinished: false } }] }), sessionNames([s1]), () => 0)[0]
  assert.equal(shown.agents.length, 5)
})

test('inbox items say how long they waited, and the drawer names the team only when asked', () => {
  const s1 = session('s1', 'app', [lead, agent('a', { status: 'waiting' })], { inbox: [{ agent: 'a', what: 'Bash: ls', since: 1000 }] })
  const sessions = sessionsOf({ v: 2, sessions: [s1] })
  assert.equal(inboxItems(sessions, sessionNames(sessions), true, () => 61000)[0].waited, 60)
  assert.equal(drawerOf(sessions[0].snapshot.agents[1], sessions[0], 0, 0, 'App Team').team, 'App Team')
})

test('the session to talk to by default is one that needs you, else the most recently active, never a stopped one', () => {
  const quiet = session('a', 'a', [lead], { at: 5000 })
  const busy = session('b', 'b', [lead], { at: 9000 })
  const asks = session('c', 'c', [lead, agent('x', { status: 'waiting' })], { at: 1000, inbox: [{ agent: 'x', what: 'ls', since: 1 }] })
  const pick = list => attentionOf(sessionsOf({ v: 2, sessions: list })).session
  assert.equal(pick([quiet, busy]), 'b')
  assert.equal(pick([quiet, busy, asks]), 'c')
  assert.equal(pick([quiet, { ...busy, alive: false }]), 'a')
})

test('Add agent spawns the chosen role (general-purpose for a session without a team), Hire another asks the lead, no role sends nothing', () => {
  const roles = [{ id: 'general-purpose', title: 'General Purpose', count: 3, active: 0 }, { id: 'qa', title: 'QA Engineer', count: 1, active: 0 }]
  assert.deepEqual(addRequest({ roleId: 'general-purpose', task: 'look at it' }, roles), { type: 'spawn', role: 'general-purpose', task: 'look at it' })
  assert.deepEqual(addRequest({ roleId: 'qa', task: 'test it', hire: true }, roles), { type: 'lead', text: 'Please bring on another QA Engineer for this: test it' })
  assert.deepEqual(addRequest({ task: 'help', hire: true }, []), { type: 'lead', text: 'Please bring on another helper for this: help' })
  assert.equal(addRequest({ task: 'x' }, []), null)
})

test('the lead takes its state from its tone (its status is always running), members from their status', () => {
  const idleLead = { ...lead, status: 'running', tone: 'done' }
  assert.equal(agentStatus(idleLead), 'done')
  assert.equal(agentStatus({ ...lead, status: 'running', tone: 'running' }), 'working')
  assert.equal(agentStatus({ ...lead, status: 'running', tone: 'needs_input' }), 'waiting')
  assert.equal(agentStatus({ ...lead, status: 'running', tone: 'error' }), 'failed')
  assert.equal(agentStatus(agent('a', { status: 'completed', tone: 'running' })), 'done')
  const g = groupsOf(sessionsOf({ v: 2, sessions: [session('s1', 'app', [idleLead, agent('a', { status: 'completed' })])] }), new Map(), () => 0)[0]
  assert.equal(g.agents.find(a => a.isLead).status, 'done')
})

test('two pushes that differ only in the engine clock have the same signature; a real change does not', () => {
  const a = sessionsOf({ v: 2, sessions: [session('s1', 'app', [lead], { at: 1000 })] })
  const b = sessionsOf({ v: 2, sessions: [session('s1', 'app', [lead], { at: 2000 })] })
  const c = sessionsOf({ v: 2, sessions: [session('s1', 'app', [lead, agent('x')], { at: 2000 })] })
  assert.equal(signatureOf(a), signatureOf(b))
  assert.notEqual(signatureOf(a), signatureOf(c))
})

// ---- 0.6.0: what each agent says it is doing, talk bubbles, the page in Thai ------------------------------------------------

test("each agent's sentence (lead included) reaches the cards and the drawer; none when the mod sends null", () => {
  const s1 = session('s1', 'app', [{ ...lead, says: 'Waiting for 1 of 2 members' }, agent('dev', { says: 'Working on the old API and fixing its issues' }), agent('qa', { says: null })])
  const sessions = sessionsOf({ v: 2, sessions: [s1] })
  const g = groupsOf(sessions, sessionNames(sessions), () => 0)[0]
  assert.equal(g.agents.find(a => a.isLead).says, 'Waiting for 1 of 2 members')
  assert.equal(g.agents.find(a => a.id === 'dev').says, 'Working on the old API and fixing its issues')
  assert.equal(g.agents.find(a => a.id === 'qa').says, undefined)
  assert.equal(drawerOf(sessions[0].snapshot.agents[1], sessions[0], 0).says, 'Working on the old API and fixing its issues')
  assert.equal(drawerOf(sessions[0].snapshot.agents[2], sessions[0], 0).says, undefined)
})

test('bubbles sit on the card they name, with the direction, the other party by name ("Lead" for the lead) and their age', () => {
  const bubbles = [
    { agent: 'dev', other: 'main', dir: 'from', text: 'fix the old API', at: 4000 },
    { agent: 'qa', other: 'dev', dir: 'to', text: 'can you check the API tests?', at: 4500 },
    { agent: 'ghost', other: 'main', dir: 'to', text: 'not on the page', at: 4500 },
  ]
  const s1 = session('s1', 'app', [lead, agent('dev', { nickname: 'Sam' }), agent('qa'), agent('rev')], { bubbles })
  const sessions = sessionsOf({ v: 2, sessions: [s1] })
  const g = groupsOf(sessions, sessionNames(sessions), () => 5000)[0]
  const by = id => g.agents.find(a => a.id === id).bubble
  assert.deepEqual(by('dev'), { key: '4000|main', dir: 'from', who: 'Lead', text: 'fix the old API', age: 1000 })
  assert.deepEqual(by('qa'), { key: '4500|dev', dir: 'to', who: 'Sam', text: 'can you check the API tests?', age: 500 })
  assert.equal(by('rev'), undefined)
  assert.equal(by('main'), undefined)
  assert.equal(g.agents.filter(a => a.bubble).length, 2, 'never more than the snapshot carries for cards on the page')
})

test('a bubble may sit on the lead; an unknown other party is named by its id; two for one card keep the newest', () => {
  const bubbles = [
    { agent: 'main', other: 'dev', dir: 'from', text: 'done, 3 tests added', at: 100 },
    { agent: 'dev', other: 'x9', dir: 'to', text: 'old', at: 100 },
    { agent: 'dev', other: 'x9', dir: 'to', text: 'new', at: 200 },
  ]
  const s1 = session('s1', 'app', [lead, agent('dev')], { bubbles })
  const g = groupsOf(sessionsOf({ v: 2, sessions: [s1] }), new Map(), () => 100)[0]
  assert.equal(g.agents.find(a => a.isLead).bubble.who, 'DEV')
  assert.equal(g.agents.find(a => a.id === 'dev').bubble.text, 'new')
  assert.equal(g.agents.find(a => a.id === 'dev').bubble.who, 'x9')
  assert.equal(g.agents.find(a => a.id === 'dev').bubble.age, 0, 'a clock behind the bubble is no negative age')
  const none = groupsOf(sessionsOf({ v: 2, sessions: [session('s1', 'app', [lead, agent('dev')])] }), new Map(), () => 0)[0]
  assert.ok(none.agents.every(a => a.bubble === undefined), 'no bubbles in the snapshot, none on the page')
})

test('in Thai the page-made words are Thai: systems, the lead in a bubble, elapsed time, the stats and the default ask', async () => {
  const { setLang } = await import('./i18n.js')
  try {
    setLang('th')
    const a = session('a', 'app', [lead, agent('dev', { status: 'waiting' })], { bubbles: [{ agent: 'dev', other: 'main', dir: 'from', text: 'แก้ปัญหาของ API เก่า', at: 0 }] })
    const b = session('b', 'docs', [lead])
    assert.equal(hudOf([a, b], sessionNames([a, b])).title, '2 ระบบ')
    const sessions = sessionsOf({ v: 2, sessions: [a] })
    assert.equal(groupsOf(sessions, sessionNames(sessions), () => 0)[0].agents[1].bubble.who, 'หัวหน้า')
    assert.equal(feedItems([{ session: 'a', at: 0, kind: 'tool', text: 'x', agent: null, agentId: 'dev' }], () => 252_000, false, () => '')[0].time, '4 นาที')
    assert.deepEqual(drawerOf(agent('dev'), sessions[0], 61_000).stats.map(s => s[0]), ['เครื่องมือ', 'เวลา', 'ล่าสุด'])
    assert.equal(inboxItems(sessions, sessionNames(sessions), false)[0].ask, 'รออนุมัติ')
  } finally {
    setLang('en')
  }
})

test("the overview's waiting count is agents held for the person (also in the inbox), so Thai calls it รอคุณ like the lead deck, not รออนุมัติ", async () => {
  const { STRINGS } = await import('./i18n.js')
  // held agents (engine status `waiting`: a plan's approval, background work or an Agent call) are the people-waiting items, not approvals only
  const s = session('a', 'app', [lead, agent('held', { status: 'waiting' }), agent('busy')])
  assert.equal(countsOf([s]).waiting, 1)
  assert.deepEqual(inboxItems(sessionsOf({ v: 2, sessions: [s] }), new Map(), false).map(i => i.agent), ['held'], 'the counted agent is one that waits on the person')
  assert.equal(STRINGS.th['crew.waiting'], 'รอคุณ')
  assert.equal(STRINGS.th['crew.waiting'], STRINGS.th['status.waiting'], "the same word as the lead deck's count and the inbox title")
})
