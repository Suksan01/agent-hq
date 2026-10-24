// Spec for hooks/prices.ts: the price table and the cost estimate (docs/specs/task-sidebar.md "price table", AC10).
// The contract these tests pin down (the plan names `costOf`; the table's names are what the tests read):
//  - PRICES: a non-empty list of { prefix, input, output, cacheRead, cacheWrite } in USD per million tokens, and
//    PRICES_AS_OF: the date the prices were taken, as YYYY-MM-DD;
//  - a model id is priced by the longest prefix it starts with;
//  - costOf(work) -> dollars, tokens x price per kind summed, correct to the cent; null for an unknown model.
// The tests read the table's own numbers, so a price update never breaks them.
import { expect, test } from 'claude-code/testing'

import { PRICES, PRICES_AS_OF, costOf } from '../hooks/prices'

const MILLION = 1_000_000
const none = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const KINDS = [
  ['input', 'inputTokens'],
  ['output', 'outputTokens'],
  ['cache read', 'cacheReadTokens'],
  ['cache write', 'cacheWriteTokens'],
] as const
const priceKey = { inputTokens: 'input', outputTokens: 'output', cacheReadTokens: 'cacheRead', cacheWriteTokens: 'cacheWrite' } as const

/** Dollars to the cent: within half a cent. */
const toTheCent = (got: number | null, want: number) => got !== null && Math.abs(got - want) < 0.005

/** The entry the table means for a model id: the longest prefix it starts with. */
const entryFor = (model: string) => [...PRICES].filter(p => model.startsWith(p.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]

test('the table lists models with whole, positive prices and the date they were taken', () => {
  expect(PRICES.length).toBeGreaterThan(0)
  expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  for (const p of PRICES) {
    expect(p.prefix, 'prefix').toMatch(/\S/)
    for (const kind of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      expect(Number.isFinite(p[kind]) && p[kind] > 0, `${p.prefix} ${kind}`).toBe(true)
    }
  }
})

test('a million tokens of one kind cost exactly the table\'s price for that kind, for every listed model (AC10)', () => {
  for (const p of PRICES) {
    for (const [label, field] of KINDS) {
      const cost = costOf({ model: p.prefix, ...none, [field]: MILLION })

      expect(toTheCent(cost, p[priceKey[field]]), `${p.prefix} ${label}: got ${cost}, table says ${p[priceKey[field]]}`).toBe(true)
    }
  }
})

test('the four kinds are added up, each at its own price (AC10)', () => {
  for (const p of PRICES) {
    const tokens = { inputTokens: 123_456, outputTokens: 78_900, cacheReadTokens: 2_345_678, cacheWriteTokens: 91_011 }
    const expected = (tokens.inputTokens * p.input + tokens.outputTokens * p.output + tokens.cacheReadTokens * p.cacheRead + tokens.cacheWriteTokens * p.cacheWrite) / MILLION

    const cost = costOf({ model: p.prefix, ...tokens })

    expect(toTheCent(cost, expected), `${p.prefix}: got ${cost}, want ${expected}`).toBe(true)
  }
})

test('a model id longer than a listed prefix (a dated or suffixed id) is priced as that prefix', () => {
  for (const p of PRICES) {
    const model = `${p.prefix}-20991231[1m]`
    const expected = entryFor(model)!

    const cost = costOf({ model, ...none, outputTokens: MILLION })

    expect(toTheCent(cost, expected.output), `${model}: got ${cost}, want ${expected.output}`).toBe(true)
  }
})

test('no tokens cost nothing, for a known model', () => {
  expect(costOf({ model: PRICES[0]!.prefix, ...none })).toBe(0)
})

test('an unknown model has no cost, not zero (AC10)', () => {
  for (const model of ['gpt-9', 'mystery-model', `not-${PRICES[0]!.prefix}`, '']) {
    expect(costOf({ model, ...none, inputTokens: MILLION, outputTokens: MILLION }), JSON.stringify(model)).toBeNull()
  }
})

test('work with no model has no cost', () => {
  expect(costOf({ ...none, inputTokens: 5 })).toBeNull()
  expect(costOf({ model: undefined, ...none, inputTokens: 5 })).toBeNull()
})

test('known models cost their listed prices, written out (AC10)', () => {
  expect(toTheCent(costOf({ model: 'claude-opus-5-5-20991231', ...none, outputTokens: MILLION }), 20)).toBe(true)
  expect(toTheCent(costOf({ model: 'claude-fable-5-1', ...none, cacheReadTokens: MILLION }), 0.25)).toBe(true)
  expect(toTheCent(costOf({ model: 'claude-fable-5', ...none, cacheReadTokens: MILLION }), 1)).toBe(true)
})

test('an id that only starts like a listed one is unknown, not priced as it', () => {
  for (const model of ['claude-opus-5-6', 'claude-fable-50', 'claude-opus-5-5x']) expect(costOf({ model, ...none, outputTokens: MILLION }), model).toBeNull()
})

test('a token count that is not a number gives no cost', () => {
  expect(costOf({ model: 'claude-opus-5-5', ...none, inputTokens: NaN })).toBeNull()
})
