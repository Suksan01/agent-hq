// Text lines are cut between code points exactly as the cell path draws them.
import { expect, test } from 'claude-code/testing'

import { cellText, fit, fitText, headOf, textWidth } from '../hooks/cells'

test('fitText and textWidth are fit and the cell width exactly', () => {
  const samples = ['a very long agent name', 'BOOKING APP TEAM · app', '研究 agent 🚀', 'café ü', 'x', '', '  spaced  out  ', '👨‍👩‍👧 family']
  for (const s of samples) {
    expect(textWidth(s)).toBe([...cellText(s)].length)
    for (let w = 0; w <= s.length + 2; w++) expect(fitText(s, w)).toBe(fit(s, w))
  }
})

test('headOf cuts raw text to a length without splitting a cluster', () => {
  expect(headOf('abcdef', 3)).toBe('abc')
  expect(headOf('éé', 2)).toBe('é') // e + combining acute is one cluster of two code units
  expect(headOf('éé', 1)).toBe('')
  expect(headOf('ab', 9)).toBe('ab')
})
