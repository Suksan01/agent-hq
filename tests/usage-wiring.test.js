// Tokens and working time per agent, from the engine's turn.complete, in the live snapshot.
import { expect, mock, test } from 'claude-code/testing';
const STATE = '/home/me/.claude/agent-hq/live/sess.json';
const agent = { id: 'a1', name: 'frontend-dev-1', type: 'general-purpose', description: 'x', status: 'running' };
const usage = (input, output) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, model: 'claude-sonnet-5-5' });
test('each agent\'s turns add up in the snapshot: turns, working time, tokens; an agent that never finished a turn has none', async ($, on) => {
    const snapshots = [];
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
        await new Promise(() => { });
        return { value: { code: 0, signal: null } };
    });
    on('agent.list', () => ({ value: [agent, { ...agent, id: 'a2', name: 'qa-1' }] }));
    on('turn.complete', (_, e) => ({ text: e.answer }));
    for (const event of ['ui.status', 'ui.open', 'ui.log', 'ui.toast', 'command.register'])
        on(event, () => ({ value: undefined }));
    on('config.list', () => ({ value: [] }));
    on('session.start', (_, e) => e);
    await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true });
    await $.command.run({ command: 'hq', args: 'web', origin: { kind: 'composer' }, presentation: {} });
    await clock.settle();
    const turn = (agentId, durationMs, tokens) => $.turn.complete({ answer: 'ok', durationMs, isAborted: false, turnId: `t${durationMs}`, reason: 'answer', ...(agentId ? { agentId } : {}), ...(tokens ? { usage: tokens } : {}) });
    await turn('a1', 1500, usage(100, 40));
    await turn('a1', 500, usage(20, 10));
    await turn(undefined, 700, usage(1, 2));
    await clock.advance(1000);
    const rows = Object.fromEntries((snapshots.at(-1)?.agents ?? []).map(a => [a.id, a.usage]));
    expect(rows.a1).toEqual({ turns: 2, workMs: 2000, inputTokens: 120, outputTokens: 50, cachedTokens: 30, model: 'claude-sonnet-5-5' });
    expect(rows.main).toEqual({ turns: 1, workMs: 700, inputTokens: 1, outputTokens: 2, cachedTokens: 15, model: 'claude-sonnet-5-5' });
    expect(rows.a2).toBeNull();
});
