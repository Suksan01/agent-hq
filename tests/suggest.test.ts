// Next-task suggestions: what the fork is asked, and what of its reply reaches the page. Pure: hooks/suggest.ts.
import { expect, test } from 'claude-code/testing'

import { NEXT_COUNT, NEXT_MAX, RECAP_MAX, parseSuggestions, suggestPrompt } from '../hooks/suggest'

test('the prompt asks for JSON with a recap and up to three tasks, in the person\'s language', () => {
  const en = suggestPrompt('en')
  expect(en).toContain('"recap"')
  expect(en).toContain('"next"')
  expect(en).toContain(`up to ${NEXT_COUNT}`)
  expect(en).toContain(`${NEXT_MAX} characters`)
  expect(en).toContain('Write the recap and the tasks in English')
  expect(suggestPrompt('th')).toContain('Write the recap and the tasks in Thai')
})

test('a JSON reply gives the recap and the tasks, even with prose or a fence around it', () => {
  const reply = 'Sure:\n```json\n{"recap": "Tests pass. The API is done.", "next": ["Commit the API work", "Write the README section"]}\n```'
  expect(parseSuggestions(reply)).toEqual({ recap: 'Tests pass. The API is done.', items: ['Commit the API work', 'Write the README section'] })
})

test('no JSON, a broken one, the wrong shape or nothing in it: no suggestion', () => {
  expect(parseSuggestions('I would commit next.')).toBeNull()
  expect(parseSuggestions('{"recap": "x", "next": [')).toBeNull()
  expect(parseSuggestions('[1, 2]')).toBeNull()
  expect(parseSuggestions('{"recap": 4, "next": "commit"}')).toBeNull()
  expect(parseSuggestions('{"recap": "  ", "next": ["", "   ", 7]}')).toBeNull()
})

test('a recap alone, or tasks alone, still counts', () => {
  expect(parseSuggestions('{"recap": "All done.", "next": []}')).toEqual({ recap: 'All done.', items: [] })
  expect(parseSuggestions('{"next": ["Run the tests"]}')).toEqual({ recap: null, items: ['Run the tests'] })
})

test('secrets are masked, control and bidi characters stripped, each one line', () => {
  const parsed = parseSuggestions(
    JSON.stringify({
      recap: 'Pushed with ghp_abcdefghijklmnopqrstuvwxyz0123456789\nand done.',
      next: ['Rotate API_KEY=supersecretvalue now', 'Fix \u001b[31mred\u001b[0m\tthe\u202e build\u0007', 'Run\r\nthe tests'],
    }),
  )
  expect(parsed?.recap).toBe('Pushed with *** and done.')
  expect(parsed?.items).toEqual(['Rotate API_KEY=*** now', 'Fix red the build', 'Run the tests'])
})

test('at most three tasks, duplicates and empties dropped, each cut to its cap between clusters', () => {
  const long = 'แก้'.repeat(100)
  const parsed = parseSuggestions(JSON.stringify({ recap: 'x'.repeat(500), next: ['Commit', '', 'commit', 'Commit ', long, 'Push', 'Fourth'] }))
  expect(parsed?.items.length).toBe(NEXT_COUNT)
  expect(parsed?.items[0]).toBe('Commit')
  expect(parsed?.items[1]?.endsWith('…')).toBe(true)
  expect(parsed?.items[1]?.length).toBeLessThanOrEqual(NEXT_MAX)
  expect(parsed?.items[1]?.startsWith('แก้แก้')).toBe(true)
  expect(parsed?.items[2]).toBe('Push')
  expect(parsed?.recap?.length).toBeLessThanOrEqual(RECAP_MAX)
})
