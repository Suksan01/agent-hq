// Terminal sounds in a session: what one poll's status changes play, the bundled files, and the `sounds` option.
import { expect, mock, test } from 'claude-code/testing';
import { SOUND_ASSET, pickSound, soundsForChanges } from '../hooks/sounds';
const LIVE = { muted: false };
const row = (status) => ({ status });
test('one poll plays the most important thing that happened: failed, then needs you, then done', () => {
    expect(pickSound(['done', 'failed', 'needs_you'])).toBe('failed');
    expect(pickSound(['done', 'needs_you'])).toBe('needs_you');
    expect(pickSound(['done', 'done'])).toBe('done');
    expect(pickSound(['done', 'levelup'])).toBe('levelup');
    expect(pickSound([])).toBeNull();
});
test('status changes across agents become at most one sound; the lead and unchanged agents are silent', () => {
    const before = { main: row('running'), a: row('running'), b: row('running'), c: row('completed') };
    const after = { main: row('completed'), a: row('completed'), b: row('running'), c: row('completed') };
    expect(soundsForChanges(before, after, LIVE)).toBe('done');
    expect(soundsForChanges(before, { ...after, b: row('failed') }, LIVE)).toBe('failed');
    expect(soundsForChanges(before, before, LIVE)).toBeNull();
    expect(soundsForChanges({ main: row('running') }, { main: row('completed') }, LIVE)).toBeNull();
    expect(soundsForChanges(before, after, { muted: true })).toBeNull();
});
test('an agent first seen already finished is silent, and one first seen working only starts', () => {
    expect(soundsForChanges({}, { a: row('completed') }, LIVE)).toBeNull();
    expect(soundsForChanges({}, { a: row('running') }, LIVE)).toBe('start');
});
test('each sound has a short WAV in assets/', () => {
    expect(SOUND_ASSET).toEqual({ done: 'assets/done.wav', needs_you: 'assets/needs-you.wav', failed: 'assets/failed.wav', levelup: 'assets/levelup.wav', start: 'assets/start.wav' });
});
const agent = (id, status) => ({ id, name: id, type: 'general-purpose', description: id, status });
/** A session whose agent list the test controls; every clip the plugin plays is recorded. */
async function session($, on, playFails = false) {
    const clock = mock.clock(on);
    const listed = [];
    const played = [];
    const toasts = [];
    const stored = {};
    on('env.get', () => ({ value: '/home/me' }));
    on('session.cwd', () => ({ value: '/work/app' }));
    on('session.id', () => ({ value: 'sess' }));
    on('fs.exists', () => ({ value: false }));
    on('fs.read', () => ({ value: '' }));
    on('fs.write', () => ({ value: undefined }));
    on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }));
    on('agent.list', () => ({ value: [...listed] }));
    on('ui.toast', (_, e) => {
        toasts.push(e.text);
        return { value: undefined };
    });
    on('store.get', (_, e) => ({ value: stored[e.key] }));
    on('store.set', (_, e) => {
        stored[e.key] = JSON.parse(JSON.stringify(e.value));
        return { value: undefined };
    });
    on('tool.call', () => ({ result: {} }));
    on('ui.status', () => ({ value: undefined }));
    on('command.register', () => ({ value: undefined }));
    on('config.list', () => ({ value: [] }));
    on('session.start', (_, e) => e);
    on('audio.play', (_, e) => {
        played.push(e.clip ?? e);
        if (playFails)
            throw new Error('no player');
        return { value: undefined };
    });
    await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true });
    return {
        played,
        toasts,
        stored,
        set: async (...agents) => {
            listed.splice(0, listed.length, ...agents);
            await clock.advance(1000);
        },
    };
}
const clips = (played) => played.map(p => JSON.stringify(p));
const names = (played) => clips(played).map(c => /assets\/([a-z-]+)\.wav/.exec(c)?.[1]);
test('an agent that finishes plays the done clip once, and the next poll with no change plays nothing', async ($, on) => {
    const s = await session($, on);
    await s.set(agent('a1', 'running'));
    await s.set(agent('a1', 'completed'));
    await s.set(agent('a1', 'completed'));
    expect(names(s.played)).toEqual(['start', 'done']); // the chirp when it appeared, one done when it finished, then quiet
});
test('needs you and failed play their own clips', async ($, on) => {
    const s = await session($, on);
    await s.set(agent('a1', 'running'), agent('a2', 'running'));
    await s.set(agent('a1', 'waiting'), agent('a2', 'running'));
    await s.set(agent('a1', 'waiting'), agent('a2', 'failed'));
    expect(names(s.played)).toEqual(['start', 'needs-you', 'failed']);
});
test('with the sounds option off nothing plays', { options: { sounds: false } }, async ($, on) => {
    const s = await session($, on);
    await s.set(agent('a1', 'running'));
    await s.set(agent('a1', 'completed'));
    expect(s.played).toEqual([]);
});
test('a player that fails never breaks the poll', async ($, on) => {
    const s = await session($, on, true);
    await s.set(agent('a1', 'running'));
    await s.set(agent('a1', 'completed'));
    await s.set(agent('a1', 'completed'));
    expect(names(s.played)).toEqual(['start', 'done']); // each tried once, never retried every poll
});
test('a level up plays the levelup clip and is toasted, and the XP is kept in the store under the nickname', async ($, on) => {
    const s = await session($, on);
    const reviewer = { ...agent('r1', 'running'), type: 'agent-hq:reviewer' };
    await s.set(reviewer);
    for (let i = 0; i < 12; i++)
        await $.tool.call({ tool: 'Read', file_path: 'a.ts', agentId: 'r1' }); // untyped: the typed union is too deep for tsc
    await s.set({ ...reviewer, status: 'completed' });
    expect(names(s.played)).toEqual(['start', 'levelup']); // 12 tools + review 15 + done 25 = 52 xp: level 2
    expect(s.toasts.some(t => /reached level 2/.test(t))).toBe(true);
    const keys = Object.keys(s.stored).filter(k => k.startsWith('xp:'));
    expect(keys).toHaveLength(1);
    expect(s.stored[keys[0]].xp).toBe(52);
});
