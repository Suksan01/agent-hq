// Terminal drawing adapted from the plan-progress mod (MIT, see THIRD_PARTY_NOTICES.md): a Raster track of twinkling braille dots with a coloured
// pill at its head. Cells are packed per RasterProps: [char, fg, bg] as uint32s.
// the space theme's status glows on a dark terminal: working electric blue, needs you amber, failed coral, done mint
export const TONE_COLOR = { running: '#3D7BFF', needs_input: '#FFB547', error: '#FF5A5F', done: '#3DF2B0' };
// on a light terminal the glows would wash out: one deeper lightness for every state, white on each reads at 4.5:1
export const TONE_COLOR_LIGHT = { running: '#3A5BD9', needs_input: '#AD6400', error: '#C5353E', done: '#18883A' };
export const tonesFor = (isLight) => (isLight ? TONE_COLOR_LIGHT : TONE_COLOR);
// the lead's mark (✦) and colour: violet-white
export const LEAD_COLOR = '#B9A6FF';
const INK = [5, 5, 7]; // text on a bright pill
export const TONE_GLYPH = { running: '●', needs_input: '?', error: '!', done: '✓' };
const DEFAULT = 0x01000000;
const BRAILLE_BITS = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
];
// the terminal background the track's tint is mixed against
const SCHEMES = { dark: { bg: [24, 24, 27] }, light: { bg: [255, 255, 255] } };
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, m) => a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * m));
const pack = (c) => ((c[0] ?? 0) << 16) | ((c[1] ?? 0) << 8) | (c[2] ?? 0);
const hash = (a, b, k) => {
    const x = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453;
    return x - Math.floor(x);
};
const wave = (t, periodMs, offset = 0) => 0.5 + 0.5 * Math.sin((t / periodMs + offset) * Math.PI * 2);
const q = (m) => Math.round(Math.max(0, Math.min(1, m)) * 8) / 8;
// A Raster cell must be exactly one column wide or the engine refuses the whole tree.
// shortcut: anything outside ASCII, Latin and the glyphs drawn here becomes '·' (CJK/emoji names show as dots); port plan-progress's width table if that matters.
// The half block the sprites draw with was checked against plan-progress's width table (the engine's own measure): one column.
const SAFE_GLYPHS = new Set([...'●↳…✓✕·│?!▀✦']);
const cellChar = (ch) => {
    const cp = ch.codePointAt(0) ?? 63;
    const isPlain = (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0x2ff) || (cp >= 0x2800 && cp <= 0x28ff);
    return isPlain || SAFE_GLYPHS.has(ch) ? ch : '·';
};
export const cellText = (s) => [...s].map(cellChar).join('');
export const fit = (s, w) => {
    const chars = [...cellText(s)];
    if (chars.length <= w)
        return chars.join('');
    return w <= 1 ? '…'.slice(0, Math.max(0, w)) : chars.slice(0, w - 1).join('').trimEnd() + '…';
};
class Grid {
    columns;
    rows;
    cells;
    constructor(columns, rows) {
        this.columns = columns;
        this.rows = rows;
        this.cells = Array.from({ length: columns * rows }, () => [32, DEFAULT, DEFAULT]);
    }
    set(x, y, ch, fg, bg) {
        if (x < 0 || x >= this.columns || y < 0 || y >= this.rows)
            return;
        this.cells[y * this.columns + x] = [typeof ch === 'number' ? ch : (ch.codePointAt(0) ?? 32), fg, bg];
    }
    fill(y, from, to, bg) {
        for (let x = from; x < to; x++)
            this.set(x, y, ' ', DEFAULT, bg);
    }
    text(x, y, s, fg, bg) {
        let i = 0;
        for (const ch of cellText(s))
            this.set(x + i++, y, ch, fg, bg);
        return i;
    }
    encode() {
        const words = new Uint32Array(this.cells.length * 3);
        this.cells.forEach((c, i) => words.set(c, i * 3));
        return new Uint8Array(words.buffer).toBase64();
    }
}
/** One-row progress track: a dim dotted rail; the finished share glows in the status hue, brighter towards its head, its
 * dots twinkling while `t` moves; the count rides the head as a pill. `base` is the background under the track (a panel's
 * colour), the terminal's when left out. */
export function trackCells(spec, W, t, isLight, base) {
    const g = new Grid(W, 1);
    const bgColor = base ? hex(base) : SCHEMES[isLight ? 'light' : 'dark'].bg;
    const isDone = spec.tone === 'done';
    const fx = (isDone ? 1 : Math.min(1, spec.done / Math.max(1, spec.total))) * W;
    const acc = hex(tonesFor(isLight)[spec.tone]);
    const glow = mix(acc, isLight ? [0, 0, 0] : [255, 255, 255], isLight ? 0.25 : 0.5);
    const rail = mix(bgColor, isLight ? [0, 0, 0] : [255, 255, 255], 0.2);
    for (let x = 0; x < W; x++)
        g.set(x, 0, '⠒', pack(rail), pack(bgColor)); // the dotted rail
    const TWINKLE = [2200, 2800, 1900, 3300];
    if (spec.sweep) {
        // no share known: a glow drifts along the rail
        const head = ((t / 2400) % 1) * (W + 12) - 6;
        for (let col = 0; col < W; col++) {
            const near = Math.max(0, 1 - Math.abs(col - head) / 6);
            if (near === 0)
                continue;
            let bits = 0;
            for (let r = 0; r < 4; r++)
                for (let c = 0; c < 2; c++)
                    if (hash(col * 2 + c, r, 1) <= 0.1 + 0.5 * near)
                        bits |= BRAILLE_BITS[r]?.[c] ?? 0;
            g.set(col, 0, bits ? 0x2800 + bits : ' ', pack(mix(rail, glow, q(near))), pack(mix(bgColor, acc, q(0.22 * near))));
        }
    }
    for (let col = 0; col < Math.min(W, Math.ceil(fx)); col++) {
        const u = Math.min(1, (col + 0.5) / Math.max(1, fx)); // brighter towards the head, a glow pushed along
        const fill = mix(bgColor, acc, q(isDone ? 0.4 : 0.2 + 0.36 * u));
        let bits = 0;
        for (let r = 0; r < 4; r++)
            for (let c = 0; c < 2; c++)
                if (hash(col * 2 + c, r, 1) <= 0.25 + 0.4 * u)
                    bits |= BRAILLE_BITS[r]?.[c] ?? 0;
        const cls = Math.floor(hash(col, 0, 2) * 4);
        const blink = 1 - (isDone ? 0.15 : 0.45) * wave(t + cls * 600, TWINKLE[cls] ?? 2200, 0.25);
        g.set(col, 0, bits ? 0x2800 + bits : ' ', pack(mix(fill, glow, q((0.5 + 0.5 * u) * blink))), pack(fill));
    }
    const icon = spec.tone === 'running' ? '' : `${TONE_GLYPH[spec.tone]} `;
    const name = fit(spec.label, Math.max(3, Math.floor(W * (W < 60 ? 0.7 : 0.5)) - icon.length - spec.count.length - 4));
    const shown = icon + name;
    if (!shown && !spec.count)
        return g.encode();
    const gap = shown && spec.count ? 1 : 0;
    const kw = [...shown].length + gap + spec.count.length + 2;
    const kx = Math.round(Math.max(0, Math.min(W - kw, (spec.sweep ? 0 : fx) - kw / 2)));
    const ink = pack(isLight ? [255, 255, 255] : INK);
    g.fill(0, kx, kx + kw, pack(acc));
    const at = kx + 1 + g.text(kx + 1, 0, shown, ink, pack(acc));
    if (spec.count)
        g.text(at + gap, 0, spec.count, ink, pack(acc));
    return g.encode();
}
// ---------- sprites: two pixels per cell, the upper as the half block's ink, the lower as its background ----------
/** A sprite frame (rows of palette letters) as Raster cells, over the panel's background; clear pixels show it. */
export function spriteCells(frame, palette, base) {
    const width = Math.max(...frame.map(row => row.length));
    const rows = Math.ceil(frame.length / 2);
    const g = new Grid(width, rows);
    const bg = hex(base);
    const colorOf = (ch) => {
        if (!ch || ch === '.')
            return bg;
        const value = palette[ch] ?? '#ff00ff';
        // a see-through colour (a halo, a shadow) is mixed over the panel
        const see = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
        return see ? mix(bg, [Number(see[1]), Number(see[2]), Number(see[3])], Number(see[4])) : hex(value);
    };
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < width; x++) {
            g.set(x, y, '▀', pack(colorOf(frame[y * 2]?.[x])), pack(colorOf(frame[y * 2 + 1]?.[x])));
        }
    }
    return g.encode();
}
