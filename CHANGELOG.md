# Changelog

## 0.8.1 (2026-10-25)

### Changed
- **Impeccable is the default design-quality skill for UI roles.** When the plugin is installed, the team interview adds
  `impeccable:impeccable` to every role that builds, designs or reviews UI or UX. The lead runs `init` once per project
  and `shape` before a design task (they interview the person); builders run `polish` before done; review and QA roles
  run `audit` and report findings without edits. It offers the install on the person's yes. HeroUI is unchanged.
  Impeccable's launcher downloads and runs a binary on first use.

## 0.8.0 (2026-10-25)

### Added
- **hq_assign `worktree: true`.** Runs a member in its own git worktree: the tool answers with the Agent call (carrying `isolation: "worktree"`) for the lead to make, and the brief tells the member to commit there for the lead to merge. It cannot be combined with `files` (the guard checks scopes against the project folder). The feature skill uses it for parallel tasks.

- **A view-only card for each permission ask on the live page.** It shows who asks, the tool, the fields that decide the
  ask (command, file path, URL, pattern, description) and only the names and sizes of file contents and edit strings,
  with hidden characters made visible. A secret or more than 2 KB hides the fields; the newest 5 asks carry a card. It
  says to answer in the terminal and has no Allow or Deny: nothing the page sends can answer an ask. The card goes when
  the call is allowed, denied or fails, and at the session's end.

### Removed
- **Page approvals** (they never shipped enabled) and `/hq web approvals`: the hold in `tool.check`, the approve helper,
  the hub's approval routes and tokens, and their strings and tests. An agent of the same OS user could reach every
  such path, so the terminal dialog stays the only way to answer. `/hq web` gives the login link in its reply again.
  The `pageApprovals` key left in `$.store` by earlier builds is not read and is harmless.

### Fixed
- **No false board failure.** In a session whose tool list has no TaskCreate (and the call fails), hq_assign no longer says the board "could not be updated": it says once that the assignment is tracked on the Agent HQ sidebar and live page. A real TaskCreate error keeps its reason.

## 0.7.2 (2026-10-24)

### Changed
- **Self-evaluation states the evidence rule.** The skill now says a 5 cites its proof and what counts as proof per axis, as the role prompt does, and every axis in its examples carries a gap or a proof.
- **Works alongside Superpowers.** With Superpowers (or another workflow plugin) enabled, the lead is told that
  Agent HQ runs the team's work: `/agent-hq:feature`, hq_assign and hq_review, not Superpowers'
  subagent-driven-development, executing-plans or dispatching-parallel-agents, whose plain subagents skip the board,
  the guard and the live page. Its other skills stay available, and roles may list them (`superpowers:<skill>`) to
  load on demand.
- **Works alongside Superset.** The lead uses superset:orchestrate only when the person asks for separate workspaces
  or hosts; the feature skill shares a phase with `superset:page` and checks screens with `superset:browser` when
  they are installed; the standup skill says when superset:standup fits instead.
- **Skills match 0.7.1.** A skill-creator audit fixed self-evaluation's description (nothing is preloaded now),
  handoff's report field and status handling, and the feature skill's trigger wording.
- **Briefs as files.** A Team Assistant writes each brief to `.claude/agent-hq/briefs/` (only that role may) and
  hq_assign takes `brief_file`, so a brief no longer passes through the lead twice.
- **A per-task model.** hq_assign's optional `model` runs one assignment on another model (haiku for mechanical work).
- **Fix loops end.** The feature build allows three review-fix rounds; then a fresh member or the person decides.
- **Lighter routine.** Small assignments may shorten the Self-check line, and members update their memory only when
  a run taught them something.
- **Fixes from a measured run.** hq_review takes idle teammates; a failed board update says why; members name the
  team's files by absolute path (a member working in another repo wrote them there); hq_assign takes `skills`, loaded
  first, because members did not load skills on their own; members call hq_doing only when their step does not say it.
- **Cheaper members and lead.** The team interview gives roles that need no MCP tools a tools list (about 38k tokens a
  member in a session with many MCP servers), and the lead suggests a fresh session for a feature when the
  conversation is already long.

## 0.7.1 (2026-10-24)

### Changed
- **Members work together and cost fewer tokens** (borrowed from Superpowers' subagent workflow). A member that can
  edit files writes its full report to `.claude/agent-hq/reports/<role>/<name>.md` and replies to the lead in at most
  15 lines with a `Status:` (DONE, DONE_WITH_CONCERNS, BLOCKED or NEEDS_CONTEXT); a read-only one replies with its
  findings in at most 30. Members see the board and each other's reports and ask a running teammate directly with
  SendMessage. The lead points briefs at the spec, the plan task and reports instead of pasting them.
- **Role skills load on demand.** Members no longer preload their skills and the self-evaluation skill; the role
  prompt names them for the Skill tool, which limited roles now have.
- **Leaner reviews.** hq_review points the reviewer at the member's report and the diff, and tells it not to re-run
  tests the report already proves.
- **The feature skill is 40% smaller.** Phase 3's prototype steps moved to `skills/feature/references/prototypes.md`,
  read only when a feature has a user interface.

## 0.7.0 (2026-10-21)

### Added
- **Next-step suggestions on the live page.** After each of the lead's turns, while a live page is open, Agent HQ
  asks for a short recap and up to three things you could ask next, in your language, and shows them on the lead's
  deck. Pressing one puts its text in the Message lead box (คุยกับหัวหน้า) for you to edit and send; it never sends
  by itself. "Not now" hides a set. It costs one short forked call per lead turn while a page is open (it shares the
  session's cache); `/hq web next off` turns it off.

### Changed
- **Answering permission asks on the live page comes in the next release.** It is built, but ships switched off:
  `/hq web approvals` says so, and the page server serves no approvals. It waits until the page's login can no
  longer be derived from a file other programs on your machine can read.

## 0.6.0 (2026-10-21)

### Added
- **Thai or English.** Agent HQ asks once which language to use (in a terminal session, when the desktop app joins,
  or on your first plain `/hq`), and `/hq lang thai|english` or `/config` changes it. The sidebar, band, status line,
  toasts, command replies, dialogs, session report and the live page all speak it, in Thai from a glossary you
  reviewed. The lead and every member speak it to you and write the files you read (specs, plans, reports, team
  texts) in it; code, commands, paths and commits stay English, and so do the skills' ids and status words. Thai shows
  as Thai in the terminal sidebar (it used to turn into "·") and is never cut inside a letter and its marks.
- **What each agent is doing now, the lead too.** A new `hq_doing` tool lets the lead and every member say what it is
  doing in one short sentence ("กำลังทำ API เก่าและแก้ปัญหาที่เจอ"). Without one, the line comes from the step in
  progress, the assignment, or for the lead "Waiting for 3 of 4 members". It is line 2 of each sidebar row, the band's
  activity line, and a line on every live-page card, the lead's deck included.
- **Talk bubbles.** When agents message each other or the lead, hand work back, are given work or finish, a short
  bubble ("← หัวหน้า: แก้ปัญหาของ API เก่า") floats over that agent's card on the live page and takes its third sidebar
  line for 6 seconds. One per card, at most four at once; your own messages make none, and a spawn's prompt never
  shows.

### Changed
- **Sidebar rows.** Line 2 is the agent's sentence; while a call runs, a member's line 3 is its live tool line
  instead of its task (the lead keeps its crew count there).

### Fixed
- **The rule guard no longer fails open.** If the guard could not finish (an error, or running out of time), Claude
  Code skipped it and ran the tool, so a read-only member's edit could go through. A member's call the guard could not
  judge is now refused, and recording a refusal can never undo it.
- **Secrets stay masked** in everything Agent HQ shows you: status sentences, bubbles, the activity feed, todo and
  task text, the live tool line and the session report. Keys and tokens (GitHub, GitLab, AWS, Anthropic, Stripe,
  Slack, Google, npm), passwords, JWTs and credentials in URLs are shown as `***`; file paths and code names are not.
  The task an `hq_assign` gives was shown unmasked in the feed before.
- **`hq_hire` makes a reviewer read-only by its role id too,** not only by an English title, so a Thai title keeps it
  read-only.
- A double space after a band track's glyph, and a live-page browser test that failed under load.

## 0.5.0 (2026-10-21)

### Changed
- **Prototypes on Claude's Design canvas.** `/agent-hq:feature` builds phase 3's variants on Claude's Design canvas by
  default: a row of boards per variant, the Recommended row on top, a private link you can share, and nothing in your
  repo to clean up afterwards. In a live test it showed the variants in about half the time. Building them in the app
  with HeroUI and a React Flow canvas page stays, as an opt-in for prototypes on your real stack. Phase 3 opens with
  one question: where to build, how many variants, and whether the lead checks that every board renders before you
  pick one.

### Fixed
- **Team members start in auto mode.** In the desktop app, auto mode refused the mod's own start of a member, so
  `hq_assign` and `hq_review` could start no one. Now the board task and the file scope are kept, and the tool answers
  with the exact Agent call for the lead to make itself. While that start waits, neither `hq_assign` nor the live
  page's **+** can take its name or replace its scope.
- **Trusting a project team from an app's command menu.** Picking `/hq` from the command menu (the desktop app,
  Superset) runs it before `trust` can be typed, so the team was never trusted and its member types never appeared.
  Plain `/hq` now asks whether to trust a waiting team file ("No" first, and not again after a No). Only your own run
  can trust: a plugin's, scheduled or relayed `/hq trust` is refused.
- **The feature workflow's HeroUI setup checks a real page.** Setup is done only when the lead loads the prototype
  page and a HeroUI Button renders; in a live test lint and tsc passed while every page returned 500, because
  `.npmrc` set `legacy-peer-deps` and HeroUI's peers were never installed. The lead now checks for that and installs
  the peers, runs the one dev server, installs only the Claude skill at versions at least two weeks old, and looks
  for the HeroUI tools before asking for a restart.
- **Smaller feature-workflow fixes from the same test.** The project's own spec and plan folders are used; prototype
  routes stay out of i18n middleware and app-shell layouts; the canvas page reads a `flows/index.json` manifest; the
  review role checks the variants before you pick; members close their own plan-progress bars.
- **Finished agents leave the live page.** A member that completed, failed or was stopped leaves the page 2 minutes
  after it ended and is only counted in the done and failed numbers at the top; a teammate idle for more than 10
  minutes leaves too, and comes back as soon as it works again; a member whose drawer is open stays in the drawer until
  you close it. Before, every agent a session ever ran stayed as a card for the whole session (57 on one team).
- **"Needs you" empties.** An idle teammate counts as needing you for its first 10 minutes only; an agent held on an
  approval and an open permission dialog still count however long they wait. A permission ask now also leaves the
  inbox when its agent's turn ends: the Agent calls `hq_assign` makes were asked about but never reached the mod as a
  tool call, so their asks stayed in "needs you" for good.
- **`/hq web` opens no second tab.** It asks the hub how many pages are open and opens a tab only when none is: one
  page shows every session, so each `/hq web` (in this or another session) used to add a tab that cost memory. With a
  page open it says so and gives a fresh link for another browser.
- **Agents close the browser tabs they open.** The lead's and every member's prompt now say to close each browser tab
  or window they open to check their work: agents checking pages in your own browser left them open (one team: 42
  tabs opened, 6 closed).
- **The browser tests close a Chrome whose start failed.** A headless Chrome that started but could not be connected
  to was only killed when the test process exited, and never if that process was killed.

## 0.4.1 (2026-10-21)

### Added
- **A gated feature workflow.** `/agent-hq:feature` runs a big feature in six phases, each ending at a gate you
  approve, and the lead is pointed to it for any big feature:
  - brainstorm, then a spec in `docs/specs/` with Given/When/Then acceptance criteria, the project's own rules from
    `CLAUDE.md`, and a security or money audit when auth, money or personal data is touched;
  - UI prototype variants in different visual and UX styles, built in parallel with HeroUI v3 by default (the
    project's own UI library on request) through the official `heroui-react`/`heroui-native` skills and the HeroUI MCP
    server, and laid out on one React Flow canvas page (loaded from a CDN, nothing installed): one row of screen
    frames per variant, recommended first, joined by labelled connections, with drag-to-connect across variants to
    sketch a mix;
  - a task plan in `docs/plans/` with feature flag, migration and rollback steps, docs and change notes as tasks, and an
    estimate of agents and time before a large build;
  - a build on a feature branch: QA writes the failing tests first, parallel members work in their own worktrees, and
    each task is reviewed and committed before the next one that depends on it;
  - a finish with the full suites, a real-browser check against the chosen variant, clean-up, and an offer of a pull
    request and a retro.
  You can skip a phase on purpose, and share a phase's spec or canvas as a page.
- **HeroUI in the team interview.** UI roles get the official HeroUI skill, a rule to look every component up with the
  HeroUI MCP server, and its tools by full name when they have a tools list.
- **A Team Assistant you can add.** The `/agent-hq:team` interview offers a Team Assistant once the lineup is set.
  It reads the project and writes each member's brief and a short proposal for you (the parts, options, trade-offs)
  before work starts, and drafts the lead's updates and closing report.
- **Full role cards for new hires.** `hq_hire` takes tasks, rules, skills, tools, model, effort and playbook for a
  new role and names them when it asks you to confirm, so a role added mid-session is as complete as one from the
  interview.

### Changed
- **Briefs with the context members lack.** The lead is told that members see none of the conversation, so every
  brief carries your words, the files and limits, conventions and commands, decisions so far and what "done" means.
- **Bars in the desktop app look like plan-progress's.** The band's Team and Tasks tracks and the sidebar's bars were
  plain 8 px strips; each is now a dot grid in its state's colour filling to its share, with the terminal's pill at its
  head: `1/3`, `in progress`, `2 running 1/4`. A working agent with no todos yet gets a glow drifting along its bar,
  "getting started" in the pill, and the words are no longer repeated beside the bar.

### Fixed
- **The feature workflow can run as written.** From a review of #3: the Team Assistant can now save the spec and plan
  (it was read-only); parallel members share the checkout, since `hq_assign` has no worktree option; QA's failing
  tests have their own files and are committed before the developer starts; the canvas stays until the finish compares
  the build against it; the HeroUI setup is its own assignment that runs first; every gate fits AskUserQuestion's 4
  options; `Status:` marks every phase draft when it starts and approved at its gate, and the brainstorm is saved, so a restart for the HeroUI MCP server
  resumes cleanly; and each member's changed files are checked against the scope of the members running as soon as it reports.
- **`hq_hire` playbooks are files.** A new role's playbook must be the absolute path of a Markdown file, and the
  confirmation names its effort and playbook.
- **The sidebar reads as one tidy list in the Claude desktop app.** The team heading stays on one line, the folder
  name giving way first; each agent's dot and tree branch sit on its name's line, the lines under a name start under
  it, and no blank rows are left before a bar. The dot shows the agent's state in the header's colours (blue working,
  amber needs you, green done, red failed) instead of its bot's colour, which could look like an error on a working
  agent. The terminal sidebar is unchanged.
- **The lead now works in the Claude desktop app.** The lead's system prompt section skipped "lean" prompts, which
  is what the desktop app sends, so the main session there never became the lead.
- **Reviewers can report back.** A role with a tools list (such as a Code Reviewer) could not use SubagentHandback,
  so its report was rejected.

## 0.4.0 (2026-10-20)

### Added
- **The team lead keeps you in the loop.** Before handing out work it says the plan and which member takes each
  part, gives a line as each member finishes, fails or gets stuck, asks your decisions at once instead of guessing,
  and ends with one report saying what was done, who reviewed it and what is waiting on you.
- **A clickable sidebar.** "No team yet" has a **Build a team** button that runs `/agent-hq:team`, a board task
  opens the agent that owns it, and the "+N more idle/done" line unfolds the folded agents (**Fold idle** folds them
  again).
- **Offered when it fits.** In a project with no team file, Claude offers `/agent-hq:team` when you ask for a team
  or for work that needs several agents in parallel.

### Changed
- **Sharper bars in the Claude desktop app.** Where the terminal's pixel tracks are not drawn (desktop, VS Code,
  mobile), the sidebar's bars are rounded Svg bars in the status colour with their words beside them, instead of
  block characters.
- **A clearer team interview.** Each `/agent-hq:team` question says its step ("Step 4 of 8"), every preview reads
  the same way and names real folders, and the interview first reads the project's stack, app folders,
  `CLAUDE.md`/`AGENTS.md` and matching skills, then uses them to suggest templates, missions, skills and first tasks.

## 0.3.3 (2026-10-20)

### Changed
- **Agents get ordinary first names by default.** The new **People** nickname theme (80 first names for members, 12
  for leads) is the default. Planets and the other themes are still options. Changing the theme now renames every agent
  whose name is from another theme. XP and badges are kept per name, so a renamed agent starts its own.
- Each session's lead is named from its own session, so two sessions' leads are no longer named alike.

### Fixed
- **Two sessions of the same team in the same folder are told apart on the live page**: they read "Team #1" and
  "Team #2" in every title, chip, list and toast. Chips no longer repeat the folder unless the same team name runs in
  another folder too.

## 0.3.2 (2026-10-19)

### Fixed
- An idle teammate (done with its turn, waiting for a message) now counts as needing you: the status line reads
  "0 working · 1 needs you" instead of going blank, and the teammate is listed in the inbox as "idle, waiting for a
  message", matching the sidebar.
- The band's Team track counts only working agents, so an idle or waiting teammate is no longer labelled "1 running".

## 0.3.1 (2026-10-19)

### Changed
- The bundled libraries no longer carry HeroUI or BotAvatar, which nothing has used since the space page replaced the
  island page: `web/vendor/libs.js` shrinks from 579 KB to 385 KB and `heroui.min.css` is gone.

### Fixed
- The live page's drawer test waits for the view to settle after Fit before its real mouse click, so it no longer
  fails on a loaded machine.

## 0.3.0 (2026-10-19)

### Added
- **A new space-themed live page** (`/hq web`). It replaces the old one. Each session's team is a group in a 2D
  diagram of glass cards with live connections, and an optional **Space view** (three.js, loaded only when chosen,
  hidden without WebGL) shows each team as a star system: members are planets with their own spin and tilt, and
  cards sit in stable slots beside them.
  - The lead gets a **command deck** with a mission board.
  - Moving between teams plays low swoosh sounds, with tones that follow the direction.
  - The page is still when nothing works: no animation, no re-render.
- **The live page survives hot reloads**: after `/hq web` the mod restarts its page on the same port and secret, so
  an open tab reconnects without a new login.
- **Terminal sidebar**: active agents first, a live activity line per agent, small member mascots and controls at the
  top (Hide done, Clear done, ✕ Close).
- **One live page for every session.** `/hq web` in any number of Claude Code sessions shares one page (a hub),
  with each session's team and its own request queue. If the hub's session ends another takes over; the page
  reconnects without a new login.
- **Lossless, live requests.** The page's request is answered only after it is queued in a private file; the
  server re-sends it every 2 s until the mod acknowledges it (`lastAction` in the state file), and after a restart.
  The mod writes the state on every change (at most one write per 50 ms), and the hub pushes to the page as soon
  as the file changes (within 300 ms in the tests).
- **Lead tools**: `hq_hire` (raise a role's headcount, or create a role, in the team file; the headcount is current staffing, not a ceiling), `hq_assign` (start a member on a scoped job, with files, done-when and limits, put on the task
  board), `hq_status` (the team in at most 40 lines) and `hq_review` (hand finished work to the review role).
- **Rule guard** for subagents: tools list, never push/merge/publish, read-only roles and file scopes, with a toast and
  a feed entry on each refusal. It is not a sandbox: no `$(...)`, alias or script analysis.
- **Shared team context and members that learn**: every member's prompt lists the rest of the team and points to
  the team notes (`.claude/agent-hq/team-notes.md`), which all members read first and add to; each role keeps its
  own project memory (`.claude/agent-memory/agent-hq-<role id>/`) and updates it before it reports. The guard leaves
  both writable for every role that can edit files; a read-only role hands its lessons to the lead.
- **Self-evaluation for every member**: the new `agent-hq:self-evaluation` skill (adapted from ECC's
  `agent-self-evaluation`, MIT) is preloaded into each role. Before its final reply a member scores its work on five
  axes with evidence, fixes quick gaps, ends with a `Self-check` scorecard and keeps a lesson for each weak axis.
  The scorecard format is in the role prompt too, so it holds when the skill did not load. With auto memory off
  (`CLAUDE_CODE_DISABLE_AUTO_MEMORY`), members that can edit files keep their lessons in the team notes.
- **Inbox and status line**: permission questions and held agents wait in an inbox on the live page; the status line
  reads `N working · M needs you`.
- **Activity feed** on the live page: a numbered log (the last 200) of tools used, steps done, status changes,
  messages and request results.
- **Nicknames** (theme option), **sounds** (option), **XP, levels and eight badges** kept across sessions, and
  **per-agent usage** (turns, working time, tokens; the engine reports no price).
- `/hq report` (session report in Markdown), `/hq trust`, and the skills `standup`, `retro` and `handoff`.
- Request results name agents as `Nickname (name)`.
- **Lead model**: the team file's `lead` takes a `model` (the team skill and every template set `opus`), and a toast warns, once per
  change, when the session runs on another one; it is checked when the team loads and as each prompt goes in.
  `node scripts/check-templates.mjs` fails when a template loses its lead's opus or is missing from the index.

### Changed
- `/agent-hq:team` asks clearer questions: labels name what happens, the recommended option says why, previews mark
  what differs from it and end with a summary line, open questions come with an example answer, an existing team or
  save place says what would be replaced, and catch-all options ("Change it", "Change something") are replaced by
  real changes. Every role gets its own model question with a suggested default (the template's, else by the kind
  of work, never haiku for a role that writes code), and the lead is saved to run on opus.
- A role that is full says `<Role> is fully staffed (4 of 4 at work)` and points to hiring another.
- **Team files must be trusted** (`/hq trust`) before their roles and lead section are used; editing one asks again.
  This covers a project's file and your own `~/.claude/agent-hq/team.json` (the one present at the first run is trusted
  once). Only the main session's own writes (and `hq_hire`) are trusted automatically, never a subagent's. Every load
  of a project team says so in a toast.
- The live page needs no internet: its libraries and fonts are bundled in `web/vendor/` and served locally. The page
  runs under a strict Content-Security-Policy.
- Login is a one-time link and a session cookie instead of a token in every URL. Cross-origin requests and requests
  without a JSON content type are refused.
- The status line counts only agents that are running (idle and held agents do not count), and the animation stops
  when nobody works.
- Requests move from `<session>.actions.jsonl` (read by the mod once a second) to lines on the server's stdout,
  acknowledged by id.
- A failure while the mod notes a finished tool call can no longer turn that call into an error, and the team file
  is reloaded only after a Write or Edit of it (not after any tool that names a file).
- No lead section in the system prompt for `bare` prompts; the live page refuses to start without `HOME` and gives
  up if the server does not announce itself within 10 seconds.

### Fixed
- `/hq web` run again opens a working page (a new one-time link; a logged-in browser is sent straight to the page).
- Team files are trusted by SHA-256 of their content (older trust records are reset once, with a toast); the main
  session's own write is trusted only when it is the file in force and has the text it wrote; the last trusted team stays
  in force (guard and lead section) while a changed file waits for `/hq trust`.
- `hq_hire` asks you in the engine's question dialog before it writes the team file.
- A request sent again with the same `key` is queued once; sessions and pages are capped (429); queue lines are
  re-checked on restart; the login cookie is named for the hub's port; only the real `live` folder is tidied; the
  server's repeated prints of a request are queued once; a reviewed member's report is handed over as fenced data.
- Files left in `~/.claude/agent-hq/live/` by sessions that ended are now deleted after 24 hours.
