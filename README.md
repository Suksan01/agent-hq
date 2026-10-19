# Agent HQ

[![Claude Code mod](https://img.shields.io/badge/Claude_Code-mod-D97757)](#install)
[![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FSuksan01%2Fagent-hq%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=7858CA)](.claude-plugin/plugin.json)
[![license: MIT](https://img.shields.io/badge/license-MIT-18883A)](LICENSE)

A Claude Code mod for building and watching orchestrated agent teams.

- **Teams**: the `/agent-hq:team` skill interviews you and saves a team. The main session acts as the team's lead.
- **Band above the prompt**: plan-progress style twinkling tracks for the whole team and the task board, with an
  `Agents ›` button that opens the sidebar.
- **Sidebar** (docked beside a fullscreen transcript, on a darker panel): the agent tree with a pixel-art bot for
  each agent, its nickname, role and running time, what it works on now (`▸`), what comes next (`○ next:`), the last
  thing it finished (`✓`), and a dotted todo track.
- **One live page for every session**: `/hq web` opens your browser on a page that shows the teams of all your open
  Claude Code sessions, and lets you give any of them work.
- **Lead tools, a rule guard, an inbox, XP and badges**: see the sections below.
- Reads todo lists (TodoWrite), the task board (TaskCreate/TaskUpdate) and, when the plan-progress mod is
  installed, its bars as each agent's steps.

Open the sidebar with `/hq`. In the sidebar, `h` hides finished items, `c` clears them, and clicking an agent's name
opens its transcript.

Commands: `/hq` (sidebar), `/hq web` (live page), `/hq report` (session report), `/hq trust` (use a project's team
file). Skills: `/agent-hq:team`, `/agent-hq:standup`, `/agent-hq:retro`, `/agent-hq:handoff`, and
`agent-hq:self-evaluation`, which every team member carries.

## Teams

Run `/agent-hq:team`. It asks, one step at a time, and shows a side-by-side preview for every choice:

1. What the team is for.
2. Where to save it: this project, or all your projects.
3. The lineup: the lead's title and the roles, with how many of each.
4. For each role: mission, tasks, rules, skills, tools and model. Where no installed skill fits, it writes a short
   playbook skill for that role.
5. A last look at the whole team before it saves.

The team is one file, `.claude/agent-hq/team.json` in the project, else `~/.claude/agent-hq/team.json`. The project
file wins. Run the skill again to edit or replace the team.

Agent HQ loads the file right away:

- Each role becomes an agent type named `agent-hq:<role id>`, so the lead hands work to it with the Agent tool.
- The main session acts as the lead. Its title, rules and the roster are added to its system prompt (also the short `lean`
  prompt the desktop app sends; not a `bare` one). Where an organization manages Claude Code, hooks on prompt composition do not run in a plugin you
  installed, so there the lead section and the team's rules are missing from the prompt; the roles still register. The lead's
  `model` (for example `"opus"`) is the one the session should run on: a toast says so, once per change, when it
  runs on another (switch with `/model`).
- Each member knows the rest of the team, reads the team notes (`.claude/agent-hq/team-notes.md`) before it starts
  and adds what the whole team should know. Each role also keeps its own memory between runs
  (`.claude/agent-memory/agent-hq-<role id>/`, shared by everyone on that role) and updates it before it reports, so
  it gets better from run to run (a read-only role can read both but not write them: it hands what it learned to the
  lead in its reply). Members load your CLAUDE.md files like any subagent, but not the main session's
  auto memory. With auto memory turned off (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`) they get no memory of their own
  either, so a member that can edit files adds each lesson as one line to the team notes instead.
- Every member carries the `agent-hq:self-evaluation` skill (adapted from ECC's `agent-self-evaluation`). Before
  its final reply it scores its work against the assignment on accuracy, completeness, clarity, actionability and
  conciseness (1 to 5, with evidence), fixes the gaps it can close quickly, ends the reply with a one-line
  `Self-check` scorecard and keeps a lesson for each weak axis. The scorecard format is also in every member's
  prompt, so the check still happens if the skill did not load (a skill added while a session runs loads only in a
  new session).
- The sidebar shows the lead's title and each role's title.

### A team file needs your say-so

A team file can change what the lead is told and which agents it can start, so Agent HQ uses one only while its text is
the text you trusted:

- **A project's file** (`.claude/agent-hq/team.json`) is used only after you run `/hq trust`. Until then no role is
  registered and nothing is added to the system prompt; a toast says `project team <name> found at <path> - run
  /hq trust to use it`. Every load of a trusted project team says `using project team <name> from <path>`.
- **Your own file** (`~/.claude/agent-hq/team.json`) is held to the same rule. The file that is there when this
  version first runs is trusted once, as it stands. After that a change made outside the session (an editor, a
  script, an agent) is not used until you run `/hq trust`; a toast says `your team file changed outside this
  session - run /hq trust to use it`.
- Trust is remembered per file path and the file's content. **Edit a file and Agent HQ asks again.**
- A team file that the **main session** writes itself during the session, with Write, Edit or `hq_hire`, is trusted
  from that moment. A write by a subagent never is: the team stops being used until you trust the new text.
- Templates for common teams ship with the mod; the `/agent-hq:team` skill offers them. After changing one, run
  `node scripts/check-templates.mjs`: it checks every template parses, is listed in `templates/index.json` and has
  its lead on opus (the mod's own tests cannot read JSON files).

## Lead tools

The lead (the main session) gets four tools, offered as `mcp__agent-hq__hq_assign`, `hq_status`, `hq_hire` and `hq_review`:

- **`hq_assign`**: start a member on a scoped job. Input: `role`, `task`, and optionally `files` (globs the member may
  change), `done` (what finished means), `limits` (what to leave alone) and `name`. The member receives a brief with
  Goal / Files / Done when / Do not touch sections, the job goes on the task board with the member as owner, and the
  files scope is handed to the rule guard.
- **`hq_status`**: where the team stands in at most 40 lines: each agent with what it does now and next, counts of
  running, done and failed agents, the board, and blocked tasks.
- **`hq_hire`**: take on more staff. The number beside a role in `team.json` is its **current staffing**, not a ceiling.
  `hq_hire` raises it (`add`, default 1, up to 10 per role) or creates a role (give `title` and `mission`; at most 12
  roles; a reviewer-like title makes it read-only). It rewrites the team file the team was loaded from, checks it like
  any team file, loads the team again and answers with the new roster. **Before it writes, the engine's own question dialog
  asks you** (naming the file and the change); "No", or a run with nobody to ask, changes nothing. When a role is full, `hq_assign` and the live page's **+** say
  `<Role> is fully staffed (4 of 4 at work)` and point to hiring another.
- **`hq_review`**: send a finished member's work to the team's review role. The reviewer gets what the member was
  asked, what it reported, what to focus on and what its verdict must look like. If the review role is already at its
  count, the brief goes to the running reviewer as a message.

Only the lead can use them; a subagent that calls one gets an error. The `/agent-hq:handoff` skill describes a good
brief, `/agent-hq:standup` collects a three-line status from every running member, and `/agent-hq:retro` turns a
finished task into proposed edits to the team's rules (applied only after you approve each).

## Rule guard

Roles in `team.json` can carry rules, and the mod holds team members to some of them. Every tool call of a **subagent**
is checked before it runs; a refused call comes back to the agent as a denial with the reason, you get a toast
`Agent HQ blocked <nickname> (<name>): <reason>`, and the live page's activity feed notes it.

**What it blocks**

- A role with a `tools` list can use no other tool, except the coordination tools every member keeps (`SendMessage`,
  `TodoWrite`, the plan-progress tool and `TaskCreate`/`TaskUpdate`/`TaskGet`/`TaskList`), so even a read-only reviewer
  can report to the lead.
- A role whose rules say never to push, merge or publish (a negation that governs the verb: "Never edit code, push or
  merge" counts, "Do not skip tests; push only after green" does not), or with `guard.noPush`, cannot run `git push`,
  `git merge`, `gh pr merge`, `gh api …/merge`, `npm`/`pnpm`/`yarn`/`bun`/`cargo`/`lerna publish` (also `pnpm -r publish`,
  `npm publish --workspaces`) or `git -c alias.x=push …`. The command is read through its wrappers (`/usr/bin/git`,
  `env`, `sudo`, `timeout`, `nice`, `nohup`, `xargs`, `stdbuf`, `time`, `command`), through `bash|sh|zsh -c "…"` and
  `eval "…"`, and after `(`, `{`, `!`, `then`, `do` and `else`. `$(…)` and backticks outside quotes are read too, and so
  is what is handed over by a here-string or heredoc fed to a shell (`bash <<< "…"`, `sh <<EOF`), `find -exec`/`-execdir`,
  `env -S "…"`, `busybox`, `watch`, `ssh host <command>` (the remote command is judged), `sudo -s|-i <command>` and
  `su … -c "<command>"`. What cannot be read is refused: a script **piped into a shell** (`curl … | sh`,
  `cat f | bash`), a bare shell session (`sudo -s`, `sudo -i`, `su`, `bash -i`) and `awk` code that runs commands
  (`system()`, `cmd | getline`, `print | "cmd"`). The body of any other heredoc is text. A remote copy (`scp`, `rsync`
  to another host) is not a push, so a no-push role may use it.
- A read-only role (`guard.readOnly`, or a tools list without Edit and Write) cannot Edit, Write or NotebookEdit, and
  cannot run commands that write: redirects into a file, `rm`, `mv`, `cp`, `tee`, `install`, `sed -i`, `awk -i inplace`,
  `awk` with `print > file`, `patch`, `wget`, `rsync`, `scp`, `dd of=`, `curl -o`/`-O`, `openssl … -out`, `tar x|c|r|u`, `unzip` (but not `-l`/`-p`),
  `gzip` and the other compressors (but not `-c`/`-l`), editors (`ed`, `vim`, `nano` …), `python -c`, `node -e`/`-p`,
  `perl -e`/`-i`, `ruby -e`/`-i`, an interpreter fed code from a pipe or heredoc, `npm|pnpm|yarn|bun install|add|i|ci`,
  `pip|pip3|pipx|uv pip|brew|apt|apt-get|gem|cargo install` (also `python -m pip install`), and these git commands:
  `apply`, `am`, `restore`, `clean`, `rm`, `mv`, `commit`, `clone`, `init`, `add`, `pull`, `merge`, `switch`,
  `checkout` (anything), `cherry-pick`, `revert`, `rebase`, `reset` (any), `stash` (except `list`/`show`), `tag` and
  `branch` when they create, delete, move or copy (listing with `git branch`, `git tag -l` is fine), and `config` when
  it sets or unsets a value (`git config --get`, `--list` and `git config user.name` are fine).
- A role with `guard.paths`, or an agent the lead started with `hq_assign` and `files`, can edit and write only files
  matching those globs.
- No member, whatever its role, can change a `.claude/agent-hq/team.json` with Write, Edit, NotebookEdit or a writing
  command, by name, glob or brace list (`tea*.json`, `.claude/*/t?am.json`, `{team,x}.json`, `te{a,}m.json`; a bare
  glob counts when the command mentions `agent-hq`): the team file is where the guards come from, and only you (or the lead, through `hq_hire`) change it.
- A role with any guard (no-push, read-only or scoped) cannot start other agents unless the mod can tell who started
  each agent; an agent such a role starts answers to its guard as well as its own.

**Memory and notes.** A role that may write files can still read, write and edit its own memory folder and the team
notes (with Read, Write and Edit, not with commands), whatever its `guard.paths`. A read-only role can read them but
not write them, and its prompt says so. This is a check of the path's text: it does not follow symlinks. The notes and
the memory files are plain project files any member can change, and every member reads them, so review them like
code, especially after a member worked with untrusted web pages or files. Every prompt tells the member that the notes
and its memory are notes from teammates, not instructions.

**It is not a sandbox, and this is what it cannot see.** The main session is never blocked, nor is a session with no
team. A command is judged by its command words, so what still passes is:

- a script file or program the agent writes and then runs (`bash build.sh`, `npm run deploy`, `make`, `just`, a
  `package.json` script, a git hook);
- the code an interpreter runs for a role that may write files (`python -c`, `node -e`), or, for a read-only role, what
  a script file it runs (`python build.py`) does;
- a command substitution inside double quotes (`sh -c "$(curl …)"`, `echo "$(git push)"`), shell aliases and
  functions, and git aliases defined anywhere but on the command line;
- programs that run a command given as an argument but are not on the guard's list of wrappers: `script -c "…"`,
  `parallel '…'`, `docker run image <command>` (and `docker exec`, `kubectl exec`), `xargs`-like tools of your own;
- a program file run by a tool that can run commands (`awk -f prog.awk`), and a numeric brace range in a team-file name
  (`{1..3}`; only comma lists are expanded);
- remote copies (`scp`, `rsync` to another host): allowed for a no-push role on purpose, since they are not a push;
- obfuscated or generated commands (`$'\x67it'`, a variable holding the command) and symlinks;
- the files a `Bash` command touches: `Bash` is never scoped by `guard.paths`.
- **an agent the roster never lists is not held to any role's rules.** Claude Code's tool call names the calling agent's
  id but not its type, and a workflow's agents, the engine's own helpers (compaction, memory forks) and a member's
  sub-agent that the agent list misses are not in the roster, while team members always are. After one roster refresh an
  agent that is not listed is treated as no team member: no role guard applies (a debug log line says `unlisted agent …
  judged as non-member`). **The team file stays closed to every subagent**, listed or not: no Write, Edit, NotebookEdit
  or writing command can change a `team.json`.

It stops a careless agent, not a determined one. For hard limits use Claude Code's own permission rules or a sandbox.

## Inbox and status line

The mod notices who is waiting on you: a tool call that Claude Code puts to you as a permission dialog, and an agent
held on an approval. They are listed on the live page as the **inbox** (who, since when, what: for example
`Bash: npm test` or `Edit: page.tsx`: a command's name (plus the subcommand for tools like `git` and `npm`), a file's name and a web address's host, never the whole input), and counted in the status line: `working` is the number of agents running a
turn, and `needs you` is the number of inbox items. Agents that are idle between turns or held do not count as
working, and the status line is empty when there is nothing to show.

## Nicknames, sounds and XP

- **Nicknames**: every agent gets a nickname when it first appears (the lead too, from its own pool), shown before its
  real name: `Alex (frontend-dev-1)`. The **Nickname theme** option picks the cast: ordinary first names (people, the
  default), planets, Japanese snacks, pirates, space crew, forest friends or robots. Changing the theme renames every
  agent whose name is from another theme; XP and badges are kept per name, so a renamed agent starts its own.
- **Sounds**: a short, soft, low tone when an agent finishes, needs you, fails, starts, or the team levels up (terminals
  with audio only). Switch them off with the **Sounds** option. The live page plays the same tones; `node
  scripts/make-space-sounds.mjs assets` writes the terminal's clips from `web/space-sounds.js`.
- **XP and badges**: agents earn XP for tool calls (1), finished steps (5), finished tasks (20), green test runs (10),
  approved reviews (15) and finishing their job (25); level = floor(sqrt(XP / 50)) + 1. Eight badges: First Task,
  Getting Handy, Toolbelt Titan, Green Streak, Bug Squasher, Reviewer Eagle, Speedy and Comeback. XP and badges are
  kept between sessions under the agent's nickname, in the mod's own store.
- **Usage**: the engine reports tokens and the time each turn took, so the live page shows per agent its turns,
  working time, input, output and cached tokens, and the model. The engine reports no price, so there is no cost
  figure.

## Reports

`/hq report` writes the session as a Markdown file in `.claude/agent-hq/reports/` (agents, tasks, what each did) and
says so in a toast. When a model answers, three sentences of summary are put on top; otherwise the report is written
without one.

## Mascots

Every agent gets its own bot. The lead is a crowned star. Members get a different shape and colour each, from a set
of eight. The shapes are from [Bot Avatars](https://libraries.dev/bots) by Jakub Antalik (MIT). The browser page draws the real
characters. The terminal draws pixel versions of them, 12×5 cells. Only working bots move; waiting, finished and
failed bots hold still in their own pose.

## Live page

`/hq web` opens your browser on a page served from this machine. It needs Node.js on your PATH.

**One page for every session.** Run `/hq web` in as many Claude Code sessions as you like: they share one page, which
shows each session's team (labelled with its project folder) with a filter chip per session. The first session to
start becomes the hub and serves the page (port 4870 when free, else any free port); the others register with it. If
the hub's session ends, another takes over within a few seconds and the page reconnects without logging in again. A
session that stops answering is shown as stopped after 6 seconds and dropped after a minute. Each session starts
its own small server and keeps its own request queue, so a request for one session can never run in another.

What the page shows:

- **Graph**: a node for each agent, with connection lines. Only working agents get an animated line.
- **Canvas**: drag to move, scroll to zoom, **Fit** to reset, and a full-screen button.
- **Task board.** The data behind the page also carries the **inbox**, the **activity feed** (a numbered log of tools
  used, steps done, status changes, messages and results of your requests; the last 200) and each agent's **XP,
  badges and usage**; how the page shows them is described under Look.
- **Actions**:
  - **+** adds an agent of a role you pick, with a task for it.
  - **Message lead** sends a prompt to the main session. It runs once Claude is free.
  - Click an agent to message it, or to stop it (asks you to confirm).
  - **Hide done**, **Show done** and **Clear done** manage finished agents and tasks.

Nothing is loaded from the internet: React, HeroUI, the mascot library and the fonts are bundled in `web/vendor/`
and served by the local server (rebuilt with `node web/build-vendor.mjs`, which is the only step that needs npm and a
network). The rebuild installs exactly what `web/vendor-build/package-lock.json` pins (`npm ci`, versions and hashes),
scans the bundles for `eval`, `new Function`, `fetch(`, `XMLHttpRequest` and remote loads (only three.js's own `fetch`
calls are allowed), and writes `web/vendor/SHA256SUMS`; `node web/vendor-guard.mjs` checks the files against it.
`SHA256SUMS` sits beside the files it lists, so it catches drift and tooling accidents (a half-finished rebuild, a stray
edit), not a hostile change of both; the lockfile and the build-time scan are the real guards.
`node web/build-design.mjs [folder]` builds the design showcase into a new or empty folder (default `web/design/out`)
and refuses any other folder.

### Safe and lossless

- **Logging in.** The server listens on 127.0.0.1 only and checks the `Host` header. Each session prints a
  one-time login link (`http://127.0.0.1:<port>/?c=<code>`) that works once, for two minutes; opening it sets a
  session cookie named for the hub's port (`HttpOnly`, `SameSite=Strict`) and every other request needs that cookie.
  Run `/hq web` again and you get a new link; a browser that is already logged in is simply sent to the page. Requests from another
  origin, or with a cross-site fetch header, are refused. The page runs under a strict Content-Security-Policy:
  its own scripts, styles and fonts only, no framing, no forms.
- **Your requests are not lost.** The page's request is answered `202` only after the session's server has written it
  to a private file (`~/.claude/agent-hq/live/<session id>.json.queue.jsonl`, mode 0600) and printed it. The server
  re-sends every request every 2 seconds until the mod acknowledges it by writing `lastAction` (the highest request
  id it handled) into the state file, and re-sends the unacknowledged ones after a restart, with the same ids.
  The mod runs each id once, even if it sees it many times. A request that fails is reported on the page and as a
  toast, and is not retried.
- **Live.** The mod writes the state whenever it changes (at most one write every 50 ms, always the latest state, so
  a burst of changes ends with the last one on disk). The hub watches each state file and pushes to the page as soon
  as the content changes; a file caught half written is read again and never shown. The tests require a push within
  300 ms of a state change. Measured on one Mac over loopback, with real servers and a scripted stand-in for the mod:
  a state write reached the page in about 33 ms (p50 and p95; worst 73 ms; 100 of 100 arrived), and a request
  from the page reached the mod in 3 ms (p50) to 14 ms (p95), 200 of 200 with 16 in flight. Writes closer together
  than about 50 ms can merge into one push on macOS, so the page always ends on the latest state, not on every
  intermediate one.
- **Survives crashes.** In the tests a session server killed with `kill -9` in the middle of a burst of 150 requests
  (66 accepted) printed exactly those 66 again on restart, with the same ids, and each ran once; a burst of 200
  requests over two sessions lost, repeated and misrouted none; and when the hub was killed the other session took
  over on the same port and the page reconnected with its old cookie, with all later requests running once.
- **Retries are safe.** The page sends a `key` with each request (one per click, reused on a retry). A request sent
  again with a key that was already queued gets the same id and is not run twice, even if the first answer was lost
  or the session server was restarted in between.
- **Not flooded.** A session takes at most 200 requests that the mod has not yet acknowledged (then `429`), and the
  hub at most 20 open pages. A queue file line is checked again like a new request when it is read back.
- **Tidy.** The hub deletes the state, queue and old request files of sessions that ended more than 24 hours ago and
  are not registered, only in `~/.claude/agent-hq/live` (its own `hub.json` is never touched).

The first request after `/hq web` can wait up to a second: the engine refuses to submit a prompt from inside the
command that started the page, so requests are taken on the next poll.

## Look

> **Placeholder.** This section is for the redesigned page (theme, layout and screenshots). It is filled in after the
> design is approved.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-hq --marketplace Suksan01/agent-hq
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install agent-hq --marketplace Suksan01/agent-hq
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace
with `Suksan01/agent-hq`, then Add plugin.

If your Claude Code doesn't recognise `--marketplace`, add the marketplace first, then install from it:

```
/plugin marketplace add Suksan01/agent-hq
/plugin install agent-hq@agent-hq
```

The `/plugin` commands are typed at the Claude Code prompt; Claude can't run them for you. Start a new session
(or run `/reload-plugins`) if the mod doesn't load right away.

## What it can see

Agent HQ reads what Claude Code does so it can draw it, and it acts in the places listed below. It reads:

- **Every tool call's name** and which agent made it, for the tool count, the `▸` line and the activity feed. For
  subagent calls the rule guard also reads the call's input (command, file path) to apply the rules above.
- **TodoWrite, TaskCreate and TaskUpdate inputs** (todo text, task titles, owners, status) and the new task's id
  from TaskCreate's result, for the todo bars and the task board.
- **Permission questions** Claude Code puts to you: the tool, the agent, and a short line (the command or file path).
- **Claude's reply rows**, to find `plan_progress` calls and the bar id they name, and to keep each agent's last
  answer (in memory, clipped) so `hq_review` can pass it on.
- **The end of every turn**: token counts, duration and model, per agent.
- **The agent list** (name, type, short description, status, parent), once a second.
- **plan-progress's saved bars**, if that mod is installed, read only.
- **Your settings list**, only to find `theme` (for the dark or light tint), and later changes to it.
- **Your team file**: `.claude/agent-hq/team.json` in the project, else in your home folder. It is read at the start
  of a session, on `/hq`, and right after a tool writes that file.
- **Test and git commands** an agent runs through Bash (only to tell a green test run from a red one, for XP).
- **The live page's requests**, as lines the local server prints.

What it does with that:

- Keeps it in memory for the current session. Between sessions it keeps only: XP and badges per nickname, and
  which project team files you trusted (path and a fingerprint of the content), in the mod's own store. Team members
  write their own memory (`.claude/agent-memory/agent-hq-<role id>/`) and the team notes
  (`.claude/agent-hq/team-notes.md`) in your project; delete those to make the team forget.
- Draws the band above the prompt, the sidebar and a status line, adds the `/hq` command, and opens the sidebar
  the first time an agent starts.
- When a team file is in force: registers each role as an agent type (`agent-hq:<role id>`) and adds one section to
  the main session's system prompt naming it the team's lead, with the lead's rules, the roster and a note on the
  lead tools.
- **Answers its own three tools** (`hq_assign`, `hq_status`, `hq_review`) and, for subagents only, **can deny a tool
  call** under the rule guard. It changes no other call and rewrites nothing.
- Plays a sound in terminals with audio (the `assets/` clips), if the option is on.
- `/hq report` asks the model for a three-sentence summary of the session report (one model call), and writes the
  report file in your project.
- Only when you run `/hq web`: starts `node web/server.mjs` and opens your browser at it. It writes the page's
  state, the same names, statuses and progress the sidebar shows, to `~/.claude/agent-hq/live/<session id>.json`
  whenever it changes, and the hub keeps `hub.json` (its port, process id and a secret) in the same folder, readable
  by you only. Files of sessions that ended are deleted after 24 hours.
- Only when you ask for it from the live page, and only then: submits your text as a prompt to the lead, sends your
  text as a message to an agent, stops an agent with Claude's own TaskStop tool (its permission rules apply), or
  starts an agent of a role with your task. Nothing else runs from the page.
- Sends nothing over the network: the live page and everything it loads are served from your machine.

The `/agent-hq:team` skill is what writes the team file and any role playbooks, through Claude's own tools, after
you confirm. All of the mod's code is in `hooks/` and `web/`; `claude plugin validate <mod folder>` lists every
event the mod hooks and every call it makes.

## Updates

Auto-update is off by default for marketplaces other than Anthropic's, so turn it on once:

1. Type `/plugin`, open the **Marketplaces** tab, select **agent-hq**, and choose **Enable auto-update**.
2. Claude Code then checks for updates within about ten minutes of your first message in each interactive session,
   downloads new versions in the background, and applies them from your next session (or after `/reload-plugins`).

To update by hand instead:

```
claude plugin marketplace update agent-hq
claude plugin update agent-hq@agent-hq
```

Then restart Claude Code, or run `/reload-plugins` in a running session.

- **A failed check** (offline, say) leaves you on the version you have; the next session tries again.
- **Updates switched off:** `DISABLE_UPDATES=1`, `DISABLE_AUTOUPDATER=1` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
  also stop plugin updates, unless `FORCE_AUTOUPDATE_PLUGINS=1` is set too.
- **Teams:** an organization admin can turn auto-update on for everyone by listing this marketplace under
  `extraKnownMarketplaces` with `"autoUpdate": true` in managed settings.

New versions are published by raising `version` in `.claude-plugin/plugin.json`; a commit without a version change
does not reach installed copies.

## Tests

From the mod folder:

- `claude plugin test .` runs the mod's tests (`tests/`), `claude plugin validate .` lists every event it hooks and every
  call it makes, and `tsc -p . --noUnusedLocals` type-checks it.
- `node --test web/server.test.mjs web/build-design.test.mjs` tests the local server, the hub and the design build
  (real server processes on free ports, in temp folders).
- `node --test skills/self-evaluation/skill.test.mjs` checks that the self-evaluation skill teaches the same evidence
  rule as the role prompt, and that every `Self-check` example in it follows that rule (the mod's test sandbox cannot
  read Markdown).
- `node --test --test-concurrency=1 web/e2e.test.mjs` is the end-to-end proof that the live page is realtime and
  lossless: a real hub and two real session servers with scripted stand-ins for the mod, and a raw HTTP client for the
  page. It prints the numbers it measures. It is timing-sensitive, so run it alone or with `--test-concurrency=1`. On a
  busy machine it scales every wait and latency budget by the machine's load (set `AGENT_HQ_TEST_SLOWDOWN=<n>` to
  force a factor).
- `node --test --test-concurrency=1 web/browser.test.mjs` opens the live page in a real headless Chrome of its own (a
  throwaway profile and debugging port; your Chrome is never touched) against a real hub. It is skipped when no Chrome
  is found; `CHROME_BIN` overrides the path.

## Credits

The dotted progress tracks are adapted from the [plan-progress](https://github.com/zycck/claude-mods) mod by Kirill
Serditov (MIT).

The mascots are shapes from [Bot Avatars](https://libraries.dev/bots) by Jakub Antalik (MIT). The live page serves the
library from `web/vendor/`; the terminal pixel versions are drawn after it.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Agent HQ is released under the [MIT license](LICENSE).

## Notes

- Agent names in Chinese, Japanese or Korean, or with emoji, show those characters as `·` inside the dotted tracks.
- A theme set to "auto" is drawn with the dark tint.
- Agent status is polled once a second.
