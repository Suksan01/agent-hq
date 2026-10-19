// Taking on staff in the team file's text, and what the lead is told about headcount.
import { expect, test } from 'claude-code/testing'

import { planHire } from '../hooks/hire'
import { leadPrompt, parseTeam } from '../hooks/team'

const source = (over: Record<string, unknown> = {}, roles?: unknown[]) =>
  JSON.stringify(
    {
      name: 'T',
      purpose: 'Build things',
      lead: { title: 'Lead', rules: ['Review everything'], skills: ['planning'] },
      extra: { kept: true },
      roles: roles ?? [
        { id: 'dev', title: 'Developer', mission: 'Build.', tasks: ['t'], rules: ['Never push'], skills: [], model: 'sonnet', futureField: 1 },
        { id: 'qa', title: 'QA Engineer', count: 3, mission: 'Test.', tasks: [], rules: [], skills: [] },
      ],
      ...over,
    },
    null,
    4,
  )

test('a role with no count counts as one; hiring raises it and keeps every other field of the file', () => {
  const plan = planHire(source(), { role: 'dev', add: 2 })
  if (!plan.ok) throw new Error(plan.error)

  expect([plan.before, plan.after, plan.hired, plan.created, plan.capped]).toEqual([1, 3, 2, false, false])
  const saved = JSON.parse(plan.source)
  expect(saved.extra).toEqual({ kept: true })
  expect(saved.roles[0]).toMatchObject({ id: 'dev', count: 3, model: 'sonnet', futureField: 1, rules: ['Never push'] })
  expect(saved.roles[1].count).toBe(3) // the other role is untouched
  expect(plan.source.endsWith('\n')).toBe(true)
  expect(typeof parseTeam(plan.source)).toBe('object')
})

test('the role id is matched after trimming, and a numeric add must be a whole number in range', () => {
  expect(planHire(source(), { role: ' qa ' }).ok).toBe(true)
  for (const add of [0, -1, 11, 2.5, '1', NaN, Infinity]) expect(planHire(source(), { role: 'qa', add }).ok, String(add)).toBe(false)
})

test('hiring into a team file that no longer parses says so instead of writing', () => {
  for (const broken of ['not json', '[]', '{"name":"T"}']) {
    const plan = planHire(broken, { role: 'dev' })
    expect(plan.ok).toBe(false)
  }
})

test('a new role gets sensible defaults, and a reviewer-like title makes it read-only', () => {
  const plan = planHire(source(), { role: 'auditor', title: 'Security Audit', mission: 'Find holes.' })
  if (!plan.ok) throw new Error(plan.error)

  const role = JSON.parse(plan.source).roles.at(-1)
  expect(role).toEqual({ id: 'auditor', title: 'Security Audit', count: 1, mission: 'Find holes.', tasks: [], rules: ['Do not edit files; report findings only.'], skills: [], guard: { readOnly: true } })
  const parsed = parseTeam(plan.source)
  if (typeof parsed === 'string') throw new Error(parsed)
  expect(parsed.roles.at(-1)?.guard?.readOnly).toBe(true)
})

test('a request that would make the file invalid is refused with parseTeam\'s reason', () => {
  const plan = planHire(source(), { role: 'x'.repeat(10), title: 'T'.repeat(5), mission: '   ' })
  expect(plan.ok).toBe(false)
  const placeholder = planHire(source(), { role: 'new', title: '<role title>', mission: 'Do the <thing>' })
  if (placeholder.ok) expect(typeof parseTeam(placeholder.source)).toBe('object') // whatever parseTeam allows, it never writes a file it would refuse
})

test('the lead is told the number beside a role is current staffing and how to add people', () => {
  const team = parseTeam(source({}, [{ id: 'dev', title: 'Developer', count: 4, mission: 'Build.', tasks: [], rules: [], skills: [] }]))
  if (typeof team === 'string') throw new Error(team)

  const prompt = leadPrompt(team)

  expect(prompt).toContain('Developer (4 on staff)')
  expect(prompt).toContain('current staffing, not a ceiling')
  expect(prompt).toContain('hq_hire')
  expect(prompt).not.toContain('never more of a role at once')
})

test('a new role can be hired with a full role card, kept as given and cleaned of blanks', () => {
  const plan = planHire(source(), {
    role: 'ux',
    title: 'UX Writer',
    mission: 'Write the copy.',
    tasks: [' Draft the copy ', '', 3, 'Report the changed strings'],
    rules: ['Never change layout'],
    skills: ['design:ux-copy'],
    tools: ['Read', 'Edit'],
    model: ' sonnet ',
    effort: 'low',
    playbook: 'Read the style guide first.',
  })
  if (!plan.ok) throw new Error(plan.error)

  expect(JSON.parse(plan.source).roles.at(-1)).toEqual({
    id: 'ux',
    title: 'UX Writer',
    count: 1,
    mission: 'Write the copy.',
    tasks: ['Draft the copy', 'Report the changed strings'],
    rules: ['Never change layout'],
    skills: ['design:ux-copy'],
    tools: ['Read', 'Edit'],
    model: 'sonnet',
    effort: 'low',
    playbook: 'Read the style guide first.',
  })
  expect(plan.card).toBe('2 tasks, 1 rule, skills design:ux-copy, tools Read, Edit, model sonnet')
})

test('a reviewer-like new role keeps its read-only rule ahead of the rules it was given', () => {
  const plan = planHire(source(), { role: 'rev', title: 'Code Reviewer', mission: 'Review.', rules: ['Treat security issues as blocking'] })
  if (!plan.ok) throw new Error(plan.error)
  expect(JSON.parse(plan.source).roles.at(-1).rules).toEqual(['Do not edit files; report findings only.', 'Treat security issues as blocking'])
})

test('a role card is only for a new role: hiring more of an existing one with card fields is refused', () => {
  const plan = planHire(source(), { role: 'dev', tasks: ['Something else'] })
  expect(plan.ok).toBe(false)
  if (!plan.ok) expect(plan.error).toContain('/agent-hq:team')
})

test('the lead is told to give a new role a full card', () => {
  const team = parseTeam(source())
  if (typeof team === 'string') throw new Error(team)
  expect(leadPrompt(team)).toContain('full role card')
})

test('every lead is told what a member brief must carry, since a member sees none of the conversation', () => {
  const team = parseTeam(source())
  if (typeof team === 'string') throw new Error(team)
  const prompt = leadPrompt(team)
  expect(prompt).toContain('## Briefing members')
  expect(prompt).toContain("the person's own words")
  expect(prompt).not.toContain('Team Assistant')
})

test('with a Team Assistant on the team, the lead has it write the briefs and proposals first', () => {
  const team = parseTeam(source({}, [
    { id: 'dev', title: 'Developer', mission: 'Build.' },
    { id: 'assistant', title: 'Team Assistant', mission: 'Write the briefs.', tools: ['Read', 'Grep', 'Glob'] },
  ]))
  if (typeof team === 'string') throw new Error(team)
  const prompt = leadPrompt(team)
  expect(prompt).toContain('have the Team Assistant ("agent-hq:assistant") write')
  expect(prompt).toContain('proposal')
})
