// `/hq report`: the session as one Markdown file, per agent, the task board, review outcomes and what is left.
// `buildReport` is pure (the tests read it); `createReport` adds the file and, when a model answers, the summary.
import { MAIN, agentWork, elapsed, isFinished, progressOf } from './model';
import { labelOf } from './view';
export const REPORTS_DIR = '.claude/agent-hq/reports';
const SUMMARY_MODEL = 'haiku';
const SUMMARY_MAX_TOKENS = 300;
const SUMMARY_TIMEOUT_MS = 20000;
const TEXT_MAX = 200;
const REVIEW_ROLE = /review|qa|test|audit|fact.?check|a11y|accessib/i;
export const STATUS_WORD = { pending: 'queued', running: 'running', waiting: 'needs approval', idle: 'idle', completed: 'done', failed: 'failed', killed: 'stopped' };
const TASK_WORD = { pending: 'pending', in_progress: 'in progress', completed: 'done' };
const pad = (n) => String(n).padStart(2, '0');
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** One line of text for a list or table cell: whitespace folded, cut, and the pipe escaped. */
const cell = (text) => {
    const one = text.replace(/\s+/g, ' ').trim();
    return (one.length > TEXT_MAX ? `${one.slice(0, TEXT_MAX - 1)}…` : one).replace(/\|/g, '\\|');
};
/** `<cwd>/.claude/agent-hq/reports/<date>-<time>.md`, to the second so two reports never share a name. */
export function reportPath(cwd, at) {
    const d = new Date(at);
    return `${cwd}/${REPORTS_DIR}/${day(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.md`;
}
const members = (data) => Object.values(data.agents).filter(a => a.id !== MAIN);
/** The board's progress, else the todos' when nothing is on the board. */
function taskProgress(data) {
    const board = Object.values(data.tasks);
    return board.length > 0 ? progressOf(board) : progressOf(Object.values(data.todos).flat());
}
const ownedBy = (agent, tasks) => Object.values(tasks).filter(t => t.owner === agent.name || t.owner === agent.id);
function agentSection(agent, data, at) {
    const label = labelOf(agent, data.team);
    const work = agentWork(agent, data.todos, data.tasks);
    const owned = ownedBy(agent, data.tasks);
    const total = (work.todos?.total ?? 0) + owned.length;
    const done = (work.todos?.done ?? 0) + owned.filter(t => t.status === 'completed').length;
    const head = agent.id === MAIN ? `${label.name} (${label.role})` : `${agent.name} (${label.role})`;
    return [
        `### ${agent.nickname ? `${agent.nickname} · ` : ''}${head}`,
        `- Status: ${STATUS_WORD[agent.status]}`,
        `- Time: ${elapsed((agent.endedAt ?? at) - agent.startedAt)}`,
        `- Tasks done: ${total === 0 ? 'none tracked' : `${done}/${total}`}`,
        `- Last result: ${work.last ? cell(work.last) : 'nothing yet'}`,
    ].join('\n');
}
function boardSection(data) {
    const tasks = Object.values(data.tasks).sort((a, b) => Number(a.id) - Number(b.id));
    if (tasks.length === 0)
        return 'No tasks on the board.';
    return ['| # | Task | Status | Owner |', '| --- | --- | --- | --- |', ...tasks.map(t => `| ${cell(t.id)} | ${cell(t.subject)} | ${TASK_WORD[t.status]} | ${cell(t.owner ?? '-')} |`)].join('\n');
}
function reviewSection(data) {
    const reviewers = members(data).filter(a => REVIEW_ROLE.test(`${labelOf(a, data.team).role} ${a.role}`));
    if (reviewers.length === 0)
        return 'No review recorded.';
    return reviewers
        .map(a => {
        const last = agentWork(a, data.todos, data.tasks).last;
        return `- ${a.nickname ?? a.name} (${labelOf(a, data.team).role}): ${STATUS_WORD[a.status]}${last ? `, last result: ${cell(last)}` : ''}`;
    })
        .join('\n');
}
function leftSection(data) {
    const lines = [];
    for (const t of Object.values(data.tasks).filter(t => t.status !== 'completed'))
        lines.push(`- Task ${cell(t.id)}: ${cell(t.subject)} (${TASK_WORD[t.status]}${t.owner ? `, ${cell(t.owner)}` : ''})`);
    for (const a of members(data)) {
        const open = (data.todos[a.id] ?? []).filter(t => t.status !== 'completed');
        for (const todo of open)
            lines.push(`- ${a.name}: ${cell(todo.content)}`);
        if (a.status === 'failed')
            lines.push(`- ${a.name} failed`);
        else if (a.status === 'killed')
            lines.push(`- ${a.name} was stopped`);
        else if (!isFinished(a.status))
            lines.push(`- ${a.name} is ${a.status === 'running' || a.status === 'pending' ? 'still running' : a.status === 'waiting' ? 'waiting for approval' : 'idle'}`);
    }
    return lines.length > 0 ? lines.join('\n') : 'Nothing left: every agent finished and every task is done.';
}
/** The whole report. `summary`, when given, opens it as a quote. */
export function buildReport(data, at, summary) {
    const d = new Date(at);
    const agents = [data.agents[MAIN], ...members(data).sort((a, b) => a.startedAt - b.startedAt)].filter((a) => a !== undefined);
    const progress = taskProgress(data);
    const running = members(data).filter(a => !isFinished(a.status)).length;
    const quote = summary?.trim() ? summary.trim().split('\n').map(l => `> ${l}`).join('\n') : '';
    return [
        `# Agent HQ report: ${data.team ? data.team.name : 'session'}`,
        quote,
        [
            `Generated ${day(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
            data.team?.purpose ? `Purpose: ${cell(data.team.purpose)}` : '',
            `Agents: ${members(data).length} (${running} still running)`,
            `Tasks: ${progress.total === 0 ? 'none' : `${progress.done}/${progress.total} done`}`,
        ]
            .filter(Boolean)
            .map(l => `- ${l}`)
            .join('\n'),
        `## Agents\n\n${agents.map(a => agentSection(a, data, at)).join('\n\n')}`,
        `## Task board\n\n${boardSection(data)}`,
        `## Review outcomes\n\n${reviewSection(data)}`,
        `## What is left\n\n${leftSection(data)}`,
    ]
        .filter(Boolean)
        .join('\n\n')
        .concat('\n');
}
/** What the model is asked for the report's top. */
export const summaryPrompt = (report) => `Below is a report of an agent team's work. Write an executive summary of exactly three sentences: what got done, what went wrong or is blocked, and what is left. Plain text only, no lists, no headings, no preamble.\n\n${report}`;
/** The toast after a report: the file (relative to the project when inside it) and the headline counts. */
export function reportToast(data, path, cwd) {
    const progress = taskProgress(data);
    const shown = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
    const tasks = progress.total === 0 ? 'no tasks' : `${progress.done}/${progress.total} tasks done`;
    return `Agent HQ: report saved to ${shown} (${members(data).length} agents, ${tasks})`;
}
// no model (a session without one, a refused call) means no summary, never a failed report
async function summarise($, report) {
    try {
        const answer = await $.model.complete({ model: SUMMARY_MODEL, prompt: summaryPrompt(report), maxTokens: SUMMARY_MAX_TOKENS, timeoutMs: SUMMARY_TIMEOUT_MS });
        return answer.isAnswered ? answer.text.trim() : '';
    }
    catch {
        return '';
    }
}
/** Writes the report under the project (`cwd`) and returns where; the model's summary tops it only when one came back. */
export async function createReport($, data, cwd, at) {
    const path = reportPath(cwd, at);
    const summary = await summarise($, buildReport(data, at));
    await $.fs.write(path, buildReport(data, at, summary));
    return { path, hasSummary: summary !== '' };
}
