# Tooling reference

Capabilities worth reaching for during development. Not every task needs one — check here when a task's shape suggests one would help, rather than keeping this loaded at all times.

This list names the **capability**, not a command: the exact spelling differs per harness (Claude Code, pi, Codex, Cursor, Copilot, …) and this project doesn't assume one. If a capability applies but you don't know how your harness exposes it, ask the agent to look it up in its own documentation.

- **Task delegation / subagents** — hand secondary work (broad searches, isolated refactors) to a separate agent so the main thread stays focused.
- **Parallel checkouts / worktrees** — work on several branches at once, each in its own working directory. Usually built on git worktrees.
- **Hooks / lifecycle events** — run a command automatically when an event fires, e.g. after a file edit, before a commit, or at session start.
- **Scheduled or repeated prompts** — run a prompt on an interval for automation. Some harnesses ship a loop command; others are driven from a shell loop.
- **Side questions** — ask a clarifying question mid-task without derailing the current flow.
- **Remote or resumable sessions** — attach to, hand off, or drive a session from another device.
- **Skills** — on-demand capability packages following the [Agent Skills standard](https://agentskills.io). This project keeps its skills in `.agents/skills/`, which any standards-compliant harness can read; harnesses with their own directory (Claude Code's `.claude/skills/`) get a symlink into the same store.

More skills can be browsed and added from [skills.sh](https://www.skills.sh/). Install them with `npx skills@latest add <package> --skill <name> --agent universal -y` to keep them in the harness-neutral store.
