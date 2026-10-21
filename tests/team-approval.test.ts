// A project's team file is used only once the person approved that text; the home folder's is the person's own.
import { expect, mock, test } from 'claude-code/testing'
import type { On, PromptOrigin } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { withApproval } from '../hooks/approval'
import { TEAM_FILE } from '../hooks/team'

const PROJECT_FILE = `/work/app/${TEAM_FILE}`
const HOME_FILE = `/home/me/${TEAM_FILE}`
const TEAM = {
  name: 'Booking App Team',
  purpose: 'Build the booking app',
  lead: { title: 'Tech Lead', rules: [], skills: [] },
  roles: [{ id: 'senior-dev', title: 'Senior Developer', count: 2, mission: 'Build.', tasks: [], rules: [], skills: [] }],
}
const TEXT = JSON.stringify(TEAM)

/** A session whose team file is at `file` (project or home) with `text`, and whose store holds `approvedTeams`. */
async function boot($: Engine, on: On, options: { file?: string; text?: string; approved?: unknown; migrated?: boolean } = {}) {
  const failure = { register: false }
  const file = options.file ?? PROJECT_FILE
  const files = new Map([[file, options.text ?? TEXT]])
  const registered: string[] = []
  const toasts: string[] = []
  const writes: string[] = []
  mock.clock(on)
  // the plugin's store, kept here so a test can read what the plugin recorded
  // the language was chosen already: its question is not what these dialogs are about
  const stored: Record<string, unknown> = { languageAsked: true, ...(options.approved === undefined ? {} : { approvedTeams: options.approved }), ...(options.migrated ? { homeTeamTrustMigrated: true } : {}) }
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sess' }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }))
  // the file tools do what they say to the in-memory files; `race.after` is someone else changing the file right after the tool ran
  const race: { after?: () => void } = {}
  // the engine's question dialog ($.ui.ask is an AskUserQuestion call): what it was asked, and the person's answer
  const dialog = { answer: 'No' as string, asked: [] as string[], options: [] as string[][], during: undefined as (() => void) | undefined }
  on('tool.call', (_, e) => {
    if ((e.tool as string) === 'AskUserQuestion') {
      const questions = (e as unknown as { questions: { question: string; options?: { label: string }[] }[] }).questions
      dialog.asked.push(questions[0]?.question ?? '')
      dialog.options.push((questions[0]?.options ?? []).map(o => o.label))
      dialog.during?.()
      if (dialog.answer === 'throws') throw new Error('dismissed')
      return { result: { questions, answers: { [questions[0]?.question ?? '']: dialog.answer } } } as never
    }
    const input = e as unknown as { file_path?: string; content?: string; old_string?: string; new_string?: string; replace_all?: boolean }
    const path = input.file_path === undefined ? undefined : input.file_path.startsWith('/') ? input.file_path : `/work/app/${input.file_path}`
    if (path !== undefined && (e.tool as string) === 'Write') files.set(path, input.content ?? '')
    if (path !== undefined && (e.tool as string) === 'Edit' && files.has(path) && input.old_string) {
      const text = files.get(path) as string
      files.set(path, input.replace_all ? text.split(input.old_string).join(input.new_string ?? '') : text.replace(input.old_string, () => input.new_string ?? ''))
    }
    race.after?.()
    return { result: {} as never }
  })
  on('fs.write', (_, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('agent.register', (_, e) => {
    if (failure.register) throw new Error('no more agent types')
    registered.push(e.name)
    return { value: { agent: `agent-hq:${e.name}` } }
  })
  // sub1 is an agent of no team role (a general one): the guard knows it, so its write reaches the plugin's trust logic
  on('agent.list', () => ({ value: [{ id: 'sub1', name: 'sub1', type: 'general-purpose', description: 'x', status: 'running' as const }] }))
  on('prompt.compose', () => ({ sections: [{ id: 'engine', text: 'base', scope: 'shared' as const }] }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined } as never
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.log', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: undefined }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('session.start', (_, e) => e)
  await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true } as never)
  const hq = (args: string) => $.command.run({ command: 'hq', args, origin: { kind: 'composer' }, presentation: {} } as never) as Promise<{ text: string }>
  const compose = (traits: string[] = []) => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits } as never)
  const runAs = (args: string, origin: PromptOrigin) => $.command.run({ command: 'hq', args, origin, presentation: {} } as never) as Promise<{ text: string }>
  return { files, registered, toasts, writes, hq, runAs, compose, failure, stored, race, dialog }
}

// every origin a run can have: the person's own trust at once; ones the engine cannot attest as the person's trust only
// through the dialog the person answers; the rest (a plugin, a schedule, another session or agent) never trust
const ORIGINS: [PromptOrigin, 'at once' | 'dialog' | 'refused'][] = [
  [{ kind: 'composer' }, 'at once'],
  [{ kind: 'bridge' }, 'at once'],
  [{ kind: 'sdk' }, 'at once'],
  [{ kind: 'slack-ping' }, 'at once'],
  [{ kind: 'unclassified' }, 'dialog'],
  [{ kind: 'auto-continuation' }, 'dialog'],
  [{ kind: 'plugin', name: 'other' }, 'refused'],
  [{ kind: 'task-notification' }, 'refused'],
  [{ kind: 'scheduled-trigger' }, 'refused'],
  [{ kind: 'peer' }, 'refused'],
  [{ kind: 'peer-send-message' }, 'refused'],
  [{ kind: 'projects-relay' }, 'refused'],
  [{ kind: 'channel', server: 'slack' }, 'refused'],
  [{ kind: 'coordinator' }, 'refused'],
  [{ kind: 'observer' }, 'refused'],
  [{ kind: 'observer-activity' }, 'refused'],
]

for (const [origin, expected] of ORIGINS) {
  test(`/hq trust from a ${origin.kind} run: ${expected === 'at once' ? 'trusted at once' : expected === 'dialog' ? 'trusted only through the dialog' : 'refused'}`, async ($, on) => {
    const s = await boot($, on)
    s.dialog.answer = 'Yes, trust it'

    const answer = await s.runAs('trust', origin)

    expect(s.dialog.asked).toEqual(expected === 'dialog' ? [TRUST_QUESTION] : [])
    expect(s.registered).toEqual(expected === 'refused' ? [] : ['senior-dev'])
    if (expected === 'refused') expect(answer.text).toMatch(/^Agent HQ: only you can trust a team file; type \/hq trust yourself/)
  })

  test(`/hq alone from a ${origin.kind} run ${expected === 'refused' ? 'asks nothing' : 'asks, and "Yes, trust it" trusts'}`, async ($, on) => {
    const s = await boot($, on)
    s.dialog.answer = 'Yes, trust it'

    await s.runAs('', origin)

    expect(s.dialog.asked).toEqual(expected === 'refused' ? [] : [TRUST_QUESTION])
    expect(s.registered).toEqual(expected === 'refused' ? [] : ['senior-dev'])
  })
}

test('the trust dialog puts "No" first, so a stray Enter does not trust', async ($, on) => {
  const s = await boot($, on)

  await s.hq('')

  expect(s.dialog.options).toEqual([['No', 'Yes, trust it']])
})

test('after a No, plain /hq does not ask again about the same text, but does about a changed one', async ($, on) => {
  const s = await boot($, on)

  await s.hq('')
  await s.hq('')
  expect(s.dialog.asked).toHaveLength(1)

  s.files.set(PROJECT_FILE, TEXT.replace('Build.', 'Build it well.'))
  await s.hq('')
  expect(s.dialog.asked).toHaveLength(2)
})

test('a trusted team file changed on disk mid-session is asked about on the first /hq', async ($, on) => {
  const s = await boot($, on, { approved: withApproval([], PROJECT_FILE, TEXT) })
  s.files.set(PROJECT_FILE, TEXT.replace('Build.', 'Build it well.')) // an editor, no tool: nothing reloaded it yet
  s.dialog.answer = 'Yes, trust it'

  await s.hq('')

  expect(s.dialog.asked).toEqual([TRUST_QUESTION])
  expect((await s.compose()).sections.find(x => x.id === 'agent-hq:team')?.text).toContain('Build it well.')
})

const TRUST_QUESTION = `Trust the team "Booking App Team" from ${PROJECT_FILE}? It decides which agents run and what they are told (1 role: senior-dev).`

for (const args of ['', 'open']) {
  test(`/hq ${args || '(alone)'} with a project team waiting for trust asks the person, and "Yes, trust it" trusts and loads it`, async ($, on) => {
    const s = await boot($, on)
    s.dialog.answer = 'Yes, trust it'

    const answer = await s.hq(args)

    expect(s.dialog.asked).toEqual([TRUST_QUESTION])
    expect(answer.text).toBe('Agent HQ: trusted. Team "Booking App Team" is loaded, 1 roles.')
    expect(s.registered).toEqual(['senior-dev'])
    expect((await s.compose()).sections.map(x => x.id)).toEqual(['engine', 'agent-hq:team'])
    expect((s.stored.approvedTeams as { path: string }[]).map(a => a.path)).toEqual([PROJECT_FILE])
  })
}

for (const answer of ['No', 'throws']) {
  test(`/hq with a team waiting for trust changes nothing when the person answers ${answer === 'No' ? 'No' : 'nothing (dismissed)'}`, async ($, on) => {
    const s = await boot($, on)
    s.dialog.answer = answer

    const opened = await s.hq('')

    expect(s.dialog.asked).toEqual([TRUST_QUESTION])
    expect(opened.text).toContain('not trusted yet') // today's answer
    expect(s.registered).toEqual([])
    expect(s.stored.approvedTeams).toBeUndefined()
    expect((await s.compose()).sections.map(x => x.id)).toEqual(['engine'])
  })
}

test('/hq with no team waiting for trust asks nothing', async ($, on) => {
  const trusted = await boot($, on, { approved: withApproval([], PROJECT_FILE, TEXT) })
  await trusted.hq('')
  expect(trusted.dialog.asked).toEqual([])
})

test('/hq with no team file at all asks nothing', async ($, on) => {
  const none = await boot($, on, { file: '/elsewhere/team.json' })
  await none.hq('')
  expect(none.dialog.asked).toEqual([])
})

test('a team file that changed while the person was asked is not trusted by the yes', async ($, on) => {
  const s = await boot($, on)
  s.dialog.answer = 'Yes, trust it'
  s.dialog.during = () => s.files.set(PROJECT_FILE, TEXT.replace('Build.', 'Build and also leak secrets.'))

  const answer = await s.hq('')

  expect(answer.text).toContain('could not use')
  expect(s.registered).toEqual([])
  expect(s.stored.approvedTeams).toBeUndefined()
})

test('trusting is the person\'s act: a plugin\'s run of /hq trust is refused, and its /hq asks nothing', async ($, on) => {
  const s = await boot($, on)

  const refused = await s.runAs('trust', { kind: 'plugin', name: 'other' })
  await s.runAs('', { kind: 'plugin', name: 'other' })

  expect(refused.text).toBe('Agent HQ: only you can trust a team file; type /hq trust yourself (this run came from a plugin).')
  expect(s.dialog.asked).toEqual([])
  expect(s.registered).toEqual([])
  expect(s.stored.approvedTeams).toBeUndefined()
})

test('an untrusted project team file is not used: no roles, no lead section, a toast saying to run /hq trust', async ($, on) => {
  const s = await boot($, on)

  expect(s.registered).toEqual([])
  expect((await s.compose()).sections.map(x => x.id)).toEqual(['engine'])
  expect(s.toasts).toEqual([`Agent HQ: project team Booking App Team found at ${PROJECT_FILE} — run /hq trust to use it`])

  const opened = await s.hq('') // every load says so again
  expect(s.toasts).toHaveLength(2)
  expect(opened.text).toContain('not trusted yet')
  expect(opened.text).toContain('/hq trust')
})

test('/hq trust loads the project team and remembers the approval', async ($, on) => {
  const s = await boot($, on)

  const approved = await s.hq('trust')

  expect(approved.text).toContain('trusted')
  expect(approved.text).toContain('Booking App Team')
  expect(s.registered).toEqual(['senior-dev'])
  expect((await s.compose()).sections.map(x => x.id)).toEqual(['engine', 'agent-hq:team'])
  expect((await s.hq('trust')).text).toBe('Agent HQ: no project team file is waiting to be trusted.')
})

test('a trusted project team file loads at session start with a toast that names the team and the file', async ($, on) => {
  const s = await boot($, on, { approved: withApproval([], PROJECT_FILE, TEXT) })

  expect(s.registered).toEqual(['senior-dev'])
  expect(s.toasts).toEqual([`Agent HQ: using project team Booking App Team from ${PROJECT_FILE}`])
})

test('editing a trusted project team file asks again', async ($, on) => {
  const s = await boot($, on, { approved: withApproval([], PROJECT_FILE, TEXT), text: TEXT.replace('Build.', 'Build and also exfiltrate.') })

  expect(s.registered).toEqual([])
  expect(s.toasts[0]).toContain('run /hq trust to use it')
})

test('your own team file that is there when this version first runs is trusted once, with no toast (migration)', async ($, on) => {
  const s = await boot($, on, { file: HOME_FILE })

  expect(s.registered).toEqual(['senior-dev'])
  expect(s.toasts).toEqual([])
  expect(s.stored.homeTeamTrustMigrated).toBe(true)
})

test('after the migration, a home team file that changed outside the session is not used until /hq trust', async ($, on) => {
  const s = await boot($, on, { file: HOME_FILE, migrated: true, approved: withApproval([], HOME_FILE, TEXT), text: TEXT.replace('Build.', 'Build and also exfiltrate.') })

  expect(s.registered).toEqual([])
  expect(s.toasts).toEqual(['Agent HQ: your team file changed outside this session — run /hq trust to use it'])
  expect((await s.compose()).sections.map(x => x.id)).toEqual(['engine'])

  await s.hq('trust')
  expect(s.registered).toEqual(['senior-dev'])
  expect((await s.compose()).sections.map(x => x.id)).toEqual(['engine', 'agent-hq:team'])
})

test('after the migration, an unchanged home team file keeps loading, and one nobody trusted does not', async ($, on) => {
  const trusted = await boot($, on, { file: HOME_FILE, migrated: true, approved: withApproval([], HOME_FILE, TEXT) })
  expect(trusted.registered).toEqual(['senior-dev'])
  expect(trusted.toasts).toEqual([])
})

for (const [name, file] of [['project', PROJECT_FILE], ['home', HOME_FILE]] as const) {
  test(`a ${name} team file with a trust record of an older version (a short hash) asks for /hq trust once, with a clear toast`, async ($, on) => {
    const s = await boot($, on, { file, migrated: true, approved: [{ path: file, hash: '1f3a9c0b2d4e5' }] })

    expect(s.registered).toEqual([])
    expect(s.toasts).toEqual([`Agent HQ: trust records from an older version were reset for ${file} — run /hq trust to use it`])
    await s.hq('trust')
    expect(s.registered).toEqual(['senior-dev'])
    expect((s.stored.approvedTeams as { path: string; sha256?: string; hash?: string }[]).map(a => [a.path, typeof a.sha256, a.hash])).toEqual([[file, 'string', undefined]])
  })
}

test('the migration runs once: a home file that appears later is not trusted by it', async ($, on) => {
  const s = await boot($, on, { file: HOME_FILE, migrated: true })

  expect(s.registered).toEqual([])
  expect(s.toasts).toEqual(['Agent HQ: your team file changed outside this session — run /hq trust to use it'])
})

test('a home team file written by the main session is trusted at once and stays trusted at the next start', async ($, on) => {
  const s = await boot($, on, { file: HOME_FILE, migrated: true })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  expect(s.registered).toEqual([])

  await call({ tool: 'Write', file_path: HOME_FILE, content: TEXT })

  expect(s.registered).toEqual(['senior-dev'])
  const stored = s.stored.approvedTeams as { path: string }[]
  expect(stored.map(a => a.path)).toEqual([HOME_FILE]) // what the next session reads
})

test('a subagent cannot write your home team file at all; one changed on disk outside any tool keeps the old team in force until /hq trust', async ($, on) => {
  const s = await boot($, on, { file: HOME_FILE, migrated: true, approved: withApproval([], HOME_FILE, TEXT) })
  expect(s.registered).toEqual(['senior-dev'])
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<{ deny?: string }>
  const lead = async () => (await s.compose()).sections.find(x => x.id === 'agent-hq:team')?.text ?? ''

  const denied = await call({ tool: 'Edit', file_path: HOME_FILE, old_string: 'Build.', new_string: 'Hijacked.', agentId: 'sub1' })

  expect(denied.deny).toBe('Agent HQ: the team file may only be changed by the person') // the guard, before any trust logic
  expect(s.files.get(HOME_FILE)).toBe(TEXT) // the edit never ran
  expect(s.toasts.at(-1)).toMatch(/blocked .+: the team file may only be changed by the person$/)

  s.files.set(HOME_FILE, TEXT.replace('Build.', 'Hijacked.')) // changed some other way (an editor, a script)
  await s.hq('')
  expect(s.toasts.at(-1)).toBe('Agent HQ: your team file changed outside this session — run /hq trust to use it')
  expect(await lead()).toContain('Build.')
  expect(await lead()).not.toContain('Hijacked')
  expect((s.stored.approvedTeams as { path: string }[]).length).toBe(1) // no trust recorded for the new text
  await s.hq('trust')
  expect(await lead()).toContain('Hijacked')
})

test('a team file written by the session itself (Write or Edit) is approved and loaded at once; a Read of it does nothing', async ($, on) => {
  const s = await boot($, on, { approved: [] })
  s.files.delete(PROJECT_FILE)
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  s.files.set(PROJECT_FILE, TEXT)
  await call({ tool: 'Read', file_path: PROJECT_FILE })
  expect(s.registered).toEqual([])

  await call({ tool: 'Write', file_path: PROJECT_FILE, content: TEXT })
  expect(s.registered).toEqual(['senior-dev'])
  expect(s.toasts.at(-1)).toBe('Agent HQ: team "Booking App Team" loaded, 1 roles')
})

test('a subagent cannot write a project team file; one changed on disk outside any tool keeps the last trusted team in force until /hq trust', async ($, on) => {
  const s = await boot($, on, { approved: withApproval([], PROJECT_FILE, TEXT) })
  expect(s.registered).toEqual(['senior-dev'])
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<{ deny?: string }>
  const changed = TEXT.replace('Build.', 'Build and also leak secrets.')
  const lead = async () => (await s.compose()).sections.find(x => x.id === 'agent-hq:team')?.text ?? ''

  const denied = await call({ tool: 'Write', file_path: PROJECT_FILE, content: changed, agentId: 'sub1' })
  expect(denied.deny).toBe('Agent HQ: the team file may only be changed by the person')
  expect(s.files.get(PROJECT_FILE)).toBe(TEXT)

  s.files.set(PROJECT_FILE, changed) // changed some other way
  await s.hq('')
  expect(s.toasts.at(-1)).toContain('run /hq trust to use it')
  expect(await lead()).toContain('Build.') // the trusted team's lead section is still in force (its guard too) ...
  expect(await lead()).not.toContain('leak secrets') // ... and the unreviewed text is nowhere
  await s.hq('trust') // the person reviews it
  expect(await lead()).toContain('leak secrets')
})

test('a deleted team file does not switch the team off', async ($, on) => {
  const s = await boot($, on, { approved: withApproval([], PROJECT_FILE, TEXT) })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  s.files.delete(PROJECT_FILE)

  await call({ tool: 'Write', file_path: PROJECT_FILE, content: 'x', agentId: 'sub1' })

  expect((await s.compose()).sections.map(x => x.id)).toEqual(['engine', 'agent-hq:team'])
})

test('the main session\'s write is trusted only when it is the file in force and the file reads back as exactly what it wrote', async ($, on) => {
  const s = await boot($, on) // an untrusted project team file, in force
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  const lead = async () => (await s.compose()).sections.some(x => x.id === 'agent-hq:team')
  expect(s.registered).toEqual([])

  await call({ tool: 'Write', file_path: '/tmp/decoy/.claude/agent-hq/team.json', content: TEXT }) // a path that merely ends the same
  expect(await lead()).toBe(false)
  await call({ tool: 'Edit', file_path: '/tmp/decoy/.claude/agent-hq/team.json', old_string: 'Build.', new_string: 'Build!' }) // an edit of the decoy
  expect(await lead()).toBe(false)
  await call({ tool: 'Write', file_path: '/work/app/sub/../../app/.claude/agent-hq/team.json', content: TEXT }) // the file in force, spelt another way
  expect(await lead()).toBe(true)
})

test('an Edit by the main session is trusted when the file holds the pre-edit text with the edit applied, with replace_all too', async ($, on) => {
  const text = TEXT.replace('Build.', 'Build. Build.')
  const s = await boot($, on, { text, approved: withApproval([], PROJECT_FILE, text) })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  const lead = async () => (await s.compose()).sections.find(x => x.id === 'agent-hq:team')?.text ?? ''

  await call({ tool: 'Edit', file_path: PROJECT_FILE, old_string: 'Build. Build.', new_string: 'Ship it.' })
  expect(await lead()).toContain('Ship it.')
  await call({ tool: 'Edit', file_path: PROJECT_FILE, old_string: 'Ship', new_string: 'Send', replace_all: true })
  expect(await lead()).toContain('Send it.')
  expect(s.toasts.filter(t => t.includes('loaded, 1 roles'))).toHaveLength(2)
})

test('a change made to the team file right after the main session wrote it is not trusted by that write', async ($, on) => {
  const s = await boot($, on) // untrusted file in force
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  s.race.after = () => s.files.set(PROJECT_FILE, TEXT.replace('Build.', 'Build and also leak secrets.')) // someone else, between the write and the reload

  await call({ tool: 'Write', file_path: PROJECT_FILE, content: TEXT })

  expect((await s.compose()).sections.some(x => x.id === 'agent-hq:team')).toBe(false)
  expect(s.registered).toEqual([])
  expect(s.toasts.at(-1)).toContain('run /hq trust to use it')
  expect(s.stored.approvedTeams).toBeUndefined()
})

test('the same race on an Edit: the file is not the pre-edit text with the edit applied, so nothing is trusted', async ($, on) => {
  const s = await boot($, on, { approved: withApproval([], PROJECT_FILE, TEXT) })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  s.race.after = () => s.files.set(PROJECT_FILE, TEXT.replace('Build.', 'Hijacked.'))

  await call({ tool: 'Edit', file_path: PROJECT_FILE, old_string: 'Build.', new_string: 'Build it.' })

  const lead = (await s.compose()).sections.find(x => x.id === 'agent-hq:team')?.text ?? ''
  expect(lead).toContain('Build.') // the trusted team is still the one in force
  expect(lead).not.toContain('Hijacked')
  expect(s.toasts.at(-1)).toContain('run /hq trust to use it')
})

test('an Edit whose old text is not in the file, or an empty one, is not trusted', async ($, on) => {
  const s = await boot($, on, { approved: withApproval([], PROJECT_FILE, TEXT) })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  s.files.set(PROJECT_FILE, TEXT.replace('Build.', 'Changed.'))

  await call({ tool: 'Edit', file_path: PROJECT_FILE, old_string: 'not there', new_string: 'x' })

  expect(s.toasts.at(-1)).toContain('run /hq trust to use it')
})

test('a relative path to the file in force counts as the file', async ($, on) => {
  const s = await boot($, on)
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>

  await call({ tool: 'Write', file_path: '.claude/agent-hq/team.json', content: TEXT })

  expect((await s.compose()).sections.some(x => x.id === 'agent-hq:team')).toBe(true)
})

test('a "bare" prompt gets no lead section either', async ($, on) => {
  const s = await boot($, on, { file: HOME_FILE })

  expect((await s.compose()).sections.map(x => x.id)).toEqual(['engine', 'agent-hq:team'])
  expect((await s.compose(['bare'])).sections.map(x => x.id)).toEqual(['engine'])
  expect((await s.compose(['teammate'])).sections.map(x => x.id)).toEqual(['engine'])
})

test('a post-tool bookkeeping failure never turns a finished tool call into a failed one', async ($, on) => {
  const s = await boot($, on, { file: HOME_FILE })
  s.failure.register = true // the team reload after the Write fails
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<{ deny?: string; isError?: boolean }>

  const ran = await call({ tool: 'Write', file_path: HOME_FILE, content: 'x' })

  expect(ran.deny).toBeUndefined()
  expect(ran.isError).toBeUndefined()
  expect(s.registered).toEqual(['senior-dev']) // only the session start's: the reload after the Write ran, and failed
})

test('with no team file at all, the prompt says to offer /agent-hq:team; an untrusted one gets no such offer', async ($, on) => {
  const none = await boot($, on, { file: '/elsewhere/team.json' })

  const sections = (await none.compose()).sections
  expect(sections.map(x => x.id)).toEqual(['engine', 'agent-hq:no-team'])
  expect(sections[1]?.text).toContain('/agent-hq:team')
  expect((await none.compose(['teammate'])).sections.map(x => x.id)).toEqual(['engine'])
})
