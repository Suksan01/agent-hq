// What waits on the person: tool calls the engine put to them (a permission ask), agents held on an approval and idle
// teammates. Pure helpers; register.tsx owns the state. The live page shows the list, the status line counts it.
import { baseName, commandWords, hostOf } from './activity';
import { MAIN, isFinished } from './model';
const WHAT_MAX = 120;
const ASKS_MAX = 50;
const clip = (text) => (text.length > WHAT_MAX ? `${text.slice(0, WHAT_MAX - 1)}…` : text);
/** A tool call in a few words: `Bash: npm test`, `Edit: page.tsx`, `WebFetch: example.com`, or just the tool. Never a command's arguments, a full path or a URL's path and query. */
export function describeAsk(tool, input) {
    const fields = typeof input === 'object' && input !== null ? input : {};
    const detail = commandWords(fields.command) || baseName(fields.file_path) || baseName(fields.notebook_path) || hostOf(fields.url);
    return clip(detail ? `${tool}: ${detail}` : tool);
}
/** The asks with this one added; at most 50 are kept, the oldest go first. */
export function addAsk(asks, toolUseId, ask) {
    return Object.fromEntries(Object.entries({ ...asks, [toolUseId]: ask }).slice(-ASKS_MAX));
}
export const removeAsk = (asks, toolUseId) => Object.fromEntries(Object.entries(asks).filter(([id]) => id !== toolUseId));
/** The asks of agents that are still running (an agent that ended can no longer be waiting for a dialog). */
export const liveAsks = (asks, agents) => Object.fromEntries(Object.entries(asks).filter(([, ask]) => ask.agent === MAIN || (agents[ask.agent] !== undefined && !isFinished(agents[ask.agent]?.status ?? 'completed'))));
/**
 * Why an agent waits on the person, by its status: `waiting` is held on a plan's approval, background work or an Agent
 * call (the sidebar calls it "needs approval"); `idle` is a teammate done with its turn, waiting for a message.
 */
const HELD = {
    waiting: 'held, waiting on an approval or a background task',
    idle: 'idle, waiting for a message',
};
/** The agents newly waiting on the person (see HELD) get a start time, the ones no longer waiting lose theirs. */
export function trackWaiting(since, agents, now) {
    return Object.fromEntries(Object.values(agents)
        .filter(a => a.id !== MAIN && HELD[a.status] !== undefined)
        .map(a => [a.id, since[a.id] ?? now]));
}
/** Everything waiting on the person, longest waiting first: open permission asks, then held agents and idle teammates. */
export function buildInbox(asks, agents, waitingSince) {
    const fromAsks = Object.values(liveAsks(asks, agents));
    const askers = new Set(fromAsks.map(a => a.agent));
    const fromAgents = Object.values(agents).flatMap((a) => {
        const what = HELD[a.status];
        return a.id !== MAIN && what && !askers.has(a.id) ? [{ agent: a.id, since: waitingSince[a.id] ?? a.startedAt, what }] : [];
    });
    return [...fromAsks, ...fromAgents].sort((a, b) => a.since - b.since);
}
/** The status line: how many are working and how many need the person; nothing at all when there is nothing to show. */
export function statusText(working, needsYou, tasks) {
    if (working === 0 && needsYou === 0 && tasks.total === 0)
        return undefined;
    return `🪐 ${working} working${needsYou > 0 ? ` · ${needsYou} needs you` : ''}${tasks.total > 0 ? ` · ${tasks.done}/${tasks.total} tasks` : ''}`;
}
