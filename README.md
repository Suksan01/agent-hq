# Agent HQ

[![Claude Code mod](https://img.shields.io/badge/Claude_Code-mod-D97757)](#install)
[![version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FSuksan01%2Fagent-hq%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&color=7858CA)](.claude-plugin/plugin.json)
[![license: MIT](https://img.shields.io/badge/license-MIT-18883A)](LICENSE)

A Claude Code mod for watching orchestrated agent teams work.

- **Band above the prompt**: plan-progress style twinkling tracks for the whole team and the task board, with an
  `Agents ›` button that opens the sidebar.
- **Sidebar** (docked beside a fullscreen transcript): the agent tree, each agent's role and running time, what it
  works on now (`▸`), what comes next (`○ next:`), the last thing it finished (`✓`), and a dotted todo track.
- **Mascots**: every agent gets its own little creature (cat, bear, butterfly, owl, robot, chick, puppy, spirit) that
  hops and blinks while it works, thinks while it waits on you, smiles when done and goes x-eyed when it fails.
- Reads todo lists (TodoWrite), the task board (TaskCreate/TaskUpdate) and, when the
  plan-progress mod is installed, its bars as each agent's steps.

Open it with `/hq`. In the sidebar, `h` hides finished items, `c` clears them, and clicking an agent's name opens
its transcript.

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

Agent HQ only watches. It never blocks, rewrites or answers anything Claude does. It reads:

- **Every tool call's name** and which agent made it, for the tool count and the `▸` line. It does not read
  other tools' inputs or outputs.
- **TodoWrite, TaskCreate and TaskUpdate inputs** (todo text, task titles, owners, status) and the new task's id
  from TaskCreate's result, for the todo bars and the task board.
- **Claude's reply rows**, only to find `plan_progress` calls and the bar id they name; the rest of each row is
  skipped.
- **The agent list** (name, type, short description, status, parent), once a second.
- **plan-progress's saved bars**, if that mod is installed, read only.
- **Your settings list**, only to find `theme` (for the dark or light tint), and later changes to it.

What it does with that:

- Keeps it in memory for the current session. It writes no files and keeps nothing between sessions.
- Draws the band above the prompt, the sidebar and a status line, adds the `/hq` command, and opens the sidebar
  the first time an agent starts.
- Sends nothing over the network, runs no programs and makes no model calls.

All of it is in `hooks/register.tsx`; `claude plugin validate <mod folder>` lists every event the mod hooks and
every call it makes.

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

## Credits

The dotted progress tracks are adapted from the [plan-progress](https://github.com/zycck/claude-mods) mod by Kirill
Serditov (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Agent HQ is released under the [MIT license](LICENSE).

## Notes

- Agent names in Chinese, Japanese or Korean, or with emoji, show those characters as `·` inside the dotted tracks.
- A theme set to "auto" is drawn with the dark tint.
- Agent status is polled once a second.
