import assert from 'node:assert/strict'
import { test } from 'node:test'

import { STRINGS, has, t } from './i18n.js'

test('the page has about a hundred and twenty English strings, each in plain text', () => {
  assert.deepEqual(Object.keys(STRINGS), ['en'])
  assert.ok(Object.keys(STRINGS.en).length >= 100, `about 120 strings (${Object.keys(STRINGS.en).length})`)
  for (const [key, text] of Object.entries(STRINGS.en)) assert.equal(typeof text, 'string', key)
})

test('t fills placeholders; an unknown key is shown as itself', () => {
  assert.equal(t('drawer.messageTo', { name: 'Sam' }), 'Message Sam…')
  assert.equal(t('no.such.key'), 'no.such.key')
  assert.equal(has('drawer.messageTo'), true)
  assert.equal(has('no.such.key'), false)
})
