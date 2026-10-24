// Spec for the guard on .claude/agent-hq/tasks.json (docs/specs/task-sidebar.md AC13), written the way tests/guard.test.ts
// and tests/guard-command.test.ts guard team.json. Decisions the spec pins down:
//  - no member (any role) changes the task list: Write, Edit, NotebookEdit and writing commands are refused, or a member
//    could fake its own task's status; the deny is one "Agent HQ: ..." line that names the task list;
//  - the lead (the main session, no role) is never blocked, and reading the file is fine for everyone;
//  - a glob is refused where it can mean tasks.json, and only there (team.json globs are tests/guard-command.test.ts's).
import { expect, test } from 'claude-code/testing'

import type { HqTeam } from '../types'
import { guardToolCall } from '../hooks/guard'
import { parseTeam } from '../hooks/team'

const role = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, count: 1, mission: 'Do the job.', tasks: [], rules: [], skills: [], ...extra })

function teamOf(...roles: Record<string, unknown>[]): HqTeam {
  const parsed = parseTeam(JSON.stringify({ name: 'T', purpose: 'p', lead: { title: 'Lead' }, roles }))
  if (typeof parsed === 'string') throw new Error(parsed)
  return { ...parsed, roles: parsed.roles.map((r, i) => ({ ...r, ...(roles[i]?.guard ? { guard: roles[i]?.guard as never } : {}) })) }
}

const TEAM = teamOf(
  role('dev', 'Senior Developer', { rules: ['Never push to main'] }),
  role('free', 'Free Developer'),
  role('flagged', 'Flagged Developer', { guard: { noPush: true } }),
  role('auditor', 'Auditor', { guard: { readOnly: true } }),
  role('scoped', 'Scoped Developer', { guard: { paths: ['src/**'] } }),
  role('editor', 'Editor', { tools: ['Read', 'Edit'] }),
)
const FILE = '.claude/agent-hq/tasks.json'
const TASK_LIST_DENIED = /task/i

const call = (roleId: string | null, tool: string, input: Record<string, unknown> = {}, extra: { cwd?: string; team?: HqTeam | null } = {}) =>
  guardToolCall({ team: extra.team === undefined ? TEAM : extra.team, role: roleId, tool, input, cwd: extra.cwd })
const bash = (roleId: string | null, command: string) => call(roleId, 'Bash', { command })

test('no member changes tasks.json: Write, Edit and NotebookEdit are refused for every role, wherever the path points (AC13)', () => {
  for (const roleId of ['dev', 'free', 'flagged', 'scoped', 'auditor', 'editor']) {
    for (const [tool, key] of [['Write', 'file_path'], ['Edit', 'file_path'], ['NotebookEdit', 'notebook_path']] as const) {
      if (roleId === 'editor' && tool !== 'Edit') continue
      for (const path of [FILE, `/work/app/${FILE}`, `/home/me/${FILE}`, `./${FILE}`, '.claude/x/../agent-hq/tasks.json']) {
        expect(call(roleId, tool, { [key]: path }, { cwd: '/work/app' }), `${roleId} ${tool} ${path}`).not.toBeNull()
      }
    }
  }
  // a role that may write anything is held by this guard alone, so its deny must name the task list
  for (const [tool, key] of [['Write', 'file_path'], ['Edit', 'file_path'], ['NotebookEdit', 'notebook_path']] as const) {
    expect(call('free', tool, { [key]: FILE }, { cwd: '/work/app' })?.deny, tool).toMatch(/^Agent HQ: .*task/i)
  }
})

test('other files stay open: a tasks.json elsewhere, the notes and a report', () => {
  expect(call('free', 'Edit', { file_path: 'tasks.json' })).toBeNull()
  expect(call('free', 'Write', { file_path: 'docs/tasks.json' })).toBeNull()
  expect(call('free', 'Edit', { file_path: '.claude/agent-hq/team-notes.md' })).toBeNull()
  expect(call('free', 'Write', { file_path: '.claude/agent-hq/reports/qa/qa-1.md' })).toBeNull()
  expect(call('free', 'Read', { file_path: FILE })).toBeNull()
})

test('shell commands that change tasks.json by name are refused for every role, a write inside the line too (AC13)', () => {
  const denied = [
    `rm ${FILE}`,
    `rm -f ${FILE}`,
    `mv ${FILE} /tmp/old.json`,
    `mv new.json ${FILE}`,
    `cp new.json ${FILE}`,
    `echo '{}' > ${FILE}`,
    `echo '{}' >> ~/${FILE}`,
    `cat new.json | tee ${FILE}`,
    `sed -i 's/waiting/done/' ${FILE}`,
    `sed -i.bak 's/waiting/done/' ${FILE}`,
    `cd .claude/agent-hq && rm tasks.json`,
    `cd .claude/agent-hq && echo {} > tasks.json`,
    `bash -c "rm ${FILE}"`,
    `python3 -c "open('${FILE}','w').write('{}')"`,
    `truncate -s 0 ${FILE}`,
  ]
  for (const command of denied) {
    expect(bash('free', command)?.deny, `free: ${command}`).toMatch(TASK_LIST_DENIED)
    expect(bash('dev', command)?.deny, `dev: ${command}`).toMatch(/^Agent HQ: /)
    expect(bash('auditor', command)?.deny, `auditor: ${command}`).toMatch(/^Agent HQ: /)
  }
})

test('shell commands that change tasks.json by glob or brace are refused, where the glob can mean that file (AC13)', () => {
  // none of these can mean team.json, so only the task list guard can refuse them
  const denied = [
    'rm .claude/agent-hq/task*.json',
    'rm .claude/agent-hq/tasks.js*',
    'rm .claude/agent-hq/ta?ks.json',
    'rm .claude/agent-hq/ta[s]ks.json',
    'rm .claude/*/tasks.json',
    'rm ~/.claude/agent-hq/tas*.json',
    'mv .claude/agent-hq/task*.json /tmp/',
    'cp other.json .claude/agent-hq/task*.json',
    'echo {} > .claude/agent-hq/task*.json',
    `sed -i 's/a/b/' .claude/agent-hq/task*.json`,
    'cd .claude/agent-hq && rm task*.json',
    'rm .claude/agent-hq/{tasks,x}.json',
    'rm .claude/agent-hq/task{s,x}.json',
    'rm .claude/{agent-hq,x}/tasks.json',
    'cp x .claude/agent-hq/{notes.md,tasks.json}',
    'bash -c "rm .claude/agent-hq/task*.json"',
  ]
  for (const command of denied) {
    expect(bash('free', command)?.deny, `free: ${command}`).toMatch(TASK_LIST_DENIED)
    expect(bash('dev', command)?.deny, `dev: ${command}`).toMatch(/^Agent HQ: /)
  }
})

test('commands that only read tasks.json, or cannot mean it, are not refused', () => {
  const allowed = [
    `cat ${FILE}`,
    `cat ${FILE} | head`,
    `grep waiting ${FILE}`,
    `jq . ${FILE} > /dev/null`,
    `diff ${FILE} other.json`,
    'cat .claude/agent-hq/task*.json',
    'ls .claude/agent-hq/task*.json',
    'rm .claude/agent-hq/tasks*.md',
    'rm .claude/agent-hq/tasks??.json', // cannot match tasks.json
    'rm *.md',
    'rm .claude/agent-hq/{notes,live}.json',
    'echo {} > out.json',
  ]
  for (const command of allowed) expect(bash('free', command), command).toBeNull()
})

test('the lead is not refused: the main session may write, move and delete tasks.json (AC13)', () => {
  for (const [tool, key] of [['Write', 'file_path'], ['Edit', 'file_path'], ['NotebookEdit', 'notebook_path']] as const) {
    expect(call(null, tool, { [key]: FILE }, { cwd: '/work/app' }), tool).toBeNull()
  }
  for (const command of [`rm ${FILE}`, `mv new.json ${FILE}`, `echo '{}' > ${FILE}`, `sed -i 's/a/b/' ${FILE}`, 'rm .claude/agent-hq/task*.json']) {
    expect(bash(null, command), command).toBeNull()
  }
  expect(call(null, 'Write', { file_path: FILE }, { team: null }), 'with no team').toBeNull()
})

test('a sub-agent that is no team member cannot change tasks.json either, as with team.json', () => {
  const outsider = (tool: string, input: Record<string, unknown>) => guardToolCall({ team: TEAM, role: null, subagent: true, tool, input })
  for (const [tool, input] of [
    ['Write', { file_path: FILE }],
    ['Edit', { file_path: `/home/me/${FILE}` }],
    ['NotebookEdit', { notebook_path: FILE }],
    ['Bash', { command: `echo {} > ${FILE}` }],
    ['Bash', { command: 'rm .claude/agent-hq/task*.json' }],
  ] as const) {
    expect(outsider(tool, input)?.deny, `${tool} ${JSON.stringify(input)}`).toMatch(TASK_LIST_DENIED)
  }
  for (const [tool, input] of [['Read', { file_path: FILE }], ['Bash', { command: `cat ${FILE}` }], ['Edit', { file_path: 'tasks.json' }]] as const) {
    expect(outsider(tool, input), `${tool} ${JSON.stringify(input)}`).toBeNull()
  }
})

test('a tasks.json that is not the task list stays open to commands, and the task list is refused beside other files', () => {
  for (const command of ["sed -i 's/a/b/' .vscode/tasks.json", 'echo x > docs/tasks.json', 'rm src/x/tasks.json', 'cd .claude/agent-hq && cat x > docs/tasks.json']) {
    expect(bash('free', command), command).toBeNull()
  }
  for (const command of [`jq . x.json > ${FILE}`, `rm .claude/agent-hq/team.json ${FILE}`, `rm ${FILE} .claude/agent-hq/team.json`]) {
    expect(bash('free', command)?.deny, command).toMatch(/^Agent HQ: /)
  }
})

test('a tasks.json with no directory, or one that may be agent-hq, is refused: the shell directory is not known across calls', () => {
  for (const command of ['rm tasks.json', 'cd .claude/agent-hq && rm ./tasks.json', 'echo {} > ./tasks.json', 'rm .claude/agent-hq/./tasks.json', 'rm .claude/agent-hq//tasks.json', 'rm sub/../tasks.json', 'rm $PWD/tasks.json', 'rm $(pwd)/tasks.json', 'rm ~/tasks.json']) {
    expect(bash('free', command)?.deny, command).toMatch(TASK_LIST_DENIED)
  }
})

test('the backup tasks.json.bak is guarded like tasks.json: Write, Edit, a command, a glob; a .bak elsewhere is open', () => {
  const bak = `${FILE}.bak`
  for (const [tool, key] of [['Write', 'file_path'], ['Edit', 'file_path'], ['NotebookEdit', 'notebook_path']] as const) {
    expect(call('free', tool, { [key]: bak }, { cwd: '/work/app' })?.deny, tool).toMatch(TASK_LIST_DENIED)
    expect(call(null, tool, { [key]: bak }, { cwd: '/work/app' }), `lead ${tool}`).toBeNull()
  }
  for (const command of [`rm ${bak}`, `cp x ${bak}`, `echo {} > ${bak}`, 'rm .claude/agent-hq/tasks.json.*', 'rm .claude/agent-hq/task*', 'rm tasks.json.bak', 'rm $PWD/tasks.json.bak']) {
    expect(bash('free', command)?.deny, command).toMatch(TASK_LIST_DENIED)
  }
  for (const command of ['rm .vscode/tasks.json.bak', `cat ${bak}`]) expect(bash('free', command), command).toBeNull()
  expect(call('free', 'Edit', { file_path: '.vscode/tasks.json.bak' })).toBeNull()
})

test('reads in a compound stay open, and a name that only ends in tasks.json is another file', () => {
  for (const command of ['jq . .claude/agent-hq/tasks.json > /tmp/out.json', 'cat .claude/agent-hq/tasks.json | tee /tmp/x', 'cat .claude/agent-hq/tasks.json && touch note', 'rm mytasks.json', 'echo x > subtasks.json']) {
    expect(bash('free', command), command).toBeNull()
  }
  expect(bash('free', 'rm $(pwd)/tasks.json')?.deny).toMatch(TASK_LIST_DENIED)
})

test('an approved plan file is closed to members and sub-agents, and only while a planFile is given', () => {
  const PLAN = 'docs/plans/task-sidebar.md'
  const withPlan = (roleId: string | null, tool: string, input: Record<string, unknown>) => guardToolCall({ team: TEAM, role: roleId, tool, input, planFile: PLAN, cwd: '/work/app' })
  for (const [tool, key] of [['Write', 'file_path'], ['Edit', 'file_path'], ['NotebookEdit', 'notebook_path']] as const) {
    for (const path of [PLAN, `/work/app/${PLAN}`, `./${PLAN}`, 'docs/x/../plans/task-sidebar.md']) {
      expect(withPlan('free', tool, { [key]: path })?.deny, `${tool} ${path}`).toMatch(/^Agent HQ: the approved plan may only be changed by the lead/)
    }
    expect(withPlan(null, tool, { [key]: PLAN }), `lead ${tool}`).toBeNull()
    expect(guardToolCall({ team: TEAM, role: null, subagent: true, tool, input: { [key]: PLAN }, planFile: PLAN })?.deny, `sub-agent ${tool}`).toMatch(/approved plan/)
  }
  for (const command of [`rm ${PLAN}`, `sed -i 's/\\[ \\]/[x]/' ${PLAN}`, `echo x >> ${PLAN}`, 'cd docs/plans && sed -i s/a/b/ task-sidebar.md', `cp x ${PLAN}`, `echo x > docs//plans/./task-sidebar.md`, 'rm $PWD/task-sidebar.md']) {
    expect(withPlan('free', 'Bash', { command })?.deny, command).toMatch(/approved plan/)
    expect(withPlan(null, 'Bash', { command }), `lead ${command}`).toBeNull()
  }
  // reads, and other files of the same name elsewhere or with another ending
  for (const command of [`cat ${PLAN}`, `grep '\\[ \\]' ${PLAN} | head`, 'rm docs/task-sidebar.md', 'rm docs/plans/task-sidebar.md.bak', 'rm mytask-sidebar.md']) {
    expect(withPlan('free', 'Bash', { command }), command).toBeNull()
  }
  expect(withPlan('free', 'Edit', { file_path: 'docs/task-sidebar.md' })).toBeNull()
  expect(withPlan('free', 'Read', { file_path: PLAN })).toBeNull()
  // no planFile: nothing changes
  expect(call('free', 'Edit', { file_path: PLAN })).toBeNull()
  expect(bash('free', `rm ${PLAN}`)).toBeNull()
})
