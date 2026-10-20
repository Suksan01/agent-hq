// "Working" is running or about to run: agents idle between turns or held (waiting) are not, so the status line does not
// over-report and the animation timer stops when nobody works.
import { expect, test } from 'claude-code/testing';
import { MAIN, isWorking, mergeAgents, who, workingCount } from '../hooks/model';
const info = (id, status) => ({ id, name: `agent-${id}`, type: 'general-purpose', description: 'x', status });
test('only running and pending agents work; idle, waiting and ended ones do not', () => {
    for (const status of ['running', 'pending'])
        expect(isWorking(status)).toBe(true);
    for (const status of ['idle', 'waiting', 'completed', 'failed', 'killed'])
        expect(isWorking(status)).toBe(false);
});
test('workingCount counts three idle agents as none, and never the lead', () => {
    const idle = mergeAgents({}, [info('a', 'idle'), info('b', 'idle'), info('c', 'idle')], 0);
    expect(workingCount(idle)).toBe(0);
    const mixed = mergeAgents({}, [info('a', 'running'), info('b', 'pending'), info('c', 'waiting'), info('d', 'idle'), info('e', 'completed')], 0);
    expect(workingCount(mixed)).toBe(2);
    expect(mixed[MAIN]?.status).toBe('running');
});
test('who names an agent by its nickname and its name, or by its name alone', () => {
    expect(who({ name: 'frontend-dev-1', nickname: 'Mochi-chan' })).toBe('Mochi-chan (frontend-dev-1)');
    expect(who({ name: 'frontend-dev-1' })).toBe('frontend-dev-1');
    expect(who({ name: 'Mochi', nickname: 'Mochi' })).toBe('Mochi');
});
