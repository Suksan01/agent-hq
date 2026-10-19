// Nicknames: every agent gets its own, picked once when it is first seen (like its bot), so the team reads as a cast of
// characters. The pools are the nickname themes (themes.ts); by default members are futuristic worlds and the lead a star.
import { DEFAULT_THEME, THEMES, type NameTheme } from './themes'

/** The default theme's member names: agents take these in turn (see pickNickname). */
export const NICKNAMES: readonly string[] = THEMES[DEFAULT_THEME].members

/** The default theme's lead names. */
export const LEAD_NICKNAMES: readonly string[] = THEMES[DEFAULT_THEME].leads

const ROMAN = ['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
const generation = (n: number) => ROMAN[n] ?? String(n)

/**
 * A nickname no name in `taken` has, starting from one the id hashes to, so the same agent gets the same one every time.
 * Once a pool is used up, the names come round again as "Kepler-7b II", "Kepler-7b III" and so on.
 */
export function pickNickname(id: string, taken: ReadonlySet<string>, isLead = false, theme: NameTheme = THEMES[DEFAULT_THEME]): string {
  const pool = isLead ? theme.leads : theme.members
  let start = 0
  for (const ch of id) start = (start * 31 + ch.charCodeAt(0)) >>> 0
  for (let round = 1; ; round++) {
    for (let i = 0; i < pool.length; i++) {
      const name = pool[(start + i) % pool.length] as string
      const pick = round === 1 ? name : `${name} ${generation(round)}`
      if (!taken.has(pick)) return pick
    }
  }
}
