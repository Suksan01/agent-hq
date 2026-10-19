import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { HqAgent } from '../types'
import { buildSnapshot } from '../hooks/live'
import { MAIN, mergeAgents } from '../hooks/model'
import { LEAD_NICKNAMES, NICKNAMES, pickNickname } from '../hooks/names'
import { THEMES } from '../hooks/themes'
import { nameAndRole, titleParts } from '../hooks/view'
import type { HqData } from '../hooks/view'

const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }

const agent = (id: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, name: id, type: 'general-purpose', description: `do ${id}`, status })

async function mountWith($: Engine, on: On, listed: AgentInfo[], bodyColumns = 46) {
  mock.clock(on)
  on('agent.list', () => ({ value: listed }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: listed[0]?.id ?? 'x' }))
  await $.agent.spawn({ prompt: 'go', description: 'seed' } as never)
  return $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: { ...PANE_PROPS, bodyColumns } as never })
}

test('the pools are at least 80 and 12 short, plain, distinct names', () => {
  expect(NICKNAMES.length).toBeGreaterThanOrEqual(80)
  expect(LEAD_NICKNAMES.length).toBeGreaterThanOrEqual(8)
  for (const pool of [NICKNAMES, LEAD_NICKNAMES]) {
    expect(new Set(pool).size).toBe(pool.length)
    for (const name of pool) expect(name).toMatch(/^[A-Za-z][A-Za-z0-9 -]{1,15}$/)
  }
  expect(NICKNAMES.filter(n => LEAD_NICKNAMES.includes(n))).toEqual([])
})

test('a nickname is the same every time for the same id', () => {
  expect(pickNickname('agent-1', new Set())).toBe(pickNickname('agent-1', new Set()))
  const picks = new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'f6'].map(id => pickNickname(id, new Set())))
  expect(picks.size).toBeGreaterThan(1)
})

test('a name already taken is skipped; when the pool runs out the names come round with a numeral', () => {
  const first = pickNickname('x', new Set())
  expect(pickNickname('x', new Set([first]))).not.toBe(first)

  const all = new Set(NICKNAMES)
  const second = pickNickname('x', all)
  expect(second).toBe(`${first} II`)
  expect(pickNickname('x', new Set([...all, second]))).not.toBe(second)
  expect(pickNickname('x', new Set([...all, ...NICKNAMES.map(n => `${n} II`)]))).toBe(`${first} III`)
  expect(LEAD_NICKNAMES).toContain(pickNickname(MAIN, new Set(), true))
})

test('thirty agents each get a nickname of their own; the lead gets one from the lead pool', () => {
  const listed = Array.from({ length: 30 }, (_, i) => agent(`agent-${i}`))
  const rows = mergeAgents({}, listed, 0)
  const names = Object.values(rows).map(a => a.nickname)
  expect(names.every(n => typeof n === 'string' && n.length > 0)).toBe(true)
  expect(new Set(names).size).toBe(31)
  expect(LEAD_NICKNAMES).toContain(rows[MAIN]?.nickname as string)
  expect(NICKNAMES).toContain(rows['agent-0']?.nickname as string)
})

test('a nickname is kept once given, even as the agent changes', () => {
  const first = mergeAgents({}, [agent('a'), agent('b')], 0)
  const later = mergeAgents(first, [agent('a', 'completed'), agent('b')], 50)
  expect(later.a?.nickname).toBe(first.a?.nickname)
  expect(later.b?.nickname).toBe(first.b?.nickname)
  expect(later.a).not.toBe(first.a) // updated as a copy
})

test('rows without a nickname get one, and the later-started of two with the same one is given another', () => {
  const rows = mergeAgents({}, [agent('a'), agent('b')], 0)
  const bare = Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, { ...r, nickname: undefined }])) as Record<string, HqAgent>
  const given = mergeAgents(bare, [agent('a'), agent('b')], 5)
  expect(given.a?.nickname).toBeDefined()
  expect(given.b?.nickname).toBeDefined()
  expect(bare.a?.nickname).toBeUndefined() // the input rows are left alone

  const clash = { ...rows, b: { ...rows.b!, nickname: rows.a!.nickname, startedAt: 10 } } as Record<string, HqAgent>
  const fixed = mergeAgents(clash, [agent('a'), agent('b')], 20)
  expect(fixed.a?.nickname).toBe(rows.a?.nickname)
  expect(fixed.b?.nickname).not.toBe(fixed.a?.nickname)
  expect(clash.b?.nickname).toBe(rows.a?.nickname)
})

test('the live snapshot carries the nickname beside the real name', () => {
  const data: HqData = { agents: mergeAgents({}, [agent('d1')], 0), todos: {}, tasks: {}, now: 1, hideFinished: false, columns: 0, isLight: false, team: null }
  const byId = Object.fromEntries(buildSnapshot(data, 1).agents.map(a => [a.id, a]))
  expect(byId.d1?.nickname).toBe(data.agents.d1?.nickname)
  expect(byId.d1?.name).toBe('d1')
  expect(byId[MAIN]?.nickname).toBe(data.agents[MAIN]?.nickname)
})

test('the sidebar shows each agent by nickname, then its real name; the lead by nickname and title', async ($, on) => {
  const ui = await mountWith($, on, [agent('busy-dev'), agent('sleepy-dev', 'idle')])
  const rows = mergeAgents({}, [agent('busy-dev'), agent('sleepy-dev', 'idle')], 0)

  for (const id of ['busy-dev', 'sleepy-dev']) {
    const text = (await ui.find({ key: `agent-${id}` }))?.text ?? ''
    expect(text).toContain(rows[id]?.nickname as string)
    expect(text).toContain(id)
    expect(text.indexOf(rows[id]?.nickname as string)).toBeLessThan(text.indexOf(id)) // the nickname comes first
  }
  const lead = (await ui.find({ key: `agent-${MAIN}` }))?.text ?? ''
  expect(lead).toContain(`${rows[MAIN]?.nickname} · main`)
  await ui.unmount()
})

test('a chosen theme names new agents from its pools, and agents that already have a nickname keep it', () => {
  const pirates = mergeAgents({}, [agent('a'), agent('b')], 0, THEMES.pirates)
  expect(THEMES.pirates.members).toContain(pirates.a?.nickname as string)
  expect(THEMES.pirates.leads).toContain(pirates[MAIN]?.nickname as string)
  const switched = mergeAgents(pirates, [agent('a'), agent('b'), agent('c')], 5, THEMES.robots)
  expect(switched.a?.nickname).toBe(pirates.a?.nickname)
  expect(switched[MAIN]?.nickname).toBe(pirates[MAIN]?.nickname)
  expect(THEMES.robots.members).toContain(switched.c?.nickname as string)
})

test('the nicknameTheme option picks the theme the sidebar names agents from', { options: { nicknameTheme: 'forest-friends' } }, async ($, on) => {
  const ui = await mountWith($, on, [agent('busy-dev')])
  const rows = mergeAgents({}, [agent('busy-dev')], 0, THEMES['forest-friends'])
  expect(THEMES['forest-friends'].members).toContain(rows['busy-dev']?.nickname as string)
  expect((await ui.find({ key: 'agent-busy-dev' }))?.text ?? '').toContain(rows['busy-dev']?.nickname as string)
  expect((await ui.find({ key: `agent-${MAIN}` }))?.text ?? '').toContain(rows[MAIN]?.nickname as string)
  await ui.unmount()
})

test('on a narrow sidebar the role is cut first and the real name stays', async ($, on) => {
  const ui = await mountWith($, on, [agent('frontend-dev-1', 'idle')], 34)
  const text = (await ui.find({ key: 'agent-frontend-dev-1' }))?.text ?? ''
  expect(text).toMatch(/frontend|fronte…/)
  expect(text).not.toContain('general-purpose')
  await ui.unmount()
})

test('nameAndRole: the role gives way first, the name keeps at least six columns, and is dropped only below that', () => {
  const name = 'frontend-dev-1'
  const role = 'Frontend Developer'
  expect(nameAndRole(name, role, 40)).toEqual({ name, role })
  const cut = nameAndRole(name, role, 24)
  expect(cut.name).toBe(name)
  expect(cut.role.length).toBeLessThan(role.length)
  expect(cut.role.endsWith('…')).toBe(true)
  expect(nameAndRole(name, role, 16)).toEqual({ name, role: '' }) // the role is dropped, not squeezed to nothing
  expect(nameAndRole(name, role, 11)).toEqual({ name: 'frontend-…', role: '' })
  expect(nameAndRole(name, role, 7).name).toHaveLength(6)
  expect(nameAndRole(name, role, 6)).toEqual({ name: '', role: '' })
})

test('titleParts: nickname first; the lead reads "nickname · title"; a row with no nickname keeps its name', () => {
  const member = { id: 'd1', name: 'dev-1', role: 'x', description: '', status: 'running', startedAt: 0, tools: 0, nickname: 'Mochi-chan' } as HqAgent
  expect(titleParts(member, { name: 'dev-1', role: 'Developer' }, 60)).toEqual({ head: 'Mochi-chan', tail: ' dev-1 Developer' })
  expect(titleParts({ ...member, id: MAIN, name: 'main', nickname: 'Captain Ramen' }, { name: 'Tech Lead', role: 'lead' }, 60)).toEqual({ head: 'Captain Ramen', tail: ' · Tech Lead' })
  const plain = { ...member, nickname: undefined }
  expect(titleParts(plain, { name: 'dev-1', role: 'Developer' }, 60)).toEqual({ head: 'dev-1', tail: ' Developer' })
})
