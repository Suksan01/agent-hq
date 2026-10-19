// The live page's data and actions, as one hook: the stream from the hub (/events, the v2 envelope), what became of each request
// (toasts), the feed's "caught up" gaps, sounds, and every action the page can make (one idempotency key per click). It re-renders
// the page when the hub pushes something and when a toast comes or goes, never on a timer: with nothing working nothing moves.

import React from './vendor/libs.js'
import { actionToasts } from './labels.js'
import { arrivals, catchUpRow, inboxOf } from './feed.js'
import { soundSummary, soundsFor } from './sounds.js'
import { playEvent, playNav } from './space-sounds.js'
import { connectEvents, postAction } from './net.js'
import { keyOf, nicknamed, sessionsOf, signatureOf } from './livemap.js'

const { useCallback, useEffect, useMemo, useRef, useState } = React
const TOAST_MS = 4500
const MAX_TOASTS = 4
const SOUND_GAP_MS = 280
const SOUND_KEY = 'agent-hq.sound' // JSON true/false; space-sounds.js reads the same key for the navigation swooshes

/** A setting the browser remembers (per viewer; without storage it lasts until the page closes). */
export function useStored(key, fallback) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw) } catch { return fallback }
  })
  const set = useCallback(next => {
    setValue(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage blocked: the choice lasts until the page closes */ }
  }, [key])
  return [value, set]
}

// audio starts only after the person has touched the page: the first touch makes (and wakes) the context
let audio = null
function wakeAudio() {
  try {
    const Context = window.AudioContext ?? window.webkitAudioContext
    audio = audio ?? (Context ? new Context() : null)
    if (audio?.state === 'suspended') audio.resume()
  } catch { /* no audio on this device */ }
}

/** One request to the hub, forwarded to the session it names; the answer is a toast. */
export async function post(action, target) {
  const body = target?.session ? { ...action, session: target.session } : action
  const res = await postAction(body)
  if (res.ok) return { ok: true, text: 'Sent to Agent HQ…' }
  const where = target?.label ? `${target.label}: ` : ''
  if (res.status === 404) return { ok: false, text: `${where}that session has stopped` }
  if (res.status === 503) return { ok: false, text: `${where}could not reach the session` }
  if (res.status === 429) return { ok: false, text: `${where}too many requests are waiting; try again shortly` }
  return { ok: false, text: 'Could not reach Agent HQ' }
}

export function useLive() {
  const [sessions, setSessions] = useState(null) // as last pushed; null until the first push
  const [online, setOnline] = useState(false)
  const [loginLost, setLoginLost] = useState(false)
  const [toasts, setToasts] = useState([])
  const [markers, setMarkers] = useState([]) // "caught up" rows for the feed
  const [soundOn, setSoundOn] = useStored(SOUND_KEY, true)
  const receivedAt = useRef(Date.now())
  const signature = useRef('')
  const reconnected = useRef(false)
  const lastN = useRef(new Map()) // session -> newest feed number seen
  const seenNotice = useRef(new Map())
  const hadActions = useRef(new Set()) // sessions whose feed carries action results (then the notice is not toasted twice)
  const lastSounds = useRef(undefined)
  const nextToast = useRef(1)

  const toast = useCallback((ok, text) => {
    const id = nextToast.current++
    setToasts(list => [...list.slice(-(MAX_TOASTS - 1)), { id, status: ok ? 'done' : 'failed', text }])
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), TOAST_MS)
  }, [])
  const dismiss = useCallback(id => setToasts(list => list.filter(t => t.id !== id)), [])

  useEffect(() => connectEvents('/events', {
    onMessage: event => {
      try {
        const next = sessionsOf(JSON.parse(event.data))
        setOnline(true)
        const now = signatureOf(next)
        if (now === signature.current) return // only the engine's clock moved: nothing to redraw, so an idle page stays still
        signature.current = now
        receivedAt.current = Date.now()
        setSessions(next)
      } catch { /* a half-written push: the next one fixes it */ }
    },
    onError: reason => {
      setOnline(false)
      reconnected.current = true
      if (reason === 'login-lost') setLoginLost(true)
    },
  }), [])

  useEffect(() => {
    const wake = () => wakeAudio()
    window.addEventListener('pointerdown', wake, { once: true })
    window.addEventListener('keydown', wake, { once: true })
    return () => { window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake) }
  }, [])

  // what a push brought: results as toasts, the feed's gaps as markers, and the sounds for what just happened
  useEffect(() => {
    if (!sessions) return
    const rows = []
    for (const s of sessions) {
      const key = keyOf(s)
      const events = s.snapshot.events ?? []
      const prefix = sessions.length > 1 ? `${s.label}: ` : ''
      const seen = arrivals(lastN.current.get(key), events)
      const { toasts: results, lastN: newest } = actionToasts(lastN.current.get(key), events)
      lastN.current.set(key, newest)
      if (events.some(e => e.kind === 'action')) hadActions.current.add(key)
      for (const r of results) toast(r.ok, prefix + nicknamed(r.text, s.snapshot.agents))
      const row = catchUpRow(s.session, s.label, seen, events, reconnected.current)
      if (row) rows.push(row)
      // an older mod answers through the snapshot's notice instead of feed events
      const notice = s.snapshot.notice
      const was = seenNotice.current.get(key)
      if (was === undefined) seenNotice.current.set(key, notice?.seq ?? 0)
      else if (notice && notice.seq > was) {
        seenNotice.current.set(key, notice.seq)
        if (!hadActions.current.has(key)) toast(notice.ok, prefix + nicknamed(notice.text, s.snapshot.agents))
      }
    }
    reconnected.current = false
    if (rows.length > 0) setMarkers(m => [...m, ...rows].slice(-12))
    const now = soundSummary(sessions, inboxOf)
    const names = soundsFor(lastSounds.current, now)
    lastSounds.current = now
    if (soundOn && audio?.state === 'running') names.forEach((name, i) => setTimeout(() => { try { playEvent(audio, name) } catch { /* no sound is no error */ } }, i * SOUND_GAP_MS))
  }, [sessions])

  /** The engine's clock for a session, moved on by the time since the last push; a stopped session's stands still. */
  const clockOf = useCallback(session => {
    const s = sessions?.find(x => x.session === session)
    return s ? (s.alive ? s.snapshot.at + (Date.now() - receivedAt.current) : s.snapshot.at) : 0
  }, [sessions])

  const sound = useMemo(() => ({
    on: soundOn,
    toggle: () => { const next = !soundOn; setSoundOn(next); if (next) { wakeAudio(); try { if (audio?.state === 'running') playEvent(audio, 'done') } catch { /* silent */ } } },
    /** A swoosh for moving round the page: fit, travel, view, select (the ♪ toggle and the browser's own limits apply). */
    nav: (kind, move) => { if (soundOn) { wakeAudio(); playNav(kind, { ctx: audio ?? undefined, muted: !soundOn, ...move }) } },
  }), [soundOn, setSoundOn])

  return { sessions, online, loginLost, clockOf, toasts, toast, dismiss, markers, sound }
}
