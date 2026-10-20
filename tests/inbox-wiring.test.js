// The inbox on the engine: a permission ask waits in the live snapshot and the status line until the call is decided.
import { expect, mock, test } from 'claude-code/testing';
const STATE = '/home/me/.claude/agent-hq/live/sess.json';
async function boot($, on, roster = []) {
    const statuses = [];
    const snapshots = [];
    const toasts = [];
    const listed = roster;
    let decision = 'ask';
    let release = () => { };
    const clock = mock.clock(on);
    mock.store(on, {});
    on('env.get', () => ({ value: '/home/me' }));
    on('session.cwd', () => ({ value: '/work/app' }));
    on('session.id', () => ({ value: 'sess' }));
    on('fs.exists', () => ({ value: false }));
    on('fs.read', () => ({ value: '' }));
    on('fs.write', (_, e) => {
        if (e.path === STATE || e.path === `${STATE}.tmp`)
            snapshots.push(JSON.parse(e.text));
        return { value: undefined };
    });
    on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }));
    on('process.spawn', async function* () {
        yield { stream: 'stdout', text: 'AGENT_HQ_URL http://127.0.0.1:4321\n' };
        await new Promise(resolve => (release = resolve));
        return { value: { code: 0, signal: null } };
    });
    on('agent.list', () => ({ value: [...listed] }));
    on('tool.check', () => ({ decision, reason: 'needs a look' }));
    on('tool.call', () => ({ result: {} }));
    on('ui.status', (_, e) => {
        statuses.push(e.text);
        return { value: undefined };
    });
    on('ui.toast', (_, e) => {
        toasts.push(e.text);
        return { value: undefined };
    });
    for (const event of ['ui.open', 'ui.log', 'command.register'])
        on(event, () => ({ value: undefined }));
    on('config.list', () => ({ value: [] }));
    on('session.start', (_, e) => e);
    await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true });
    await $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} });
    await clock.settle();
    return { statuses, snapshots, toasts, clock, listed, ask: (v) => void (decision = v), finish: () => release() };
}
const info = (id, status = 'running') => ({ id, name: id, type: 'general-purpose', description: 'x', status });
const last = (list) => list[list.length - 1];
test('an agent held on an approval is in the inbox and the status line counts it', async ($, on) => {
    const s = await boot($, on, [info('a1'), info('a2', 'waiting'), info('a3')]);
    await s.clock.advance(1000);
    expect(last(s.snapshots)?.inbox).toEqual([{ agent: 'a2', since: expect.any(Number), what: expect.stringContaining('waiting') }]);
    expect(last(s.statuses)).toBe('🪐 2 working · 1 needs you');
    s.listed.splice(1, 1, info('a2', 'running'));
    await s.clock.advance(1000);
    expect(last(s.snapshots)?.inbox).toEqual([]);
    expect(last(s.statuses)).toBe('🪐 3 working');
    s.finish();
});
test('the status line is cleared when nothing is left to show', async ($, on) => {
    const s = await boot($, on, []);
    await s.clock.advance(1000);
    expect(last(s.statuses)).toBeUndefined();
    s.finish();
});
test('a permission ask waits in the inbox until the tool call is decided, then leaves it', async ($, on) => {
    const s = await boot($, on, [info('a1')]);
    const call = $.tool.call;
    // the engine asks first (tool.check), and the call that raised it ends once the person has answered
    const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'u1', agentId: 'a1' });
    await s.clock.advance(1000);
    expect(verdict.decision).toBe('ask');
    expect(last(s.snapshots)?.inbox).toEqual([{ agent: 'a1', since: expect.any(Number), what: 'Bash: rm' }]);
    expect(last(s.statuses)).toContain('1 needs you');
    await call({ tool: 'Bash', command: 'rm -rf build', agentId: 'a1', tool_use_id: 'u1' });
    await s.clock.advance(1000);
    expect(last(s.snapshots)?.inbox).toEqual([]);
    expect(last(s.statuses)).not.toContain('needs you');
    s.finish();
});
test('a query that is not a real call (no tool_use_id) and an ask of the lead are handled', async ($, on) => {
    const s = await boot($, on, [info('a1')]);
    await $.tool.check({ tool: 'Bash', input: { command: 'ls' } }); // a $.tool.check query
    await $.tool.check({ tool: 'Edit', input: { file_path: 'a.ts' }, tool_use_id: 'u7' }); // the lead's own ask
    await s.clock.advance(1000);
    expect(last(s.snapshots)?.inbox).toEqual([{ agent: 'main', since: expect.any(Number), what: 'Edit: a.ts' }]);
    s.finish();
});
test('a call the engine allows outright never reaches the inbox', async ($, on) => {
    const s = await boot($, on, [info('a1')]);
    s.ask('allow');
    await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, tool_use_id: 'u2', agentId: 'a1' });
    await s.clock.advance(1000);
    expect(last(s.snapshots)?.inbox).toEqual([]);
    s.finish();
});
