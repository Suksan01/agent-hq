// The ask card (view only): one open permission ask, as the mod's state file describes it. Who asks, with which tool, the fields that
// decide it (hidden characters made visible), the size of the rest, why, and "Answer it in the terminal": the page has no
// Allow or Deny and no countdown, the terminal's dialog is the only place an ask is answered. Everything it shows is text
// (never HTML). A secret or a large input arrives as `isHidden` with no fields: the card says to look in the terminal.
// htm/React like spacekit.js; styles are one <style id="ap-style"> (prefix ap-); nothing moves.

import { GlassTile, html } from './spacekit.js'
import { visibleText } from './approvalmarks.js'
import { t } from './i18n.js'

const text = value => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')

/** One ask's card as plain strings and numbers only; entries that are not what AskCard says are skipped. */
function cleanCard(card) {
  const rows = value => (Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [])
  return {
    isHidden: card.isHidden === true,
    reason: text(card.reason),
    fields: rows(card.fields).map(f => ({ key: text(f.key), text: text(f.text) })),
    sizes: rows(card.sizes).filter(z => Number.isFinite(Number(z.chars))).map(z => ({ key: text(z.key), chars: Number(z.chars) })),
  }
}

/**
 * The open asks that carry a card, on every session: [{ key, agent, tool, card }]. A 0.7.x state file has none. The state
 * file can be written by an agent, so a malformed session, ask or card is skipped, never thrown on (it would blank the page).
 */
export function cardsOf(sessions) {
  return sessions.flatMap(s => {
    const asks = Array.isArray(s?.snapshot?.inbox) ? s.snapshot.inbox : []
    const agents = Array.isArray(s?.snapshot?.agents) ? s.snapshot.agents : []
    return asks.flatMap((ask, i) => {
      try {
        const agent = agents.find(a => a?.id === ask?.agent)
        const card = ask?.card
        if (!agent || !card || typeof card !== 'object') return []
        return [{ key: `${s.session}|${ask.agent}|${i}`, agent: text(agent.nickname) || text(agent.name), tool: text(card.tool), card: cleanCard(card) }]
      } catch {
        return []
      }
    })
  })
}

/** `card`: { tool, fields: [{key, text}], sizes: [{key, chars}], isHidden, reason? } as AskCard in hooks/inbox.ts, cleaned by cardsOf. */
export function ApprovalCard({ agent, tool, card }) {
  ensureStyles()
  const fields = card.fields.map(f => ({ key: f.key, raw: f.text, text: visibleText(f.text) }))
  const reason = card.reason ? visibleText(t('approval.because', { reason: card.reason })) : ''
  const marked = fields.some(f => f.text !== f.raw)
  return html`<${GlassTile} status="waiting" soft className="ap-card" role="group" aria-label=${t('approval.title')}>
    <span className="sk-label ap-title">${t('approval.title')}</span>
    <p className="ap-who">${t('approval.wants', { agent: visibleText(agent), tool: visibleText(tool) })}</p>
    ${reason ? html`<p className="ap-reason">${reason}</p>` : null}
    ${card.isHidden ? html`<div className="ap-hint">${t('approval.seeTerminal')}</div>` : null}
    ${fields.map((f, i) => html`<div key=${i} className="ap-field"><span className="sk-label">${visibleText(f.key)}</span><pre className="ap-input" tabIndex="0">${f.text}</pre></div>`)}
    ${card.sizes.map((z, i) => html`<div key=${i} className="ap-hint">${t('approval.size', { key: visibleText(z.key), n: z.chars.toLocaleString('en-US') })}</div>`)}
    ${marked ? html`<div className="ap-hint">${t('approval.hidden')}</div>` : null}
    <div className="sk-label ap-terminal">${t('approval.terminal')}</div>
  <//>`
}

const STYLE = `
.ap-stack { position: fixed; z-index: 70; top: 16px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px);
  overflow: auto; display: grid; gap: 10px; }
.ap-card { display: grid; gap: 8px; padding: 14px 16px; box-sizing: border-box; }
.ap-title { color: var(--st-waiting); }
.ap-who { margin: 0; font: 600 16px/1.35 var(--sk-font-title); color: var(--sk-text); overflow-wrap: anywhere; }
.ap-field { display: grid; gap: 4px; }
.ap-input { margin: 0; max-height: 24vh; overflow: auto; padding: 10px 12px; border-radius: 12px; background: rgba(0,0,0,.45); box-shadow: inset 0 0 0 1px rgba(255,255,255,.1);
  font: 400 12.5px/1.45 var(--sk-font-mono); color: var(--sk-text); white-space: pre-wrap; overflow-wrap: anywhere; }
.ap-input:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.ap-reason { margin: 0; font: 500 13.5px/1.4 var(--sk-font-title); color: var(--sk-text); overflow-wrap: anywhere; }
.ap-hint { font: 400 12px var(--sk-font-title); color: var(--sk-text-2); overflow-wrap: anywhere; }
.ap-terminal { color: var(--sk-text-2); }
`

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('ap-style')) return
  const style = document.createElement('style')
  style.id = 'ap-style'
  style.textContent = STYLE
  document.head.append(style)
}
