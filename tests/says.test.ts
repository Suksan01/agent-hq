// What each agent says it is doing (hq_doing), and the line shown when it said nothing: its step, its assignment, or for
// the lead a line worked out from the team. Pure: hooks/says.ts.
import { expect, test } from 'claude-code/testing'
import type { AgentInfo } from 'claude-code'

import { SAYS_MAX, cleanSaying, pruneSays, sayingOf } from '../hooks/says'
import { maskSecrets } from '../hooks/secrets'
import { DOING_TOOL, COORDINATION_TOOLS, MAIN, mergeAgents } from '../hooks/model'
import { guardToolCall } from '../hooks/guard'
import { leadPrompt, parseTeam, rolePrompt } from '../hooks/team'
import { trackCells } from '../hooks/cells'
import type { HqData } from '../hooks/view'

const graphemes = (s: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), g => g.segment)

test('secrets never reach the line: tokens, keys, KEY=value, long opaque strings, URLs with credentials', () => {
  const cases = [
    'pushing with ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'calling the API with sk-ant-api03-abcdefGHIJKL0123456789',
    'set API_KEY=supersecretvalue and run',
    'password: hunter2 for the db',
    'token=abc123def456 in the header',
    'fetch https://admin:s3cret@example.com/data',
    'commit 9f8e7d6c5b4a39281706f5e4d3c2b1a0ffeeddcc',
    'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
    'aws AKIAIOSFODNN7EXAMPLE key',
  ]
  const secrets = ['ghp_abcdef', 'sk-ant-api03', 'supersecretvalue', 'hunter2', 'abc123def456', 's3cret', '9f8e7d6c5b4a', 'eyJhbGciOi', 'AKIAIOSFODNN7']
  cases.forEach((text, i) => expect(maskSecrets(text), text).not.toContain(secrets[i]))
  expect(maskSecrets('set API_KEY=supersecretvalue and run')).toBe('set API_KEY=*** and run')
  expect(maskSecrets('fetch https://admin:s3cret@example.com/data')).toBe('fetch https://***@example.com/data')
  // plain words, paths, Thai and short numbers stay
  for (const plain of ['Fixing the old API in src/components/booking-calendar.tsx', 'กำลังแก้ API เก่า', 'Running 12 tests on port 3000', 'internationalization']) {
    expect(maskSecrets(plain)).toBe(plain)
  }
})

test('more secrets never reach the line: AWS secret keys, a secret word then its value, GitLab, Slack webhooks, Google OAuth, -u user:pass', () => {
  const cases: [string, string][] = [
    ['export the key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY now', 'wJalrXUtnFEMI'],
    ['aws_secret_access_key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'K7MDENG'],
    ['logging in with --password hunter2now', 'hunter2now'],
    ['the password is hunter2now, try it', 'hunter2now'],
    ['the API token is 9a8b7c6d for staging', '9a8b7c6d'],
    ['pushing with glpat-xYz12AbCdEfGhIjKlMn to GitLab', 'glpat-'],
    // a fake webhook, split so GitHub's push protection doesn't take it for a real one
    ['posting to https://hooks.slack.com/services/' + 'T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx', 'T0123ABCD'],
    ['calling Drive with ya29.a0AfH6SMBx-3kLmNoPqRsTuVwXyZ', 'a0AfH6SMBx'],
    ['curl -u admin:s3cretpass https://api.example.com', 's3cretpass'],
    ['curl --user=admin:s3cretpass https://api.example.com', 's3cretpass'],
    ['รหัสผ่าน hunter2now สำหรับฐานข้อมูล', 'hunter2now'],
    ['ใช้โทเคน: abc12345xyz ก่อน', 'abc12345xyz'],
    ['รหัส 9a8b7c6d ของ staging', '9a8b7c6d'],
    ['the key wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY is live', 'wJalrXUtnFEMIK7'],
    ['secret key wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY.', 'K7MDENG'], // at a sentence's end: a full stop is no extension
    ['the API key is abc123xyz9 for now', 'abc123xyz9'],
    ['api key: k3yv4lue99', 'k3yv4lue99'],
  ]
  for (const [text, secret] of cases) expect(maskSecrets(text), text).not.toContain(secret)
  expect(maskSecrets('the password is hunter2now, try it')).toBe('the password is ***, try it')
  expect(maskSecrets('curl -u admin:s3cretpass https://api.example.com')).toBe('curl -u admin:*** https://api.example.com')
  expect(maskSecrets('posting to https://hooks.slack.com/services/' + 'T0123ABCD/B0456EFGH/abcdefghijklmnopqrstuvwx')).toBe('posting to https://hooks.slack.com/services/***')
  // ordinary sentences about secrets, paths and Thai stay as they are
  for (const plain of [
    'Fixing the token refresh logic',
    'Updating the password reset page so the password field is checked',
    'the secret is out: we ship on Friday',
    'Moving src/components/BookingCalendar/index.tsx to the new folder',
    'Reading /Users/me/work/agent-hq-0.6.0/hooks/talk.ts',
    'Run curl -u with the deploy user from the vault',
    'กำลังแก้หน้ารีเซ็ตรหัสผ่าน',
    'ตรวจ token ที่หมดอายุ แล้วแก้ password reset',
    // what the review found masked by mistake: paths, identifiers, numbers after a secret word
    'Edit src/pages/Checkout/Step2/PaymentForm/CardInput.tsx',
    'Fix src/components/BookingCalendar/WeekView2.tsx',
    'Run test_login_with_expired_token_returns_401',
    'Rename MAX_RETRY_ATTEMPTS_FOR_UPLOAD_V2 constant',
    'Wire useState hook in AppProviderContextWrapper2Component',
    'Fixing token 401 error',
    'Update secret 2 of 3 in the vault docs',
    'Passwords: 3 tests failing',
    'แก้รหัสผ่าน 3 ข้อที่ล้มเหลว',
    'Rotate the API key next week',
    'Fix the OAuth2 token: v2 migration',
    'secret: v2 of the plan',
    'the token is v1.2.3 now',
  ]) {
    expect(maskSecrets(plain), plain).toBe(plain)
  }
})

test('a saying is one line, masked, at most 90 characters, cut between clusters', () => {
  expect(cleanSaying('Fixing the API\n  and   its tests')).toBe('Fixing the API and its tests')
  expect(cleanSaying('   ')).toBe('')
  expect(cleanSaying(42)).toBe('')
  const long = cleanSaying('a'.repeat(200))
  expect(long.length).toBeLessThanOrEqual(SAYS_MAX)
  expect(long.endsWith('…')).toBe(true)
  const thai = 'กำลังแก้ปัญหาของ API เก่าที่ทำให้หน้าค้นหาช้ามากและเขียนเทสต์ให้ครบทุกกรณีที่ผู้ใช้เจอบ่อยที่สุดในสัปดาห์นี้'
  const cut = cleanSaying(thai)
  expect(cut.length).toBeLessThanOrEqual(SAYS_MAX)
  const kept = cut.replace(/…$/, '')
  expect(graphemes(thai).slice(0, graphemes(kept).length).join('')).toBe(kept) // a whole-cluster prefix
  expect(cleanSaying('deploying with ghp_abcdefghijklmnopqrstuvwxyz0123456789')).not.toContain('ghp_')
})

const member = (id: string, status: AgentInfo['status'] = 'running'): AgentInfo => ({ id, name: `dev-${id}`, type: 'agent-hq:dev', description: 'x', status })
const base = (listed: AgentInfo[]): HqData => ({ agents: mergeAgents({}, listed, 0), todos: {}, tasks: {}, now: 1000, hideFinished: false, columns: 46, isLight: false, team: null })
const step = (content: string, activeForm: string) => ({ content, activeForm, status: 'in_progress' as const })

test('the line shown: a fresh hq_doing sentence, then the step in progress, then the assignment, else nothing', () => {
  const data = base([member('a')])
  const row = data.agents.a
  if (!row) throw new Error('no row')
  expect(sayingOf(row, data)).toBeNull()

  const assigned: HqData = { ...data, assignments: { 'dev-a': { role: 'dev', name: 'dev-a', task: 'Build the search page\nUse the old API.', at: 0 } } }
  expect(sayingOf(row, assigned)).toEqual({ text: 'Build the search page', source: 'assignment' })

  const stepping: HqData = { ...assigned, todos: { a: [step('Fix the old API', 'Fixing the old API')] } }
  expect(sayingOf(row, stepping)).toEqual({ text: 'Fixing the old API', source: 'step' })

  const said: HqData = { ...stepping, says: { a: { text: 'Working on the old API and fixing its issues', at: 5, step: 'Fix the old API' } } }
  expect(sayingOf(row, said)).toEqual({ text: 'Working on the old API and fixing its issues', source: 'doing' })

  // the step it was said for is over: the sentence is stale, the new step speaks
  const moved: HqData = { ...said, todos: { a: [{ ...step('Fix the old API', 'x'), status: 'completed' }, step('Write tests', 'Writing tests')] } }
  expect(sayingOf(row, moved)).toEqual({ text: 'Writing tests', source: 'step' })
})

test('every sentence the line shows is masked: the step and the assignment as much as what hq_doing said', () => {
  const data = base([member('a')])
  const row = data.agents.a
  if (!row) throw new Error('no row')
  const assigned: HqData = { ...data, assignments: { 'dev-a': { role: 'dev', name: 'dev-a', task: 'Deploy with --password hunter2now\nthen check', at: 0 } } }
  expect(sayingOf(row, assigned)?.text).toBe('Deploy with --password ***')
  const stepping: HqData = { ...assigned, todos: { a: [step('Deploy', 'Deploying with token=abc12345\nand   checking')] } }
  expect(sayingOf(row, stepping)).toEqual({ text: 'Deploying with token=*** and checking', source: 'step' })
  const content: HqData = { ...assigned, todos: { a: [step('Push with glpat-xYz12AbCdEfGhIjKlMn', '')] } }
  expect(sayingOf(row, content)?.text).toBe('Push with ***')
})

test('a finished or idle agent says nothing, whatever it said before', () => {
  for (const status of ['completed', 'failed', 'killed', 'idle'] as const) {
    const data: HqData = { ...base([member('a', status)]), says: { a: { text: 'Fixing', at: 1 } }, todos: { a: [step('x', 'Doing x')] } }
    const row = data.agents.a
    if (!row) throw new Error('no row')
    expect(sayingOf(row, data), status).toBeNull()
  }
})

test('the lead, saying nothing, waits for its members or plans', () => {
  const data = base([member('a'), member('b'), member('c'), member('d', 'completed')])
  const lead = data.agents[MAIN]
  if (!lead) throw new Error('no lead')
  expect(sayingOf(lead, data)).toEqual({ text: 'Waiting for 3 of 4 members', source: 'lead' })
  expect(sayingOf(lead, data, 'th')).toEqual({ text: 'รอสมาชิก 3/4', source: 'lead' })

  const alone = base([member('d', 'completed')])
  const leadAlone = alone.agents[MAIN]
  if (!leadAlone) throw new Error('no lead')
  expect(sayingOf(leadAlone, alone)).toBeNull() // idle between turns: today's line stays
  const busy: HqData = { ...alone, activity: { [MAIN]: { text: 'Reading a.ts', since: 0, callId: 'c' } } }
  expect(sayingOf(leadAlone, busy)).toEqual({ text: 'Planning', source: 'lead' })
  expect(sayingOf(leadAlone, busy, 'th')).toEqual({ text: 'กำลังวางแผน', source: 'lead' })

  const said: HqData = { ...data, says: { [MAIN]: { text: 'Reviewing the API fix', at: 3 } } }
  expect(sayingOf(lead, said)).toEqual({ text: 'Reviewing the API fix', source: 'doing' })
})

test('pruneSays drops what finished or idle agents said and sentences whose step is over', () => {
  const agents = mergeAgents({}, [member('a'), member('b'), member('c', 'completed'), member('d', 'idle')], 0)
  const says = { a: { text: 'A', at: 1, step: 'one' }, b: { text: 'B', at: 1, step: 'old' }, c: { text: 'C', at: 1 }, d: { text: 'D', at: 1 }, [MAIN]: { text: 'L', at: 1 } }
  const todos = { a: [step('one', 'One')], b: [step('new', 'New')] }
  expect(pruneSays(says, agents, todos)).toEqual({ a: { text: 'A', at: 1, step: 'one' }, [MAIN]: { text: 'L', at: 1 } })
  const fresh = { a: says.a }
  expect(pruneSays(fresh, agents, todos)).toBe(fresh) // nothing to drop: the same object back
})

test('every member may call hq_doing: it is a coordination tool, kept in a tools list and never guarded', () => {
  expect(DOING_TOOL).toBe('mcp__agent-hq__hq_doing')
  expect(COORDINATION_TOOLS).toContain(DOING_TOOL)
  const team = parseTeam(
    JSON.stringify({
      name: 'T',
      lead: { title: 'Lead' },
      roles: [{ id: 'reviewer', title: 'Reviewer', count: 1, mission: 'Review.', tools: ['Read', 'Grep'], guard: { readOnly: true } }],
    }),
  )
  if (typeof team === 'string') throw new Error(team)
  expect(team.roles[0]?.tools).toContain(DOING_TOOL)
  expect(guardToolCall({ team, role: 'reviewer', subagent: true, tool: DOING_TOOL, input: { text: 'Reviewing' } } as never)).toBeNull()
})

test('the lead says what it does with hq_doing at each step; a member only when its step title would not say it', () => {
  const team = parseTeam(JSON.stringify({ name: 'T', lead: { title: 'Lead' }, roles: [{ id: 'dev', title: 'Dev', count: 1, mission: 'Build.' }] }))
  if (typeof team === 'string') throw new Error(team)
  const role = team.roles[0]
  if (!role) throw new Error('no role')
  for (const prompt of [rolePrompt(team, role), rolePrompt(team, role, true, 'th'), leadPrompt(team)]) {
    expect(prompt).toContain(DOING_TOOL)
    expect(prompt).toMatch(/in the person's language/)
  }
  expect(leadPrompt(team)).toMatch(/at the start of each step/i)
  // a member's step in progress already shows (says.ts falls back to it), so a call per step is a tool call wasted
  for (const prompt of [rolePrompt(team, role), rolePrompt(team, role, true, 'th')]) {
    expect(prompt).not.toMatch(/at the start of each step/i)
    expect(prompt).toContain(`call ${DOING_TOOL} only when a step's title would not say what you are doing`)
  }
})

test('a pill with no words keeps one space between its glyph and its count', () => {
  const chars = (b64: string) => {
    const words = new Uint32Array(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer)
    return Array.from({ length: words.length / 3 }, (_, i) => String.fromCodePoint(words[i * 3] ?? 32)).join('')
  }
  expect(chars(trackCells({ done: 3, total: 3, tone: 'done', label: '', count: '3/3' }, 30, 0, false))).toContain('✓ 3/3')
  expect(chars(trackCells({ done: 1, total: 4, tone: 'needs_input', label: '', count: '1/4' }, 30, 0, false))).toContain('? 1/4')
  expect(chars(trackCells({ done: 1, total: 4, tone: 'needs_input', label: 'Team', count: '1/4' }, 30, 0, false))).toContain('? Team 1/4')
})
