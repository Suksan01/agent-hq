// What the live page shows, worked out from what the hub pushes: sessions in a stable order, the groups the diagram and space
// views draw, the title HUD's numbers, the feed, the inbox and the task boards. Pure (no DOM, no imports but labels.js and
// feed.js), so `node --test` checks it; the page (live.js) only hands the results to the panels.

import { inboxOf } from './feed.js'
import { levelOf, timelineOf } from './drawer.js'

/** The engine's statuses as the six states of the look. */
const STATUS_OF = { running: 'working', pending: 'working', waiting: 'waiting', idle: 'idle', completed: 'done', failed: 'failed', killed: 'stopped' }
export const statusOf = status => STATUS_OF[status] ?? (['working', 'waiting', 'done', 'failed', 'idle', 'stopped'].includes(status) ? status : 'idle')

/** The lead's snapshot status is always 'running'; what it is doing is in its `tone` (running, needs_input, done, error). Members use their status. */
const LEAD_TONE = { running: 'working', needs_input: 'waiting', done: 'done', error: 'failed' }
export const agentStatus = a => (a.isMain ? LEAD_TONE[a.tone] ?? 'working' : statusOf(a.status))

export const BLANK = { at: 0, team: null, agents: [], tasks: [], roles: [], overall: { done: 0, active: 0, total: 0 }, tasksProgress: { done: 0, active: 0, total: 0 }, notice: null, hideFinished: false, events: [] }

/** /events and /state carry {v: 2, sessions: [{session, cwd, label, alive, snapshot}]}; an older single snapshot is one session. Stable order: name, then id. */
export function sessionsOf(data) {
  const list = data?.v === 2 ? data.sessions ?? [] : [{ session: null, label: data?.team?.name ?? 'Agent HQ', alive: true, snapshot: data }]
  return list
    .filter(s => s?.snapshot)
    .map(s => ({ session: s.session ?? null, label: s.label || 'session', alive: s.alive !== false, snapshot: { ...BLANK, ...s.snapshot } }))
    .sort((a, b) => a.label.localeCompare(b.label) || String(a.session).localeCompare(String(b.session)))
}
export const keyOf = s => s.session ?? 'main'

export const pctOf = p => (!p || !p.total ? 0 : p.done === p.total ? 100 : Math.min(99, Math.round((p.done / p.total) * 100)))
const TASK_PCT = { pending: 0, in_progress: 50, completed: 100 }

/** An agent's progress 0-100: its steps, else the board task it owns; undefined when nothing is known (the bar then shows it is working). */
export function progressOf(agent) {
  if (agent.todos) return pctOf(agent.todos)
  if (agent.fallback?.kind === 'task') return TASK_PCT[agent.fallback.status] ?? 0
  return undefined
}

/** Who is waiting for the person, as `session|agent` ids. */
export const waitingIds = sessions => new Set(sessions.flatMap(s => inboxOf(s.snapshot).map(i => `${keyOf(s)}|${i.agent}`)))

/**
 * The groups the diagram and space views draw: one per session, its agents in the views' shape. `clockOf(session)` is the engine's time
 * (ms) so a working agent's current call can say how long it has run.
 */
export function groupsOf(sessions, names, clockOf = () => 0) {
  const waiting = waitingIds(sessions)
  let index = 0
  return sessions.map(s => {
    const n = names.get(s.session) ?? { team: s.label, folder: s.label, tag: '' }
    const clock = clockOf(s.session)
    const agents = [...s.snapshot.agents].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.id.localeCompare(b.id)).map(a => {
      const status = agentStatus(a)
      const needsYou = waiting.has(`${keyOf(s)}|${a.id}`)
      return {
        id: a.id,
        parentId: a.parentId ?? null,
        nickname: a.nickname || a.name,
        name: a.name,
        role: a.role,
        status: needsYou && status === 'working' ? 'waiting' : status,
        progress: progressOf(a),
        isLead: Boolean(a.isMain),
        needsYou,
        now: a.now || undefined,
        next: a.next || undefined,
        activity: a.activity?.text || undefined, // the cards draw the ▸ themselves
        elapsed: status === 'working' && a.activity?.since ? Math.max(0, Math.round((clock - a.activity.since) / 1000)) : undefined,
        seed: a.id,
        index: index++,
      }
    })
    // "Hide done" drops finished members (never the lead); a helper whose parent went is hung on the lead
    const shown = s.snapshot.hideFinished ? agents.filter(m => m.isLead || !['done', 'failed', 'stopped'].includes(m.status)) : agents
    const ids = new Set(shown.map(m => m.id))
    const leadId = shown.find(m => m.isLead)?.id ?? null
    const tidy = shown.map(m => (m.parentId && !ids.has(m.parentId) ? { ...m, parentId: leadId } : m))
    return { session: s.session, team: n.flag ?? n.team, folder: n.sub || n.folder, tag: n.tag, alive: s.alive, agents: tidy }
  })
}

/** The members' counts by state (the lead is not counted; stopped counts as failed), over the sessions shown. */
export function countsOf(shown) {
  const states = shown.flatMap(s => s.snapshot.agents.filter(a => !a.isMain)).map(a => statusOf(a.status))
  return { working: states.filter(t => t === 'working').length, waiting: states.filter(t => t === 'waiting').length, done: states.filter(t => t === 'done').length, failed: states.filter(t => t === 'failed' || t === 'stopped').length }
}

/** The title HUD: one team's name and folder, or "N systems"; the Doto counts; the team's progress 0-100. */
export function hudOf(shown, names) {
  const one = shown.length === 1 ? shown[0] : null
  const n = one ? names.get(one.session) : null
  const overall = shown.reduce((p, s) => ({ done: p.done + s.snapshot.overall.done, total: p.total + s.snapshot.overall.total }), { done: 0, total: 0 })
  return {
    title: one ? n?.flag ?? one.label : `${shown.length} systems`,
    folder: one ? n?.sub || undefined : shown.map(s => names.get(s.session)?.flag ?? s.label).join(' · '),
    counts: countsOf(shown),
    pct: pctOf(overall),
    hasTeam: Boolean(one?.snapshot.team),
  }
}

const elapsedText = ms => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}
export { elapsedText }

const FEED_STATUS = { tool: 'working', step: 'done', status: 'idle', message: 'lead', action: 'waiting' }

/** The feed's rows for the FeedTile, newest first: `rows` from feed.js feedRows; markers are the "caught up" lines. */
export function feedItems(rows, clockOf, isMulti, nameOf) {
  return rows.map(r => r.marker
    ? { marker: true, text: `${isMulti ? `${r.label}: ` : ''}${r.text}` }
    : {
      time: elapsedText(clockOf(r.session) - r.at),
      status: r.agent ? agentStatus(r.agent) : FEED_STATUS[r.kind] ?? 'idle',
      who: r.agent ? r.agent.nickname || r.agent.name : r.agentId ?? '',
      text: `${r.text}${isMulti ? ` · ${nameOf(r.session)}` : ''}`,
    })
}

/** The inbox tile's items: every agent waiting, on any session; `uid` is `session|agent`. */
export function inboxItems(sessions, names, isMulti, clockOf = () => 0) {
  return sessions.flatMap(s => inboxOf(s.snapshot).flatMap(item => {
    const agent = s.snapshot.agents.find(a => a.id === item.agent)
    return agent ? [{ who: agent.nickname || agent.name, role: agent.role, ask: `${item.text}${isMulti ? ` · ${names.get(s.session)?.prefix ?? s.label}` : ''}`, command: item.text !== 'Needs approval' ? item.text : undefined, uid: `${keyOf(s)}|${agent.id}`, session: s.session, agent: agent.id, since: item.since, waited: item.since ? Math.max(0, Math.round((clockOf(s.session) - item.since) / 1000)) : undefined }] : []
  }))
}

/** The task board: one section per session shown; `blockedBy` keeps only tasks still open. */
export function boardSections(shown, names) {
  return shown.map(s => {
    const open = new Set(s.snapshot.tasks.filter(t => t.status !== 'completed').map(t => t.id))
    return {
      key: keyOf(s),
      label: names.get(s.session)?.prefix ?? s.label,
      progress: { done: s.snapshot.tasksProgress.done, total: s.snapshot.tasksProgress.total },
      tasks: s.snapshot.tasks.map(t => ({ id: t.id, subject: t.subject, status: t.status, owner: t.owner ?? undefined, blockedBy: t.blockedBy.filter(b => open.has(b)) })),
    }
  })
}

/** What the drawer shows for one agent (the props of Drawer), from the snapshot's agent and its session's events. */
export function drawerOf(agent, session, clock, index = 0, team) {
  const status = agentStatus(agent)
  const level = levelOf(agent.xp)
  const end = agent.endedAt ?? clock
  const minutes = Math.max(0, Math.round((end - agent.startedAt) / 60000))
  return {
    nickname: agent.nickname || agent.name,
    name: agent.name,
    role: agent.role,
    team,
    status,
    seed: agent.id,
    index,
    lead: Boolean(agent.isMain),
    pct: progressOf(agent),
    activity: agent.activity?.text || undefined,
    elapsed: status === 'working' && agent.activity?.since ? Math.max(0, Math.round((clock - agent.activity.since) / 1000)) : undefined,
    now: agent.now || undefined,
    next: agent.next || undefined,
    stats: [['Tools', agent.tools], minutes >= 60 ? ['Time', Math.floor(minutes / 60), 'h'] : ['Time', minutes, 'm'], ...(agent.lastTool ? [['Last', agent.lastTool]] : [])],
    level: level?.level,
    xp: level?.into,
    xpNext: level?.need,
    badges: level?.badges.map(b => b.title) ?? [],
    timeline: timelineOf(session.snapshot.events, agent.id).map(e => ({ time: elapsedText(clock - e.at), status: FEED_STATUS[e.kind] ?? 'idle', text: e.text })),
    finished: ['done', 'stopped', 'failed'].includes(status) && Boolean(agent.endedAt),
  }
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasNickname = a => Boolean(a.nickname) && a.nickname !== a.name

/** An agent as the person addresses it: "Kepler-7b (frontend-dev-1)", its nickname first, its real name in brackets. */
export const whoOf = a => (hasNickname(a) ? `${a.nickname} (${a.name})` : a.name)

/** A toast from the engine names agents by their real name: add each one's nickname. */
export function nicknamed(text, agents) {
  const named = agents.filter(a => !a.isMain && hasNickname(a)).sort((a, b) => b.name.length - a.name.length)
  if (named.length === 0) return text
  const pattern = new RegExp(`(?<![\\w-])(${named.map(a => escapeRe(a.name)).join('|')})(?![\\w-])`, 'g')
  return text.replace(pattern, name => whoOf(named.find(a => a.name === name)))
}

/** The live session to talk to when none is chosen: one that needs the person (an inbox item or a failure), else the most recently active. */
export function attentionOf(sessions) {
  const alive = sessions.filter(s => s.alive)
  const needs = s => inboxOf(s.snapshot).length > 0 || s.snapshot.agents.some(a => agentStatus(a) === 'failed')
  const recent = s => Math.max(s.snapshot.at, ...s.snapshot.events.map(e => e.at))
  const pool = alive.some(needs) ? alive.filter(needs) : alive
  return pool.reduce((best, s) => (!best || recent(s) > recent(best) ? s : best), null) ?? sessions[0]
}

/** The action for the Add agent dialog: "Hire another" asks the lead; otherwise a spawn of the chosen role (a session without a team offers `general-purpose`). Null when there is no role to spawn. */
export function addRequest({ roleId, task, hire }, roles) {
  if (hire) return { type: 'lead', text: `Please bring on another ${roles.find(r => r.id === roleId)?.title ?? roleId ?? 'helper'} for this: ${task}` }
  return roleId ? { type: 'spawn', role: roleId, task } : null
}

/** What a push says apart from the engine's clock: two pushes with the same signature need no new render (the clock alone moves every write). */
export const signatureOf = sessions => JSON.stringify(sessions.map(s => [s.session, s.label, s.alive, { ...s.snapshot, at: 0 }]))
