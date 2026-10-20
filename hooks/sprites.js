// Mascots after the Bot Avatars library (libraries.dev/bots, MIT): each agent is one of its plush shapes. The browser
// page draws the real <BotAvatar>; the terminal draws a 12×10 pixel sprite of the same shape and colour, two pixels
// per cell with half blocks, in the same states: hopping while it works, looking up while it waits, asleep when done.
// In the sidebar the lead keeps the 12×10 crowned star and members are drawn smaller, as an 8×6 version of their shape.
export const SPRITE_W = 12;
export const SPRITE_H = 10;
// members' size in the sidebar: 8×6 pixels, three rows of half blocks
export const SMALL_W = 8;
export const SMALL_H = 6;
export const LETTERS = '.olbEkasrdz';
/** The main session, the team's lead: the library's star, crowned. */
export const LEAD = {
    type: 'star',
    color: '#EFDB8E',
    hat: 'crown',
    art: ['...a.aa.a...', '...aaaaaa...', '...oooooo...', '..obbbbbbo..', '.obbbbbbbbo.', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '...ssssss...'],
    small: ['.a.aa.a.', '.aaaaaa.', 'obEbbEbo', 'obbbbbbo', '.oooooo.', '..ssss..'],
};
/** Members get these in turn (see pickMascot): eight shapes of distinct hue. */
export const SPECIES = [
    {
        type: 'clover',
        color: '#41C4FF',
        art: ['............', '..ooo..ooo..', '.obbbooobbo.', '.obbbbbbbbo.', '..obEbbEbo..', '..obbbbbbo..', '.obbbbbbbbo.', '.obbo..obbo.', '..oo....oo..', '...ssssss...'],
        small: ['.oo..oo.', 'obboobbo', 'obEbbEbo', 'obbbbbbo', '.oo..oo.', '..ssss..'],
    },
    {
        type: 'cat',
        color: '#EAA06F',
        art: ['............', '..o......o..', '.obo....obo.', '.obboooobbo.', '.obbbbbbbbo.', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '...ssssss...'],
        small: ['o......o', 'oboooobo', 'obEbbEbo', 'obbbbbbo', '.oooooo.', '..ssss..'],
    },
    {
        type: 'flower',
        color: '#2FCB7A',
        art: ['............', '...oo..oo...', '..obboobbo..', '.obbbbbbbbo.', 'obbbEbbEbbbo', '.obbbbbbbbo.', '..obboobbo..', '...oo..oo...', '............', '...ssssss...'],
        small: ['.o.oo.o.', 'obobbobo', 'obEbbEbo', 'obbbbbbo', '.o.oo.o.', '..ssss..'],
    },
    {
        type: 'triangle',
        color: '#DC48FF',
        art: ['............', '.....oo.....', '....obbo....', '...obbbbo...', '..obEbbEbo..', '..obbbbbbo..', '.obbbbbbbbo.', '.oooooooooo.', '............', '...ssssss...'],
        small: ['...oo...', '..obbo..', '.oEbbEo.', 'obbbbbbo', 'oooooooo', '..ssss..'],
    },
    {
        type: 'drop',
        color: '#1ED3C6',
        art: ['............', '.....oo.....', '....obbo....', '...obbbbo...', '..obbbbbbo..', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '...ssssss...'],
        small: ['...oo...', '..obbo..', '.obbbbo.', 'obEbbEbo', '.obbbbo.', '..oooo..'],
    },
    {
        type: 'circle',
        color: '#9A62FF',
        art: ['............', '............', '....oooo....', '..oobbbboo..', '.obbbbbbbbo.', '.obbEbbEbbo.', '.obbbbbbbbo.', '..oobbbboo..', '....oooo....', '...ssssss...'],
        small: ['..oooo..', '.obbbbo.', 'obEbbEbo', 'obbbbbbo', '.obbbbo.', '..oooo..'],
    },
    {
        type: 'hexagon',
        color: '#EB7575',
        art: ['............', '...oooooo...', '..obbbbbbo..', '.obbbbbbbbo.', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '............', '...ssssss...'],
        small: ['.oooooo.', 'obbbbbbo', 'obEbbEbo', 'obbbbbbo', '.oooooo.', '..ssss..'],
    },
    {
        type: 'alien',
        color: '#9CD66A',
        art: ['.o........o.', '..o......o..', '...oooooo...', '..obbbbbbo..', '.obbEbbEbbo.', '.obbbbbbbbo.', '..obbbbbbo..', '...oooooo...', '....o..o....', '...ssssss...'],
        small: ['o......o', '.oooooo.', 'obEbbEbo', 'obbbbbbo', '.oooooo.', '..o..o..'],
    },
];
// past eight agents the shapes come round again, each round in a new set of hues, so no two agents share a colour
const ROUNDS = [
    ['#FFB020', '#5B8CFF', '#FF5FA2', '#14C8A0', '#B66DFF', '#FF7A45', '#2EC4FF', '#C6E04A'],
    ['#E8C547', '#7B61FF', '#FF8DC7', '#3DDC97', '#F25F5C', '#4ECDC4', '#9D8DF1', '#FFA62B'],
];
export const MASCOT_COUNT = SPECIES.length * (ROUNDS.length + 1);
export function speciesOf(mascot) {
    if (mascot === undefined)
        return LEAD;
    const shape = SPECIES[mascot % SPECIES.length] ?? LEAD;
    const round = Math.floor(mascot / SPECIES.length) % (ROUNDS.length + 1);
    return round === 0 ? shape : { ...shape, color: ROUNDS[round - 1]?.[mascot % SPECIES.length] ?? shape.color };
}
// ---------- colours ----------
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, m) => toHex(hex(a).map((v, i) => v + ((hex(b)[i] ?? 0) - v) * m));
const grey = (h) => {
    const [r = 0, g = 0, b = 0] = hex(h);
    const y = 0.3 * r + 0.59 * g + 0.11 * b;
    return toHex([y, y, y].map(v => v * 0.75));
};
/** The species' colours; a failed agent is drawn in greys. */
export function paletteOf(s, tone) {
    const body = tone === 'error' ? grey(s.color) : s.color;
    return {
        o: mix(body, '#000000', 0.55),
        b: body,
        l: mix(body, '#ffffff', 0.55),
        E: '#17171f',
        k: '#1d2433',
        a: s.hat === 'crown' ? '#ffcf3f' : '#ff5d5d',
        s: 'rgba(0,0,0,0.35)',
        r: '#ff5d5d',
        d: '#7fc8f8',
        z: '#aab4ff',
    };
}
// the library's states: working hops with a glance now and then; default (waiting) looks round and up;
// sleeping (done) breathes with shut eyes and drifting z's; failed slumps grey with x-eyes
const POSES = {
    running: [
        { eyes: 'open' },
        { eyes: 'open', hop: true },
        { eyes: 'right', hop: true },
        { eyes: 'open' },
        { eyes: 'left' },
        { eyes: 'open', hop: true },
        { eyes: 'blink', hop: true },
        { eyes: 'open' },
    ],
    // idle, waiting and done bots hold still: one frame each
    needs_input: [{ eyes: 'up' }],
    done: [{ eyes: 'shut', z: 2 }],
    error: [{ eyes: 'x', sweat: true }],
};
/** One frame of a species in a pose: rows of palette letters, 10 of 12 (or 6 of 8 for the small one). */
export function renderPose(s, pose, small = false) {
    const art = small ? s.small : s.art;
    const width = small ? SMALL_W : SPRITE_W;
    const height = small ? SMALL_H : SPRITE_H;
    const grid = art.map(row => [...row]);
    const at = (x, y) => grid[y]?.[x];
    const put = (x, y, ch) => {
        const line = grid[y];
        if (line && x >= 0 && x < width)
            line[x] = ch;
    };
    // a sheen on the upper left of the body, the plush highlight the library lights from that side
    const top = grid.findIndex(row => row.includes('b'));
    if (top >= 0) {
        const x = grid[top + 1]?.indexOf('b') ?? -1;
        if (x >= 0)
            put(x, top + 1, 'l');
    }
    // eyes
    const eyes = [];
    grid.forEach((row, y) => row.forEach((ch, x) => ch === 'E' && eyes.push([x, y])));
    const fill = (x, y) => (art[y]?.[x] === 'E' ? 'b' : (art[y]?.[x] ?? '.'));
    for (const [x, y] of eyes) {
        if (pose.eyes === 'open')
            continue;
        put(x, y, fill(x, y));
        if (pose.eyes === 'blink' || pose.eyes === 'shut')
            put(x, y, 'o');
        else if (pose.eyes === 'x')
            put(x, y, 'r');
        else {
            const [nx, ny] = pose.eyes === 'left' ? [x - 1, y] : pose.eyes === 'right' ? [x + 1, y] : [x, y - 1];
            // look only where the face is: into body or visor, never over the outline
            put(at(nx, ny) === 'b' || at(nx, ny) === 'k' ? nx : x, at(nx, ny) === 'b' || at(nx, ny) === 'k' ? ny : y, 'E');
        }
    }
    // a hop lifts everything but the shadow by one pixel, where the top row is free; the shadow tightens
    if (pose.hop && grid[0]?.every(ch => ch === '.')) {
        const shadow = grid[height - 1] ?? [];
        const lifted = [...grid.slice(1, height - 1), [...'.'.repeat(width)], shadow.map((ch, x) => (ch === 's' && x > 3 && x < width - 4 ? 's' : '.'))];
        grid.splice(0, height, ...lifted);
    }
    if (pose.z === 1)
        put(width - 2, 1, 'z');
    if (pose.z === 2)
        (put(width - 2, 1, 'z'), put(width - 1, 0, 'z'));
    if (pose.sweat)
        put(width - 2, 2, 'd');
    return grid.map(line => line.join(''));
}
/** Every frame of a species' animation for a status; the terminal and the page step through them on one beat.
 *  `small` draws the 8×6 member version (the sidebar), else the 12×10 one. */
export const spriteFrames = (s, tone, small = false) => POSES[tone].map(pose => renderPose(s, pose, small));
/** The Bot Avatars `state` for a status: working hops, done sleeps, waiting and failed stand looking round. */
export const botState = (tone) => (tone === 'running' ? 'working' : tone === 'done' ? 'sleeping' : 'default');
