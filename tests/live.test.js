import { expect, test } from 'claude-code/testing';
import { buildSnapshot } from '../hooks/live';
import { MAIN, createTask, mergeAgents, updateTask } from '../hooks/model';
import { parseTeam } from '../hooks/team';
const TEAM = parseTeam(JSON.stringify({
    name: 'Booking App Team',
    purpose: 'Build the booking app',
    lead: { title: 'Tech Lead', rules: [], skills: [] },
    roles: [{ id: 'frontend-dev', title: 'Frontend Developer', count: 2, mission: 'Build pages.', tasks: [], rules: [], skills: [] }],
}));
test('the live snapshot carries the tree, labels, mascots, progress and the board', () => {
    if (typeof TEAM === 'string')
        throw new Error(TEAM);
    const dev = { id: 'd1', name: 'frontend-dev-1', type: 'agent-hq:frontend-dev', description: 'Search page', status: 'running' };
    const helper = { id: 'h1', name: 'helper', type: 'Explore', description: 'Find files', status: 'completed', parentId: 'd1' };
    const tasks = updateTask(createTask({}, '1', 'Search page', 'Building search'), '1', { status: 'in_progress', owner: 'frontend-dev-1' });
    const data = {
        agents: mergeAgents({}, [dev, helper], 1000),
        todos: { d1: [{ content: 'Read', status: 'completed', activeForm: 'Reading' }, { content: 'Build', status: 'in_progress', activeForm: 'Building' }] },
        tasks,
        now: 5000,
        hideFinished: false,
        columns: 0,
        isLight: false,
        team: TEAM,
    };
    const snap = buildSnapshot(data, 5000);
    const byId = Object.fromEntries(snap.agents.map(a => [a.id, a]));
    expect(snap.team).toEqual({ name: 'Booking App Team', purpose: 'Build the booking app', lead: 'Tech Lead' });
    expect(byId[MAIN]?.name).toBe('Tech Lead');
    expect(byId[MAIN]?.parentId).toBeNull();
    expect(byId.d1?.role).toBe('Frontend Developer');
    expect(byId.d1?.parentId).toBe(MAIN);
    expect(byId.h1?.parentId).toBe('d1');
    expect(byId.d1?.now).toContain('Building');
    expect(byId.d1?.todos).toEqual({ done: 1, active: 1, total: 2 });
    expect(byId.h1?.tone).toBe('done');
    expect(byId.d1?.mascot.state).toBe('working');
    expect(byId.d1?.mascot.frames.length).toBeGreaterThan(2);
    expect(byId[MAIN]?.mascot).toMatchObject({ type: 'star', hat: 'crown' });
    expect(snap.tasks[0]).toEqual({ id: '1', subject: 'Search page', status: 'in_progress', owner: 'frontend-dev-1', blockedBy: [] });
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap); // plain JSON, nothing lost on the wire
});
test('the snapshot carries the acknowledged request id and the activity feed, empty by default', () => {
    const data = { agents: mergeAgents({}, [], 0), todos: {}, tasks: {}, now: 0, hideFinished: false, columns: 0, isLight: false, team: null };
    expect(buildSnapshot(data, 1)).toMatchObject({ lastAction: 0, events: [] });
    const events = [{ n: 4, at: 9, agent: 'a1', kind: 'tool', text: 'used Bash' }];
    const snap = buildSnapshot(data, 1, null, { lastAction: 12, events });
    expect(snap.lastAction).toBe(12);
    expect(snap.events).toEqual(events);
    expect(snap.events).not.toBe(events);
});
