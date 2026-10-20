// XP for the team's agents, earned from what they do and kept by nickname across sessions.
import { expect, test } from 'claude-code/testing';
import { buildSnapshot } from '../hooks/live';
import { mergeAgents } from '../hooks/model';
import { createLedger, creditActivity, creditTestRun, testRunEvent, xpAnnouncement, xpSummaries } from '../hooks/xpstore';
const BOOT = 100000;
/** A store in memory that counts how often it is written. */
function memory(initial = {}) {
    const data = new Map(Object.entries(initial));
    const writes = [];
    const store = {
        get: async (key) => data.get(key),
        set: async (key, value) => {
            writes.push(key);
            data.set(key, JSON.parse(JSON.stringify(value)));
        },
    };
    return { store, data, writes };
}
const agent = (id, nickname, over = {}) => ({
    id,
    name: `${id}-name`,
    role: 'agent-hq:dev',
    description: 'work',
    status: 'running',
    startedAt: BOOT + 1000,
    tools: 0,
    ...(nickname ? { nickname } : {}),
    ...over,
});
const todos = (done, open = 0) => [
    ...Array.from({ length: done }, (_, i) => ({ content: `d${i}`, status: 'completed', activeForm: 'x' })),
    ...Array.from({ length: open }, (_, i) => ({ content: `o${i}`, status: 'pending', activeForm: 'x' })),
];
const task = (id, subject, status, owner) => ({ id, subject, status, blockedBy: [], ...(owner ? { owner } : {}) });
const activity = (agents, over = {}) => ({
    agents: Object.fromEntries(agents.map(a => [a.id, a])),
    todos: over.todos ?? {},
    tasks: Object.fromEntries((over.tasks ?? []).map(t => [t.id, t])),
});
test('a new agent earns XP for its tools and finished todos, once, however many polls see them', async () => {
    const { store } = memory();
    const ledger = createLedger();
    await creditActivity(store, ledger, activity([agent('a', 'Mochi-chan', { tools: 3 })], { todos: { a: todos(2) } }), BOOT);
    expect((await xpSummaries(store, ledger, activity([agent('a', 'Mochi-chan')]).agents)).a).toMatchObject({ xp: 3 * 1 + 2 * 5, level: 1 });
    await creditActivity(store, ledger, activity([agent('a', 'Mochi-chan', { tools: 3 })], { todos: { a: todos(2) } }), BOOT + 1000);
    expect((await xpSummaries(store, ledger, activity([agent('a', 'Mochi-chan')]).agents)).a?.xp).toBe(13);
    await creditActivity(store, ledger, activity([agent('a', 'Mochi-chan', { tools: 5 })], { todos: { a: todos(3) } }), BOOT + 2000);
    expect((await xpSummaries(store, ledger, activity([agent('a', 'Mochi-chan')]).agents)).a?.xp).toBe(13 + 2 + 5);
});
test('an agent already working when the plugin loaded is not credited for what it did before', async () => {
    const { store } = memory();
    const ledger = createLedger();
    const old = agent('a', 'Tamago', { tools: 40, startedAt: BOOT - 60000 });
    await creditActivity(store, ledger, activity([old], { todos: { a: todos(4) } }), BOOT);
    expect((await xpSummaries(store, ledger, activity([old]).agents)).a?.xp).toBe(0);
    await creditActivity(store, ledger, activity([{ ...old, tools: 41 }], { todos: { a: todos(4) } }), BOOT + 1000);
    expect((await xpSummaries(store, ledger, activity([old]).agents)).a?.xp).toBe(1);
});
test('finishing earns agent_done once, a failure earns nothing but is remembered, a stop is silent', async () => {
    const { store } = memory();
    const ledger = createLedger();
    const running = [agent('a', 'Kuma-san'), agent('b', 'Daifuku'), agent('c', 'Taiyaki')];
    await creditActivity(store, ledger, activity(running), BOOT);
    const ended = [agent('a', 'Kuma-san', { status: 'completed' }), agent('b', 'Daifuku', { status: 'failed' }), agent('c', 'Taiyaki', { status: 'killed' })];
    await creditActivity(store, ledger, activity(ended), BOOT + 1000);
    await creditActivity(store, ledger, activity(ended), BOOT + 2000);
    const sums = await xpSummaries(store, ledger, activity(ended).agents);
    expect(sums.a?.xp).toBe(25);
    expect(sums.b?.xp).toBe(0);
    expect(sums.c?.xp).toBe(0);
});
test('a finished reviewer also earns for the review, and a finished task for itself with its subject', async () => {
    const { store } = memory();
    const ledger = createLedger();
    const reviewer = agent('r', 'Matcha Pop', { role: 'agent-hq:reviewer', name: 'reviewer-1' });
    const dev = agent('d', 'Wasabi', { name: 'dev-1' });
    await creditActivity(store, ledger, activity([reviewer, dev], { tasks: [task('1', 'Fix login bug', 'in_progress', 'dev-1')] }), BOOT);
    const notices = await creditActivity(store, ledger, activity([{ ...reviewer, status: 'completed' }, dev], { tasks: [task('1', 'Fix login bug', 'completed', 'dev-1')] }), BOOT + 30000);
    const sums = await xpSummaries(store, ledger, activity([reviewer, dev]).agents);
    expect(sums.r?.xp).toBe(25 + 15);
    expect(sums.d?.xp).toBe(20);
    expect(sums.d?.badges).toEqual(['first_task', 'bug_squasher', 'speedy']); // finished a fix 30 s after it was seen starting
    expect(notices.find(n => n.nickname === 'Wasabi')?.badges.map(b => b.id)).toEqual(['first_task', 'bug_squasher', 'speedy']);
});
test('a level up comes back as a notice with the new level', async () => {
    const { store } = memory({ 'xp:Hoshi': { xp: 45, level: 1, badges: [], tools: 45, tasks: 0, reviews: 0, testStreak: 0, failures: 0 } });
    const ledger = createLedger();
    const notices = await creditActivity(store, ledger, activity([agent('a', 'Hoshi', { tools: 6 })]), BOOT);
    expect(notices).toEqual([expect.objectContaining({ nickname: 'Hoshi', level: 2 })]);
    expect(await creditActivity(store, ledger, activity([agent('a', 'Hoshi', { tools: 7 })]), BOOT + 1000)).toEqual([]);
});
test('XP is kept by nickname in the store and a new session carries on from it', async () => {
    const { store, data } = memory();
    const first = createLedger();
    await creditActivity(store, first, activity([agent('a', 'Sakura Puff', { tools: 9 })]), BOOT);
    expect(data.get('xp:Sakura Puff').xp).toBe(9);
    const second = createLedger(); // a later session: the same nickname, a different agent id
    await creditActivity(store, second, activity([agent('z', 'Sakura Puff', { tools: 4 })]), BOOT);
    expect((await xpSummaries(store, second, activity([agent('z', 'Sakura Puff')]).agents)).z?.xp).toBe(13);
});
test('a stored value that is not stats is ignored, and an agent with no nickname earns nothing', async () => {
    const { store } = memory({ 'xp:Udon': { xp: 'lots', level: {}, badges: 'all' }, 'xp:Kombu': { xp: 10, level: 1, badges: ['ten_tools', 'made_up'], tools: 10, tasks: 0, reviews: 0, testStreak: 0, failures: 0 } });
    const ledger = createLedger();
    await creditActivity(store, ledger, activity([agent('a', 'Udon', { tools: 2 }), agent('b', 'Kombu'), agent('c', undefined, { tools: 5 })]), BOOT);
    const sums = await xpSummaries(store, ledger, activity([agent('a', 'Udon'), agent('b', 'Kombu'), agent('c', undefined)]).agents);
    expect(sums.a?.xp).toBe(2);
    expect(sums.b).toMatchObject({ xp: 10, badges: ['ten_tools'] });
    expect(sums.c).toBeUndefined();
});
test('a changed agent is written in the same poll, once per nickname, and nothing is written when nothing changed', async () => {
    const { store, writes } = memory();
    const ledger = createLedger();
    await creditActivity(store, ledger, activity([agent('a', 'Dango', { tools: 1 }), agent('b', 'Miso', { tools: 1 })]), BOOT);
    expect(writes.sort()).toEqual(['xp:Dango', 'xp:Miso']);
    await creditActivity(store, ledger, activity([agent('a', 'Dango', { tools: 1 }), agent('b', 'Miso', { tools: 1 })]), BOOT + 1000); // nothing new
    expect(writes).toHaveLength(2);
    await creditActivity(store, ledger, activity([agent('a', 'Dango', { tools: 4 }), agent('b', 'Miso', { tools: 1 })]), BOOT + 2000); // only Dango moved
    expect(writes).toHaveLength(3);
    expect(writes[2]).toBe('xp:Dango');
});
test('a failed write is tried again in the next poll', async () => {
    const data = new Map();
    let fail = true;
    const store = {
        get: async (key) => data.get(key),
        set: async (key, value) => {
            if (fail)
                throw new Error('disk full');
            data.set(key, JSON.parse(JSON.stringify(value)));
        },
    };
    const ledger = createLedger();
    await creditActivity(store, ledger, activity([agent('a', 'Dango', { tools: 2 })]), BOOT);
    expect(data.size).toBe(0);
    fail = false;
    await creditActivity(store, ledger, activity([agent('a', 'Dango', { tools: 2 })]), BOOT + 1000);
    expect(data.get('xp:Dango').xp).toBe(2);
});
test('test commands are told apart, and a failing run is red', () => {
    for (const command of ['npm test', 'pnpm run test -- --watch=false', 'yarn test', 'npx vitest run', 'bun test', 'pytest -q', 'go test ./...', 'cargo test', 'claude plugin test .', 'cd app && npm run test']) {
        expect(testRunEvent(command, false), command).toEqual({ type: 'tests_green' });
        expect(testRunEvent(command, true), command).toEqual({ type: 'tests_red' });
    }
    for (const command of ['npm install', 'git status', 'echo "npm test"', 'ls tests', 'cat test.log', 'npm run build'])
        expect(testRunEvent(command, false), command).toBeNull();
});
test('a test run is credited to the agent that ran it', async () => {
    const { store } = memory();
    const ledger = createLedger();
    for (let i = 0; i < 5; i++)
        await creditTestRun(store, ledger, 'Pocky Pal', 'npm test', false, BOOT + i * 1000);
    await creditTestRun(store, ledger, 'Pocky Pal', 'npm test', true, BOOT + 6000);
    await creditTestRun(store, ledger, 'Pocky Pal', 'git status', false, BOOT + 7000);
    await creditTestRun(store, ledger, undefined, 'npm test', false, BOOT + 8000);
    const sums = await xpSummaries(store, ledger, activity([agent('a', 'Pocky Pal')]).agents);
    expect(sums.a).toMatchObject({ xp: 50, badges: ['test_streak_5'] });
});
test('a level up is toasted and its clip beats a done clip; muted plays nothing for it; badges are toasted too', () => {
    const up = { nickname: 'Hoshi', level: 3, badges: [{ id: 'ten_tools', title: 'Getting Handy', hint: 'Use 10 tools' }] };
    const badge = { nickname: 'Miso', level: null, badges: [{ id: 'first_task', title: 'First Task', hint: 'Finish your first task' }] };
    expect(xpAnnouncement([up, badge], 'done', false)).toEqual({
        toasts: ['Agent HQ: Hoshi reached level 3! · Hoshi earned the Getting Handy badge', 'Agent HQ: Miso earned the First Task badge'],
        sound: 'levelup',
    });
    expect(xpAnnouncement([up], 'failed', false).sound).toBe('failed'); // something that went wrong is louder
    expect(xpAnnouncement([badge], 'done', false).sound).toBe('done'); // a badge alone is no level up
    expect(xpAnnouncement([up], null, true).sound).toBeNull();
    expect(xpAnnouncement([], null, false)).toEqual({ toasts: [], sound: null });
});
test('the live snapshot carries each agent level, XP and badges with their titles, or null where nothing is kept', () => {
    const data = {
        agents: mergeAgents({}, [{ id: 'd1', name: 'dev-1', type: 'general-purpose', description: 'x', status: 'running' }], 1000),
        todos: {},
        tasks: {},
        now: 2000,
        hideFinished: false,
        columns: 0,
        isLight: false,
        team: null,
        xp: { d1: { level: 3, xp: 210, badges: ['first_task', 'speedy'] } },
    };
    const snap = buildSnapshot(data, 2000);
    const byId = Object.fromEntries(snap.agents.map(a => [a.id, a]));
    expect(byId.d1?.xp).toEqual({
        level: 3,
        xp: 210,
        badges: [
            { id: 'first_task', title: 'First Task', hint: 'Finish your first task' },
            { id: 'speedy', title: 'Speedy', hint: 'Finish a task in under 2 minutes' },
        ],
    });
    expect(byId.main?.xp).toBeNull();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
});
