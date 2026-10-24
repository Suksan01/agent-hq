// List prices and the cost estimate of the task table (docs/specs/task-sidebar.md "price table", AC10). An estimate from
// list prices, not anybody's bill.

/** USD per million tokens, for a model id that is `prefix`, with an 8-digit date (`-20991231`) and/or a `[1m]` style suffix. */
export type Price = { prefix: string; input: number; output: number; cacheRead: number; cacheWrite: number }

/**
 * The day the prices were taken: the claude-api skill's model table (cached 2026-10-06). Input and output are its
 * figures; cache read is the figure it states per model (Fable 5.1 and Mythos 5.1 0.25, Fable 5 1.00, Opus 5.5 0.20,
 * Sonnet 5.5 0.20) and 0.1x input where it gives only the multiplier; cache write is 1.25x input (5-minute duration).
 */
export const PRICES_AS_OF = '2026-10-06'

const price = (prefix: string, input: number, output: number, cacheRead: number): Price => ({ prefix, input, output, cacheRead, cacheWrite: input * 1.25 })

// shortcut: Haiku 5.5's prices are for prompts up to 100K tokens (0.50 / 2.50 above that), the cost counts every prompt at the lower tier; split by prompt size if that matters.
export const PRICES: readonly Price[] = [
  price('claude-fable-5-1', 10, 50, 0.25),
  price('claude-mythos-5-1', 10, 50, 0.25),
  price('claude-fable-5', 10, 50, 1),
  price('claude-mythos-5', 10, 50, 1),
  price('claude-opus-5-5', 4, 20, 0.2),
  price('claude-opus-5', 5, 25, 0.5),
  price('claude-opus-4-8', 5, 25, 0.5),
  price('claude-opus-4-7', 5, 25, 0.5),
  price('claude-opus-4-6', 5, 25, 0.5),
  price('claude-sonnet-5-5', 2, 10, 0.2),
  price('claude-sonnet-5', 2, 10, 0.2),
  price('claude-sonnet-4-6', 3, 15, 0.3),
  price('claude-haiku-5-5', 0.1, 0.5, 0.01),
  price('claude-haiku-4-5', 1, 5, 0.1),
]

const MILLION = 1_000_000

export type Work = { model?: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }

// the boundary keeps `claude-opus-5-6` from being priced as `claude-opus-5`; it also makes the match unique, so no sorting
const SUFFIX = /^(-\d{8})?(\[.*\])?$/
const priceOf = (model: string) => PRICES.find(p => model.startsWith(p.prefix) && SUFFIX.test(model.slice(p.prefix.length)))

/** Dollars for the work at list prices; null when the model is missing or not in the table (not zero: it is unknown). */
export function costOf(work: Work): number | null {
  const p = work.model ? priceOf(work.model) : undefined
  if (!p) return null
  // shortcut: all cache writes at the 5-minute rate (1-hour writes cost 2x input), upgrade if the engine reports writes by TTL
  const cost = (work.inputTokens * p.input + work.outputTokens * p.output + work.cacheReadTokens * p.cacheRead + work.cacheWriteTokens * p.cacheWrite) / MILLION
  return Number.isFinite(cost) ? cost : null
}
