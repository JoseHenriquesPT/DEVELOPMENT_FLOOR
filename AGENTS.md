# Guidelines

- Write tests before building the implementation.
- For complex or multi-step work, plan first and get the plan approved before making changes. Keep it lightweight for trivial single-step requests.
- Start a new task in a new session — don't let unrelated work pile up in one conversation. When a task ends with knowledge the next task needs, leave a short handoff note (the `handoff` skill writes one).
- Before wrapping up a session that created or edited code, run the changes through the `thermo-nuclear-code-quality-review` skill; resolve its findings, and only then build the handoff.
- After every code write/edit, say in one short, plain-language sentence what changed and why — as if explaining it to a non-technical person.

# Reference

Available tooling reference: [docs/KNOWLEDGE.md](docs/KNOWLEDGE.md) — capabilities worth reaching for (task delegation, worktrees, lifecycle hooks, repeated runs, side questions, remote sessions) and how to find them in your harness. Consult it when a task looks like it needs one; it isn't loaded by default.
