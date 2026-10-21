import assert from 'node:assert/strict'
import { test } from 'node:test'

import { STRINGS, langOf, setLang, t } from './i18n.js'

const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
const THAI = /[฀-๿]/

test('en and th have the same keys, and each Thai string the same placeholders as its English one', () => {
  assert.deepEqual(Object.keys(STRINGS.th).sort(), Object.keys(STRINGS.en).sort())
  for (const key of Object.keys(STRINGS.en)) assert.deepEqual(holes(STRINGS.th[key]), holes(STRINGS.en[key]), key)
  assert.ok(Object.keys(STRINGS.en).length >= 100, `about 120 strings (${Object.keys(STRINGS.en).length})`)
})

test('every Thai string is in Thai script and none is the English left in place', () => {
  for (const [key, th] of Object.entries(STRINGS.th)) {
    assert.match(th, THAI, `${key} has Thai script: ${th}`)
    assert.notEqual(th, STRINGS.en[key], `${key} is translated`)
    assert.doesNotMatch(th, /ครับ|ค่ะ|ผม|ฉัน/, `${key}: no particles or first-person pronouns (glossary)`)
    assert.doesNotMatch(th, /ตัว/, `${key}: agents are counted with คน (glossary)`)
  }
})

test('the glossary words the person approved are the ones used', () => {
  const th = STRINGS.th
  assert.equal(th['lead.message'], 'คุยกับหัวหน้า')
  assert.equal(th['status.working'], 'ทำงานอยู่')
  assert.equal(th['live.on'], 'ออนไลน์')
  assert.equal(th['live.hideDone'], 'ซ่อนที่เสร็จ')
  assert.equal(th['feed.title'], 'กิจกรรม')
  assert.equal(th['talk.lead'], 'หัวหน้า')
  assert.equal(th['status.lead'], 'หัวหน้าทีม')
  assert.equal(th['unit.s'], '{n} วิ')
})

test('t fills placeholders in the language set; an unknown language or key falls back to English, then the key', () => {
  try {
    setLang('th')
    assert.equal(t('drawer.messageTo', { name: 'Sam' }), 'ส่งข้อความถึง Sam…')
    assert.equal(t('post.stopped', { where: '' }), 'เซสชันนั้นหยุดไปแล้ว')
    setLang('fr')
    assert.equal(t('drawer.messageTo', { name: 'Sam' }), 'Message Sam…')
    assert.equal(t('no.such.key'), 'no.such.key')
  } finally {
    setLang('en')
  }
})

test("the page follows the first live session's language; none, an unknown one or no sessions is English", () => {
  const s = (lang, alive = true) => ({ alive, snapshot: lang === undefined ? {} : { lang } })
  assert.equal(langOf([s('th'), s('en')]), 'th')
  assert.equal(langOf([s('en'), s('th')]), 'en')
  assert.equal(langOf([s('th', false), s('en')]), 'en', 'a stopped session does not decide')
  assert.equal(langOf([s(undefined)]), 'en')
  assert.equal(langOf([s('de')]), 'en')
  assert.equal(langOf([]), undefined, 'nothing to follow: the caller keeps what it had')
})
