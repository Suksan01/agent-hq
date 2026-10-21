// What the approval card does to the input before it shows it: every character a person cannot see, or that changes how the
// text around it reads (controls, bidi overrides and isolates, zero-width and other format characters, separators, tags,
// variation selectors), becomes a visible ⟦U+XXXX⟧. Pure, so `node --test` checks it. Real text (Thai vowels and tone marks,
// emoji) is left alone; JSON has already escaped C0 controls, newlines and tabs.

const HIDDEN = /[\u{0}-\u{8}\u{B}-\u{C}\u{E}-\u{1F}\u{7F}-\u{9F}\u{AD}\u{34F}\u{61C}\u{115F}-\u{1160}\u{17B4}-\u{17B5}\u{180B}-\u{180F}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2028}-\u{2029}\u{2060}-\u{206F}\u{3164}\u{FE00}-\u{FE0F}\u{FEFF}\u{FFA0}\u{FFF0}-\u{FFFB}\u{E0000}-\u{E0FFF}]|\p{Cf}/gu

/** `text` with each hidden character shown as ⟦U+XXXX⟧. */
export const visibleText = text => text.replace(HIDDEN, ch => `⟦U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`)
