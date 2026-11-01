// The person-facing text table (hooks/i18n.ts) and the English the hooks build from it. Text the model reads is English too.
import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { TABLES, t } from '../hooks/i18n'
import type { Key } from '../hooks/i18n'
import { describeCall } from '../hooks/activity'
import { statusText } from '../hooks/inbox'
import { elapsed, mergeAgents } from '../hooks/model'
import { xpAnnouncement } from '../hooks/xpstore'
import { BADGES } from '../hooks/xp'
import { buildReport, reportToast, summaryPrompt } from '../hooks/report'
import { handlePageAction } from '../hooks/actions'
import type { ActionDeps } from '../hooks/actions'
import { buildSnapshot } from '../hooks/live'
import { statusEvents } from '../hooks/feed'
import { planHire } from '../hooks/hire'
import { parseTeam, rolePrompt } from '../hooks/team'
import type { HqData } from '../hooks/view'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

test('the table has a text for every key, and every value is plain English text', () => {
  const keys = Object.keys(TABLES.en) as Key[]
  expect(keys.length).toBeGreaterThan(120)
  expect(Object.keys(TABLES)).toEqual(['en'])
  expect(keys.filter(key => /[^\x00-\x7f·…→←✓✕▸◌○⛓≈›🪐—–]/.test(TABLES.en[key]))).toEqual([])
  expect(keys.filter(key => placeholders(TABLES.en[key]).some(name => !name))).toEqual([])
})

test('t fills placeholders and leaves an unknown one as it is', () => {
  expect(t('en', 'band.running', { n: 2 })).toBe('2 running')
  expect(t('en', 'band.running')).toBe('{n} running')
})

test('tool lines, the status line and elapsed time read in English', () => {
  expect(describeCall('Edit', { file_path: '/a/view.tsx' })).toBe('Editing view.tsx')
  expect(describeCall('Bash', { command: 'npm test' })).toBe('Running npm test')
  expect(statusText(2, 1, { done: 3, total: 5 })).toBe('🪐 2 working · 1 needs you · 3/5 tasks')
  expect(elapsed(252_000)).toBe('4m 12s')
  expect(elapsed(12_000)).toBe('12s')
  expect(elapsed(7_260_000)).toBe('2h 1m')
})

test('XP toasts and badges read in English', () => {
  const [first] = BADGES
  if (!first) throw new Error('no badges')
  const { toasts } = xpAnnouncement([{ nickname: 'Alex', level: 3, badges: [first] }], null, true)
  expect(toasts[0]).toMatch(/^Agent HQ: Alex /)
  expect(t('en', 'badge.first_task.title')).toBe(first.title)
})

const TEAM = parseTeam(
  JSON.stringify({
    name: 'Web',
    purpose: 'Ship the site',
    lead: { title: 'Tech Lead', rules: [], skills: [] },
    roles: [{ id: 'dev', title: 'Developer', count: 2, mission: 'Build.', tasks: [], rules: [], skills: [] }],
  }),
)
if (typeof TEAM === 'string') throw new Error(TEAM)
const team = TEAM
const dev: AgentInfo = { id: 'd1', name: 'dev-1', type: 'agent-hq:dev', description: 'x', status: 'running' }
const data = (): HqData => ({ agents: mergeAgents({}, [dev], 0), todos: {}, tasks: {}, now: 1000, hideFinished: false, columns: 0, isLight: false, team })

test('the session report and its toast are in English; the summary prompt asks for English', () => {
  expect(buildReport(data(), 0)).toContain('## Task board')
  expect(reportToast(data(), '/w/r.md', '/w')).toMatch(/^Agent HQ: .*r\.md/)
  expect(summaryPrompt('x')).not.toMatch(/Thai/)
})

test('live page notices and feed events are in English', async () => {
  const deps = { readData: async () => data(), getAgent: async () => undefined } as unknown as ActionDeps
  expect(await handlePageAction({} as never, { type: 'nope' }, deps)).toEqual({ ok: false, text: t('en', 'page.unknown') })
  expect(await handlePageAction({} as never, { type: 'stop', agent: 'zz' }, deps)).toEqual({ ok: false, text: t('en', 'page.noAgent') })
  const before = mergeAgents({}, [dev], 0)
  const after = mergeAgents(before, [{ ...dev, status: 'completed' }], 5)
  expect(statusEvents(before, after)[0]?.text).toBe('running → completed')
})

test('the snapshot has no language and its words are English', () => {
  const snap = buildSnapshot({ ...data(), team: null }, 1)
  expect(snap).not.toHaveProperty('lang')
  expect(snap.roles[0]?.title).toBe(t('en', 'live.generalAgent'))
})

test('a hired reviewer is read-only by its id or its title', () => {
  const source = JSON.stringify({ name: 'Web', purpose: '', lead: { title: 'Lead', rules: [], skills: [] }, roles: [{ id: 'dev', title: 'Dev', count: 1, mission: 'Build.' }] })
  const byId = planHire(source, { role: 'code-reviewer', title: 'Checker', mission: 'Read code' })
  const byTitle = planHire(source, { role: 'checker', title: 'Code auditor', mission: 'Read code' })
  for (const plan of [byId, byTitle]) {
    if (!plan.ok) throw new Error(plan.error)
    expect(parseTeam(plan.source)).toMatchObject({ roles: [{}, { guard: { readOnly: true } }] })
  }
})

test('a member is told no language: prompts are English and carry no language section', () => {
  const role = team.roles[0]
  if (!role) throw new Error('no role')
  expect(rolePrompt(team, role, true)).not.toMatch(/Thai|## Language/)
})
