# Changelog

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
