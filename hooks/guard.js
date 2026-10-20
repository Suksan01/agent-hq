// The tool-call guard for team roles (tests/guard.test.ts is the spec): what a role may not do however it is asked,
// from its tools list, its rules and its `guard`. Pure: a call in, a short human reason out, or null. The main session,
// an unknown role and a team-less session are never blocked. A writable role's own memory folder and the team notes
// stay readable and writable (Read, Write, Edit) whatever its paths: its prompt has it keep them. How a command is
// read, and what it cannot see, is in command.ts.
import { changesTeamFile, commandsOf, pushes, writes } from './command';
import { COORDINATION_TOOLS } from './model';
import { AGENT_PREFIX, TEAM_FILE, TEAM_NOTES, isReadOnlyRole, memoryDirOf } from './team';
const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
const MEMORY_TOOLS = ['Write', 'Edit']; // what the engine enables for an agent's memory, writing; reading is never refused for a path
const AGENT_TOOLS = ['Agent', 'Task'];
const MAX_ANCESTORS = 8;
// A negation that governs push, merge or publish: "Never push", "Do not merge PRs", "Never edit code, push or merge"; not "Do not skip tests; push only after green".
const NEGATION = String.raw `(?:never|don[’']?t|do not|must not|mustn[’']?t|should not|shouldn[’']?t|shall not|may not|cannot|can[’']?t|not)`;
const FILLER = String.raw `(?:\s+(?:allowed|permitted|able|to|ever|directly|force|also|either)\b)*`;
const CO_LISTED = String.raw `(?:(?:edit|write|commit|deploy|release|rebase|delete|modify|change|touch)(?:\s+\w+)?\s*(?:,|/|\bor\b|\band\b)\s*)*`;
const NO_PUSH_RULE = new RegExp(String.raw `\b${NEGATION}${FILLER}\s+${CO_LISTED}(?:push|merge|publish)`, 'i');
const SHOWN_MAX = 40;
const TEAM_FILE_REASON = 'the team file may only be changed by the person';
const TEAM_FILE_DENIED = `Agent HQ: ${TEAM_FILE_REASON}`;
/**
 * The team role ids of an agent and of those that started it, nearest first, from the roster's rows; `unknown` when the
 * agent has no row. An agent of another type (Explore, general-purpose) has no role of its own but still answers to the
 * roles above it: whoever a guarded role starts is held to that role's guard. A parent with no row is the main session.
 */
export function agentRoles(agents, agentId) {
    const roles = [];
    let row = agents[agentId];
    for (let depth = 0; row && depth < MAX_ANCESTORS; depth++) {
        if (row.role.startsWith(AGENT_PREFIX))
            roles.push(row.role.slice(AGENT_PREFIX.length));
        row = row.parentId ? agents[row.parentId] : undefined;
    }
    return { roles, unknown: agents[agentId] === undefined };
}
// ---------- paths and globs ----------
/** `a/./b/../c` as ['a', 'c']; null when it climbs out of its root. */
function resolveParts(path) {
    const parts = [];
    for (const part of path.split('/')) {
        if (part === '' || part === '.')
            continue;
        if (part === '..') {
            if (parts.pop() === undefined)
                return null;
        }
        else
            parts.push(part);
    }
    return parts;
}
/** The path relative to the project, or null when it leaves it. */
function relativePath(path, cwd) {
    const parts = resolveParts(path);
    if (!parts)
        return null;
    if (!path.startsWith('/') || !cwd)
        return parts.join('/');
    const root = resolveParts(cwd);
    if (!root || root.some((p, i) => parts[i] !== p))
        return null;
    return parts.slice(root.length).join('/');
}
function globRegex(glob) {
    const source = (resolveParts(glob) ?? [glob]).join('/')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\u0000')
        .replace(/\*\*/g, '\u0001')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\u0000/g, '(?:.*/)?')
        .replace(/\u0001/g, '.*');
    return new RegExp(`^${source}$`);
}
const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x !== '') : []);
const shorten = (text) => (text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX - 1)}…` : text);
// ---------- the guard ----------
/** The role's own memory folder or the team notes, inside this project (`..` resolved first). */
function isTeamMemory(roleId, given, cwd) {
    if (typeof given !== 'string' || given === '' || (given.startsWith('/') && !cwd))
        return false; // absolute needs the project to compare to
    const relative = relativePath(given, cwd);
    return relative !== null && (relative === TEAM_NOTES || relative.startsWith(`${memoryDirOf(roleId)}/`));
}
/** A team.json (in a project, or in the home folder), which a member must never change: it is where the guards come from. */
function isTeamFile(given) {
    const parts = typeof given === 'string' ? resolveParts(given) : null;
    return parts !== null && parts.join('/').endsWith(TEAM_FILE);
}
/** Whether the call writes a team.json: Write, Edit or NotebookEdit on it, or a command that changes it (by name or by glob). */
function changesTeamFileBy(call) {
    if (WRITE_TOOLS.includes(call.tool))
        return isTeamFile(call.tool === 'NotebookEdit' ? call.input.notebook_path : call.input.file_path);
    if (call.tool !== 'Bash')
        return false;
    const source = typeof call.input.command === 'string' ? call.input.command : '';
    return changesTeamFile(commandsOf(source), source);
}
const isNoPush = (role) => role.guard?.noPush === true || role.rules.some(rule => NO_PUSH_RULE.test(rule));
/** `{ deny }` with a short human reason when the role may not make this call, else null. */
export function guardToolCall(call) {
    for (const id of [call.role, ...(call.inherited ?? [])]) {
        const role = id === null ? undefined : call.team?.roles.find(r => r.id === id);
        const verdict = role ? guardRole(role, call) : null;
        if (verdict)
            return verdict;
    }
    // a sub-agent that is no team member (a general agent, one the roster does not list) has no role guard, but the team file is closed to it too
    return call.subagent && changesTeamFileBy(call) ? { deny: TEAM_FILE_DENIED } : null;
}
function guardRole(role, call) {
    if (COORDINATION_TOOLS.includes(call.tool))
        return null;
    const deny = (what) => ({ deny: `Agent HQ: ${what} (${role.title})` });
    const readOnly = isReadOnlyRole(role);
    const named = call.tool === 'NotebookEdit' ? call.input.notebook_path : call.input.file_path;
    if (WRITE_TOOLS.includes(call.tool) && isTeamFile(named))
        return deny(TEAM_FILE_REASON);
    // memory and notes are plain files: only a role that may write files at all keeps them, whatever its paths
    if (MEMORY_TOOLS.includes(call.tool) && !readOnly && (!role.tools || role.tools.includes(call.tool)) && isTeamMemory(role.id, call.input.file_path, call.cwd))
        return null;
    if (role.tools && !role.tools.includes(call.tool))
        return deny(`${call.tool} is not one of this role's tools`);
    if (AGENT_TOOLS.includes(call.tool)) {
        const guarded = isNoPush(role) || readOnly || strings(role.guard?.paths).length > 0 || strings(call.assignment?.paths).length > 0;
        return guarded && !call.inheritsGuard ? deny('starting agents is not allowed, they would not be held to this role\'s rules') : null;
    }
    if (call.tool === 'Bash') {
        const source = typeof call.input.command === 'string' ? call.input.command : '';
        const commands = commandsOf(source);
        if (changesTeamFile(commands, source))
            return deny(TEAM_FILE_REASON);
        if (isNoPush(role) && commands.some(pushes))
            return deny('pushing, merging or publishing is not allowed');
        if (readOnly && commands.some(writes))
            return deny('this command writes files and the role is read-only');
        return null;
    }
    if (!WRITE_TOOLS.includes(call.tool))
        return null;
    if (readOnly)
        return deny(`${call.tool} is not allowed, the role is read-only`);
    const scopes = [strings(role.guard?.paths), strings(call.assignment?.paths)].filter(globs => globs.length > 0);
    if (scopes.length === 0)
        return null;
    if (typeof named !== 'string' || named === '')
        return deny(`${call.tool} names no path, so it cannot be checked against ${shorten(scopes[0]?.join(', ') ?? '')}`);
    const relative = relativePath(named, call.cwd);
    for (const globs of scopes) {
        if (relative === null || !globs.some(g => globRegex(g).test(relative)))
            return deny(`${call.tool} on ${shorten(named)} is outside ${shorten(globs.join(', '))}`);
    }
    return null;
}
