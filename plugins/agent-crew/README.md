# agent-crew

A live pane of your subagents as a little pixel crew: who is working, on what, and how far along.

![Agent Crew pane: four subagents at work, then clocking out](assets/agent-crew.gif)

## What you see

- **One mini Clawd per subagent**, two rows tall, each in its own body color and cap (the first goes bareheaded in Clawd orange). It blinks and waves while working, holds up a flag with happy `^ ^` eyes when done, goes grey with `× ×` eyes on failure, and dozes if stopped.
- **Role and model**: `Explore` shows up as a scout, `Plan` as an architect, `general-purpose` as a builder, and so on, along with the model it runs on.
- **What it's doing right now**, based on the last tool it called ("sniffing through files", "hammering code", "cranking the shell"…).
- **Progress, steps, tokens and elapsed time** for each agent, plus a crew-wide summary at the top.
- **Mail between agents.** When one agent messages another with SendMessage, a bracket in the sender's color runs down the lane on the left, from `╭─` at the sender to `╰▶` at the receiver, with a little ✉ riding it (`⌂` is the lead, your main conversation). The sender says `💬 → builder: "found 3 call sites"` and the receiver, with a `!` beside it and wide-open eyes, shows `📬 from mapper: "found 3 call sites"` in the same color. Each agent counts what it sent and got (`✉2↑3↓`). A message also wakes a teammate that went idle. When an agent finishes and hands its report back, that report flies home to `⌂` as a letter too, and mail addressed to `main` or `team-lead` lands at the lead.

The pane opens on its own when the first subagent spawns. When the whole crew clocks out you get a toast, and the pane closes 10 seconds later. Press `c` to clear finished agents, or run `/crew` to open the pane at any time.

## Install

```
/plugin marketplace add xinhuagu/oh-my-claude-mods
/plugin install agent-crew@oh-my-claude-mods
```

Restart the session afterwards.

Third-party marketplaces don't auto-update by default. To get new versions, turn on auto-update under `/plugin` → Marketplaces, or run `/plugin marketplace update oh-my-claude-mods`.
