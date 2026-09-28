# Decisions

Template-level decisions, written in ADR form (the `domain-modeling` skill carries the same
format). Each entry states what was decided, why, and what the decision costs.

## ADR-0001 — New projects start with their own git history

**Date:** 2026-09-28
**Status:** accepted

### Context

New projects were made by cloning this repository, so a project inherited the template's commit
history *and* its `origin` remote. Commits made in the new project could be pushed straight into
the template repository by accident, and the history said more about the template than about the
project. The installer made this worse by silently skipping git when `.git` already existed, and
when it did initialize a repository, the branch name depended on the machine's
`init.defaultBranch`.

### Decision

`setup.mjs --fresh` gives a new project a history of its own:

- one parentless `Initial commit` on `main`, containing the unpacked setup;
- the template's `origin` remote removed, so the project must add its own;
- every branch that belonged to the old history deleted.

The canonical next-time command is unattended:

```bash
git clone https://github.com/Tykelar/DEVELOPMENT_FLOOR.git NewProject
cd NewProject
node setup.mjs --fresh --yes --no-claude
gh repo create <owner>/NewProject --private --source=. --remote=origin --push
```

`--yes` accepts every default (all skills enabled, scaffolding removed) and `--no-claude` keeps
the setup harness-neutral. `--fresh` is opt-in and only meaningful for new projects: adoption
into an existing repository (`--into`) never touches git, and passing both is rejected outright.

### Consequences

- New projects have a clean, reviewable history from the first commit, and cannot push to the
  template by accident.
- The template can no longer be updated inside a project with `git pull`. To pick up template
  changes later, run the installer from a fresh template checkout, previewing first:
  `node /path/to/template/setup.mjs --into . --dry-run`.
- The default branch of every new project is `main`, independent of the machine's git config.
- Working-tree files — including uncommitted ones — are preserved by the re-root; only history,
  branches and the remote are replaced.
