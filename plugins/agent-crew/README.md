# agent-crew

A live pane of your subagents as a little pixel crew: who is working, on what, and how far along.

![Agent Crew pane: four subagents at work, then clocking out](assets/agent-crew.gif)

## What you see

- **One critter per subagent**, each with its own hat and colors. It bobs while working, raises a flag when done, crosses its eyes on failure, and dozes if stopped.
- **Role and model**: `Explore` shows up as a scout, `Plan` as an architect, `general-purpose` as a builder, and so on, along with the model it runs on.
- **What it's doing right now**, based on the last tool it called ("sniffing through files", "hammering code", "cranking the shell"…).
- **Progress, steps, tokens and elapsed time** for each agent, plus a crew-wide summary at the top.

The pane opens on its own when the first subagent spawns. When the whole crew clocks out you get a toast, and the pane closes 10 seconds later. Press `c` to clear finished agents, or run `/crew` to open the pane at any time.

## Install

```
/plugin marketplace add xinhuagu/claude-mods
/plugin install agent-crew@claude-mods
```

Restart the session afterwards.

Third-party marketplaces don't auto-update by default. To get new versions, turn on auto-update under `/plugin` → Marketplaces, or run `/plugin marketplace update claude-mods`.
