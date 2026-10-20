// What each agent has used, from what the engine reports at the end of every turn (`turn.complete`: the turn's token
// counts and how long it took). Tokens and working time only: the engine reports no price, and a made-up price table
// would be a guess, so there is no cost figure.
export const EMPTY_USAGE = { turns: 0, workMs: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
/** The agent's totals with one more turn added (the totals given are not changed). A turn that counted nothing still counts as a turn. */
export function addTurn(total, turn) {
    const before = total ?? EMPTY_USAGE;
    const usage = turn.usage;
    return {
        turns: before.turns + 1,
        workMs: before.workMs + count(turn.durationMs),
        inputTokens: before.inputTokens + count(usage?.input_tokens),
        outputTokens: before.outputTokens + count(usage?.output_tokens),
        cachedTokens: before.cachedTokens + count(usage?.cache_read_input_tokens) + count(usage?.cache_creation_input_tokens),
        ...(typeof usage?.model === 'string' && usage.model ? { model: usage.model } : before.model ? { model: before.model } : {}),
    };
}
