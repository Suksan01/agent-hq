// The live page (/hq web): every Claude Code session's team as a group of glass cards on one space-dark canvas. This file is the
// page itself: it reads the hub's stream (livestate.js), works out what to show (livemap.js), hands it to the views (liveview.js:
// the diagram, or the optional 3D space) and the panels (spacekit.js), and turns every click into one action to the hub.
// Nothing here animates or re-renders on a timer: a push from the hub, a click or a toast are the only things that redraw it.

import React, { createRoot } from './vendor/libs.js'
import * as kit from './spacekit.js'
import { sessionNames } from './labels.js'
import { LiveView, ViewToggle, useViewMode } from './liveview.js'
import { useLazySpace } from './lazyspace.js'
import { addRequest, attentionOf, boardSections, drawerOf, feedItems, groupsOf, hudOf, inboxItems, keyOf, pctOf } from './livemap.js'
import { feedRows } from './feed.js'
import { TaskBoardTile } from './panels.js'
import { post, useLive, useStored } from './livestate.js'
import { pauseOffscreen } from './motion.js'
import { langOf, setLang, t } from './i18n.js'

const { AddAgentDialog, ChipBar, Dialog, DotNumber, DotProgress, Drawer, EmptyState, FeedTile, IconButton, InboxTile, PillButton, SegmentedToggle, SpaceCanvas, TitleHud, Toast, ToastStack, Toolbar, html } = kit
const { useCallback, useEffect, useMemo, useRef, useState } = React

const WIDE = 1100 // from here the HUD and the panels sit beside the canvas; below it they float over it
const PANEL_W = 372
const PILLS_H = 96 // the collapsed pills (needs you, activity) on a phone
const NARROW_TOP = 188 // the compact HUD on a phone

/** The height of the bottom bar (it wraps on a phone); the panels and the views' inset sit above it. Measured on resize only. */
function useHeight() {
  const [height, setHeight] = useState(96)
  const watch = useRef(null)
  const ref = useCallback(el => {
    watch.current?.disconnect()
    if (!el || !window.ResizeObserver) return
    watch.current = new ResizeObserver(() => {
      const next = Math.ceil(el.getBoundingClientRect().height) + 16
      document.documentElement.style.setProperty('--hq-bar', `${next}px`)
      setHeight(next)
    })
    watch.current.observe(el)
  }, [])
  return [height, ref]
}

function useWide() {
  const query = matchMedia(`(min-width: ${WIDE}px)`)
  const [wide, setWide] = useState(query.matches)
  useEffect(() => {
    const on = e => setWide(e.matches)
    query.addEventListener('change', on)
    return () => query.removeEventListener('change', on)
  }, [])
  return wide
}

function Hud({ hud, online, loginLost }) {
  const word = t(online ? 'live.on' : loginLost ? 'live.lost' : 'live.reconnecting')
  return html`<div className="hq-hud">
    <${TitleHud} team=${hud.title} folder=${hud.folder} counts=${hud.counts} />
    <div className="hq-hud__row">
      <span className="sk-label">${t('team')}</span><div className="hq-hud__bar"><${DotProgress} value=${hud.pct} status=${hud.pct === 100 ? 'done' : 'working'} /></div><${DotNumber} value=${hud.pct} suffix="%" size="sm" />
      <span className=${`sk-pill hq-live${online ? '' : ' is-off'}`} data-status=${online ? 'done' : 'waiting'}><span className="sk-pill__disc"></span>${word}</span>
    </div>
  </div>`
}

function App() {
  const live = useLive()
  const { sessions } = live
  const wide = useWide()
  const [mode, setMode, canSpace, fallBack] = useViewMode()
  const Space = useLazySpace(mode === 'space')
  const [focus, setFocus] = useState(null) // a session id, or null for all
  const [selected, setSelected] = useState(null) // `${session}|${agent}`
  const [boardOpen, setBoardOpen] = useStored('agent-hq.board', false)
  const [feedOpen, setFeedOpen] = useStored('agent-hq.feed', wide)
  const [adding, setAdding] = useState(false) // false, or true / a session id: the team the dialog starts on
  const [inboxOpen, setInboxOpen] = useState(false) // on a phone the needs-you tile is a pill until it is opened
  const [clearing, setClearing] = useState(false)
  const [draft, setDraft] = useState(null) // a next step pressed on a lead deck: { for: selected, text, n }, put in that lead's box once, never sent from here
  const view = useRef(null)
  const [barHeight, bar] = useHeight()
  const [lastLang, keepLang] = useStored('agent-hq.lang', 'en') // so the screens before any session (connecting, none) speak it too

  useEffect(() => pauseOffscreen(document.body), [])
  useEffect(() => { if (draft && draft.for !== selected) setDraft(null) }, [selected]) // the draft goes with the box it was put in

  const list = sessions ?? []
  const lang = langOf(list) ?? lastLang
  setLang(lang) // before anything below renders a word
  useEffect(() => {
    document.documentElement.lang = lang
    if (lang !== lastLang) keepLang(lang)
  }, [lang])
  const names = useMemo(() => sessionNames(list), [sessions])
  const focused = focus !== null && list.some(s => s.session === focus) ? focus : null
  const shown = focused === null ? list : list.filter(s => s.session === focused)
  const groups = useMemo(() => groupsOf(list, names, live.clockOf), [sessions])
  const hud = useMemo(() => hudOf(shown, names), [sessions, focused])
  const inbox = useMemo(() => inboxItems(list, names, list.length > 1, live.clockOf), [sessions])
  const current = focused === null ? attentionOf(shown) : shown.find(s => s.alive) ?? shown[0]
  const isMulti = list.length > 1

  useEffect(() => { document.title = list.length > 0 ? `${hud.title} · Agent HQ` : 'Agent HQ' }, [hud.title, list.length])
  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return
      if (adding) setAdding(false)
      else if (clearing) setClearing(false)
      else if (selected) setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adding, clearing, selected])

  const say = useCallback(result => live.toast(result.ok, result.text), [live.toast])
  const choose = useCallback((session, id) => {
    setSelected(id ? `${session}|${id}` : null)
  }, [])
  const focusOn = useCallback(session => {
    setFocus(session)
    view.current?.focus(session)
    if (session === null) live.sound.nav('fit', { duration: 600 }) // a chosen system plays its own 'travel' through onMove
  }, [live.sound])

  // the agent in the drawer; one that leaves the page while its drawer is open (it finished a while ago) stays there, as
  // last seen, until the person closes the drawer
  const lastPick = useRef(null)
  const pick = useMemo(() => {
    if (!selected) return (lastPick.current = null)
    const [key, id] = selected.split('|')
    const session = list.find(s => keyOf(s) === key)
    const agent = session?.snapshot.agents.find(a => a.id === id)
    const index = groups.find(g => keyOf(g) === key)?.agents.find(a => a.id === id)?.index ?? 0
    if (agent) return (lastPick.current = { session, agent, index })
    const kept = lastPick.current
    return kept && keyOf(kept.session) === key && kept.agent.id === id ? kept : null
  }, [selected, sessions])

  if (!sessions) return html`<${SpaceCanvas} className="hq-app"><div className="hq-center"><${EmptyState} title=${t('live.connecting')} text=${t('live.moment')} /></div><//>`
  if (list.length === 0) return html`<${SpaceCanvas} className="hq-app"><div className="hq-center"><${EmptyState} title=${t('live.none')} text=${t('live.start')}>${live.loginLost ? html`<div className="sk-body-text">${t('live.lostPage')}</div>` : null}<//></div><//>`

  const alive = shown.filter(s => s.alive)
  const send = (action, target = current) => post(action, target).then(say)
  const finish = async mode => {
    const results = await Promise.all(alive.map(s => post({ type: 'finished', mode }, s)))
    say(results.find(r => !r.ok) ?? results[0] ?? { ok: false, text: t('live.noSession') })
  }
  const talkTo = s => { const lead = leadOf(s); if (lead) setSelected(`${keyOf(s)}|${lead.id}`) }
  const leadOf = s => s?.snapshot.agents.find(a => a.isMain)
  const suggest = (session, text) => {
    const s = list.find(x => x.session === session)
    const lead = leadOf(s)
    if (!lead) return
    const uid = `${keyOf(s)}|${lead.id}`
    setSelected(uid)
    setDraft(d => ({ for: uid, text, n: (d?.n ?? 0) + 1 }))
  }
  const drafted = draft?.for === selected ? draft : null // a draft is for the box it was pressed into; another agent's drawer starts empty
  const hidden = Boolean(current?.snapshot.hideFinished)
  const clock = pick ? live.clockOf(pick.session.session) : 0
  const drawer = pick ? drawerOf(pick.agent, pick.session, clock, pick.index, isMulti ? names.get(pick.session.session)?.flag : undefined) : null
  const teams = focused === null ? list.filter(s => s.alive) : []
  const side = wide && (drawer || feedOpen || inbox.length > 0)
  const sheet = !wide && (drawer || (inbox.length > 0 && inboxOpen) || feedOpen)
  const inset = wide
    ? { top: 16, right: side ? PANEL_W + 24 : 16, bottom: barHeight, left: PANEL_W + 24 }
    : { top: NARROW_TOP, right: 12, bottom: barHeight + (sheet ? Math.round(innerHeight * 0.4) : PILLS_H), left: 12 }
  const chips = [{ id: 'all', label: t('live.all'), count: list.length }, ...list.map(s => ({ id: keyOf(s), label: names.get(s.session)?.chip ?? s.label, count: s.snapshot.agents.filter(a => !a.isMain).length, seed: names.get(s.session)?.flag, attention: inbox.some(i => i.session === s.session) }))]
  const target = focused === null ? 'all' : keyOf(list.find(s => s.session === focused) ?? list[0])

  return html`<${SpaceCanvas} className="hq-app">
    <div className="hq-stage">
      <${LiveView} mode=${mode} Space=${Space} onFallback=${fallBack} onNotice=${text => live.toast(false, text)} groups=${groups} focus=${focused} selected=${selected} inset=${inset}
        onSelect=${choose} onLeadMessage=${session => talkTo(list.find(s => s.session === session))} onLeadSuggest=${suggest} onLeadHire=${session => setAdding(session ?? true)}
        onMove=${move => live.sound.nav('travel', move)} onLeadTasks=${() => setBoardOpen(!boardOpen)} onReady=${api => { view.current = api }} />
    </div>
    <div className="hq-left">
      <${Hud} hud=${hud} online=${live.online} loginLost=${live.loginLost} />
      ${boardOpen ? html`<${TaskBoardTile} sections=${boardSections(shown, names)} onClose=${() => setBoardOpen(false)} />` : null}
    </div>
    <div className=${`hq-right${drawer ? ' has-drawer' : ''}`}>
      ${drawer?.lead && teams.length > 1 ? html`<${SegmentedToggle} label=${t('live.teamToMessage')} value=${keyOf(pick.session)} options=${teams.map(s => ({ id: keyOf(s), label: names.get(s.session)?.flag ?? s.label }))}
        onChange=${key => talkTo(list.find(s => keyOf(s) === key))} />` : null}
      ${drawer
        ? html`<${Drawer} key=${drafted ? `${selected}|${drafted.n}` : selected} ...${drawer} draft=${drafted?.text} onClose=${() => setSelected(null)}
            onSend=${text => send(drawer.lead ? { type: 'lead', text } : { type: 'message', agent: pick.agent.id, text }, pick.session)}
            onStop=${() => send({ type: 'stop', agent: pick.agent.id }, pick.session)} />`
        : html`${inbox.length === 0 ? null : wide || inboxOpen
            ? html`<${InboxTile} items=${inbox} onMessage=${item => setSelected(item.uid)} />${wide ? null : html`<${PillButton} small onClick=${() => setInboxOpen(false)}>${t('live.hide')}<//>`}`
            : html`<${PillButton} primary onClick=${() => setInboxOpen(true)}>⚑ ${t(inbox.length === 1 ? 'lead.needsOne' : 'lead.needsMany', { n: inbox.length })}<//>`}
          ${feedOpen
            ? html`<div className="hq-feed"><${FeedTile} rows=${feedItems(feedRows(shown, live.markers), live.clockOf, shown.length > 1, session => names.get(session)?.prefix ?? '')} />
                <${IconButton} icon="close" label=${t('live.hideFeed')} small className="hq-feed__close" onClick=${() => setFeedOpen(false)} /></div>`
            : html`<${PillButton} small onClick=${() => setFeedOpen(true)}>${t('feed.title')}<//>`}`}
    </div>
    <div className="hq-bar" ref=${bar}>
      <${ChipBar} items=${chips} value=${target} onChange=${id => focusOn(id === 'all' ? null : list.find(s => keyOf(s) === id)?.session ?? null)} />
      <${Toolbar} label=${t('toolbar.label')}>
        <${PillButton} primary onClick=${() => talkTo(current)}>${t('lead.message')}<//>
        <${IconButton} icon="tasks" label=${t(boardOpen ? 'live.boardHide' : 'live.boardShow')} pressed=${boardOpen} onClick=${() => setBoardOpen(!boardOpen)} />
        <${IconButton} icon=${hidden ? 'eye' : 'eyeoff'} label=${t(hidden ? 'live.showDone' : 'live.hideDone')} pressed=${hidden} onClick=${() => finish(hidden ? 'show' : 'hide')} />
        <${IconButton} icon="trash" label=${t('live.clearDone')} onClick=${() => setClearing(true)} />
        <${IconButton} icon="fit" label=${t('live.fit')} onClick=${() => { view.current?.fit(); live.sound.nav('fit', { duration: 600 }) }} />
        <${IconButton} icon="expand" label=${t('live.fullScreen')} onClick=${() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())} />
        <${IconButton} icon=${live.sound.on ? 'volume' : 'mute'} label=${t(live.sound.on ? 'live.soundsOn' : 'live.soundsOff')} pressed=${live.sound.on} onClick=${live.sound.toggle} />
        <${ViewToggle} mode=${mode} canSpace=${canSpace} onChange=${setMode} />
        <${IconButton} icon="plus" label=${t('add.title')} primary onClick=${() => setAdding(true)} />
      <//>
    </div>
    <${ToastStack}>${live.toasts.map(t => html`<${Toast} key=${t.id} status=${t.status} onClose=${() => live.dismiss(t.id)}>${t.text}<//>`)}<//>
    ${adding ? html`<${AddAgentDialog} sessions=${list.filter(s => s.alive).map(s => ({ key: keyOf(s), label: names.get(s.session)?.chip ?? s.label }))} initialSession=${typeof adding === 'string' ? adding : keyOf(current)}
      roles=${Object.fromEntries(list.map(s => [keyOf(s), s.snapshot.roles]))} onClose=${() => setAdding(false)}
      onAdd=${({ sessionKey, roleId, task, hire }) => {
        setAdding(false)
        const to = list.find(s => keyOf(s) === sessionKey) ?? current
        const action = addRequest({ roleId, task, hire }, to.snapshot.roles)
        if (action) send(action, to)
        else live.toast(false, t('live.noRole'))
      }} />` : null}
    ${clearing ? html`<${Dialog} title=${t('live.clearTitle')} onClose=${() => setClearing(false)}
      actions=${html`<${PillButton} onClick=${() => setClearing(false)}>${t('live.keepThem')}<//><${PillButton} danger onClick=${() => { setClearing(false); finish('clear') }}>${t('live.clear')}<//>`}>
      <div className="sk-body-text">${t('live.clearText')}</div>
    <//>` : null}
  <//>`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
