// The person can always close the sidebar: `/hq` toggles it, `/hq close` / `/hq open` say which, a ✕ Close button sits at
// its top, and once they close it no spawned agent opens it again by itself.
import { expect, mock, test } from 'claude-code/testing';
const PANE = 'agent-hq';
const PANE_PROPS = { title: 'Agent HQ', isFocused: false, bodyColumns: 46, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} };
const CLOSED = 'Agent HQ sidebar closed — /hq to open it again';
async function session($, on) {
    const toasts = [];
    const opens = [];
    const listed = [];
    mock.clock(on);
    on('session.start', (_, e) => e);
    on('session.cwd', () => ({ value: '/work/app' }));
    for (const event of ['command.register', 'ui.status', 'ui.log'])
        on(event, () => ({ value: undefined }));
    on('config.list', () => ({ value: [] }));
    on('ui.toast', (_, e) => {
        toasts.push(e.text);
        return { value: undefined };
    });
    // the engine's pane record, as the surface keeps it
    const panes = new Set();
    on('ui.open', (_, e) => {
        opens.push({ ...e });
        panes.add(e.id);
        return { value: { isPlaced: true } };
    });
    on('ui.close', (_, e) => {
        panes.delete(e.id);
        return { value: undefined };
    });
    on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }));
    for (const event of ['env.get', 'fs.exists'])
        on(event, () => ({ value: undefined }));
    on('agent.list', () => ({ value: listed }));
    on('agent.spawn', () => ({ model: 'haiku', agentId: `a${listed.length}` }));
    await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true });
    const hq = (args = '') => $.command.run({ command: 'hq', args, origin: { kind: 'composer' }, presentation: {} });
    const isOpen = async () => panes.has(PANE);
    const spawn = async () => {
        listed.push({ id: `a${listed.length + 1}`, name: `dev-${listed.length + 1}`, type: 'general-purpose', description: 'x', status: 'running' });
        await $.agent.spawn({ prompt: 'go', description: 'x' });
    };
    return { toasts, opens, hq, isOpen, spawn };
}
test('/hq toggles the sidebar, and /hq close says how to get it back', async ($, on) => {
    const s = await session($, on);
    await s.hq();
    expect(await s.isOpen()).toBe(true);
    expect(s.opens.at(-1)).toMatchObject({ id: PANE, closeOnEscape: true });
    expect(s.opens.at(-1)?.focus).toBeUndefined(); // Escape closes it, yet it never takes the keyboard
    expect((await s.hq()).text).toBe(CLOSED);
    expect(await s.isOpen()).toBe(false);
    expect(s.toasts).toContain(CLOSED);
    await s.hq('open');
    await s.hq('open');
    expect(await s.isOpen()).toBe(true); // open is open, never a toggle
    expect((await s.hq('close')).text).toBe(CLOSED);
    expect(await s.isOpen()).toBe(false);
    expect((await s.hq('close')).text).toBe(CLOSED); // closing a closed sidebar is fine
});
test('the sidebar has a ✕ Close button (q) that closes it', async ($, on) => {
    const s = await session($, on);
    await s.hq('open');
    const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
    const button = await ui.find({ key: 'close-sidebar' });
    expect(button?.text).toContain('✕ Close');
    expect(button?.props.hotkey).toBe('q');
    await ui.press({ key: 'close-sidebar' });
    expect(await s.isOpen()).toBe(false);
    expect(s.toasts).toContain(CLOSED);
});
// the test kit's `$` cannot raise a person's close mark, so the ✕ Close press stands for it: both run the same ui.close hook
test('once the person closes the sidebar, a spawned agent never reopens it; /hq still does', async ($, on) => {
    const s = await session($, on);
    await s.spawn();
    expect(await s.isOpen()).toBe(true); // the first spawn opens it by itself, once
    const ui = await $.ui.mount({ plugin: 'agent-hq', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS });
    await ui.press({ key: 'close-sidebar' });
    expect(await s.isOpen()).toBe(false);
    await s.spawn();
    await s.spawn();
    expect(await s.isOpen()).toBe(false);
    await s.hq();
    expect(await s.isOpen()).toBe(true);
});
test('closed with /hq close before any agent started, the first spawn does not open it either', async ($, on) => {
    const s = await session($, on);
    await s.hq('open');
    await s.hq('close');
    await s.spawn();
    expect(await s.isOpen()).toBe(false);
});
