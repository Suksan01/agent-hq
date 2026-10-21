// The person-facing text tables (hooks/i18n.ts) and the Thai the hooks build from them. Text the model reads stays English.
import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { TABLES, langOf, languageOfAnswer, t } from '../hooks/i18n'
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
import { statusEvents, stepEvents } from '../hooks/feed'
import { planHire } from '../hooks/hire'
import { parseTeam, rolePrompt } from '../hooks/team'
import type { HqData } from '../hooks/view'

const THAI = /[฀-๿]/
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
// th values that may carry no Thai script (a brand, a symbol): none so far
const WITHOUT_THAI = new Set<string>([])

test('the Thai table has every English key, with the same placeholders', () => {
  const en = Object.keys(TABLES.en).sort()
  expect(Object.keys(TABLES.th).sort()).toEqual(en)
  const mismatched = en.filter(key => JSON.stringify(placeholders(TABLES.en[key as Key])) !== JSON.stringify(placeholders(TABLES.th[key as Key])))
  expect(mismatched).toEqual([])
  expect(en.length).toBeGreaterThan(120)
})

test('every Thai value is written in Thai and none is left as its English', () => {
  const keys = Object.keys(TABLES.en) as Key[]
  expect(keys.filter(key => !WITHOUT_THAI.has(key) && !THAI.test(TABLES.th[key]))).toEqual([])
  expect(keys.filter(key => TABLES.th[key] === TABLES.en[key])).toEqual([])
  // house rules: no polite particles, no first-person pronouns, the agent counter is คน
  expect(keys.filter(key => /ครับ|ค่ะ|ผม|ฉัน|ดิฉัน/.test(TABLES.th[key]))).toEqual([])
  expect(keys.filter(key => /\d+ ตัว|\{\w+\} ตัว/.test(TABLES.th[key]))).toEqual([])
})

test('t fills placeholders and falls back to the option default', () => {
  expect(t('en', 'band.running', { n: 2 })).toBe('2 running')
  expect(t('th', 'band.running', { n: 2 })).toBe('ทำงานอยู่ 2')
  expect(langOf('thai')).toBe('th')
  expect(langOf('english')).toBe('en')
  expect(langOf(undefined)).toBe('en')
  expect(langOf('klingon')).toBe('en')
  expect(languageOfAnswer('ภาษาไทย')).toBe('th')
  expect(languageOfAnswer('English')).toBe('en')
  expect(languageOfAnswer(null)).toBe('en')
})

test('tool lines, the status line and elapsed time read in Thai', () => {
  expect(describeCall('Edit', { file_path: '/a/view.tsx' }, 'th')).toBe('แก้ไข view.tsx')
  expect(describeCall('Bash', { command: 'npm test' }, 'th')).toBe('รัน npm test')
  expect(describeCall('SendMessage', { to: 'Sam' }, 'th')).toBe('ส่งข้อความถึง Sam')
  expect(describeCall('Edit', { file_path: '/a/view.tsx' })).toBe('Editing view.tsx') // English unchanged
  expect(statusText(2, 1, { done: 3, total: 5 }, 'th')).toBe('🪐 ทำงานอยู่ 2 · รอคุณ 1 · งาน 3/5')
  expect(statusText(2, 1, { done: 3, total: 5 })).toBe('🪐 2 working · 1 needs you · 3/5 tasks')
  expect(elapsed(252_000, 'th')).toBe('4 นาที 12 วิ')
  expect(elapsed(252_000, 'th', true)).toBe('4:12')
  expect(elapsed(12_000, 'th')).toBe('12 วิ')
  expect(elapsed(7_260_000, 'th')).toBe('2 ชม. 1 นาที')
  expect(elapsed(252_000)).toBe('4m 12s')
  expect(elapsed(252_000, 'en', true)).toBe('4m 12s') // English is short already
})

test('XP toasts and badges read in Thai', () => {
  const [first] = BADGES
  if (!first) throw new Error('no badges')
  const { toasts } = xpAnnouncement([{ nickname: 'Alex', level: 3, badges: [first] }], null, true, 'th')
  expect(toasts).toEqual(['Agent HQ: Alex ขึ้นเลเวล 3 แล้ว! · Alex ได้ตรา งานแรก'])
  for (const b of BADGES) expect(THAI.test(t('th', `badge.${b.id}.title`))).toBe(true)
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
const data = (lang?: 'en' | 'th'): HqData => ({ agents: mergeAgents({}, [dev], 0), todos: {}, tasks: {}, now: 1000, hideFinished: false, columns: 0, isLight: false, team, ...(lang ? { lang } : {}) })

test('the session report and its toast are in Thai; the summary prompt asks for Thai', () => {
  const report = buildReport(data('th'), 0)
  expect(report).toContain('# รายงาน Agent HQ: Web')
  expect(report).toContain('## บอร์ดงาน')
  expect(report).toContain('- สถานะ: ทำงานอยู่')
  expect(report).not.toMatch(/Task board|Status:|What is left/)
  expect(buildReport(data(), 0)).toContain('## Task board') // English unchanged
  expect(reportToast(data('th'), '/w/r.md', '/w')).toBe('Agent HQ: บันทึกรายงานที่ r.md แล้ว (เอเจนต์ 1 คน, ไม่มีงาน)')
  expect(summaryPrompt('x', 'th')).toMatch(/in Thai/)
  expect(summaryPrompt('x')).not.toMatch(/Thai/)
})

test('live page notices and feed events are in Thai', async () => {
  const deps = { lang: 'th', readData: async () => data('th'), getAgent: async () => undefined } as unknown as ActionDeps
  expect(await handlePageAction({} as never, { type: 'nope' }, deps)).toEqual({ ok: false, text: 'ไม่รู้จักคำขอนี้' })
  expect(await handlePageAction({} as never, { type: 'stop', agent: 'zz' }, deps)).toEqual({ ok: false, text: 'ไม่พบเอเจนต์นี้' })
  const before = mergeAgents({}, [dev], 0)
  const after = mergeAgents(before, [{ ...dev, status: 'completed' }], 5)
  expect(statusEvents(before, after, 'th')[0]?.text).toBe('ทำงานอยู่ → เสร็จแล้ว')
  expect(statusEvents(before, after)[0]?.text).toBe('running → completed')
  expect(stepEvents('d1', [], [{ content: 'Read', status: 'completed', activeForm: 'Reading' }], 'th')[0]?.text).toBe('เสร็จ: Read')
})

test('the snapshot says its language and its words are Thai', () => {
  expect(buildSnapshot(data(), 1).lang).toBe('en')
  const snap = buildSnapshot({ ...data('th'), team: null }, 1)
  expect(snap.lang).toBe('th')
  expect(snap.roles[0]?.title).toBe('เอเจนต์ทั่วไป')
  expect(snap.agents.find(a => a.isMain)?.now).toBe('กำลังนำทีม')
})

test('a hired reviewer is read-only whatever language its title is in', () => {
  const source = JSON.stringify({ name: 'Web', purpose: '', lead: { title: 'Lead', rules: [], skills: [] }, roles: [{ id: 'dev', title: 'Dev', count: 1, mission: 'Build.' }] })
  const byId = planHire(source, { role: 'code-reviewer', title: 'ผู้รีวิวโค้ด', mission: 'รีวิวโค้ด' })
  const byTitle = planHire(source, { role: 'checker', title: 'ผู้ตรวจโค้ด', mission: 'ตรวจโค้ด' })
  for (const plan of [byId, byTitle]) {
    if (!plan.ok) throw new Error(plan.error)
    expect(parseTeam(plan.source)).toMatchObject({ roles: [{}, { guard: { readOnly: true } }] })
  }
})

test('a member is told the chosen language only when it is Thai', () => {
  const role = team.roles[0]
  if (!role) throw new Error('no role')
  expect(rolePrompt(team, role, true, 'th')).toMatch(/Speak Thai to the person/)
  expect(rolePrompt(team, role, true, 'th')).toMatch(/code, file paths, commands, JSON keys, code comments and commit messages in English/)
  expect(rolePrompt(team, role, true)).toBe(rolePrompt(team, role, true, 'en'))
  expect(rolePrompt(team, role, true)).not.toMatch(/Thai/)
})
