// Nickname themes and the plugin's options: the pools are data the names module draws from, the options say which.
import { expect, test } from 'claude-code/testing'

import { LEAD_NICKNAMES, NICKNAMES } from '../hooks/names'
import { DEFAULT_THEME, THEMES, THEME_IDS, soundsOn, themeOf } from '../hooks/themes'

test('the seven themes, people first and the default', () => {
  expect(THEME_IDS).toEqual(['people', 'planets', 'japanese-snacks', 'pirates', 'space-crew', 'forest-friends', 'robots'])
  expect(DEFAULT_THEME).toBe('people')
  expect(Object.keys(THEMES)).toEqual([...THEME_IDS])
})

test('every theme has 80 or more member names and 12 or more lead names, short, plain and distinct', () => {
  for (const id of THEME_IDS) {
    const { members, leads } = THEMES[id]
    expect(members.length).toBeGreaterThanOrEqual(80)
    expect(leads.length).toBeGreaterThanOrEqual(12)
    for (const pool of [members, leads]) {
      expect(new Set(pool).size).toBe(pool.length)
      for (const name of pool) expect(name).toMatch(/^[A-Za-z][A-Za-z0-9 -]{1,15}$/)
    }
    expect(members.filter(n => leads.includes(n))).toEqual([])
  }
})

test('no two themes share a name, so a nickname says which theme it came from', () => {
  const all = THEME_IDS.flatMap(id => [...THEMES[id].members, ...THEMES[id].leads])
  expect(new Set(all).size).toBe(all.length)
})

test('the default theme, people, is the pool the names module draws from', () => {
  expect(THEMES.people.members).toEqual(NICKNAMES)
  expect(THEMES.people.leads).toEqual(LEAD_NICKNAMES)
  expect(NICKNAMES).toContain('Alex')
  expect(LEAD_NICKNAMES).toContain('Margaret')
  for (const name of [...NICKNAMES, ...LEAD_NICKNAMES]) expect(name.length).toBeLessThanOrEqual(14)
})

test('a theme is chosen by its id; anything else falls back to the default', () => {
  expect(themeOf('pirates').id).toBe('pirates')
  expect(themeOf('robots').members).toBe(THEMES.robots.members)
  for (const bad of [undefined, null, '', 'Pirates', 'cowboys', 3, ['pirates'], {}]) expect(themeOf(bad).id).toBe(DEFAULT_THEME)
})

test('sounds are on unless the option is off', () => {
  expect(soundsOn(undefined)).toBe(true)
  expect(soundsOn(true)).toBe(true)
  expect(soundsOn('on')).toBe(true)
  expect(soundsOn(false)).toBe(false)
  expect(soundsOn('off')).toBe(false)
  expect(soundsOn('false')).toBe(false)
})
