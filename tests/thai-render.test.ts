// The sidebar and the band with the language set to Thai: every word Thai and shown whole (never dotted), no English left
// from the tables, and no Thai in a Raster cell (a mark has no column of its own, so the engine would refuse the tree).
import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, RenderElement } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { TABLES } from '../hooks/i18n'
import type { Key } from '../hooks/i18n'
import { TEAM_FILE } from '../hooks/team'

const RAW_TEAM = {
  name: 'ทีมเว็บ',
  purpose: 'ทำเว็บจองห้อง',
  lead: { title: 'หัวหน้าเทคนิค', rules: [], skills: [] },
  roles: [{ id: 'senior-dev', title: 'นักพัฒนาอาวุโส', count: 4, mission: 'สร้างฟีเจอร์', tasks: [], rules: [], skills: [] }],
}
const member = (id: string, status: AgentInfo['status']): AgentInfo => ({ id, name: `senior-dev-${id}`, type: 'agent-hq:senior-dev', description: 'x', status })
const LISTED = [member('1', 'running'), member('2', 'running'), member('3', 'idle'), member('4', 'completed')]
const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} }
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const THAI = /[฀-๿]/

/** A Thai session with the team loaded: agent 1 has Thai todos, agent 2 none (its bar stands in), a Thai task on the board. */
async function session($: Engine, on: On) {
  mock.clock(on)
  mock.store(on, { approvedTeams: withApproval([], `/work/app/${TEAM_FILE}`, JSON.stringify(RAW_TEAM)), languageAsked: true })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('fs.exists', (_, e) => ({ value: e.path === `/work/app/${TEAM_FILE}` }))
  on('fs.read', () => ({ value: JSON.stringify(RAW_TEAM) }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }))
  on('agent.list', () => ({ value: LISTED }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: '1' }))
  on('command.register', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '7', subject: 'x' } } } : { result: {} as never }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }) as RenderElement)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true } as never)
  await $.agent.spawn({ prompt: 'go', subagentType: 'agent-hq:senior-dev' } as never)
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  await call({ tool: 'TaskCreate', subject: 'ทำหน้าค้นหา', description: 'x' })
  await call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', owner: 'senior-dev-9', activeForm: 'กำลังทำหน้าค้นหา' })
  await call({
    tool: 'TodoWrite',
    agentId: '1',
    todos: [
      { content: 'อ่านโค้ดเดิม', status: 'completed', activeForm: 'อ่านโค้ดเดิม' },
      { content: 'แก้ API เก่า', status: 'in_progress', activeForm: 'กำลังแก้ API เก่า' },
      { content: 'เขียนเทสต์', status: 'pending', activeForm: 'เขียนเทสต์' },
    ],
  })
}

/** Every word shown: each Text's and Button's text, one per line. */
async function shown(ui: { findAll: (q: { type: string }) => Promise<{ text?: string }[]> }) {
  return [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(el => el.text ?? '').join('\n')
}

/** The characters of every Raster's cells ([char, fg, bg] as uint32s, base64). */
async function rasterChars(ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) {
  const chars: number[] = []
  for (const r of await ui.findAll({ type: 'Raster' })) {
    const bytes = Uint8Array.from(atob(String(r.props.cells)), c => c.charCodeAt(0))
    const words = new Uint32Array(bytes.buffer)
    for (let i = 0; i < words.length; i += 3) chars.push(words[i] ?? 0)
  }
  return chars
}

// the English words of the tables that draw the sidebar and band: none may be left on a Thai screen
const DRAWN = /^(sidebar|row|now|tree|tasks|status|band|track|team)\./
const englishLeft = (text: string) =>
  (Object.keys(TABLES.en) as Key[])
    .filter(key => DRAWN.test(key))
    .flatMap(key => TABLES.en[key].split(/\{\w+\}/).map(part => part.trim()))
    .filter(part => part.length >= 4 && /[A-Za-z]/.test(part) && text.includes(part))

test('the Thai sidebar shows Thai whole, keeps no English from the tables and no Thai in its cells', { options: { language: 'thai' } }, async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  const text = await shown(ui as never)

  for (const word of ['บอร์ดงาน', 'ซ่อนที่เสร็จ', 'ล้างที่เสร็จ', 'ถัดไป: เขียนเทสต์', 'ทีมเว็บ', 'เริ่มต้น', 'กำลังแก้ API เก่า']) expect(text, word).toContain(word)
  expect(text).not.toMatch(/··/) // a Thai word sent through the cell path would be a run of dots
  expect(englishLeft(text)).toEqual([])
  expect((await rasterChars(ui as never)).filter(c => c >= 0x0e00 && c <= 0x0e7f)).toEqual([])
  expect(await ui.find({ type: 'Raster', key: 'todo-2' })).toBeDefined() // the stand-in bar is still drawn, its word beside it
  await ui.unmount()
})

test('the Thai band keeps its words beside the tracks, never in them', { options: { language: 'thai' } }, async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS as never, viewport: { columns: 100, rows: 40, isFullscreen: true } as never })
  const text = await shown(ui as never)

  for (const word of ['ทีม', 'งาน', 'ทำงานอยู่ 2', 'กำลังทำหน้าค้นหา', 'เอเจนต์ ›']) expect(text, word).toContain(word)
  expect(text).not.toMatch(/··/)
  expect(englishLeft(text)).toEqual([])
  expect((await rasterChars(ui as never)).filter(c => c >= 0x0e00 && c <= 0x0e7f)).toEqual([])
  await ui.unmount()
})

test('where the app draws, the Thai words sit beside the Svg tracks too', { options: { language: 'thai' } }, async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'desktop', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  const text = await shown(ui as never)
  expect(text).toContain('เริ่มต้น')
  expect(englishLeft(text)).toEqual([])
  expect(THAI.test(text)).toBe(true)
  await ui.unmount()
})

test('the English sidebar is unchanged: no words beside its tracks', async ($, on) => {
  await session($, on)
  const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS as never })
  expect(await ui.find({ text: /TASK BOARD/ })).toBeDefined()
  expect(await ui.find({ text: /^getting started/ })).toBeUndefined() // in the track's pill, not in a Text
  await ui.unmount()
})
