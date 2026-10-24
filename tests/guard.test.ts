// Spec for hooks/guard.ts: the tool-call guard for team roles. Decisions the spec pins down:
//  - the main session (role null), an unknown role and a missing team are never blocked;
//  - a command is judged by its command words: the text is split on && || ; | & and newlines (outside quotes), leading
//    VAR=value words are skipped, so `echo "git push"` and `git commit -m "git push"` are NOT pushes;
//  - a redirect to /dev/null or between descriptors (2>&1) is not a write;
//  - path globs are relative to `cwd` (when given); `*` stays within a folder, `**` crosses folders; `..` is resolved first;
//  - when a path guard applies and the call names no path, it is denied (fail closed);
//  - every deny text is one short line "Agent HQ: <what is not allowed> (<role title>)";
//  - wrappers (env, sudo, timeout, xargs …), a path to the command, `bash -c "…"` and `eval` do not hide a command;
//  - a role keeps its memory and the team notes only if it may write files at all; nobody changes a team.json;
//  - an agent a guarded role starts answers to that role's guard; an agent nothing is known about is refused.
import { expect, test } from 'claude-code/testing'

import type { HqTeam } from '../types'
import { agentRoles, guardToolCall } from '../hooks/guard'
import { parseTeam } from '../hooks/team'

type RoleSpec = Record<string, unknown>
const role = (id: string, title: string, extra: RoleSpec = {}): RoleSpec => ({ id, title, count: 2, mission: 'Do the job.', tasks: [], rules: [], skills: [], ...extra })

function teamOf(...roles: RoleSpec[]): HqTeam {
  const parsed = parseTeam(JSON.stringify({ name: 'Booking App Team', purpose: 'Build', lead: { title: 'Tech Lead', rules: [], skills: [] }, roles }))
  if (typeof parsed === 'string') throw new Error(parsed)
  // parseTeam is not what is under test here: put the raw guard back whatever it keeps
  return { ...parsed, roles: parsed.roles.map((r, i) => ({ ...r, ...(roles[i]?.guard ? { guard: roles[i]?.guard as never } : {}) })) }
}

const TEAM = teamOf(
  role('reviewer', 'Code Reviewer', { tools: ['Read', 'Grep', 'Bash'], rules: ['Never edit code', 'Never push or merge'] }),
  role('dev', 'Senior Developer', { rules: ['Never push to main'] }),
  role('free', 'Free Developer', { rules: ['Have every change reviewed'] }),
  role('flagged', 'Flagged Developer', { guard: { noPush: true } }),
  role('auditor', 'Auditor', { guard: { readOnly: true } }),
  role('scoped', 'Scoped Developer', { guard: { paths: ['src/**'] } }),
  role('editor', 'Editor', { tools: ['Read', 'Edit'] }),
)

const call = (roleId: string | null, tool: string, input: Record<string, unknown> = {}, extra: { assignment?: { paths?: string[] } | null; cwd?: string; team?: HqTeam | null } = {}) =>
  guardToolCall({ team: extra.team === undefined ? TEAM : extra.team, role: roleId, tool, input, assignment: extra.assignment, cwd: extra.cwd })
const bash = (roleId: string | null, command: string) => call(roleId, 'Bash', { command })

test('the main session, an unknown role and a missing team are never blocked', () => {
  expect(bash(null, 'git push origin main')).toBeNull()
  expect(call(null, 'Edit', { file_path: '/etc/passwd' })).toBeNull()
  expect(bash('ghost', 'git push')).toBeNull()
  expect(bash('dev', 'git push')).not.toBeNull()
  expect(call('dev', 'Bash', { command: 'git push' }, { team: null })).toBeNull()
})

test('a role with a tools list refuses every other tool and says which', () => {
  const edit = call('reviewer', 'Edit', { file_path: 'a.ts' })
  expect(edit?.deny).toMatch(/^Agent HQ: /)
  expect(edit?.deny).toContain('Edit')
  expect(edit?.deny).toMatch(/ \(Code Reviewer\)$/)
  expect(call('reviewer', 'WebFetch', { url: 'https://x.dev' })?.deny).toContain('WebFetch')
  expect(call('reviewer', 'Read', { file_path: 'a.ts' })).toBeNull()
  expect(call('reviewer', 'Grep', { pattern: 'x' })).toBeNull()
  expect(call('free', 'WebFetch', { url: 'https://x.dev' })).toBeNull() // no tools list: every tool
})

test('coordination tools (SendMessage, progress and task tools) are always allowed, for every role, whatever its tools list, read-only flag or path guard', () => {
  const PROGRESS = ['SendMessage', 'TodoWrite', 'mcp__plan-progress__plan_progress', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']
  // hand-built, so the tools lists really lack them (parseTeam adds them to a list; the guard must not depend on that)
  const bare: HqTeam = {
    ...TEAM,
    roles: [
      { id: 'narrow', title: 'Narrow', count: 1, mission: 'm', tasks: [], rules: [], skills: [], tools: ['Read'] },
      { id: 'ro', title: 'Read Only', count: 1, mission: 'm', tasks: [], rules: ['Never push'], skills: [], guard: { readOnly: true, noPush: true } },
      { id: 'scoped', title: 'Scoped', count: 1, mission: 'm', tasks: [], rules: [], skills: [], tools: ['Read', 'Edit'], guard: { paths: ['src/**'] } },
    ],
  }
  for (const roleId of ['narrow', 'ro', 'scoped', 'reviewer', 'auditor']) {
    for (const tool of PROGRESS) {
      const team = roleId === 'reviewer' || roleId === 'auditor' ? TEAM : bare
      expect(call(roleId, tool, { todos: [] }, { team }), `${roleId} ${tool}`).toBeNull()
    }
  }
  expect(call('narrow', 'Edit', { file_path: 'a.ts' }, { team: bare })).not.toBeNull() // only the coordination tools are let through
  expect(call('narrow', 'mcp__other__tool', {}, { team: bare })).not.toBeNull()
})

test('a read-only reviewer can report to the lead with SendMessage, and still cannot edit or write', () => {
  const narrow: HqTeam = { ...TEAM, roles: [{ id: 'rev', title: 'Code Reviewer', count: 1, mission: 'm', tasks: [], rules: [], skills: [], tools: ['Read', 'Grep'], guard: { readOnly: true } }] }
  const asReviewer = (tool: string, input: Record<string, unknown> = {}) => guardToolCall({ team: narrow, role: 'rev', tool, input })

  expect(asReviewer('SendMessage', { to: 'main', text: 'APPROVED' })).toBeNull()
  expect(asReviewer('TaskUpdate', { taskId: '3', status: 'completed' })).toBeNull()
  expect(asReviewer('Edit', { file_path: 'a.ts' })?.deny).toContain('Edit')
  expect(asReviewer('Write', { file_path: 'a.ts' })?.deny).toContain('Write')
  expect(asReviewer('WebFetch', { url: 'https://x.dev' })?.deny).toContain('WebFetch')
})

test('roles whose rules say never push, merge or publish are marked, in any case or wording', () => {
  for (const rule of ['Never push to main', 'Do not merge pull requests', "Don't publish releases", 'NEVER PUSH', 'You must not push or publish']) {
    const team = teamOf(role('dev', 'Dev', { rules: [rule] }))
    expect(guardToolCall({ team, role: 'dev', tool: 'Bash', input: { command: 'git push' } })?.deny, rule).toMatch(/^Agent HQ: /)
  }
  const unrelated = teamOf(role('dev', 'Dev', { rules: ['Have every change reviewed', 'Push yourself to write tests'] }))
  expect(guardToolCall({ team: unrelated, role: 'dev', tool: 'Bash', input: { command: 'git push' } })).toBeNull()
  expect(bash('flagged', 'git push')).not.toBeNull() // the explicit flag, with no rule text at all
  expect(bash('free', 'git push')).toBeNull()
})

test('push and publish commands are denied, chained, prefixed by env vars or a cd, and with git options', () => {
  const denied = [
    'git push',
    'git push origin main',
    'git push --force-with-lease',
    'git merge feature/search',
    'gh pr merge 12 --squash',
    'npm publish',
    'pnpm publish --access public',
    'yarn publish',
    'claude plugin publish ./mod',
    'GIT_SSH_COMMAND=ssh git push',
    'CI=1 FOO=bar npm publish',
    'cd repo && git push',
    'cd repo; git push origin HEAD',
    'npm test && git push',
    'git add . && git commit -m wip && git push',
    'npm test | git push',
    'false || git merge main',
    'git fetch\ngit push',
    'git -C ../other push',
  ]
  for (const command of denied) {
    const result = bash('dev', command)
    expect(result?.deny, command).toMatch(/^Agent HQ: .*\(Senior Developer\)$/)
  }
})

test('commands that only mention a push, or only look like one, are allowed', () => {
  const allowed = [
    'git status',
    'git log --oneline -5',
    'git diff main...HEAD',
    'git stash push -m wip',
    'git merge-base HEAD main',
    'gh pr view 12',
    'gh pr checks 12',
    'npm test',
    'npm run build',
    'pnpm install',
    'echo "git push"',
    "echo 'npm publish'",
    'git commit -m "do not git push yet"',
    'grep -rn "git push" docs',
    'cat docs/git-push.md',
    'ls publish',
    'git fetch && git status',
  ]
  for (const command of allowed) expect(bash('dev', command), command).toBeNull()
  expect(call('dev', 'Edit', { file_path: 'a.ts' })).toBeNull() // only commands are judged
})

test('read-only roles (flag, or a tools list with no Edit or Write) are denied every file-writing tool', () => {
  for (const roleId of ['auditor', 'reviewer']) {
    for (const [tool, input] of [
      ['Edit', { file_path: 'a.ts' }],
      ['Write', { file_path: 'a.ts' }],
      ['NotebookEdit', { notebook_path: 'n.ipynb' }],
    ] as const) {
      expect(call(roleId, tool, input)?.deny, `${roleId} ${tool}`).toMatch(/^Agent HQ: /)
    }
  }
  expect(call('auditor', 'Edit', { file_path: 'a.ts' })?.deny).toMatch(/read-only/)
  expect(call('auditor', 'Edit', { file_path: 'a.ts' })?.deny).toContain('Auditor')
  expect(call('auditor', 'Read', { file_path: 'a.ts' })).toBeNull()
  expect(call('free', 'Edit', { file_path: 'a.ts' })).toBeNull()
})

test('read-only roles are denied Bash commands that obviously write', () => {
  const denied = ['echo hi > out.txt', 'echo hi >> out.txt', 'cat a b > c', 'rm -rf dist', 'rm file', 'mv a b', "sed -i 's/a/b/' f.ts", "sed -i.bak 's/a/b/' f.ts", 'ls | tee out.txt', 'npm test && rm -rf tmp', 'cd x; mv a b']
  for (const command of denied) {
    expect(bash('auditor', command)?.deny, command).toMatch(/read-only/)
    expect(bash('reviewer', command)?.deny, command).toMatch(/read-only/)
  }
})

test('read-only roles may still run commands that only read', () => {
  const allowed = [
    'git diff',
    'git log 2>&1 | head -20',
    'ls -la',
    'ls > /dev/null',
    'npm test 2>/dev/null',
    'echo "a > b"',
    "grep -rn 'x > y' src | head",
    'cat a.txt | wc -l',
    "sed -n '1,5p' f.ts",
    'ls farm',
    'echo "rm -rf is dangerous"',
    'npm test',
  ]
  for (const command of allowed) expect(bash('auditor', command), command).toBeNull()
})

test('path guards: a role guard.paths or the assignment keeps Edit, Write and NotebookEdit inside the globs', () => {
  expect(call('scoped', 'Edit', { file_path: 'src/app/page.tsx' })).toBeNull()
  expect(call('scoped', 'Write', { file_path: 'src/new.ts' })).toBeNull()
  const out = call('scoped', 'Edit', { file_path: 'lib/other.ts' })
  expect(out?.deny).toMatch(/^Agent HQ: /)
  expect(out?.deny).toContain('src/**')
  expect(call('scoped', 'NotebookEdit', { notebook_path: 'notes/a.ipynb' })).not.toBeNull()
  expect(call('scoped', 'Read', { file_path: 'lib/other.ts' })).toBeNull() // reading is not scoped

  const assignment = { paths: ['app/search/**', 'components/Search*.tsx'] }
  expect(call('free', 'Edit', { file_path: 'app/search/page.tsx' }, { assignment })).toBeNull()
  expect(call('free', 'Edit', { file_path: 'components/SearchBar.tsx' }, { assignment })).toBeNull()
  expect(call('free', 'Edit', { file_path: 'app/cart/page.tsx' }, { assignment })?.deny).toContain('app/search/**')
  expect(call('free', 'Edit', { file_path: 'components/Cart.tsx' }, { assignment })).not.toBeNull()
  expect(call('free', 'Edit', { file_path: 'anything.ts' }, { assignment: { paths: [] } })).toBeNull() // no globs, no scope
  expect(call('free', 'Edit', { file_path: 'anything.ts' }, { assignment: null })).toBeNull()
})

test('path globs: * stays in one folder, ** crosses folders, ./ is ignored and .. is resolved', () => {
  const only = (paths: string[]) => ({ assignment: { paths } })
  expect(call('free', 'Edit', { file_path: 'src/a.ts' }, only(['src/*.ts']))).toBeNull()
  expect(call('free', 'Edit', { file_path: 'src/deep/a.ts' }, only(['src/*.ts']))).not.toBeNull()
  expect(call('free', 'Edit', { file_path: 'src/deep/a.ts' }, only(['src/**/*.ts']))).toBeNull()
  expect(call('free', 'Edit', { file_path: 'src/a.ts' }, only(['src/**/*.ts']))).toBeNull()
  expect(call('free', 'Edit', { file_path: './src/a.ts' }, only(['src/**']))).toBeNull()
  expect(call('free', 'Edit', { file_path: 'src/../secrets/key.ts' }, only(['src/**']))).not.toBeNull()
  expect(call('free', 'Edit', { file_path: 'src/a.ts' }, only(['lib/**', 'src/**']))).toBeNull() // any one glob will do
})

test('absolute paths are compared to the globs relative to cwd; outside cwd is outside', () => {
  const extra = { cwd: '/work/app', assignment: { paths: ['src/**'] } }
  expect(call('free', 'Edit', { file_path: '/work/app/src/a.ts' }, extra)).toBeNull()
  expect(call('free', 'Edit', { file_path: '/work/app/lib/a.ts' }, extra)).not.toBeNull()
  expect(call('free', 'Edit', { file_path: '/work/other/src/a.ts' }, extra)).not.toBeNull()
  expect(call('free', 'Edit', { file_path: '/work/app/src/../lib/a.ts' }, extra)).not.toBeNull()
  expect(call('free', 'Edit', { file_path: '/work/appsrc/a.ts' }, extra)).not.toBeNull()
  expect(call('free', 'NotebookEdit', { notebook_path: '/work/app/src/n.ipynb' }, extra)).toBeNull()
})

test('when a role guard and an assignment both set paths, a file must be inside both', () => {
  const extra = { assignment: { paths: ['src/search/**'] } }
  expect(call('scoped', 'Edit', { file_path: 'src/search/a.ts' }, extra)).toBeNull()
  expect(call('scoped', 'Edit', { file_path: 'src/cart/a.ts' }, extra)).not.toBeNull() // inside the role, outside the assignment
  expect(call('scoped', 'Edit', { file_path: 'lib/search/a.ts' }, extra)).not.toBeNull()
})

test('a path-guarded edit that names no path is denied rather than let through', () => {
  expect(call('scoped', 'Edit', {})).not.toBeNull()
  expect(call('scoped', 'Write', { file_path: 42 })).not.toBeNull()
  expect(call('free', 'Edit', {})).toBeNull() // nothing scoped, nothing to check
})

test('deny texts are short, human and name the role', () => {
  const samples = [bash('dev', 'git push'), call('auditor', 'Edit', { file_path: 'a' }), call('scoped', 'Edit', { file_path: 'lib/x.ts' }), call('reviewer', 'WebFetch', {})]
  for (const sample of samples) {
    expect(sample?.deny.length).toBeLessThanOrEqual(140)
    expect(sample?.deny).not.toContain('\n')
    expect(sample?.deny).toMatch(/^Agent HQ: .+ \(.+\)$/)
  }
  expect(samples[0]?.deny).toMatch(/push|publish/)
  expect(samples[0]?.deny).toContain('Senior Developer')
  expect(samples[2]?.deny).toContain('Scoped Developer')
})

test('parseTeam keeps a role guard and drops what is not a guard', () => {
  const read = (guard: unknown) => {
    const parsed = parseTeam(JSON.stringify({ name: 'T', purpose: 'p', lead: { title: 'L' }, roles: [role('dev', 'Dev', { guard })] }))
    if (typeof parsed === 'string') throw new Error(parsed)
    return parsed.roles[0]?.guard
  }
  expect(read({ noPush: true, readOnly: true, paths: ['src/**', 'lib/*.ts'] })).toEqual({ noPush: true, readOnly: true, paths: ['src/**', 'lib/*.ts'] })
  expect(read({ readOnly: true })).toEqual({ readOnly: true })
  expect(read({ noPush: 'yes', readOnly: 1, paths: 'src/**' })).toBeUndefined()
  expect(read({ paths: ['src/**', 7, ''] })).toEqual({ paths: ['src/**'] })
  expect(read(undefined)).toBeUndefined()
  expect(read('nope')).toBeUndefined()
})

test('a member that may write files keeps its own memory and the team notes whatever its paths, and nothing else that way', () => {
  const cwd = '/work/app'
  const own = (roleId: string) => `.claude/agent-memory/agent-hq-${roleId}/MEMORY.md` // the engine's folder for agent type agent-hq:<id>
  expect(call('scoped', 'Write', { file_path: own('scoped') }, { assignment: { paths: ['src/search/**'] } })).toBeNull() // outside its paths
  expect(call('scoped', 'Edit', { file_path: `${cwd}/${own('scoped')}` }, { cwd })).toBeNull()
  expect(call('scoped', 'Edit', { file_path: '.claude/agent-hq/team-notes.md' })).toBeNull()
  expect(call('editor', 'Edit', { file_path: own('editor') })).toBeNull()
  expect(call('editor', 'Write', { file_path: own('editor') })?.deny).toContain('Write') // Write is not one of its tools
  expect(call('auditor', 'Read', { file_path: own('auditor') })).toBeNull() // reading is never a problem

  // its own reports folder too, so the full report never needs a path in the assignment
  expect(call('scoped', 'Write', { file_path: '.claude/agent-hq/reports/scoped/scoped-1.md' }, { assignment: { paths: ['src/search/**'] } })).toBeNull()
  expect(call('scoped', 'Write', { file_path: '.claude/agent-hq/reports/dev/dev-1.md' }, { assignment: { paths: ['src/search/**'] } })).not.toBeNull() // another role's report
  expect(call('scoped', 'Write', { file_path: '.claude/agent-hq/reports/scoped/../../team.json' }, { assignment: { paths: ['src/search/**'] } })).not.toBeNull()

  expect(call('scoped', 'Edit', { file_path: own('dev') })).not.toBeNull() // another role's memory
  expect(call('scoped', 'Edit', { file_path: '.claude/agent-memory/agent-hq-scoped/../../../lib/a.ts' })).not.toBeNull()
  expect(call('scoped', 'Edit', { file_path: `/elsewhere/${own('scoped')}` }, { cwd })).not.toBeNull() // another project's
  expect(bash('scoped', 'echo x >> .claude/agent-hq/team-notes.md')).toBeNull() // not read-only: Bash is not path-scoped
  for (const path of [
    '.claude/agent-memory/agent-hq-scoped-evil/x', // a sibling folder sharing the prefix
    '.claude/agent-memory/agent-hq-scoped', // the folder itself, not a file in it
    '.claude/agent-hq/team-notes.md.bak',
    '.claude/agent-hq/team-notes.md/x',
    '/.claude/agent-memory/agent-hq-scoped/x', // absolute with no project folder to compare it to
  ])
    expect(call('scoped', 'Edit', { file_path: path }), path).not.toBeNull()
})

test('a read-only role may read its memory and the team notes but not write them', () => {
  const own = (roleId: string) => `.claude/agent-memory/agent-hq-${roleId}/MEMORY.md`
  for (const roleId of ['reviewer', 'auditor']) {
    for (const tool of ['Write', 'Edit'])
      for (const path of [own(roleId), '.claude/agent-hq/team-notes.md']) expect(call(roleId, tool, { file_path: path })?.deny, `${roleId} ${tool} ${path}`).toMatch(/^Agent HQ: /)
    for (const path of [own(roleId), '.claude/agent-hq/team-notes.md']) expect(call(roleId, 'Read', { file_path: path }), `${roleId} Read ${path}`).toBeNull()
  }
  expect(call('auditor', 'Edit', { file_path: own('auditor') })?.deny).toMatch(/read-only/)
  expect(bash('auditor', 'echo x >> .claude/agent-hq/team-notes.md')).not.toBeNull() // and not through Bash either
})

test('coordination tools stay open to a read-only role, so a reviewer can report', () => {
  expect(call('reviewer', 'SendMessage', { to: 'main', message: 'APPROVED' })).toBeNull()
  expect(call('auditor', 'TaskUpdate', { taskId: '1' })).toBeNull()
})

test('no member changes a team.json: Write, Edit, NotebookEdit and writing commands are refused for every role', () => {
  const file = '.claude/agent-hq/team.json'
  for (const roleId of ['dev', 'free', 'flagged', 'scoped', 'auditor', 'editor']) {
    for (const [tool, key] of [['Write', 'file_path'], ['Edit', 'file_path'], ['NotebookEdit', 'notebook_path']] as const) {
      if (roleId === 'editor' && tool !== 'Edit') continue
      for (const path of [file, `/work/app/${file}`, `/home/me/${file}`, `./${file}`, `.claude/x/../agent-hq/team.json`]) {
        expect(call(roleId, tool, { [key]: path }, { cwd: '/work/app' })?.deny, `${roleId} ${tool} ${path}`).toMatch(/team file/)
      }
    }
  }
  expect(call('free', 'Edit', { file_path: 'team.json' })).toBeNull() // some other team.json
  expect(call('free', 'Read', { file_path: file })).toBeNull() // reading it is fine
  expect(call('free', 'Edit', { file_path: '.claude/agent-hq/team-notes.md' })).toBeNull()

  const denied = [
    `echo '{}' > ${file}`,
    `echo '{}' >> ~/${file}`,
    `tee ${file} < new.json`,
    `cp new.json ${file}`,
    `mv new.json ${file}`,
    `rm ${file}`,
    `sed -i 's/a/b/' ${file}`,
    `cd .claude/agent-hq && echo {} > team.json`,
    `bash -c "echo {} > ${file}"`,
    `python3 -c "open('${file}','w').write('{}')"`,
  ]
  for (const command of denied) {
    expect(bash('free', command)?.deny, command).toMatch(/team file/)
    expect(bash('dev', command)?.deny, command).toMatch(/^Agent HQ: /)
  }
  for (const command of [`cat ${file}`, `cat ${file} | head`, `grep name ${file}`, `jq . ${file} > /dev/null`, `diff ${file} other.json`]) expect(bash('free', command), command).toBeNull()
})

test('a sub-agent that is no team member (a general agent, a workflow agent, an engine fork) has no role guard, but cannot change a team.json', () => {
  // the engine names no agent type in a tool call, and a member always shows in the roster: an agent with no role is judged as a non-member
  const outsider = (tool: string, input: Record<string, unknown>, extra: Partial<Parameters<typeof guardToolCall>[0]> = {}) => guardToolCall({ team: TEAM, role: null, subagent: true, tool, input, ...extra })
  expect(outsider('Bash', { command: 'git push origin main' })).toBeNull()
  expect(outsider('Bash', { command: 'rm -rf dist' })).toBeNull()
  expect(outsider('Edit', { file_path: 'src/a.ts' })).toBeNull()
  expect(outsider('Write', { file_path: '.claude/agent-memory/x/MEMORY.md' })).toBeNull()
  expect(outsider('SendMessage', { to: 'main' })).toBeNull()

  const file = '.claude/agent-hq/team.json'
  for (const [tool, input] of [
    ['Write', { file_path: file }],
    ['Edit', { file_path: `/home/me/${file}` }],
    ['NotebookEdit', { notebook_path: file }],
    ['Bash', { command: `echo {} > ${file}` }],
    ['Bash', { command: `mv new.json ${file}` }],
    ['Bash', { command: 'rm .claude/agent-hq/tea*.json' }],
    ['Bash', { command: 'cd .claude/agent-hq && rm t*.json' }],
    ['Bash', { command: `bash -c "rm ${file}"` }],
  ] as const) {
    expect(outsider(tool, input)?.deny, `${tool} ${JSON.stringify(input)}`).toBe('Agent HQ: the team file may only be changed by the person')
  }
  for (const [tool, input] of [['Read', { file_path: file }], ['Bash', { command: `cat ${file}` }], ['Edit', { file_path: 'team.json' }]] as const) expect(outsider(tool, input), `${tool} ${JSON.stringify(input)}`).toBeNull()
  expect(outsider('Write', { file_path: file }, { team: null })?.deny).toMatch(/team file/) // with no team in force too
  // the main session (no subagent flag) is the person's own hand
  expect(guardToolCall({ team: TEAM, role: null, tool: 'Write', input: { file_path: file } })).toBeNull()
  expect(guardToolCall({ team: TEAM, role: null, tool: 'Read', input: {} })).toBeNull()
})

test('agentRoles: an agent answers to its own role and to every role above it', () => {
  const rows = {
    a: { role: 'agent-hq:reviewer' },
    b: { role: 'Explore', parentId: 'a' },
    c: { role: 'general-purpose', parentId: 'b' },
    d: { role: 'agent-hq:dev', parentId: 'c' },
    e: { role: 'Explore', parentId: 'main-loop' }, // started by the main session: its row is not listed
    loop1: { role: 'agent-hq:dev', parentId: 'loop2' },
    loop2: { role: 'agent-hq:auditor', parentId: 'loop1' },
  }
  expect(agentRoles(rows, 'a')).toEqual({ roles: ['reviewer'], unknown: false })
  expect(agentRoles(rows, 'c')).toEqual({ roles: ['reviewer'], unknown: false })
  expect(agentRoles(rows, 'd')).toEqual({ roles: ['dev', 'reviewer'], unknown: false })
  expect(agentRoles(rows, 'e')).toEqual({ roles: [], unknown: false })
  expect(agentRoles(rows, 'nobody')).toEqual({ roles: [], unknown: true })
  expect(agentRoles(rows, 'loop1').roles.length).toBeLessThanOrEqual(8) // a cycle ends
})

test('an agent a guarded role started is held to that role guard as well as its own', () => {
  const asChild = (own: string | null, inherited: string[], tool: string, input: Record<string, unknown>) =>
    guardToolCall({ team: TEAM, role: own, inherited, tool, input, inheritsGuard: true })
  expect(asChild('free', ['auditor'], 'Edit', { file_path: 'a.ts' })?.deny).toContain('Auditor') // its own role would allow it
  expect(asChild(null, ['auditor'], 'Write', { file_path: 'a.ts' })?.deny).toContain('Auditor') // an Explore agent has no role
  expect(asChild(null, ['flagged'], 'Bash', { command: 'git push' })?.deny).toContain('Flagged Developer')
  expect(asChild(null, ['scoped'], 'Edit', { file_path: 'lib/a.ts' })).not.toBeNull()
  expect(asChild(null, ['scoped'], 'Edit', { file_path: 'src/a.ts' })).toBeNull()
  expect(asChild('dev', ['free'], 'Bash', { command: 'git push' })).not.toBeNull() // its own role still applies
})

test('a guarded role may not start agents unless the guard is passed on to them', () => {
  const start = (roleId: string, tool: string, extra: { inheritsGuard?: boolean; assignment?: { paths?: string[] } } = {}) =>
    guardToolCall({ team: TEAM, role: roleId, tool, input: { prompt: 'go' }, ...extra })
  for (const roleId of ['dev', 'flagged', 'auditor', 'scoped']) {
    if (roleId === 'auditor' || roleId === 'scoped' || roleId === 'flagged' || roleId === 'dev') expect(start(roleId, 'Agent')?.deny, roleId).toMatch(/starting agents/)
    expect(start(roleId, 'Task')?.deny, roleId).toMatch(/starting agents/)
    expect(start(roleId, 'Agent', { inheritsGuard: true }), roleId).toBeNull()
  }
  expect(start('free', 'Agent')).toBeNull() // nothing to pass on
  expect(start('free', 'Agent', { assignment: { paths: ['src/**'] } })?.deny).toMatch(/starting agents/) // scoped by the lead's assignment
  expect(start('reviewer', 'Agent')?.deny).toContain('not one of this role') // not in its tools list
})

test('a rule only marks a role no-push when a negation governs push, merge or publish', () => {
  const marked = (rule: string) => {
    const team = teamOf(role('dev', 'Dev', { rules: [rule] }))
    return guardToolCall({ team, role: 'dev', tool: 'Bash', input: { command: 'git push' } }) !== null
  }
  for (const rule of ['Never push to main', 'Do not merge pull requests', "Don't publish releases", 'You must not push or publish', 'Never edit code, push or merge', 'You are not allowed to push', 'Should not push directly to main', "Don’t push"])
    expect(marked(rule), rule).toBe(true)
  for (const rule of ['Do not skip tests; push only after green', 'Do not skip tests, push only after green', 'Never ship untested code. Push when the review is done.', 'Push yourself to write tests', 'Not every change needs a design doc; merge small ones fast', 'Have every change reviewed'])
    expect(marked(rule), rule).toBe(false)
})

test('commands are read through their wrappers: a path, env, sudo, timeout, nice, nohup, xargs, time, command', () => {
  const denied = [
    '/usr/bin/git push',
    '/opt/homebrew/bin/gh pr merge 3',
    'env git push',
    'env -i git push',
    'env -i PATH=/usr/bin git push',
    'env -u HOME git push',
    'sudo git push',
    'sudo -u deploy git push',
    'sudo -E -- git push',
    'timeout 30 git push',
    'timeout -s KILL 30 git push',
    'nice git push',
    'nice -n 10 git push',
    'nohup git push &',
    'command git push',
    'time git push',
    'xargs git push',
    'xargs -n1 -I {} git push {}',
    'stdbuf -oL git push',
    'stdbuf -o L git push',
    'echo origin | xargs -I {} git push {}',
    'sudo env FOO=1 timeout 5 nice -n 3 /usr/bin/git push origin main',
    'FOO=1 command -p git push',
    '\\git push',
    '"git" push',
  ]
  for (const command of denied) expect(bash('dev', command)?.deny, command).toMatch(/^Agent HQ: /)
  const allowed = ['env', 'env FOO=1', 'sudo ls', 'timeout 30 npm test', 'nice -n 5 npm run build', 'xargs echo', 'time git status', 'command -v git', 'env git status', 'nohup npm start &']
  for (const command of allowed) expect(bash('dev', command), command).toBeNull()
})

test('commands are read inside bash -c, sh -c, zsh -c, eval and control words', () => {
  const denied = [
    `bash -c "git push"`,
    `sh -c 'cd repo && git push origin main'`,
    `zsh -c "npm test; git merge main"`,
    `bash -lc "git push"`,
    `bash -ec 'git push'`,
    `sudo bash -c "git push"`,
    `bash -c "bash -c 'git push'"`,
    `eval "git push"`,
    `eval git push`,
    `eval 'cd x && npm publish'`,
    `(git push)`,
    `( cd repo && git push )`,
    `{ git push; }`,
    `if true; then git push; fi`,
    `for i in 1 2; do git push; done`,
    `if false; then echo; else git push; fi`,
    `! git push`,
    `echo $(git push)`,
    'echo `git push`',
  ]
  for (const command of denied) expect(bash('dev', command)?.deny, command).toMatch(/^Agent HQ: /)
  const allowed = [`bash -c "git status"`, `sh -c 'echo git push'`, `bash script.sh`, `bash -c`, `eval`, `eval "echo hi"`, `(cd repo && git status)`, `{ ls; }`, `for i in 1 2; do echo $i; done`, `echo $(date)`, 'echo `date`', `echo "(git push)"`]
  for (const command of allowed) expect(bash('dev', command), command).toBeNull()
})

test('git aliases that push or merge, and the other ways to publish and merge', () => {
  const denied = [
    'git -c alias.p=push p',
    'git -c alias.up="push origin" up',
    'git -c alias.m=merge m',
    'git -c alias.x=!git\ push x',
    'git -C repo -c alias.p=push p',
    'pnpm -r publish',
    'pnpm --filter web publish',
    'npm publish --workspaces',
    'npm publish -w packages/a',
    'yarn workspaces foreach npm publish',
    'yarn npm publish',
    'bun publish',
    'npx lerna publish',
    'lerna publish from-package',
    'cargo publish',
    'gh api repos/o/r/pulls/12/merge -X PUT',
    'gh api -X PUT repos/o/r/pulls/12/merge',
    'gh api --method PUT /repos/o/r/pulls/12/merge -f merge_method=squash',
    'gh api repos/o/r/merges -f base=main -f head=dev',
    `gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }'`,
  ]
  for (const command of denied) expect(bash('dev', command)?.deny, command).toMatch(/^Agent HQ: /)
  const allowed = [
    'git -c user.name=me commit -m wip',
    'git -c alias.s=status s',
    'git -c core.pager=cat log',
    'pnpm -r test',
    'pnpm --filter web build',
    'npm run build --workspaces',
    'npm run publish-docs',
    'npm pack',
    'yarn workspaces foreach run build',
    'cargo build',
    'cargo test',
    'gh api repos/o/r/pulls/12',
    'gh api repos/o/merge-tool/issues',
    'gh api repos/o/r/pulls/12/comments',
    'gh pr view 3 --json mergeable',
    'git stash push -m wip',
    'git stash push',
    'git merge-base HEAD main',
    'git log --merges',
    'echo "git push"',
    'sed -n 1,5p f.ts',
    'ls 2>&1',
    'ls > /dev/null',
    'ls 2>&1 > /dev/null',
  ]
  for (const command of allowed) expect(bash('dev', command), command).toBeNull()
})

test('read-only roles: interpreters running code, dd, curl -o, wget, rsync, installs and git commands that change the tree are refused', () => {
  const denied = [
    `python -c "open('a','w').write('x')"`,
    `python3 -c 'print(1)'`,
    `python3.12 -c 'print(1)'`,
    `node -e "require('fs').writeFileSync('a','x')"`,
    `node -p 1+1`,
    `node --eval "1"`,
    `perl -e 'print 1'`,
    `perl -i -pe 's/a/b/' f.ts`,
    `perl -pi -e 's/a/b/' f.ts`,
    `ruby -e 'puts 1'`,
    `ruby -i -pe '$_.upcase!' f.rb`,
    'dd if=/dev/zero of=out.bin count=1',
    'curl -o out.html https://x.dev',
    'curl -O https://x.dev/a.tgz',
    'curl -sSLo out.html https://x.dev',
    'curl --output out.html https://x.dev',
    'curl --remote-name https://x.dev/a.tgz',
    'wget https://x.dev/a.tgz',
    'rsync -a src/ dest/',
    'npm install',
    'npm i left-pad',
    'npm ci',
    'pnpm install',
    'pnpm -r install',
    'pnpm add zod',
    'yarn install',
    'yarn add zod',
    'yarn',
    'bun install',
    'git apply fix.patch',
    'git am 0001.patch',
    'git checkout -- src/a.ts',
    'git checkout main -- src/a.ts',
    'git restore src/a.ts',
    'git reset --hard HEAD~1',
    'git -C repo reset --hard',
    'git clean -fd',
    'patch -p1 < fix.patch',
    'bash -c "echo hi > out.txt"',
    'env FOO=1 python3 -c "1"',
    `eval "rm -rf dist"`,
    'sudo rm -rf dist',
    'echo hi | xargs -I {} touch {}',
    '(echo hi > out.txt)',
  ]
  for (const command of denied) {
    expect(bash('auditor', command)?.deny, command).toMatch(/read-only/)
    expect(bash('reviewer', command)?.deny, command).toMatch(/read-only/)
    expect(bash('free', command), `a role that may write: ${command}`).toBeNull()
  }
  const allowed = [
    'python -m pytest -p no:cacheprovider',
    'python3 -m pytest -x tests/',
    'python script.py',
    'python --version',
    'python3 -V',
    'node --version',
    'node script.js',
    'node --test web/server.test.mjs',
    'perl -v',
    'ruby --version',
    'dd --help',
    'curl https://x.dev',
    'curl -s https://x.dev | head',
    'curl -H "Accept: application/json" https://x.dev',
    'curl -X POST -d @body.json https://x.dev',
    'npm test',
    'npm run build',
    'npm ls',
    'pnpm test',
    'pnpm -r test',
    'yarn test',
    'git status',
    'git diff HEAD~1',
    'git log --oneline',
    'git show HEAD:src/a.ts',
    'git checkout --help',
    'git stash list',
    'git stash show -p',
    'git merge-base HEAD main',
    'git fetch',
    'sed -n 1,5p f.ts',
    'ls farm',
    'echo "git push" 2>&1',
    'cat a.txt > /dev/null',
    'bash -c "git status"',
    'eval "ls"',
    'bash -c "echo hi 2>&1"',
  ]
  for (const command of allowed) expect(bash('auditor', command), command).toBeNull()
})
