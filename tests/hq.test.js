import { expect, mock, test } from 'claude-code/testing';
import { cellText, fit, spriteCells, trackCells } from '../hooks/cells';
import { LEAD, LETTERS, MASCOT_COUNT, SMALL_H, SMALL_W, SPECIES, SPRITE_H, SPRITE_W, botState, paletteOf, speciesOf, spriteFrames } from '../hooks/sprites';
import { MAIN, PLAN_TOOL, agentWork, barIdsIn, clearFinished, pickMascot, mergeTodos, planSteps, countTool, createTask, mergeAgents, overallProgress, teamTree, updateTask } from '../hooks/model';
const lead = { id: 'a1', name: 'researcher', type: 'Explore', description: 'Find auth code', status: 'running' };
const helper = { ...lead, id: 'a2', name: 'reviewer', type: 'code-reviewer', parentId: 'a1' };
test('mergeAgents keeps tool stats and marks agents that left the list as done', () => {
    const first = countTool(mergeAgents({}, [lead], 1000), 'a1', 'Grep', 1000);
    const second = mergeAgents(first, [], 5000);
    expect(second.a1?.tools).toBe(1);
    expect(second.a1?.status).toBe('completed');
    expect(second.a1?.endedAt).toBe(5000);
    expect(second[MAIN]?.role).toBe('orchestrator');
});
test('teamTree nests sub-agents under their parent and orphans under main', () => {
    const tree = teamTree(mergeAgents({}, [lead, helper], 0));
    expect(tree[MAIN]?.map(a => a.id)).toEqual(['a1']);
    expect(tree.a1?.map(a => a.id)).toEqual(['a2']);
});
test('task board create/update/delete and overall progress', () => {
    let tasks = createTask({}, '1', 'Plan');
    tasks = createTask(tasks, '2', 'Build');
    tasks = updateTask(tasks, '1', { status: 'completed' });
    tasks = updateTask(tasks, '2', { status: 'in_progress', owner: 'researcher', addBlockedBy: ['1'] });
    const todos = { a1: [{ content: 'x', status: 'pending', activeForm: 'Xing' }] };
    expect(overallProgress(tasks, todos)).toEqual({ done: 1, active: 1, total: 3 });
    expect(tasks['2']?.blockedBy).toEqual(['1']);
    expect(updateTask(tasks, '2', { status: 'deleted' })['2']).toBeUndefined();
});
test('clearFinished drops done agents and tasks but never main', () => {
    const agents = mergeAgents({}, [{ ...lead, status: 'completed' }], 0);
    const cleared = clearFinished(agents, createTask({}, '1', 'Plan'), {});
    expect(Object.keys(cleared.agents)).toEqual([MAIN]);
    expect(Object.keys(cleared.tasks)).toEqual(['1']);
});
test('raster cells are one column each and sized to the track', () => {
    // a wide glyph would make the engine refuse the whole pane
    expect(cellText('研究 agent 🚀')).toBe('·· agent ·');
    expect(fit('a very long agent name', 8)).toBe('a very…');
    const W = 40;
    const bytes = (b64) => (b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    expect(bytes(trackCells({ done: 3, total: 8, tone: 'running', label: '2 running', count: '3/8' }, W, 0, false))).toBe(W * 12);
});
test('agentWork reads now and next from todos, then from owned board tasks', () => {
    const [row] = Object.values(mergeAgents({}, [lead], 0)).filter(a => a.id === 'a1');
    if (!row)
        throw new Error('no agent row');
    const todos = {
        a1: [
            { content: 'Read', status: 'completed', activeForm: 'Reading' },
            { content: 'Sum', status: 'in_progress', activeForm: 'Summarizing' },
            { content: 'Report', status: 'pending', activeForm: 'Reporting' },
        ],
    };
    expect(agentWork(row, todos, {})).toEqual({ now: 'Summarizing', next: 'Report', last: 'Read', todos: { done: 1, active: 1, total: 3 } });
    let tasks = updateTask(createTask({}, '1', 'Ship it', 'Shipping'), '1', { owner: 'researcher', status: 'in_progress' });
    tasks = updateTask(createTask(tasks, '2', 'Write docs'), '2', { owner: 'researcher' });
    expect(agentWork(row, {}, tasks)).toEqual({ now: 'Shipping', next: 'Write docs', last: undefined, todos: undefined });
    tasks = updateTask(createTask(tasks, '3', 'Fix bug'), '3', { owner: 'researcher', status: 'completed' });
    expect(agentWork(row, {}, tasks).last).toBe('Fix bug');
});
const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} };
const BAND_PROPS = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} };
async function seedTeam($, on) {
    mock.clock(on);
    on('agent.list', () => ({ value: [lead, helper] }));
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }));
    on('tool.call', (_, e) => {
        if (e.tool === 'TaskCreate')
            return { result: { task: { id: '7', subject: 'Write tests' } } };
        return { result: {} };
    });
    await $.agent.spawn({ prompt: 'go', description: 'Find auth code', subagentType: 'Explore' });
    // untyped on purpose: the session's full tool union is too deep for tsc to resolve here
    const call = $.tool.call;
    await call({ tool: 'TaskCreate', subject: 'Write tests', description: 'cover it' });
    await call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', owner: 'reviewer', activeForm: 'Writing tests' });
    await call({
        tool: 'TodoWrite',
        todos: [
            { content: 'Read', status: 'completed', activeForm: 'Reading' },
            { content: 'Sum', status: 'in_progress', activeForm: 'Summarizing' },
            { content: 'Report back', status: 'pending', activeForm: 'Reporting' },
        ],
    });
}
test('sidebar shows the agent tree with each agent now and next', async ($, on) => {
    await seedTeam($, on);
    for (const surface of ['terminal', 'desktop']) {
        const ui = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS });
        const missing = [];
        for (const key of ['view-main', 'view-a1', 'view-a2'])
            if (!(await ui.find({ key })))
                missing.push(key);
        expect(missing).toEqual([]);
        expect(await ui.find({ text: /researcher/ })).toBeDefined();
        expect(await ui.find({ text: /reviewer/ })).toBeDefined(); // its real name, after its nickname
        expect(await ui.find({ text: /└─ / })).toBeDefined();
        expect(await ui.find({ text: /▸ Summarizing/ })).toBeDefined();
        expect(await ui.find({ text: /next: Report back/ })).toBeDefined();
        expect(await ui.find({ text: /▸ Writing tests/ })).toBeDefined();
        expect(await ui.find({ text: /TASK BOARD/ })).toBeDefined();
        if (surface === 'terminal') {
            expect(await ui.find({ type: 'Raster', key: 'todo-main' })).toBeDefined();
            expect(await ui.find({ type: 'Raster', key: 'mascot-a1' })).toBeDefined();
        }
        else {
            expect(await ui.find({ text: /●/ })).toBeDefined(); // no Rasters on desktop: each bot as a dot in its colour
        }
        await ui.press({ key: 'toggle-hide' });
        expect(await ui.find({ key: 'toggle-hide', text: /Show done/ })).toBeDefined();
        await ui.press({ key: 'toggle-hide' });
        await ui.unmount();
    }
});
test('band above the prompt draws plan-progress style Team and Tasks tracks', async ($, on) => {
    // stands for the engine's own band: an empty Box
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine-band' }));
    await seedTeam($, on);
    const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS, viewport: { columns: 100, rows: 40, isFullscreen: true } });
    expect(await ui.find({ type: 'Raster', key: 'track-team' })).toBeDefined();
    expect(await ui.find({ type: 'Raster', key: 'track-tasks' })).toBeDefined();
    expect(await ui.find({ key: 'open-sidebar' })).toBeDefined();
    await ui.press({ key: 'hide-band' });
    expect(await ui.find({ type: 'Raster', key: 'track-team' })).toBeUndefined();
    await ui.unmount();
});
test('a finished agent shows its last completed task in the sidebar', async ($, on) => {
    const finisher = { id: 'a3', name: 'finisher', type: 'general-purpose', description: 'Ship it', status: 'completed' };
    mock.clock(on);
    on('agent.list', () => ({ value: [finisher] }));
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'a3' }));
    on('tool.call', (_, e) => (e.tool === 'TaskCreate' ? { result: { task: { id: '9', subject: 'Ship release' } } } : { result: {} }));
    await $.agent.spawn({ prompt: 'go', description: 'Ship it' });
    const call = $.tool.call;
    await call({ tool: 'TaskCreate', subject: 'Ship release', description: 'tag and publish' });
    await call({ tool: 'TaskUpdate', taskId: '9', status: 'completed', owner: 'finisher' });
    for (const surface of ['terminal', 'desktop']) {
        const ui = await $.ui.mount({ plugin: 'agent-hq', surface, component: 'Pane', requestId: 'agent-hq', props: PANE_PROPS });
        expect(await ui.find({ text: /✓ Ship release/ })).toBeDefined();
        expect(await ui.find({ text: /done in/ })).toBeUndefined();
        await ui.unmount();
    }
});
test('plan-progress calls name their bar the way plan-progress slugs it', () => {
    const content = [
        { type: 'text', text: 'working' },
        { type: 'tool_use', name: PLAN_TOOL, input: { id: 'Read Files', stages: [] } },
        { type: 'tool_use', name: PLAN_TOOL, input: { title: 'Ship  the  release!' } },
        { type: 'tool_use', name: 'Read', input: { id: 'nope' } },
    ];
    expect(barIdsIn(content)).toEqual(['read-files', 'ship-the-release']);
    expect(barIdsIn('not blocks')).toEqual([]);
});
test('plan-progress bars read as todo lists, and an agent own todos win over its bar', () => {
    const plans = [
        { id: 'demo', state: 'running', stages: [{ name: 'A', steps: [{ title: 'One', status: 'done' }, { title: 'Two', status: 'active' }] }, { name: 'B', steps: [{ title: 'Three', status: 'pending' }] }] },
        { id: 'shipped', state: 'done', stages: [{ name: 'X', steps: [{ title: 'Only', status: 'pending' }] }] },
        { id: 7, stages: 'garbage' },
    ];
    const bars = planSteps(plans);
    expect(bars.demo?.map(s => s.status)).toEqual(['completed', 'in_progress', 'pending']);
    expect(bars.shipped?.[0]?.status).toBe('completed');
    expect(Object.keys(bars)).toEqual(['demo', 'shipped']);
    expect(planSteps(null)).toEqual({});
    const agents = mergeAgents({}, [lead], 0);
    const owners = { demo: { owner: 'a1', at: 1 }, shipped: { owner: 'a1', at: 2 }, ghost: { owner: 'gone', at: 3 } };
    expect(mergeTodos({}, bars, owners, agents).a1?.[0]?.content).toBe('Only'); // the bar moved last
    const own = [{ content: 'Mine', status: 'pending', activeForm: 'Mining' }];
    expect(mergeTodos({ a1: own }, bars, owners, agents).a1).toEqual(own);
    expect(mergeTodos({}, bars, owners, agents).gone).toBeUndefined();
});
test('every bot sprite is 12×10, animates while working, sleeps when done, and draws as 12×5 cells; members also at 8×6', () => {
    const letters = new Set([...LETTERS]);
    const all = Array.from({ length: MASCOT_COUNT }, (_, i) => speciesOf(i));
    // 24 mascots, no two alike: shape × colour
    expect(MASCOT_COUNT).toBeGreaterThanOrEqual(24);
    expect(new Set(all.map(s => `${s.type} ${s.color}`)).size).toBe(MASCOT_COUNT);
    for (const [small, W, H] of [[false, SPRITE_W, SPRITE_H], [true, SMALL_W, SMALL_H]]) {
        for (const s of [LEAD, ...SPECIES]) {
            for (const tone of ['running', 'needs_input', 'done', 'error']) {
                const frames = spriteFrames(s, tone, small);
                const palette = paletteOf(s, tone);
                for (const frame of frames) {
                    expect(frame.length).toBe(H);
                    for (const row of frame) {
                        expect(row.length).toBe(W);
                        for (const ch of row)
                            expect(letters.has(ch)).toBe(true);
                    }
                    const bytes = (spriteCells(frame, palette, '#050507').length / 4) * 3;
                    expect(bytes).toBeGreaterThanOrEqual(W * (H / 2) * 12);
                }
            }
            expect(new Set(spriteFrames(s, 'running', small).map(f => f.join(''))).size).toBeGreaterThan(2);
            // only a working bot moves: the other states are one still frame, so an idle view never redraws for them
            for (const tone of ['needs_input', 'done', 'error'])
                expect(spriteFrames(s, tone, small)).toHaveLength(1);
            expect(spriteFrames(s, 'done', small).some(f => f.join('').includes('z'))).toBe(true);
            expect(spriteFrames(s, 'error', small)[0]?.join('')).toContain('r');
        }
    }
    expect(paletteOf(SPECIES[0], 'error').b).not.toBe(paletteOf(SPECIES[0], 'running').b); // failed slumps grey
    expect(botState('running')).toBe('working');
    expect(botState('done')).toBe('sleeping');
    expect(cellText('▀')).toBe('▀');
});
test('each agent gets its own mascot and keeps it', () => {
    const listed = SPECIES.map((_, i) => ({ ...lead, id: `x${i}`, name: `agent${i}` }));
    const rows = mergeAgents({}, listed, 0);
    const picks = listed.map(a => rows[a.id]?.mascot);
    expect(new Set(picks).size).toBe(SPECIES.length);
    expect(rows[MAIN]?.mascot).toBeUndefined();
    expect(speciesOf(undefined)).toBe(LEAD);
    // a later poll and a newcomer leave earlier picks alone; the newcomer takes a free one once some are cleared
    const again = mergeAgents(rows, listed, 5);
    expect(listed.map(a => again[a.id]?.mascot)).toEqual(picks);
    const { x0: _gone, ...rest } = again;
    expect(pickMascot(rest, 'newcomer')).toBe(again.x0?.mascot);
});
