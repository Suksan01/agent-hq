// Per-agent tokens and working time from turn.complete.
import { expect, test } from 'claude-code/testing'

import { EMPTY_USAGE, addTurn } from '../hooks/usage'

test('a turn adds its tokens, its time and one turn, without changing the totals it was given', () => {
  const first = addTurn(undefined, { durationMs: 1500, usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, model: 'claude-sonnet-5-5' } })
  const second = addTurn(first, { durationMs: 500, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' } })

  expect(first).toEqual({ turns: 1, workMs: 1500, inputTokens: 100, outputTokens: 40, cachedTokens: 950, model: 'claude-sonnet-5-5' })
  expect(second).toEqual({ turns: 2, workMs: 2000, inputTokens: 110, outputTokens: 45, cachedTokens: 950, model: 'claude-haiku-5-5' })
  expect(EMPTY_USAGE).toEqual({ turns: 0, workMs: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 })
})

test('a turn that counted nothing (an interrupt, an API error) is still a turn, and keeps the last model', () => {
  const before = addTurn(undefined, { durationMs: 100, usage: { input_tokens: 1, output_tokens: 1, model: 'm1' } })

  expect(addTurn(before, {})).toEqual({ ...before, turns: 2 })
})

test('anything that is not a positive number counts as zero', () => {
  const total = addTurn(undefined, { durationMs: -5, usage: { input_tokens: '12', output_tokens: Number.NaN, cache_read_input_tokens: Infinity, cache_creation_input_tokens: null, model: 7 } })

  expect(total).toEqual({ turns: 1, workMs: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 })
})
