# Agent HQ

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

This repository is private: you need read access on GitHub, and your machine needs a git credential for github.com
(an SSH key, or `gh auth login` then `gh auth setup-git`).

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

- **Private repository:** background updates use the git credentials already saved on your machine and never prompt.
  You need an SSH key, or `gh auth login` followed by `gh auth setup-git`; setting `GITHUB_TOKEN` alone is not
  enough. If a check fails, you keep the version you have.
- **Updates switched off:** `DISABLE_UPDATES=1`, `DISABLE_AUTOUPDATER=1` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
  also stop plugin updates, unless `FORCE_AUTOUPDATE_PLUGINS=1` is set too.
- **Teams:** an organization admin can turn auto-update on for everyone by listing this marketplace under
  `extraKnownMarketplaces` with `"autoUpdate": true` in managed settings.

New versions are published by raising `version` in `.claude-plugin/plugin.json`; a commit without a version change
does not reach installed copies.

## Credits

The dotted progress tracks are adapted from the [plan-progress](https://github.com/zycck/claude-mods) mod by Kirill
Serditov (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Notes

- Agent names in Chinese, Japanese or Korean, or with emoji, show those characters as `·` inside the dotted tracks.
- A theme set to "auto" is drawn with the dark tint.
- Agent status is polled once a second.
