// Terminal sounds: which sound an agent's status change plays (tests/sounds.test.ts is the spec), what one poll plays,
// and the bundled clip each sound is. Playing is best-effort: no player, no sound, never an error.
import { MAIN, isFinished } from './model';
/** `prev` is null the first time an agent is seen. */
export function soundFor(prev, next, opts) {
    if (opts.muted)
        return null;
    if (opts.levelUp)
        return 'levelup';
    if (prev === null)
        return next === 'pending' || next === 'running' ? 'start' : null;
    if (prev === next || isFinished(prev))
        return null; // nothing changed, or a finished agent moved again
    if (next === 'completed')
        return 'done';
    if (next === 'failed')
        return 'failed';
    if ((next === 'waiting' || next === 'idle') && (prev === 'running' || prev === 'pending'))
        return 'needs_you';
    return null; // resumed, or stopped by the person
}
// one clip per poll: the thing that most needs the person wins, since clips are not queued but play over each other
const PRIORITY = ['failed', 'needs_you', 'levelup', 'done', 'start'];
export const pickSound = (sounds) => PRIORITY.find(s => sounds.includes(s)) ?? null;
/** What one poll plays for every agent whose status changed (the lead is silent). */
export function soundsForChanges(before, after, opts) {
    const heard = Object.entries(after)
        .filter(([id]) => id !== MAIN)
        .map(([id, agent]) => soundFor(before[id]?.status ?? null, agent.status, opts))
        .filter((s) => s !== null);
    return pickSound(heard);
}
/** The clip each sound plays, relative to the plugin folder. */
export const SOUND_ASSET = {
    done: 'assets/done.wav',
    needs_you: 'assets/needs-you.wav',
    failed: 'assets/failed.wav',
    levelup: 'assets/levelup.wav',
    start: 'assets/start.wav',
};
/** Plays a sound's clip; a session with no player or a clip that cannot play is no reason to fail anything. */
export async function playSound($, sound) {
    const asset = sound ? SOUND_ASSET[sound] : null;
    if (!asset)
        return;
    try {
        await $.audio.play({ asset });
    }
    catch {
        // best effort
    }
}
