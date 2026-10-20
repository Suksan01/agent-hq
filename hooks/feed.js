// The activity feed on the live page: a numbered list of what just happened (a tool used, a step done, a status change,
// a message sent, a page request's result). `n` only rises, so the page can tell it missed some; the last 200 are kept.
import { MAIN } from './model';
export const FEED_MAX = 200;
const TEXT_MAX = 140;
export const EMPTY_FEED = { next: 1, events: [] };
const clip = (text) => (text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text);
/** The feed with these events added at `at`, numbered on from where it was; only the newest FEED_MAX stay. */
export function addEvents(feed, at, items) {
    if (items.length === 0)
        return feed;
    const added = items.map((item, i) => ({ n: feed.next + i, at, agent: item.agent, kind: item.kind, text: clip(item.text) }));
    return { next: feed.next + added.length, events: [...feed.events, ...added].slice(-FEED_MAX) };
}
/** An agent that appeared, or whose status changed, between two polls (never the main session). */
export function statusEvents(before, after) {
    return Object.values(after).flatMap((agent) => {
        if (agent.id === MAIN)
            return [];
        const prior = before[agent.id];
        if (!prior)
            return [{ agent: agent.id, kind: 'status', text: `started (${agent.status})` }];
        return prior.status === agent.status ? [] : [{ agent: agent.id, kind: 'status', text: `${prior.status} → ${agent.status}` }];
    });
}
/** Steps a TodoWrite just completed: todos done now that were not done in the list before (matched by their text). */
export function stepEvents(agent, before, after) {
    const wasDone = new Set((before ?? []).filter(todo => todo.status === 'completed').map(todo => todo.content));
    return after.filter(todo => todo.status === 'completed' && !wasDone.has(todo.content)).map(todo => ({ agent, kind: 'step', text: `done: ${todo.content}` }));
}
