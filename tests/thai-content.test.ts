// Thai typed by the person or the team (a sentence, a task title, a hired role) is handled as before, whatever the UI language:
// secrets masked, the cut never parting a leading vowel, bug words found, read-only titles recognised.
import { expect, test } from 'claude-code/testing'

import { cleanSaying, SAYS_MAX } from '../hooks/says'
import { maskSecrets } from '../hooks/secrets'
import { planHire } from '../hooks/hire'
import { parseTeam } from '../hooks/team'
import { applyEvent, emptyStats } from '../hooks/xp'

test('Thai secret words mask their value, and plain Thai sentences stay', () => {
  for (const [text, secret] of [
    ['รหัสผ่าน hunter2now สำหรับฐานข้อมูล', 'hunter2now'],
    ['ใช้โทเคน: abc12345xyz ก่อน', 'abc12345xyz'],
    ['รหัส 9a8b7c6d ของ staging', '9a8b7c6d'],
  ] as const) expect(maskSecrets(text), text).not.toContain(secret)
  for (const plain of ['กำลังแก้หน้ารีเซ็ตรหัสผ่าน', 'ตรวจ token ที่หมดอายุ แล้วแก้ password reset', 'แก้รหัสผ่าน 3 ข้อที่ล้มเหลว']) expect(maskSecrets(plain), plain).toBe(plain)
})

test('a long Thai sentence is cut at a cluster, never ending on a leading vowel', () => {
  const thai = 'กำลังแก้ปัญหาของ API เก่าที่ทำให้หน้าค้นหาช้ามากและเขียนเทสต์ให้ครบทุกกรณีที่ผู้ใช้เจอบ่อยที่สุดในสัปดาห์นี้'
  const cut = cleanSaying(thai)
  expect(cut.length).toBeLessThanOrEqual(SAYS_MAX)
  expect(cut.endsWith('…')).toBe(true)
  expect(/[เ-ไ]…$/.test(cut)).toBe(false)
})

test('bug_squasher is earned by a Thai task about a fix or a bug', () => {
  const NOW = 1_000_000
  const stats = { ...emptyStats(), badges: ['first_task' as const] }
  for (const subject of ['แก้บั๊กหน้าค้นหา', 'แก้หน้าแรก', 'บั๊กในตะกร้า']) {
    expect(applyEvent(stats, { type: 'task_done', subject }, NOW).badges.map(b => b.id), subject).toEqual(['bug_squasher'])
  }
  expect(applyEvent(stats, { type: 'task_done', subject: 'เพิ่มหน้าค้นหา' }, NOW).badges).toEqual([])
})

test('a hired reviewer with a Thai title is read-only', () => {
  const source = JSON.stringify({ name: 'Web', purpose: '', lead: { title: 'Lead', rules: [], skills: [] }, roles: [{ id: 'dev', title: 'Dev', count: 1, mission: 'Build.' }] })
  for (const [role, title, mission] of [['code-reviewer', 'ผู้รีวิวโค้ด', 'รีวิวโค้ด'], ['checker', 'ผู้ตรวจโค้ด', 'ตรวจโค้ด']] as const) {
    const plan = planHire(source, { role, title, mission })
    if (!plan.ok) throw new Error(plan.error)
    expect(parseTeam(plan.source)).toMatchObject({ roles: [{}, { guard: { readOnly: true } }] })
  }
})
