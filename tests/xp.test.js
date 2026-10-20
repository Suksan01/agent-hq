// Spec for hooks/xp.ts. Decisions the spec pins down (change the test with the lead, not the code, if they are wrong):
//  - XP per event is the XP table below; level = floor(sqrt(xp / 50)) + 1; `levelUp` is the NEW level when it rose, else null;
//  - `tests_red` (a failing test command) is an addition to the event list: it adds nothing and resets the test streak;
//  - `task_done` carries the task `subject` and optionally `startedAt`; speedy needs startedAt and now - startedAt < 120 000 ms;
//  - bug_squasher matches the whole words fix, fixes, fixed, bug, bugs (case-insensitive): "Prefix" and "Debugging" do not;
//  - comeback is earned by the first task_done or agent_done that comes after an agent_failed;
//  - `badges` returned are the ones THIS event earned (in BADGES order); `stats.badges` holds every id earned so far.
import { expect, test } from 'claude-code/testing';
import { BADGES, XP, applyEvent, emptyStats, levelOf } from '../hooks/xp';
const NOW = 1000000;
const IDS = ['first_task', 'ten_tools', 'hundred_tools', 'test_streak_5', 'bug_squasher', 'reviewer_eagle', 'speedy', 'comeback'];
const task = (subject, startedAt) => ({ type: 'task_done', subject, ...(startedAt === undefined ? {} : { startedAt }) });
const ids = (r) => r.badges.map(b => b.id);
/** Stats a few steps in, without replaying events: the earlier work counted, nothing awarded yet. */
const stats = (over = {}) => ({ ...emptyStats(), ...over });
function replay(events, from = emptyStats()) {
    let current = from;
    const earned = [];
    for (const event of events) {
        const out = applyEvent(current, event, NOW);
        current = out.stats;
        earned.push(...ids(out));
    }
    return { stats: current, earned };
}
test('the XP table is fixed', () => {
    expect(XP).toEqual({ tool: 1, todo_done: 5, task_done: 20, tests_green: 10, tests_red: 0, review_approved: 15, agent_done: 25, agent_failed: 0 });
});
test('level is floor(sqrt(xp / 50)) + 1', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(49)).toBe(1);
    expect(levelOf(50)).toBe(2);
    expect(levelOf(199)).toBe(2);
    expect(levelOf(200)).toBe(3);
    expect(levelOf(449)).toBe(3);
    expect(levelOf(450)).toBe(4);
    expect(levelOf(1250)).toBe(6);
});
test('a fresh agent starts at level 1 with nothing', () => {
    expect(emptyStats()).toMatchObject({ xp: 0, level: 1, badges: [], tools: 0, tasks: 0, reviews: 0, testStreak: 0, failures: 0 });
});
test('every event adds its XP from the table', () => {
    const events = [{ type: 'tool' }, { type: 'todo_done' }, task('Write docs'), { type: 'tests_green' }, { type: 'tests_red' }, { type: 'review_approved' }, { type: 'agent_done' }, { type: 'agent_failed' }];
    for (const event of events) {
        const out = applyEvent(emptyStats(), event, NOW);
        expect(out.stats.xp, event.type).toBe(XP[event.type]);
        expect(out.stats.level).toBe(levelOf(out.stats.xp));
    }
});
test('level up reports the new level only when it rose', () => {
    const near = stats({ xp: 49, level: 1 });
    const up = applyEvent(near, { type: 'tool' }, NOW);
    expect(up.stats).toMatchObject({ xp: 50, level: 2 });
    expect(up.levelUp).toBe(2);
    expect(applyEvent(stats({ xp: 40, level: 1 }), { type: 'tool' }, NOW).levelUp).toBeNull();
    expect(applyEvent(stats({ xp: 60, level: 2 }), { type: 'tool' }, NOW).levelUp).toBeNull();
    expect(applyEvent(stats({ xp: 190, level: 2 }), { type: 'agent_done' }, NOW)).toMatchObject({ levelUp: 3, stats: { xp: 215, level: 3 } });
});
test('events count what they should and leave the rest alone', () => {
    const { stats: s } = replay([{ type: 'tool' }, { type: 'tool' }, { type: 'todo_done' }, task('Ship it'), { type: 'review_approved' }, { type: 'tests_green' }, { type: 'agent_failed' }]);
    expect(s).toMatchObject({ tools: 2, tasks: 1, reviews: 1, testStreak: 1, failures: 1 });
});
test('applyEvent never changes the stats it is given', () => {
    const before = Object.freeze(stats({ xp: 49, tools: 9, badges: Object.freeze(['first_task']) }));
    const copy = JSON.parse(JSON.stringify(before));
    const out = applyEvent(before, { type: 'tool' }, NOW);
    expect(out.stats).not.toBe(before);
    expect(before).toEqual(copy);
});
test('the badge list is the eight badges, each with a title and a hint', () => {
    expect(BADGES.map(b => b.id)).toEqual(IDS);
    for (const badge of BADGES) {
        expect(badge.title.length).toBeGreaterThan(0);
        expect(badge.hint.length).toBeGreaterThan(0);
    }
    const out = applyEvent(emptyStats(), task('Anything'), NOW);
    expect(out.badges[0]).toEqual(BADGES.find(b => b.id === 'first_task'));
});
test('first_task is earned by the first finished task only', () => {
    const first = applyEvent(emptyStats(), task('Write docs'), NOW);
    expect(ids(first)).toEqual(['first_task']);
    expect(first.stats.badges).toEqual(['first_task']);
    expect(ids(applyEvent(first.stats, task('More docs'), NOW))).toEqual([]);
    expect(ids(applyEvent(emptyStats(), { type: 'todo_done' }, NOW))).toEqual([]);
});
test('ten_tools and hundred_tools come at the 10th and the 100th tool, once', () => {
    expect(ids(applyEvent(stats({ tools: 8 }), { type: 'tool' }, NOW))).toEqual([]);
    expect(ids(applyEvent(stats({ tools: 9 }), { type: 'tool' }, NOW))).toEqual(['ten_tools']);
    const again = applyEvent(stats({ tools: 9, badges: ['ten_tools'] }), { type: 'tool' }, NOW);
    expect(ids(again)).toEqual([]);
    expect(ids(applyEvent(stats({ tools: 99, badges: ['ten_tools'] }), { type: 'tool' }, NOW))).toEqual(['hundred_tools']);
    expect(applyEvent(stats({ tools: 9 }), { type: 'tool' }, NOW).stats.badges).toEqual(['ten_tools']);
});
test('test_streak_5 needs five green runs in a row; a red run starts the count over', () => {
    const green = (n) => Array.from({ length: n }, () => ({ type: 'tests_green' }));
    expect(replay(green(4)).earned).toEqual([]);
    expect(replay(green(5)).earned).toEqual(['test_streak_5']);
    expect(replay([...green(3), { type: 'tests_red' }, ...green(4)]).earned).toEqual([]);
    expect(replay([...green(3), { type: 'tests_red' }, ...green(5)]).earned).toEqual(['test_streak_5']);
    expect(replay(green(9)).earned).toEqual(['test_streak_5']); // not again
    expect(replay([...green(2), { type: 'tests_red' }]).stats.testStreak).toBe(0);
});
test('bug_squasher is earned by a finished task about a fix or a bug, by whole word', () => {
    for (const subject of ['Fix login', 'fixed the cart bug', 'Bugs in checkout', 'FIXES #12', 'Squash the bug']) {
        expect(ids(applyEvent(stats({ badges: ['first_task'] }), task(subject), NOW)), subject).toEqual(['bug_squasher']);
    }
    for (const subject of ['Add search', 'Add prefix handling', 'Debugging session notes', 'Refactor']) {
        expect(ids(applyEvent(stats({ badges: ['first_task'] }), task(subject), NOW)), subject).toEqual([]);
    }
    expect(ids(applyEvent(stats({ badges: ['first_task', 'bug_squasher'] }), task('Fix another bug'), NOW))).toEqual([]);
});
test('reviewer_eagle comes with the fifth approved review', () => {
    expect(ids(applyEvent(stats({ reviews: 3 }), { type: 'review_approved' }, NOW))).toEqual([]);
    expect(ids(applyEvent(stats({ reviews: 4 }), { type: 'review_approved' }, NOW))).toEqual(['reviewer_eagle']);
    expect(ids(applyEvent(stats({ reviews: 4, badges: ['reviewer_eagle'] }), { type: 'review_approved' }, NOW))).toEqual([]);
});
test('speedy needs a task done in under two minutes from its start', () => {
    const done = (startedAt) => ids(applyEvent(stats({ badges: ['first_task'] }), task('Quick job', startedAt), NOW));
    expect(done(NOW - 60000)).toEqual(['speedy']);
    expect(done(NOW - 119999)).toEqual(['speedy']);
    expect(done(NOW - 120000)).toEqual([]);
    expect(done(NOW - 600000)).toEqual([]);
    expect(done(undefined)).toEqual([]);
});
test('comeback is earned by the first thing done after a failure', () => {
    expect(ids(applyEvent(stats({ failures: 1, badges: ['first_task'] }), task('Retry it'), NOW))).toEqual(['comeback']);
    expect(ids(applyEvent(stats({ failures: 1 }), { type: 'agent_done' }, NOW))).toEqual(['comeback']);
    expect(ids(applyEvent(stats({ failures: 0 }), { type: 'agent_done' }, NOW))).toEqual([]);
    expect(ids(applyEvent(stats({ failures: 1, badges: ['comeback'] }), { type: 'agent_done' }, NOW))).toEqual([]);
    expect(ids(applyEvent(stats(), { type: 'agent_failed' }, NOW))).toEqual([]); // failing earns nothing
    expect(replay([{ type: 'agent_failed' }, { type: 'agent_done' }]).earned).toEqual(['comeback']);
});
test('one event can earn several badges, listed in badge order', () => {
    const out = applyEvent(stats({ failures: 1 }), task('Fix the bug', NOW - 30000), NOW);
    expect(ids(out)).toEqual(['first_task', 'bug_squasher', 'speedy', 'comeback']);
    expect(out.stats.badges).toEqual(['first_task', 'bug_squasher', 'speedy', 'comeback']);
});
