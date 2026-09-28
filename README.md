# Project template

A starting point for new projects, and a setup you can retrofit onto an existing repository.

It is **model- and harness-agnostic**: the canonical files follow open conventions, not
any one coding agent.

- **`AGENTS.md`** — the cross-harness convention for project instructions. Read natively by
  pi, Codex, Cursor, GitHub Copilot, opencode, Amp and others, and by Claude Code through a
  one-line import.
- **`.agents/skills/<name>/`** — skills in the [Agent Skills](https://agentskills.io) format,
  in the neutral location every standards-compliant harness scans.
- **`docs/KNOWLEDGE.md`** — capability reference written by capability, not by slash command.

Claude Code is the one common harness that reads its own paths rather than the neutral ones,
so it gets a small **optional compatibility shim**: a `CLAUDE.md` that imports `AGENTS.md`
(rather than duplicating it), the `.claude/settings.json` plan-mode hook, and symlinks from
`.claude/skills/` into `.agents/skills/`. Nothing in the template requires it — `--no-claude`
installs the canonical setup alone.

## Starting a new project

Clone (or copy) the template, then unpack it in one unattended command:

```bash
git clone https://github.com/Tykelar/DEVELOPMENT_FLOOR.git MyProject
cd MyProject
node setup.mjs --fresh --yes --no-claude
```

- `--fresh` gives the project its own history: a single parentless `Initial commit` on `main`,
  with the template's `origin` remote dropped. Without it, an existing `.git` is left exactly as
  it is.
- `--yes` accepts every default — all skills enabled, scaffolding removed — so the run needs no
  input. Drop it to be asked once per item (all prompts default to yes).
- `--no-claude` installs the canonical, harness-neutral setup and skips the Claude Code shim;
  pass `--claude` instead if you want the shim.
- The template's own `README.md` is replaced by a minimal project README, titled after the
  project folder and pointing at `AGENTS.md`, `.agents/skills/` and `docs/KNOWLEDGE.md`.

Publish the project under its own name when you're ready:

```bash
gh repo create <owner>/MyProject --private --source=. --remote=origin --push
```

The reasoning behind the fresh start is recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Adding this setup to an existing repository

Point the same script at a repo you already have:

```bash
node /path/to/this/template/setup.mjs --into /path/to/your/repo --dry-run   # preview
node /path/to/this/template/setup.mjs --into /path/to/your/repo             # do it
```

Useful flags:

| Flag | Effect |
| --- | --- |
| `--into <repo>` | Adopt into an existing repository instead of setting up in place. |
| `--dry-run` | Print exactly what would change, touch nothing. |
| `--allow-dirty` | Skip the clean-working-tree check (see below). |
| `--yes` | Accept every prompt's default, so the run is unattended. |
| `--fresh` | New projects: start a parentless `Initial commit` on `main` and drop the template's `origin` remote. Never valid together with `--into`. |
| `--claude` | Install the Claude Code shim even if `~/.claude` is absent. |
| `--no-claude` | Install the canonical setup only, with no Claude-specific files. |
| `--list` | Print the skill catalog without installing anything. |

By default the Claude shim follows the machine: it is installed when `~/.claude` exists, and
skipped when it doesn't. Pass `--claude` or `--no-claude` to decide explicitly.

It merges rather than overwrites, and nothing it does is hard to undo:

- **It refuses to run** unless the target is a git repository with a clean working tree, so every
  change lands as a reviewable `git diff` and `git checkout -- .` reverts the lot. `--allow-dirty`
  overrides the clean check if you know what you're doing.
- **It never commits** to your repo, and never deletes anything from the template folder.
- **Re-running is a no-op.** Run it again later to pick up template changes; files that already
  match are reported `unchanged`.

What happens to each file:

| File | If you don't have it | If you already have it |
| --- | --- | --- |
| `AGENTS.md` | copied inside `<!-- BEGIN development-floor -->` markers, so a later run can refresh it | template guidance is added inside the same markers; your own text is never rewritten |
| `CLAUDE.md` (Claude shim) | created as an import of `AGENTS.md` | the `@AGENTS.md` import is added; your own text is kept |
| `.claude/settings.json` (Claude shim) | copied | merged — your permissions, env and other hooks are untouched, and the plan-mode hook isn't added twice |
| `.vscode/extensions.json` | copied | `recommendations` are merged, yours first, no duplicates |
| `docs/KNOWLEDGE.md` | copied | left alone; ours is written beside it as `docs/KNOWLEDGE.template.md` |
| `.agents/skills/<name>/` | copied | left alone — a skill you've edited is never overwritten |
| `.claude/skills/<name>` (Claude shim) | symlinked to `.agents/skills/<name>` | left alone |

If a guidance file already had its own content in `CLAUDE.md` only, note that other harnesses
read `AGENTS.md`: move your own text there (the installer won't relocate it for you), leaving
`CLAUDE.md` as the thin import it installs.

If a JSON file has comments or trailing commas (VS Code allows both in `extensions.json`), it is
reported and left byte-for-byte alone rather than reformatted — merge those lines by hand.

## What's in here

- **[AGENTS.md](AGENTS.md)** — behavioral guidelines every harness follows automatically (plan before complex tasks, tests before building, one task per session, plain-language change summaries).
- **[docs/KNOWLEDGE.md](docs/KNOWLEDGE.md)** — capability reference (task delegation, worktrees, hooks, repeated runs, side questions, remote sessions, skills) with a note that the exact command depends on your harness. Not auto-loaded — check it when a task calls for one of these.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — template-level decisions in ADR form, starting with the fresh-start rule for new projects.
- **`setup.mjs`** — the installer described above. In new-project mode it asks once per item (git, then each skill in the catalog), or takes `--yes` to accept every default unattended, and removes itself and `template-assets/` when finished, so the resulting project doesn't carry template scaffolding. Run `node setup.mjs --list` to preview the catalog without installing anything.
- **[.vscode/extensions.json](.vscode/extensions.json)** — recommends [VSSticky](https://marketplace.visualstudio.com/items?itemName=Hyperclaw79.vssticky), so opening a project copied from this template prompts to install it. Lets you keep per-file/workspace markdown notes (quick reference, commands to remember) without opening a separate document.
- **`template-assets/`** — scaffolding that belongs to the template, not to your project: staged skills in `skills/`, the Claude shim in `harness/claude/`, the merge rules in `lib/merge.mjs`, and their tests in `test/`. New-project setup deletes the whole folder when it's done.

## Skills included by default

Each one is an independent yes/no prompt in `setup.mjs` — enable only what a given project needs.
All of them install into `.agents/skills/`, the neutral Agent Skills location.

- **grill-with-docs** — interview session that builds a domain model and keeps `CONTEXT.md` and ADRs updated as you go. Adapted locally from [mattpocock/skills](https://github.com/mattpocock/skills) so it reads harness-neutrally; it requires **grilling** and **domain-modeling**, which setup pulls in automatically.
- **thermo-nuclear-code-quality-review** — an intentionally harsh, manually-invoked code review pass (structural simplification, file-size discipline, anti-spaghetti). Authored locally in `template-assets/skills/`.
- **find-skills** — finds relevant skills from the skills.sh ecosystem for a project or task. From [vercel-labs/skills](https://github.com/vercel-labs/skills).
- **grilling** — relentless round-by-round interview to stress-test a plan. From [mattpocock/skills](https://github.com/mattpocock/skills).
- **domain-modeling** — builds and sharpens the glossary and ADRs. From [mattpocock/skills](https://github.com/mattpocock/skills).
- **improve-codebase-architecture** — scans the codebase for architectural deepening opportunities and reports them as an interactive HTML review. From [mattpocock/skills](https://github.com/mattpocock/skills).
- **handoff** — compacts the current conversation into a handoff document so another agent or session can pick up where you left off. From [mattpocock/skills](https://github.com/mattpocock/skills).

### Adding or removing a skill

- **Local skill** (authored here, not a published package): add or remove a folder under `template-assets/skills/<name>/SKILL.md` — `setup.mjs` auto-discovers whatever's there from the folder's frontmatter, no code changes needed. A skill can declare `requires: other-skill` in its frontmatter and setup will enable that dependency too.
- **Remote skill** (installed via `npx`): add or remove an entry in the `REMOTE_SKILLS` array near the top of `setup.mjs`. Installs use `--agent universal`, so they land in `.agents/skills/` and nowhere else; the script then links them into `.claude/skills/` when the Claude shim is on.

After changing the catalog, update this section to match — `node setup.mjs --list` prints the current one to copy from.

Looking for more skills to add later? Browse [skills.sh](https://www.skills.sh/).

## Harness notes

| Harness | Reads guidance from | Reads skills from | Shims needed |
| --- | --- | --- | --- |
| pi, Codex, Cursor, Copilot, opencode, Amp, … | `AGENTS.md` | `.agents/skills/` | none |
| Claude Code | `CLAUDE.md` → `@AGENTS.md` | `.claude/skills/` (symlinks) | the optional shim above |

To wire a harness that needs its own file (for example a `GEMINI.md`), add a one-line pointer to
`AGENTS.md` rather than a second copy of the guidance.

## Tests

The merge rules, the adopt flow, the fresh-start flow, and the canonical-vs-shim file layout are
covered by tests, run with node's built-in runner (no dependencies):

```bash
node --test "template-assets/test/*.test.mjs"
```
