// Bookkeeping after an agent started never turns the start into an error for the Agent tool.
import { expect, mock, test } from 'claude-code/testing';
test('a failing roster sync after agent.spawn still returns the spawn result, and says so in the debug log', async ($, on) => {
    const logs = [];
    mock.clock(on);
    mock.store(on, {});
    on('env.get', () => ({ value: '/home/me' }));
    on('session.cwd', () => ({ value: '/work/app' }));
    on('fs.exists', () => ({ value: false }));
    on('fs.read', () => ({ value: '' }));
    on('ui.toast', () => ({ value: undefined }));
    on('ui.log', (_, e) => {
        logs.push(e.text);
        return { value: undefined };
    });
    on('command.register', () => ({ value: undefined }));
    on('config.list', () => ({ value: [] }));
    on('session.start', (_, e) => e);
    on('agent.list', () => {
        throw new Error('roster unavailable');
    });
    on('agent.spawn', () => ({ model: 'sonnet', agentId: 'm1' }));
    await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true });
    const result = await $.agent.spawn({ prompt: 'go', description: 'x' });
    expect(result).toMatchObject({ model: 'sonnet', agentId: 'm1' });
    expect(logs.some(text => text.includes('could not note a started agent'))).toBe(true);
});
