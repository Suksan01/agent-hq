// /hq report: the session as Markdown, per agent, the task board, review outcomes and what is left.
import { expect, mock, test } from 'claude-code/testing';
import { MAIN, createTask, mergeAgents, updateTask } from '../hooks/model';
import { buildReport, reportPath, reportToast, summaryPrompt } from '../hooks/report';
import { parseTeam } from '../hooks/team';
const PARSED = parseTeam(JSON.stringify({
    name: 'Booking App Team',
    purpose: 'Build the booking app',
    lead: { title: 'Tech Lead', rules: [], skills: [] },
    roles: [
        { id: 'frontend-dev', title: 'Frontend Developer', count: 2, mission: 'Build pages.', tasks: [], rules: [], skills: [] },
        { id: 'reviewer', title: 'Code Reviewer', count: 1, mission: 'Review.', tasks: [], rules: [], skills: [] },
    ],
}));
if (typeof PARSED === 'string')
    throw new Error(PARSED);
const TEAM = PARSED;
const AT = new Date(2026, 9, 19, 18, 5, 9).getTime(); // 19 Oct 2026, 18:05:09 local
const MIN = 60000;
function data(overrides = {}) {
    const dev = { id: 'd1', name: 'frontend-dev-1', type: 'agent-hq:frontend-dev', description: 'Search page', status: 'completed' };
    const rev = { id: 'r1', name: 'reviewer-1', type: 'agent-hq:reviewer', description: 'Review', status: 'failed' };
    const qa = { id: 'd2', name: 'frontend-dev-2', type: 'agent-hq:frontend-dev', description: 'Date picker', status: 'running' };
    let agents = mergeAgents({}, [dev, rev, qa], AT - 20 * MIN);
    agents = { ...agents, d1: { ...agents.d1, endedAt: AT - 5 * MIN, nickname: 'Mochi-chan', tools: 12 }, r1: { ...agents.r1, endedAt: AT - 2 * MIN, nickname: 'Onigiri' } };
    let tasks = updateTask(createTask({}, '1', 'Search page'), '1', { status: 'completed', owner: 'frontend-dev-1' });
    tasks = updateTask(createTask(tasks, '2', 'Date | picker'), '2', { status: 'in_progress', owner: 'frontend-dev-2' });
    return {
        agents,
        todos: { d1: [{ content: 'Write tests', status: 'completed', activeForm: 'Writing tests' }, { content: 'Fix lint', status: 'completed', activeForm: 'Fixing lint' }] },
        tasks,
        now: AT,
        hideFinished: false,
        columns: 0,
        isLight: false,
        team: TEAM,
        ...overrides,
    };
}
test('the report file is named by date and time in the project, never overwriting another minute', () => {
    expect(reportPath('/work/app', AT)).toBe('/work/app/.claude/agent-hq/reports/2026-10-19-180509.md');
});
test('the report has a section per agent with nickname, role, time, tasks done and last result', () => {
    const md = buildReport(data(), AT);
    expect(md).toContain('# Agent HQ report: Booking App Team');
    expect(md).toContain('2026-10-19 18:05');
    expect(md).toContain('### Mochi-chan · frontend-dev-1 (Frontend Developer)');
    expect(md).toContain('- Status: done');
    expect(md).toContain('- Time: 15m 0s'); // started 20 minutes ago, ended 5 minutes ago
    expect(md).toContain('- Tasks done: 3/3'); // two todos and the board task it owns
    expect(md).toContain('- Last result: Fix lint');
    expect(md).toContain('· Tech Lead (lead)'); // the main session plays the team's lead, under its own nickname
});
test('a running agent is timed up to now and an agent with nothing tracked says so', () => {
    const md = buildReport(data(), AT);
    expect(md).toContain('- Time: 20m 0s');
    expect(md).toContain('- Tasks done: 0/1');
    expect(md).toContain('- Tasks done: none tracked');
});
test('the task board lists every task with its status and owner, and a pipe cannot break the table', () => {
    const md = buildReport(data(), AT);
    expect(md).toContain('| 1 | Search page | done | frontend-dev-1 |');
    expect(md).toContain('| 2 | Date \\| picker | in progress | frontend-dev-2 |');
});
test('review outcomes name the reviewers and how they ended; none is said plainly', () => {
    expect(buildReport(data(), AT)).toContain('- Onigiri (Code Reviewer): failed');
    const without = data();
    const noReviewer = { ...without, agents: Object.fromEntries(Object.entries(without.agents).filter(([id]) => id !== 'r1')) };
    expect(buildReport(noReviewer, AT)).toContain('No review recorded');
});
test("what is left lists open tasks and agents that have not finished", () => {
    const md = buildReport(data(), AT);
    const left = md.slice(md.indexOf('## What is left'));
    expect(left).toContain('Date | picker'.replace('|', '\\|'));
    expect(left).toContain('frontend-dev-2 is still running');
    expect(left).toContain('reviewer-1 failed');
    expect(left).not.toContain('Search page');
});
test('with everything finished it says nothing is left; with no team it is a session report', () => {
    const d = data();
    const done = { ...d, agents: Object.fromEntries(Object.entries(d.agents).map(([id, a]) => [id, id === MAIN ? a : { ...a, status: 'completed' }])), tasks: {}, team: null };
    const md = buildReport(done, AT);
    expect(md).toContain('# Agent HQ report: session');
    expect(md).toContain('Nothing left');
});
test('a summary, when there is one, opens the report as a quote', () => {
    const md = buildReport(data(), AT, 'Two of three agents finished. One review failed.');
    const [heading, ...rest] = md.split('\n');
    expect(heading).toContain('# Agent HQ report');
    expect(rest.join('\n').indexOf('> Two of three agents finished. One review failed.')).toBeLessThan(rest.join('\n').indexOf('## Agents'));
    expect(buildReport(data(), AT)).not.toContain('\n> ');
});
test('the summary prompt asks for three sentences and carries the report', () => {
    const p = summaryPrompt('# Agent HQ report\nbody');
    expect(p).toContain('three sentences');
    expect(p).toContain('# Agent HQ report\nbody');
});
test('the toast names the file relative to the project and counts agents and tasks', () => {
    const t = reportToast(data(), '/work/app/.claude/agent-hq/reports/2026-10-19-180509.md', '/work/app');
    expect(t).toBe('Agent HQ: report saved to .claude/agent-hq/reports/2026-10-19-180509.md (3 agents, 1/2 tasks done)');
});
/** `/hq report` run in a session whose agents are a finished developer and a running one. */
async function runReport($, on, model) {
    mock.clock(on);
    const writes = {};
    const toasts = [];
    const prompts = [];
    const listed = [
        { id: 'd1', name: 'frontend-dev-1', type: 'agent-hq:frontend-dev', description: 'Search page', status: 'completed' },
        { id: 'd2', name: 'reviewer-1', type: 'agent-hq:reviewer', description: 'Review', status: 'running' },
    ];
    on('env.get', () => ({ value: '/home/me' }));
    on('session.cwd', () => ({ value: '/work/app' }));
    on('session.id', () => ({ value: 'sess' }));
    on('fs.exists', () => ({ value: false }));
    on('fs.read', () => ({ value: '' }));
    on('fs.write', (_, e) => {
        writes[e.path] = e.text;
        return { value: undefined };
    });
    on('agent.register', (_, e) => ({ value: { agent: `agent-hq:${e.name}` } }));
    on('agent.list', () => ({ value: listed }));
    on('ui.toast', (_, e) => {
        toasts.push(e.text);
        return { value: undefined };
    });
    on('ui.status', () => ({ value: undefined }));
    on('command.register', () => ({ value: undefined }));
    on('config.list', () => ({ value: [] }));
    on('session.start', (_, e) => e);
    if (model) {
        on('model.complete', (_, e) => {
            prompts.push(e.prompt);
            return { value: model };
        });
    }
    await $.session.start({ cwd: '/work/app', surface: null, isInteractive: true });
    const answer = await $.command.run({ command: 'hq', args: 'report', origin: { kind: 'composer' }, presentation: {} });
    const files = Object.entries(writes).filter(([path]) => path.includes('/.claude/agent-hq/reports/'));
    return { answer, files, toasts, prompts };
}
test('/hq report writes the file under the project and says so in a toast', async ($, on) => {
    const { answer, files, toasts } = await runReport($, on);
    expect(files).toHaveLength(1);
    const [path, text] = files[0];
    expect(path).toMatch(/^\/work\/app\/\.claude\/agent-hq\/reports\/\d{4}-\d{2}-\d{2}-\d{6}\.md$/);
    expect(text).toContain('# Agent HQ report: session');
    expect(text).toContain('frontend-dev-1');
    expect(toasts.some(t => t.startsWith('Agent HQ: report saved to .claude/agent-hq/reports/'))).toBe(true);
    expect(JSON.stringify(answer)).toContain('report saved');
});
test('/hq report puts the model summary on top when a model answers', async ($, on) => {
    const { files, prompts } = await runReport($, on, { isAnswered: true, text: ' Summary here. ', usage: {} });
    expect(prompts[0]).toContain('three sentences');
    expect(files[0][1]).toContain('> Summary here.');
});
test('/hq report skips the summary when no model answers, and still writes the file', async ($, on) => {
    const { answer, files } = await runReport($, on, { isAnswered: false, reason: 'api-error', usage: {} });
    expect(files[0][1]).not.toContain('\n> ');
    expect(JSON.stringify(answer)).toContain('No summary');
});
