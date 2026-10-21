// The approval card (0.7.0): one permission ask the mod is holding for the person, at most a minute. Who asks, with which tool,
// the exact input as text (hidden characters made visible), a countdown, and Allow / Deny / Ask in terminal now. Everything
// it shows is text (never HTML). It takes the focus itself, never a button, and its buttons arm a moment after it appears, so
// a stray Enter or a click meant for something else cannot answer it. Props only: the answer goes to `onAnswer(decision)`.
// htm/React like spacekit.js; styles are one <style id="ap-style"> (prefix ap-); nothing moves.

import React from './vendor/libs.js'
import { GlassTile, PillButton, html } from './spacekit.js'
import { visibleText } from './approvalmarks.js'
import { t } from './i18n.js'

const { useEffect, useRef, useState } = React
const ARM_MS = 600
const TICK_MS = 1000

/** `approval`: { id, agent, role, tool, input, reason, setting, hook, label, expiresAt } as the hub sends it. */
export function ApprovalCard({ approval, onAnswer }) {
  ensureStyles()
  const box = useRef(null)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    box.current?.focus()
    const arm = setTimeout(() => setArmed(true), ARM_MS)
    const tick = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => { clearTimeout(arm); clearInterval(tick) }
  }, [])
  const raw = JSON.stringify(approval.input, null, 2) ?? String(approval.input)
  const shown = visibleText(raw)
  const left = Math.max(0, Math.ceil((approval.expiresAt - now) / 1000))
  const answer = async decision => {
    setBusy(true)
    await onAnswer(decision)
    setBusy(false)
  }
  const off = !armed || busy
  const titleId = `ap-title-${approval.id}`
  const textId = `ap-text-${approval.id}`
  return html`<${GlassTile} ref=${box} status="waiting" soft className="ap-card" role="alertdialog" aria-labelledby=${titleId} aria-describedby=${textId} tabIndex="-1">
    <div className="ap-head">
      <span className="sk-label ap-title" id=${titleId}>${t('approval.title')}</span>
      <span className="ap-left" role="timer">${t('approval.left', { n: left })}</span>
    </div>
    <p className="ap-who" id=${textId}>${t('approval.wants', { agent: approval.agent, tool: approval.tool })}</p>
    <div className="sk-label ap-meta">${[approval.role, approval.label].filter(Boolean).join(' · ')}</div>
    ${reasonOf(approval) ? html`<p className="ap-reason">${reasonOf(approval)}</p>` : null}
    <pre className="ap-input" tabIndex="0" aria-label=${t('approval.input')}>${shown}</pre>
    ${shown === raw ? null : html`<div className="ap-hint">${t('approval.hidden')}</div>`}
    <div className="ap-actions">
      <${PillButton} primary disabled=${off} onClick=${() => answer('allow')}>${t('approval.allow')}<//>
      <${PillButton} danger disabled=${off} onClick=${() => answer('deny')}>${t('approval.deny')}<//>
      <${PillButton} disabled=${off} onClick=${() => answer('ask')}>${t('approval.terminal')}<//>
    </div>
  <//>`
}

/** Why Claude Code asks (the engine's reason, already masked), with the setting or hook that asks when there is one; hidden characters shown. */
function reasonOf({ reason, setting, hook }) {
  const source = [setting && t('approval.setting', { name: setting }), hook && t('approval.hook', { name: hook })].filter(Boolean).join(', ')
  if (!reason && !source) return ''
  return visibleText(`${reason ? t('approval.because', { reason }) : t('approval.because', { reason: '' }).trim()}${source ? ` (${source})` : ''}`)
}

const STYLE = `
.ap-card { position: fixed; z-index: 70; top: 16px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px);
  overflow: auto; display: grid; gap: 10px; padding: 16px 18px; box-sizing: border-box; outline: none; }
.ap-card:focus-visible { box-shadow: 0 0 0 2px #fff; }
.ap-head { display: flex; align-items: center; gap: 10px; }
.ap-title { color: var(--st-waiting); }
.ap-left { margin-left: auto; font: 500 12px var(--sk-font-mono); color: var(--sk-text-2); font-variant-numeric: tabular-nums; }
.ap-who { margin: 0; font: 600 16px/1.35 var(--sk-font-title); color: var(--sk-text); overflow-wrap: anywhere; }
.ap-meta { color: var(--sk-text-2); overflow-wrap: anywhere; }
.ap-input { margin: 0; max-height: 38vh; overflow: auto; padding: 10px 12px; border-radius: 12px; background: rgba(0,0,0,.45); box-shadow: inset 0 0 0 1px rgba(255,255,255,.1);
  font: 400 12.5px/1.45 var(--sk-font-mono); color: var(--sk-text); white-space: pre-wrap; overflow-wrap: anywhere; }
.ap-input:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.ap-reason { margin: 0; font: 500 13.5px/1.4 var(--sk-font-title); color: var(--sk-text); overflow-wrap: anywhere; }
.ap-hint { font: 400 12px var(--sk-font-title); color: var(--sk-text-2); }
.ap-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ap-actions .sk-pillbtn:disabled { opacity: .55; cursor: default; }
`

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('ap-style')) return
  const style = document.createElement('style')
  style.id = 'ap-style'
  style.textContent = STYLE
  document.head.append(style)
}
