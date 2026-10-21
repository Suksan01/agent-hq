// Talk bubbles, the pure part (hooks/talk.ts): the bubble's words, where it sits, one per card, four per team, six
// seconds, and the snapshot's `bubbles`.
import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { BUBBLES_MAX, BUBBLE_MAX, BUBBLE_MS, addBubble, bubbleText, liveBubbles, placeTalk, recipientOf, talkLine } from '../hooks/talk'
import { textWidth } from '../hooks/cells'
import { MAIN, mergeAgents } from '../hooks/model'
import { buildSnapshot } from '../hooks/live'
import type { HqData } from '../hooks/view'
import type { HqBubble } from '../types'

const LISTED: AgentInfo[] = [
  { id: 'd1', name: 'dev-1', type: 'agent-hq:dev', description: 'x', status: 'running' },
  { id: 'r1', name: 'reviewer-1', type: 'agent-hq:reviewer', description: 'x', status: 'running' },
]
const AGENTS = mergeAgents({}, LISTED, 0)
const bubble = (agent: string, at: number, text = 'hi'): HqBubble => ({ agent, other: MAIN, dir: 'from', text, at })

test('a bubble says the first sentence of the first line that says something', () => {
  expect(bubbleText('Fix the old API. Then write the tests.')).toBe('Fix the old API.')
  expect(bubbleText('Can you check the API tests? Thanks')).toBe('Can you check the API tests?')
  expect(bubbleText('## Report\n\n**Done**, 3 tests added. Details below')).toBe('Done, 3 tests added.')
  expect(bubbleText('- read api.ts and fix it\n- then tests')).toBe('read api.ts and fix it') // a dot inside a word ends nothing
  expect(bubbleText('แก้ปัญหาของ API เก่า\nรายละเอียด')).toBe('แก้ปัญหาของ API เก่า')
  expect(bubbleText('   \n\n')).toBe('')
  expect(bubbleText(undefined)).toBe('')
  expect(bubbleText({ type: 'shutdown_request' })).toBe('')
})

test('a bubble masks secrets', () => {
  expect(bubbleText('Log in with token=abc123secret now.')).toBe('Log in with token=*** now.')
  expect(bubbleText('Use sk-ant-api03-abcdefghijklmnop for the API')).toBe('Use *** for the API')
  expect(bubbleText('Clone https://bob:hunter2@example.com/repo.git first')).toBe('Clone https://***@example.com/repo.git first')
  expect(bubbleText('Log in with --password hunter2now first')).toBe('Log in with --password *** first')
  expect(bubbleText('curl -u admin:s3cretpass the health URL')).toBe('curl -u admin:*** the health URL')
})

test('a bubble is at most 80 columns, cut between clusters with an ellipsis', () => {
  const long = 'Rewrite the whole search page so that results load in pages and the filters keep their state across reloads'
  const cut = bubbleText(long)
  expect(cut.endsWith('…')).toBe(true)
  expect(textWidth(cut)).toBeLessThanOrEqual(BUBBLE_MAX)
  expect(long.startsWith(cut.slice(0, -1))).toBe(true)

  const thai = 'ช่วยเช็กเทสต์ของ API หน้าค้นหาทั้งหมดที่เขียนไว้เมื่อวานแล้วแก้ที่พังให้ผ่านทุกข้อก่อนส่งงานให้หัวหน้าตรวจอีกรอบ'
  const thaiCut = bubbleText(thai)
  expect(thaiCut.endsWith('…')).toBe(true)
  expect(textWidth(thaiCut)).toBeLessThanOrEqual(BUBBLE_MAX)
  const kept = thaiCut.slice(0, -1)
  expect(thai.startsWith(kept)).toBe(true)
  // the cut never parts a consonant from its marks, nor a leading vowel from its consonant
  expect(/^[ัิ-ฺ็-๎]/.test(thai.slice(kept.length))).toBe(false)
  expect(/[เ-ไ]$/.test(kept)).toBe(false)
})

test('a bubble sits on the party that is not the lead: from the lead, to the lead, and from the sender between members', () => {
  expect(placeTalk(MAIN, 'd1')).toEqual({ agent: 'd1', other: MAIN, dir: 'from' })
  expect(placeTalk('d1', MAIN)).toEqual({ agent: 'd1', other: MAIN, dir: 'to' })
  expect(placeTalk('d1', 'r1')).toEqual({ agent: 'd1', other: 'r1', dir: 'to' })
  expect(placeTalk(MAIN, MAIN)).toBeNull()
  expect(placeTalk('d1', 'd1')).toBeNull()
})

test('a recipient is found by the name or id SendMessage gives, "main" being the lead', () => {
  expect(recipientOf('main', AGENTS)).toBe(MAIN)
  expect(recipientOf('team-lead', AGENTS)).toBe(MAIN) // what teammates call the lead
  expect(recipientOf('user', AGENTS)).toBeNull() // the person: their talk is not the team's
  expect(recipientOf('team-lead@web', AGENTS)).toBe(MAIN) // a teammate address, <name>@<team>
  expect(recipientOf('reviewer-1@web', AGENTS)).toBe('r1')
  expect(recipientOf('reviewer-1', AGENTS)).toBe('r1')
  expect(recipientOf('r1', AGENTS)).toBe('r1')
  expect(recipientOf('reviewer-1 [a7]', AGENTS)).toBe('r1')
  expect(recipientOf('someone-else', AGENTS)).toBeNull()
})

test('one bubble per card, the newest replacing; at most four per team, the oldest dropping', () => {
  const first = [bubble('a', 1, 'one')]
  const replaced = addBubble(first, bubble('a', 2, 'two'))
  expect(replaced).toEqual([bubble('a', 2, 'two')])
  expect(first).toEqual([bubble('a', 1, 'one')]) // the list it was given is left as it was

  const full = ['a', 'b', 'c', 'd'].reduce<HqBubble[]>((all, id, i) => addBubble(all, bubble(id, i + 1)), [])
  expect(full.length).toBe(BUBBLES_MAX)
  const next = addBubble(full, bubble('e', 10))
  expect(next.map(b => b.agent)).toEqual(['b', 'c', 'd', 'e'])
})

test('a bubble lasts six seconds; the same list comes back when none ended', () => {
  const all = [bubble('a', 1000), bubble('b', 4000)]
  expect(liveBubbles(all, 1000 + BUBBLE_MS - 1)).toBe(all)
  expect(liveBubbles(all, 1000 + BUBBLE_MS)).toEqual([bubble('b', 4000)])
  expect(liveBubbles(all, 4000 + BUBBLE_MS)).toEqual([])
})

test('a bubble reads with its direction and the other party by nickname, the lead by its word', () => {
  const lead = { agent: 'd1', other: MAIN, dir: 'from' as const, text: 'fix the old API', at: 0 }
  expect(talkLine(lead, AGENTS, 'en')).toBe('← Lead: fix the old API')
  expect(talkLine(lead, AGENTS, 'th')).toBe('← หัวหน้า: fix the old API')
  const peer = { agent: 'd1', other: 'r1', dir: 'to' as const, text: 'can you check?', at: 0 }
  expect(talkLine(peer, AGENTS, 'en')).toBe(`→ ${AGENTS.r1?.nickname}: can you check?`)
  expect(talkLine({ ...peer, other: 'gone' }, AGENTS, 'en')).toBe('→ gone: can you check?')
})

test('the snapshot carries the bubbles as the contract has them', () => {
  const bubbles: HqBubble[] = [{ agent: 'd1', other: MAIN, dir: 'from', text: 'fix the old API', at: 5 }]
  const data: HqData = { agents: AGENTS, todos: {}, tasks: {}, now: 10, hideFinished: false, columns: 0, isLight: false, team: null, bubbles }
  const snap = buildSnapshot(data, 10)
  expect(snap.bubbles).toEqual([{ agent: 'd1', other: 'main', dir: 'from', text: 'fix the old API', at: 5 }])
  expect(buildSnapshot({ ...data, bubbles: undefined }, 10).bubbles).toEqual([])
})
