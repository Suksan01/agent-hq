// Thai in Text lines: kept whole by cluster (a consonant never parts from its marks), marks taking no column. Anything
// else is drawn exactly as the cell path draws it, so English and the dotted fallback stay byte for byte as they were.
import { expect, test } from 'claude-code/testing'

import { cellText, fit, fitText, headOf, textWidth } from '../hooks/cells'

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map(g => g.segment)
/** Whether `kept` is `s` cut at a cluster boundary: the first k clusters, whole. */
const isClusterPrefix = (s: string, kept: string) => graphemes(s).some((_, k) => graphemes(s).slice(0, k + 1).join('') === kept) || kept === ''

test('Thai marks take no column; a consonant with its marks is one', () => {
  expect(textWidth('ก')).toBe(1)
  expect(textWidth('กี่')).toBe(1) // ก + ี + ่
  expect(textWidth('ทำงานอยู่')).toBe(7) // ำ (sara am) is a spacing vowel, ู and ่ are marks
  expect(textWidth('กั็')).toBe(1)
  expect(textWidth('เอเจนต์ 3 คน')).toBe(11)
})

test('fitText never cuts between a consonant and its marks, and fits the width', () => {
  const samples = ['ทำงานอยู่ 2 จาก 4', 'ซ่อนเอเจนต์ที่เสร็จแล้ว 3 คน', 'แก้ไข view.tsx', 'กี่กี่กี่กี่', 'ผู้รีวิวโค้ด']
  for (const s of samples) {
    for (let w = 0; w <= textWidth(s) + 1; w++) {
      const out = fitText(s, w)
      expect(textWidth(out)).toBeLessThanOrEqual(Math.max(w, 0))
      expect(isClusterPrefix(s, out.replace(/…$/, ''))).toBe(true)
      expect(out).not.toContain('·')
    }
  }
  expect(fitText('ทำงานอยู่', 7)).toBe('ทำงานอยู่')
  expect(fitText('ทำงานอยู่', 6)).toBe('ทำงาน…')
})

test('a leading vowel (เ แ โ ใ ไ) stays with the consonant after it: a cut never ends on one', () => {
  expect(fitText('หัวหน้าเทคนิค', 7)).toBe('หัวหน้า…')
  expect(fitText('หัวหน้าเทคนิค', 8)).toBe('หัวหน้าเท…')
  for (const s of ['เอเจนต์ใหม่', 'ไปแล้วโอเค', 'แก้ไขเสร็จแล้ว']) {
    for (let w = 0; w <= textWidth(s); w++) expect(fitText(s, w), `${s} in ${w}`).not.toMatch(/[เ-ไ]…$/)
  }
})

test('outside Thai, fitText and textWidth are fit and the cell width exactly', () => {
  const samples = ['a very long agent name', 'BOOKING APP TEAM · app', '研究 agent 🚀', 'café ü', 'x', '', '  spaced  out  ', '👨‍👩‍👧 family']
  for (const s of samples) {
    expect(textWidth(s)).toBe([...cellText(s)].length)
    for (let w = 0; w <= s.length + 2; w++) expect(fitText(s, w)).toBe(fit(s, w))
  }
})

test('Thai never reaches the cell path: there it is dotted, as every wide glyph is', () => {
  expect(cellText('ทีม')).toBe('···')
})

test('headOf cuts raw text to a length without splitting a cluster', () => {
  expect(headOf('abcdef', 3)).toBe('abc')
  expect(headOf('กี่กี่', 2)).toBe('') // the first cluster is three code units long
  expect(headOf('กี่กี่', 3)).toBe('กี่')
  expect(headOf('กี่กี่', 5)).toBe('กี่')
  expect(headOf('ab', 9)).toBe('ab')
})
