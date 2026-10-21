// The language option: asked once, where a person can answer (a REPL start, a client that joins later, else the first
// plain /hq; English when dismissed), never marked asked where nobody could be; changed with /hq lang or /config; what
// the lead is told about it, in both languages.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { TEAM_FILE } from '../hooks/team'

// one turn of the event loop (the test runtime has timers; the engine's types do not declare them)
const tick = () => new Promise<void>(resolve => (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown }).setTimeout(resolve, 0))

type Boot = { stored?: Record<string, unknown>; answer?: string | 'throws'; surface?: 'terminal' | null; isInteractive?: boolean; deny?: string; team?: string; wait?: Promise<void> }

/** A session with no team; what the plugin asks, stores and sets is recorded. */
async function boot($: Engine, on: On, options: Boot = {}) {
  const clock = mock.clock(on)
  const stored: Record<string, unknown> = { ...options.stored }
  const asked: { question: string; options: string[] }[] = []
  const sets: { key: string; value: unknown }[] = []
  const toasts: string[] = []
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('tool.call', async (_, e) => {
    if ((e.tool as string) !== 'AskUserQuestion') return { result: {} as never }
    await options.wait // the person takes their time
    const questions = (e as unknown as { questions: { question: string; options?: { label: string }[] }[] }).questions
    asked.push({ question: questions[0]?.question ?? '', options: (questions[0]?.options ?? []).map(o => o.label) })
    if (options.answer === 'throws') throw new Error('dismissed')
    return { result: { questions, answers: { [questions[0]?.question ?? '']: options.answer ?? 'English' } } } as never
  })
  on('config.set', (_, e) => {
    sets.push({ key: e.key, value: e.value })
    return options.deny ? { deny: options.deny } : { value: e.value }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('fs.exists', (_, e) => ({ value: options.team !== undefined && e.path === `/work/app/${TEAM_FILE}` }))
  on('fs.read', () => ({ value: options.team ?? '' }))
  // where the session draws: the REPL's terminal from the start; a client that joins later adds itself
  const surfaces: string[] = options.surface === null ? [] : [options.surface ?? 'terminal']
  on('session.surfaces', () => ({ value: surfaces }) as never)
  on('session.attach', (_, e) => {
    surfaces.push(e.surface)
    return { clientId: e.clientId }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: undefined }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('agent.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'engine', text: 'base', scope: 'shared' as const }] }))
  const registered: { argumentHint?: string; description?: string }[] = []
  on('command.register', (_, e) => {
    registered.push(e as never)
    return { value: undefined } as never
  })
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: options.surface === undefined ? 'terminal' : options.surface, isInteractive: options.isInteractive ?? true } as never)
  // the question is asked beside the start, not in its way: wait for it to settle
  for (let i = 0; i < 50 && stored.languageAsked === undefined; i++) await tick()
  const hq = (args: string) => $.command.run({ command: 'hq', args, origin: { kind: 'composer' }, presentation: {} } as never) as Promise<{ text: string }>
  const compose = (traits: string[] = []) => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits } as never)
  const attach = async (surface: string) => {
    await $.session.attach({ surface, clientId: `${surface}:default` } as never)
    for (let i = 0; i < 50 && stored.languageAsked === undefined; i++) await tick() // asked beside the attach, not in its way
  }
  return { stored, asked, sets, toasts, registered, hq, compose, attach, surfaces, clock }
}

test('the first start asks once, in both languages, and Thai is set in the plugin config', async ($, on) => {
  const s = await boot($, on, { answer: 'ภาษาไทย' })

  expect(s.asked).toHaveLength(1)
  expect(s.asked[0]?.options).toEqual(['English', 'ภาษาไทย'])
  expect(s.asked[0]?.question).toMatch(/Which language should Agent HQ use\?/)
  expect(s.asked[0]?.question).toMatch(/ให้ Agent HQ ใช้ภาษาไหน/)
  expect(s.stored.languageAsked).toBe(true)
  expect(s.sets).toEqual([]) // set just after, never inside a hook still running
  await s.clock.settle()
  expect(s.sets).toEqual([{ key: 'agent-hq.language', value: 'thai' }])
  expect((await s.hq('close')).text).toBe('ปิดแถบข้าง Agent HQ แล้ว — พิมพ์ /hq เพื่อเปิดอีกครั้ง') // in Thai at once, before the reload
})

test('answering English stores nothing but the asked mark', async ($, on) => {
  const s = await boot($, on, { answer: 'English' })
  expect(s.asked).toHaveLength(1)
  expect(s.stored.languageAsked).toBe(true)
  expect(s.sets).toEqual([])
})

test('a dismissed question means English, and it is not asked again', async ($, on) => {
  const s = await boot($, on, { answer: 'throws' })
  expect(s.asked).toHaveLength(1)
  expect(s.stored.languageAsked).toBe(true)
  expect(s.sets).toEqual([])
})

test('once asked, a start does not ask again', async ($, on) => {
  const s = await boot($, on, { stored: { languageAsked: true }, answer: 'ภาษาไทย' })
  expect(s.asked).toEqual([])
  expect(s.sets).toEqual([])
})

test('a start with nobody to ask (-p, the SDK, the desktop app before it joins) asks nothing and marks nothing', async ($, on) => {
  const s = await boot($, on, { surface: null, isInteractive: false })
  expect(s.asked).toEqual([])
  expect(s.stored.languageAsked).toBeUndefined()
})

test('a client that joins later (the desktop app) is asked once; another joining does not ask again', async ($, on) => {
  const s = await boot($, on, { surface: null, isInteractive: false, answer: 'ภาษาไทย' })
  await s.attach('desktop')
  expect(s.asked).toHaveLength(1)
  expect(s.asked[0]?.options).toEqual(['English', 'ภาษาไทย'])
  expect(s.stored.languageAsked).toBe(true)
  await s.clock.settle()
  expect(s.sets).toEqual([{ key: 'agent-hq.language', value: 'thai' }])
  await s.attach('mobile')
  expect(s.asked).toHaveLength(1)
})

test('plain /hq asks the language first when nobody was asked yet, before the trust dialog, and only once', async ($, on) => {
  const team = JSON.stringify({ name: 'Web', purpose: 'Ship', lead: { title: 'Lead', rules: [], skills: [] }, roles: [{ id: 'dev', title: 'Dev', count: 1, mission: 'Build.' }] })
  const s = await boot($, on, { surface: null, isInteractive: false, team })
  s.surfaces.push('desktop') // the app's client is there, but its session.attach was missed
  await s.hq('')
  expect(s.asked.map(q => q.question)).toEqual([expect.stringMatching(/Which language should Agent HQ use\?/), expect.stringMatching(/^Trust the team "Web"/)])
  expect(s.stored.languageAsked).toBe(true)
  await s.hq('')
  expect(s.asked.filter(q => /Which language/.test(q.question))).toHaveLength(1)
})

test('choosing Thai from plain /hq ends that run with a line in Thai; the setting (which reloads the plugin) follows once it returned', async ($, on) => {
  const team = JSON.stringify({ name: 'Web', purpose: 'Ship', lead: { title: 'Lead', rules: [], skills: [] }, roles: [{ id: 'dev', title: 'Dev', count: 1, mission: 'Build.' }] })
  const s = await boot($, on, { surface: null, isInteractive: false, team, answer: 'ภาษาไทย' })
  s.surfaces.push('desktop')
  expect((await s.hq('')).text).toBe('Agent HQ จะใช้ภาษาไทยจากนี้ไป พิมพ์ /hq อีกครั้งเพื่อเปิด')
  expect(s.asked).toHaveLength(1) // no trust dialog in this run
  expect(s.sets).toEqual([]) // nothing set while /hq ran
  await s.clock.settle()
  expect(s.sets).toEqual([{ key: 'agent-hq.language', value: 'thai' }])
  expect(s.stored.languageAsked).toBe(true)
})

test('/hq typed while a joining client is still being asked joins that question; Thai still waits until /hq returned', async ($, on) => {
  const team = JSON.stringify({ name: 'Web', purpose: 'Ship', lead: { title: 'Lead', rules: [], skills: [] }, roles: [{ id: 'dev', title: 'Dev', count: 1, mission: 'Build.' }] })
  let answer = () => {}
  const wait = new Promise<void>(resolve => (answer = resolve))
  const s = await boot($, on, { surface: null, isInteractive: false, team, answer: 'ภาษาไทย', wait })
  void $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never) // the question opens beside the join
  for (let i = 0; i < 10; i++) await tick()
  const typed = s.hq('')
  for (let i = 0; i < 10; i++) await tick()
  answer()
  expect((await typed).text).toBe('Agent HQ จะใช้ภาษาไทยจากนี้ไป พิมพ์ /hq อีกครั้งเพื่อเปิด')
  expect(s.asked).toHaveLength(1)
  expect(s.sets).toEqual([])
  await s.clock.settle()
  expect(s.sets).toEqual([{ key: 'agent-hq.language', value: 'thai' }])
})

test('plain /hq with nobody to ask (a -p run) asks nothing and marks nothing', async ($, on) => {
  const s = await boot($, on, { surface: null, isInteractive: false })
  await s.hq('')
  expect(s.asked).toEqual([])
  expect(s.stored.languageAsked).toBeUndefined()
})

test('nothing asks twice: after a REPL start asked, neither a client joining nor plain /hq asks again', async ($, on) => {
  const s = await boot($, on, { answer: 'English' })
  await s.attach('desktop')
  await s.hq('')
  expect(s.asked).toHaveLength(1)
})

test('/hq lang counts as the answer: it is not asked afterwards', async ($, on) => {
  const s = await boot($, on, { surface: null, isInteractive: false })
  expect((await s.hq('lang english')).text).toBe('Agent HQ will speak English from now on.')
  expect(s.stored.languageAsked).toBe(true)
  await s.attach('desktop')
  expect(s.asked).toEqual([])
})

test('a language already chosen in /config is not asked about', { options: { language: 'thai' } }, async ($, on) => {
  const s = await boot($, on)
  expect(s.asked).toEqual([])
  expect(s.stored.languageAsked).toBe(true)
})

test('/hq lang sets the language and answers in it', async ($, on) => {
  const s = await boot($, on, { stored: { languageAsked: true } })
  expect(s.registered[0]?.argumentHint).toMatch(/lang/)

  expect((await s.hq('lang thai')).text).toBe('Agent HQ จะใช้ภาษาไทยจากนี้ไป')
  expect((await s.hq('lang english')).text).toBe('Agent HQ will speak English from now on.')
  expect(s.sets).toEqual([
    { key: 'agent-hq.language', value: 'thai' },
    { key: 'agent-hq.language', value: 'english' },
  ])
  expect((await s.hq('lang klingon')).text).toBe('Agent HQ: say /hq lang thai or /hq lang english.')
  expect((await s.hq('lang')).text).toBe('Agent HQ speaks English. Change it with /hq lang thai or /hq lang english.')
  expect(s.sets).toHaveLength(2)
})

test('/hq lang says so when the setting is refused', async ($, on) => {
  const s = await boot($, on, { stored: { languageAsked: true }, deny: 'locked by policy' })
  expect((await s.hq('lang thai')).text).toBe('Agent HQ could not change the language (locked by policy).')
  expect((await s.hq('close')).text).toMatch(/^Agent HQ sidebar closed/) // still English
})

test('in Thai the lead is told to speak Thai and keep code English, with or without a team', { options: { language: 'thai' } }, async ($, on) => {
  const s = await boot($, on)
  const composed = await s.compose()
  const section = composed.sections.find(x => x.id === 'agent-hq:language')
  expect(section?.text).toMatch(/Speak Thai to the person/)
  expect(section?.text).toMatch(/AskUserQuestion/)
  expect(section?.text).toMatch(/specs, plans, reports, team titles and missions/)
  expect(section?.text).toMatch(/code, file paths, commands, JSON keys, code comments and commit messages in English/)
  expect(composed.sections.some(x => x.id === 'agent-hq:no-team')).toBe(true)
  expect((await s.compose(['bare'])).sections.some(x => x.id === 'agent-hq:language')).toBe(false)
  expect(s.registered[0]?.description).toMatch(/แถบข้าง/)
})

test('in English the lead gets no language section', async ($, on) => {
  const s = await boot($, on, { stored: { languageAsked: true } })
  expect((await s.compose()).sections.some(x => x.id === 'agent-hq:language')).toBe(false)
})
