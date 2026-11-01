// Agent HQ speaks English only: no language question, no /hq lang, no language section for the lead; an install that
// saved the old `language: thai` option loads cleanly in English.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

async function boot($: Engine, on: On) {
  mock.clock(on)
  mock.store(on, {})
  const asked: string[] = []
  const toasts: string[] = []
  const registered: { argumentHint?: string; description?: string }[] = []
  on('tool.call', (_, e) => {
    if ((e.tool as string) === 'AskUserQuestion') asked.push('asked')
    return { result: {} as never }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: '' }))
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
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
  on('command.register', (_, e) => {
    registered.push(e as never)
    return { value: undefined } as never
  })
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true } as never)
  const compose = () => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as never)
  const hq = (args: string) => $.command.run({ command: 'hq', args, origin: { kind: 'composer' }, presentation: {} } as never) as Promise<{ text: string }>
  return { asked, toasts, registered, compose, hq }
}

test('a start asks no language question and registers /hq without a lang word', async ($, on) => {
  const s = await boot($, on)
  expect(s.asked).toEqual([])
  expect(s.registered[0]?.argumentHint).not.toMatch(/lang/)
  expect(s.registered[0]?.description).toMatch(/^[\x20-\x7e]+$/)
})

test('a saved language: thai loads cleanly in English, with no error, question or language section', { options: { language: 'thai' } }, async ($, on) => {
  const s = await boot($, on)
  expect(s.asked).toEqual([])
  expect(s.toasts).toEqual([])
  expect(s.registered[0]?.description).toMatch(/^[\x20-\x7e]+$/)
  expect((await s.compose()).sections.map(x => x.id)).not.toContain('agent-hq:language')
})

test('/hq lang thai is an unknown argument: the normal reply, no error, nothing asked', async ($, on) => {
  const s = await boot($, on)
  const reply = await s.hq('lang thai')
  expect(reply.text).toMatch(/^Agent HQ sidebar opened/) // as for any unknown argument
  expect(s.asked).toEqual([])
  expect(s.toasts.filter(t => /language/i.test(t))).toEqual([])
})
