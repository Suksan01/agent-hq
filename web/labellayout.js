// What the space view's card layout shares, with no DOM and no imports so `node --test` can check it: rectangle tests on the screen, where a
// card of a given size stands from an anchor, and which kinds of card an agent would take. Where each card goes is slots.js.

export const hit = (a, b, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m
export const inside = (r, b) => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
/** Does a rectangle touch a disc ({x, y, r})? */
export const hitDisc = (r, d) => Math.hypot(clamp(d.x, r.x, r.x + r.w) - d.x, clamp(d.y, r.y, r.y + r.h) - d.y) < d.r

/** The rectangle of a card of `w` by `h` placed from the anchor (ax, ay) at `dist` in direction `dir`: its nearest corner or edge is `dist` from the anchor. */
export function cardRect(ax, ay, w, h, dist, dir) {
  const [dx, dy] = dir
  const x = dx > 0.1 ? ax + dist * dx : dx < -0.1 ? ax + dist * dx - w : ax - w / 2
  const y = dy > 0.1 ? ay + dist * dy : dy < -0.1 ? ay + dist * dy - h : ay - h / 2
  return { x, y, w, h }
}

const KINDS = { lead: ['lead', 'chip'], full: ['full', 'compact', 'chip'], compact: ['compact', 'chip'], chip: ['chip'] }

/**
 * The kinds of card an agent would take, best first: the lead its own deck (or a chip), a working agent or one that needs the person the
 * full card, the rest the compact one; on a narrow screen everyone starts compact; with a system too small on screen only a chip.
 */
export function variantsFor({ isLead = false, state = 'idle', needsYou = false } = {}, { chipOnly = false, narrow = false } = {}) {
  if (chipOnly) return KINDS.chip
  if (isLead) return KINDS.lead
  return (state === 'working' || state === 'waiting' || needsYou) && !narrow ? KINDS.full : KINDS.compact
}

/** Is a system (its radius in pixels) tiny on screen, under about a twelfth of the short side across? Then its agents are chips. */
export const isChipOnly = (systemRadius, width, height) => systemRadius < 0.04 * Math.min(width, height)
