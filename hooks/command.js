// Reading a shell command for the rule guard (tests/guard.test.ts is the spec): the commands it runs, with the
// wrappers around them peeled off, and whether one of them pushes or writes files.
//
// shortcut: a command is judged by its command words after splitting on separators outside quotes, and by the scripts
// handed to `bash -c`, `eval`, `su -c`, `ssh host …`, `watch`, `env -S`, a here-string and `find -exec`. A script piped
// into a shell is refused outright (it cannot be read). Substitutions inside double quotes, a script file, a shell
// function or alias hiding a push, and obfuscation ($'\x67it', variables) are not looked into. Move to a real shell
// parser if the guard ever has to stand against a determined agent rather than a careless one.
const MAX_DEPTH = 4; // scripts inside scripts
const HEREDOC_DELIMITER = /^\s*(?:'([^']*)'|"([^"]*)"|([^\s;|&<>()'"]+))/;
/** Reads the heredoc body that starts at `from` into `op`; returns the index where the delimiter line ends. */
function readBody(command, from, op) {
    const lines = [];
    for (let pos = from; pos <= command.length;) {
        const end = command.indexOf('\n', pos);
        const line = command.slice(pos, end < 0 ? undefined : end);
        if ((op.strips ? line.replace(/^\t+/, '') : line) === op.delimiter) {
            op.body = lines.join('\n');
            return end < 0 ? command.length : end;
        }
        lines.push(line);
        if (end < 0)
            break;
        pos = end + 1;
    }
    op.body = lines.join('\n');
    return command.length;
}
/** A command as segments (split on && || ; | & ( ) backticks and newlines outside quotes) of words and redirect operators. */
function scan(command) {
    const segments = [];
    let current = [];
    let piped = false; // the segment being read follows a pipe
    const pendingBodies = []; // heredocs whose body starts at the next line
    let word = '';
    let hasWord = false;
    let quote = null;
    const flush = () => {
        if (hasWord)
            current.push({ text: word });
        word = '';
        hasWord = false;
    };
    const endSegment = (nextPiped = false) => {
        flush();
        if (current.length > 0)
            segments.push({ tokens: current, piped });
        current = [];
        piped = nextPiped;
    };
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (quote) {
            if (c === quote)
                quote = null;
            else if (c === '\\' && quote === '"' && i + 1 < command.length)
                word += command[++i];
            else
                word += c;
        }
        else if (c === '"' || c === "'") {
            quote = c;
            hasWord = true;
        }
        else if (c === '\\') {
            word += command[++i] ?? '';
            hasWord = true;
        }
        else if (c === '|') {
            if (command[i + 1] === '|') {
                i++;
                endSegment(); // ||
            }
            else {
                if (command[i + 1] === '&')
                    i++; // |&
                endSegment(true);
            }
        }
        else if (c === '\n') {
            endSegment(piped && current.length === 0 && !hasWord); // a line ending in | goes on with the pipeline
            for (const op of pendingBodies.splice(0))
                i = readBody(command, i + 1, op); // heredoc bodies are text, not commands
        }
        else if (c === ';' || c === '(' || c === ')' || c === '`') {
            endSegment();
        }
        else if (c === '&') {
            const prev = command[i - 1];
            const next = command[i + 1];
            if (prev === '>' || prev === '<' || next === '>') {
                word += c; // 2>&1 and &>
                hasWord = true;
            }
            else
                endSegment();
        }
        else if (c === '>' || c === '<') {
            let fd = '';
            if (hasWord && /^\d+$/.test(word)) {
                fd = word;
                word = '';
                hasWord = false;
            }
            else
                flush();
            let op = c;
            if (command[i + 1] === c)
                op += command[++i];
            if (op === '<<' && command[i + 1] === '<')
                op += command[++i]; // <<< a here-string
            if (command[i + 1] === '&')
                op += command[++i];
            const token = { text: fd + op, isOp: true };
            if (op === '<<') {
                const strips = command[i + 1] === '-';
                const delimiter = HEREDOC_DELIMITER.exec(command.slice(i + 1 + (strips ? 1 : 0)));
                if (delimiter) {
                    token.delimiter = delimiter[1] ?? delimiter[2] ?? delimiter[3];
                    token.strips = strips;
                    pendingBodies.push(token);
                    i += (strips ? 1 : 0) + delimiter[0].length; // the delimiter is not a word of the command
                }
                else if (strips)
                    i++;
            }
            current.push(token);
        }
        else if (/\s/.test(c)) {
            flush();
        }
        else {
            word += c;
            hasWord = true;
        }
    }
    endSegment();
    return segments;
}
const baseName = (word) => word.split('/').filter(Boolean).at(-1) ?? word;
// words that only introduce a command: `then git push`, `! git push`, `{ git push; }`
const CONTROL_WORDS = ['!', '{', '}', 'then', 'do', 'else', 'elif', 'if', 'while', 'until'];
const WRAPPERS = {
    env: { valued: ['-u', '-C', '--unset', '--chdir'] },
    sudo: { valued: ['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U', '--user', '--group', '--host', '--prompt', '--chdir'] },
    doas: { valued: ['-u', '-C'] },
    timeout: { valued: ['-s', '-k', '--signal', '--kill-after'], positional: 1 },
    nice: { valued: ['-n', '--adjustment'] },
    ionice: { valued: ['-c', '-n', '-p', '-P', '-u'] },
    stdbuf: { valued: ['-i', '-o', '-e'] },
    xargs: { valued: ['-a', '-d', '-E', '-I', '-L', '-l', '-n', '-P', '-s', '--arg-file', '--delimiter', '--max-args', '--max-procs'] },
    watch: { valued: ['-n', '--interval'] },
    time: { valued: ['-f', '-o', '--format', '--output'] },
    nohup: {},
    command: {},
    builtin: {},
    busybox: {},
    exec: { valued: ['-a'] },
    setsid: {},
    caffeinate: {},
};
const SUDO_SHELL_OPTIONS = ['-s', '-i', '--shell', '--login'];
/** The command line `env -S "…"` hands over: the option's value when it is -S/--split-string, else null. Takes the value from `words` when it is the next word. */
function splitStringOf(option, words) {
    if (option === '-S' || option === '--split-string')
        return words.shift() ?? '';
    if (option.startsWith('--split-string='))
        return option.slice('--split-string='.length);
    return option.startsWith('-S') ? option.slice(2) : null;
}
/** The words of a command with VAR=value prefixes, control words and wrappers (with their options) peeled off, the command word as its basename. */
function normalize(all) {
    const words = [...all];
    for (;;) {
        const first = words[0];
        if (first === undefined)
            return words;
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first) || CONTROL_WORDS.includes(first)) {
            words.shift();
            continue;
        }
        const name = baseName(first);
        const wrapper = Object.hasOwn(WRAPPERS, name) ? WRAPPERS[name] : undefined;
        if (!wrapper)
            break;
        words.shift();
        let viaShell = false; // sudo -s / -i: the rest is run by a shell, or is a shell session when there is no rest
        while (words[0]?.startsWith('-') && words[0] !== '-') {
            const option = words.shift();
            if (option === '--')
                break;
            const line = name === 'env' ? splitStringOf(option, words) : null;
            if (line !== null) {
                words.unshift(...line.split(/\s+/).filter(Boolean)); // the command line env -S splits and runs
                break;
            }
            if (name === 'sudo' && SUDO_SHELL_OPTIONS.includes(option))
                viaShell = true;
            if (wrapper.valued?.includes(option))
                words.shift();
        }
        words.splice(0, wrapper.positional ?? 0);
        if (viaShell)
            words.splice(0, words.length, ...(words.length > 0 ? ['sh', '-c', words.join(' ')] : ['sh', '-i']));
    }
    if (!/\s/.test(words[0]))
        words[0] = baseName(words[0]); // a whole command line as one word is read by scriptOf
    return words;
}
const SHELLS = ['bash', 'sh', 'zsh', 'dash', 'ksh', 'su'];
// ssh options that take their value as the next word
const SSH_VALUED = ['-p', '-i', '-l', '-o', '-F', '-J', '-L', '-R', '-D', '-b', '-c', '-e', '-E', '-I', '-m', '-S', '-w', '-W', '-B'];
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;
/** The script a command hands to something that runs it (`bash -c "…"`, `eval …`, `ssh host …`, a here-string), else null. */
function scriptOf(words, hereString) {
    const [first, ...args] = words;
    if (!first)
        return null;
    if (/\s/.test(first))
        return words.join(' '); // a whole command line as one word, as watch and env -S take it
    if (first === 'eval')
        return args.length > 0 ? args.join(' ') : null;
    if (first === 'ssh') {
        let i = 0;
        while (args[i]?.startsWith('-'))
            i += SSH_VALUED.includes(args[i]) ? 2 : 1;
        // args[i] is the host, the rest the remote command; a word with spaces is quoted again so a nested `bash -c "…"` stays one script
        return args.length > i + 1 ? args.slice(i + 1).map(w => (/\s/.test(w) ? `'${w.replace(/'/g, `'\\''`)}'` : w)).join(' ') : null;
    }
    if (!SHELLS.includes(first))
        return null;
    const at = args.findIndex(w => SHELL_COMMAND_FLAG.test(w));
    return at >= 0 ? (args[at + 1] ?? null) : (hereString ?? null);
}
/** The commands `find` runs with -exec, -execdir, -ok and -okdir, each as its words. */
function findRuns(words) {
    if (words[0] !== 'find')
        return [];
    const runs = [];
    for (let i = 1; i < words.length; i++) {
        if (!/^-(?:exec|execdir|ok|okdir)$/.test(words[i]))
            continue;
        const end = words.findIndex((w, j) => j > i && (w === ';' || w === '+'));
        runs.push(words.slice(i + 1, end < 0 ? undefined : end));
    }
    return runs;
}
/** The redirect targets of a segment that write to a file (`>`, `>>`, `2>`); a descriptor copy and /dev/null are not. */
function redirectTargets(tokens) {
    return tokens.flatMap((t, i) => {
        const target = tokens[i + 1]?.text;
        return t.isOp && /^\d*>>?$/.test(t.text) && target !== undefined && target !== '/dev/null' ? [target] : [];
    });
}
/** What a command runs besides itself: the script it hands over, the commands of a `find -exec`. */
function nestedCommands(words, hereString, depth) {
    const script = scriptOf(words, hereString);
    return [
        ...(script === null ? [] : commandsOf(script, depth + 1)),
        ...findRuns(words).flatMap(run => {
            const inner = { words: normalize(run), targets: [], piped: false, inline: false };
            return [inner, ...nestedCommands(inner.words, undefined, depth + 1)];
        }),
    ];
}
/** Every command of a script, the ones it hands to a shell, ssh, watch, eval or find -exec included. */
export function commandsOf(command, depth = 0) {
    return scan(command).flatMap(({ tokens, piped }) => {
        const hereString = tokens.findIndex(t => t.isOp && t.text.endsWith('<<<'));
        const words = normalize(tokens.filter((t, i) => !t.isOp && !(hereString >= 0 && i === hereString + 1)).map(t => t.text)); // the here-string is input, not an argument
        const heredoc = tokens.find(t => t.isOp && t.body !== undefined);
        const stdin = hereString >= 0 ? tokens[hereString + 1]?.text : heredoc?.body; // the script a shell is fed inline
        return [{ words, targets: redirectTargets(tokens), piped, inline: stdin !== undefined }, ...(depth < MAX_DEPTH ? nestedCommands(words, stdin, depth) : [])];
    });
}
// ---------- git ----------
// git options that take their value as the next word
const GIT_VALUE_OPTIONS = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'];
const ALIAS_PUSH = /^alias\..+=.*\b(?:push|merge)\b/;
/** `git [options] sub args`; `pushAlias` when a `-c alias.x=…push` option defines one for this call. */
function gitCall(words) {
    const rest = words.slice(1);
    let pushAlias = false;
    let i = 0;
    while (i < rest.length && rest[i]?.startsWith('-')) {
        if (rest[i] === '-c' && ALIAS_PUSH.test(rest[i + 1] ?? ''))
            pushAlias = true;
        i += GIT_VALUE_OPTIONS.includes(rest[i]) ? 2 : 1;
    }
    return { sub: rest[i], args: rest.slice(i + 1), pushAlias };
}
// ---------- code the guard cannot read ----------
const INTERPRETERS = ['python', 'node', 'perl', 'ruby'];
const kindOf = (command) => command.replace(/[\d.]+$/, ''); // python3, python3.12
/** A shell fed from a pipe with no script of its own (`curl … | sh`, `cat f | bash -s`): whatever it runs cannot be read. */
function pipesIntoShell({ words, piped }) {
    const [first = '', ...args] = words;
    if (!piped || !SHELLS.includes(first) || first === 'su' || args.some(w => SHELL_COMMAND_FLAG.test(w)))
        return false;
    return args.includes('-s') || args.includes('-') || args.every(w => w.startsWith('-'));
}
/** A shell session nobody can read: `sudo -s`, `bash -i`, `bash -l`, or `su` with no -c (it opens a login shell). */
function interactiveShell({ words }) {
    const [first = '', ...args] = words;
    if (!SHELLS.includes(first) || args.some(w => SHELL_COMMAND_FLAG.test(w)))
        return false;
    if (first === 'su')
        return true;
    return args.every(w => w.startsWith('-')) && args.some(w => w === '-i' || w === '-l' || w === '--login' || w === '--interactive');
}
/** A shell whose commands the guard cannot read: fed from a pipe, or an interactive session. */
const unreadableShell = (cmd) => pipesIntoShell(cmd) || interactiveShell(cmd);
/** awk code that runs commands or writes: `system(…)`, `cmd | getline`, `print | "cmd"`. */
const awkRunsCommands = ([first = '', ...args]) => AWKS.includes(first) && args.some(w => /\bsystem\s*\(|\|&?\s*getline|\bprintf?\b[^;}]*\|/.test(w));
/** awk code that writes a file: `print > "f"`, `printf … >> f`. */
const awkWritesFile = ([first = '', ...args]) => AWKS.includes(first) && args.some(w => /\bprintf?\b[^;}|]*>/.test(w));
const AWKS = ['awk', 'gawk', 'mawk', 'nawk'];
/** An interpreter fed code from a pipe or a heredoc (`… | python`, `python - <<EOF`): a script the guard does not read. */
const pipesIntoInterpreter = ({ words: [first = '', ...args], piped, inline }) => (piped || inline) && INTERPRETERS.includes(kindOf(first)) && args.every(w => w.startsWith('-') && w !== '-m');
// ---------- what a command does ----------
// package managers and release tools: any `publish` word among their arguments publishes (pnpm -r publish, npm publish --workspaces)
const GH_API_MERGE = /(?:^|\/)merges?(?:\?|$)|mergePullRequest/i; // …/pulls/1/merge, …/merges, a GraphQL mutation
const PUBLISHERS = ['npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx', 'lerna', 'changeset', 'cargo'];
/** Whether the command pushes, merges or publishes. */
export function pushes(cmd) {
    const { words } = cmd;
    const [first, second, third] = words;
    if (unreadableShell(cmd) || awkRunsCommands(words))
        return true;
    if (first === 'git') {
        const { sub, pushAlias } = gitCall(words);
        return pushAlias || sub === 'push' || sub === 'merge';
    }
    if (first === 'gh')
        return (second === 'pr' && third === 'merge') || (second === 'api' && words.slice(2).some(w => GH_API_MERGE.test(w)));
    if (first === 'claude')
        return second === 'plugin' && third === 'publish';
    return PUBLISHERS.includes(first ?? '') && words.slice(1).includes('publish');
}
const WRITING_COMMANDS = ['rm', 'rmdir', 'mv', 'cp', 'touch', 'mkdir', 'tee', 'chmod', 'chown', 'ln', 'truncate', 'patch', 'wget', 'rsync', 'scp', 'install', 'ed', 'ex', 'vi', 'vim', 'nvim', 'nano', 'emacs'];
// the flag that runs code or edits in place: python -c, node -e/-p, perl -e/-i/-pi, ruby -e/-i
const CODE_FLAGS = {
    python: /^-[A-Za-z]*c/,
    node: /^(?:--eval|--print|-[A-Za-z]*[ep])/,
    perl: /^-[A-Za-z]*[eEi]/,
    ruby: /^-[A-Za-z]*[ei]/,
};
const CURL_OUTPUT = /^(?:--output|--remote-name|-[A-Za-z]*[oO])/;
const INSTALL_WORDS = ['install', 'add', 'i', 'ci'];
const SYSTEM_INSTALLERS = ['pip', 'pip3', 'pipx', 'uv', 'brew', 'apt', 'apt-get', 'gem', 'cargo']; // `<tool> install`, `uv pip install`
const GIT_WRITING = ['apply', 'am', 'restore', 'rm', 'mv', 'clean', 'commit', 'clone', 'init', 'add', 'pull', 'switch', 'checkout', 'cherry-pick', 'revert', 'rebase', 'merge', 'reset'];
const COMPRESSORS = ['gzip', 'gunzip', 'bzip2', 'bunzip2', 'xz', 'unxz', 'zstd', 'compress'];
const TAR_WRITES = /^(?:-?[A-Za-z]*[xcru][A-Za-z]*|--(?:extract|get|create|append|update|delete))$/;
function runsCode([first = '', ...args]) {
    const kind = kindOf(first);
    const flags = Object.hasOwn(CODE_FLAGS, kind) ? CODE_FLAGS[kind] : undefined;
    if (!flags)
        return false;
    const own = kind === 'python' && args.includes('-m') ? args.slice(0, args.indexOf('-m')) : args; // after -m the flags are the module's
    return own.some(w => flags.test(w));
}
const hasFlag = (args, pattern) => args.some(w => pattern.test(w));
const BRANCH_LISTING = /^(?:-[A-Za-z]*[lavr]|--(?:list|all|remotes|verbose|show-current|contains|no-contains|merged|no-merged|points-at))/;
const BRANCH_CHANGING = /^(?:-[A-Za-z]*[dDmMcCu]|--(?:delete|move|copy|set-upstream-to|unset-upstream|edit-description))/;
const TAG_LISTING = /^(?:-[A-Za-z]*[lnv]|--(?:list|verify|contains|no-contains|points-at|merged|no-merged))/;
const TAG_CHANGING = /^(?:-[A-Za-z]*[dasfmu]|--(?:delete|annotate|sign|force|message|local-user))/;
const CONFIG_READING = /^(?:-[A-Za-z]*l|--(?:get|get-all|get-regexp|get-urlmatch|list|show-origin|show-scope))/;
const CONFIG_CHANGING = /^(?:-[A-Za-z]*e|--(?:add|unset|unset-all|replace-all|rename-section|remove-section|edit))/;
/** `git branch` and `git tag` only list unless they are told to create, delete or move; `git config` only reads with one name or a read flag. */
function gitListsOrWrites(sub, args) {
    const positional = args.filter(w => !w.startsWith('-'));
    if (sub === 'branch')
        return hasFlag(args, BRANCH_CHANGING) || (positional.length > 0 && !hasFlag(args, BRANCH_LISTING));
    if (sub === 'tag')
        return !hasFlag(args, TAG_LISTING) && (positional.length > 0 || hasFlag(args, TAG_CHANGING));
    return !hasFlag(args, CONFIG_READING) && (hasFlag(args, CONFIG_CHANGING) || positional.length > 1);
}
function gitWrites(words) {
    const { sub = '', args } = gitCall(words);
    if (sub === 'stash')
        return !['list', 'show'].includes(args[0] ?? '');
    if (sub === 'checkout')
        return !args.includes('--help');
    if (['branch', 'tag', 'config'].includes(sub))
        return gitListsOrWrites(sub, args);
    return GIT_WRITING.includes(sub);
}
/** tar x/c/r/u (a letter cluster, with or without the dash, as the first word or a flag) or a long form of one. */
const tarWrites = (args) => args.some((w, i) => (i === 0 || w.startsWith('-')) && TAR_WRITES.test(w));
/** Whether the command itself (not a redirect) writes files, or obviously changes them: for a read-only role. */
export function writesByCommand(cmd) {
    const [first, ...args] = cmd.words;
    if (!first)
        return false;
    if (unreadableShell(cmd) || pipesIntoInterpreter(cmd) || awkRunsCommands(cmd.words) || awkWritesFile(cmd.words))
        return true;
    if (WRITING_COMMANDS.includes(first))
        return true;
    if (first === 'sed')
        return args.some(w => /^-[A-Za-z]*i/.test(w) || w === '--in-place');
    if (AWKS.includes(first))
        return args.some(w => w.includes('inplace'));
    if (first === 'dd')
        return args.some(w => w.startsWith('of='));
    if (first === 'curl')
        return args.some(w => CURL_OUTPUT.test(w));
    if (first === 'openssl')
        return args.some(w => w === '-out' || w === '-keyout');
    if (first === 'tar')
        return tarWrites(args);
    if (first === 'unzip')
        return !args.some(w => /^-[A-Za-z]*[ltpvZ]/.test(w)); // listing, testing and printing are reading
    if (COMPRESSORS.includes(first))
        return !args.some(w => /^-[A-Za-z]*[clt]/.test(w) || /^--(?:stdout|to-stdout|list|test)$/.test(w));
    if (first === 'git')
        return gitWrites(cmd.words);
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(first))
        return args.some(w => INSTALL_WORDS.includes(w)) || (first === 'yarn' && args.length === 0);
    if (SYSTEM_INSTALLERS.includes(first))
        return args.includes('install');
    if (kindOf(first) === 'python' && args.includes('-m') && args.includes('pip'))
        return args.includes('install');
    return runsCode(cmd.words);
}
/** Whether the command writes files: it redirects into one, or is a command that writes. */
export const writes = (cmd) => cmd.targets.length > 0 || writesByCommand(cmd);
// ---------- the team file ----------
/** A glob word as a regex over one path part; null when it is not a valid one. `*` and `?` stay in the part, `[..]` is kept. */
function partGlob(glob) {
    try {
        return new RegExp(`^${glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
    }
    catch {
        return null;
    }
}
/**
 * Whether a word names the team file: the literal `team.json`, or a glob that matches it (`tea*.json`, `.claude/agent-hq/t?am.json`)
 * in a folder that can be agent-hq. A bare glob (no folder) counts only when the command line mentions agent-hq (a `cd` into it).
 */
function namesTeamFile(word, mentionsFolder) {
    if (word.includes('team.json'))
        return true;
    if (!/[*?[]/.test(word))
        return false;
    const parts = word.split('/').filter(Boolean);
    const base = parts.at(-1) ?? '';
    if (!partGlob(base)?.test('team.json'))
        return false;
    const folder = parts.at(-2);
    return folder === undefined ? mentionsFolder : (partGlob(folder)?.test('agent-hq') ?? false);
}
const MAX_BRACE_COMMAS = 40; // a word with more is left unexpanded
/** A word with its brace lists expanded (`{team,x}.json` → team.json and x.json, `te{a,}m.json` → team.json and tem.json). A `{…}` with no comma is literal; ranges are not expanded. */
function expandBraces(word) {
    if (word.split(',').length > MAX_BRACE_COMMAS)
        return [word];
    for (let open = word.indexOf('{'); open >= 0; open = word.indexOf('{', open + 1)) {
        let depth = 0;
        let close = -1;
        const bounds = [open]; // the opening brace, each top-level comma, the closing brace
        for (let i = open; i < word.length && close < 0; i++) {
            if (word[i] === '{')
                depth++;
            else if (word[i] === '}' && --depth === 0)
                close = i;
            else if (word[i] === ',' && depth === 1)
                bounds.push(i);
        }
        if (close < 0 || bounds.length === 1)
            continue;
        bounds.push(close);
        const before = word.slice(0, open);
        const after = word.slice(close + 1);
        return bounds.slice(0, -1).flatMap((start, k) => expandBraces(before + word.slice(start + 1, bounds[k + 1]) + after));
    }
    return [word];
}
const namesTeamFileExpanded = (word, mentionsFolder) => expandBraces(word).some(w => namesTeamFile(w, mentionsFolder));
/** Whether a command of the script changes the team file (a redirect into it, or a writing command with it among its arguments). `source` is the whole command line. */
export function changesTeamFile(commands, source) {
    const mentionsFolder = source.includes('agent-hq');
    return commands.some(cmd => cmd.targets.some(t => namesTeamFileExpanded(t, mentionsFolder)) || (writesByCommand(cmd) && cmd.words.slice(1).some(w => namesTeamFileExpanded(w, mentionsFolder))));
}
