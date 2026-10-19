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

## Credits

The dotted progress tracks are adapted from the [plan-progress](https://github.com/zycck/claude-mods) mod by Kirill
Serditov (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Notes

- Agent names in Chinese, Japanese or Korean, or with emoji, show those characters as `·` inside the dotted tracks.
- A theme set to "auto" is drawn with the dark tint.
- Agent status is polled once a second.
