#!/usr/bin/env node
// Installer for this template. Two ways in:
//
//   node setup.mjs                     fresh project — run once after copying
//                                      and renaming this folder
//   node setup.mjs --into <repo>       adopt — install the same setup into a
//                                      repository that already exists, merging
//                                      instead of overwriting
//
// Other flags: --list (print the skill catalog), --dry-run, --allow-dirty,
// --yes (accept every prompt's default, so the run is unattended), --fresh
// (new projects: start a parentless `main` history and drop the template's
// origin remote), --claude / --no-claude (force or skip the Claude Code
// compatibility shims; by default they are installed only when ~/.claude
// exists).
//
// Harness model: the canonical artifacts are neutral — AGENTS.md, .agents/skills
// and docs/KNOWLEDGE.md — and every standards-compliant harness (pi, Codex,
// Cursor, Copilot, …) reads them. Claude Code is the one common harness that
// needs extra files, so a small optional shim adds them (CLAUDE.md importing
// AGENTS.md, .claude/settings.json, and .claude/skills links).

import { createInterface } from "node:readline";
import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  statSync,
  mkdirSync,
  cpSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
} from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  mergeAgentInstructions,
  mergeClaudeImport,
  mergeSettings,
  mergeExtensions,
  parseJson,
} from "./template-assets/lib/merge.mjs";
import { ensureFreshHistory } from "./template-assets/lib/fresh.mjs";

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};

// Where the template lives vs. where we are installing to. In fresh mode they
// are the same directory, which is why fresh-mode behaviour is unchanged.
const sourceRoot = dirname(fileURLToPath(import.meta.url));
const into = flagValue("--into");
const adopting = Boolean(into);
const targetRoot = adopting ? resolve(into) : process.cwd();
const dryRun = hasFlag("--dry-run");
const allowDirty = hasFlag("--allow-dirty");
const assumeYes = hasFlag("--yes") || hasFlag("-y");
const fresh = hasFlag("--fresh");

const localSkillsDir = join(sourceRoot, "template-assets", "skills");
const claudeShimDir = join(sourceRoot, "template-assets", "harness", "claude");

// Claude Code is the only harness that needs a compatibility shim here. Decide
// once whether to lay it down: an explicit flag wins, otherwise we follow the
// user's machine (someone with ~/.claude almost certainly uses Claude Code).
const claudeFlag = hasFlag("--claude") ? true : hasFlag("--no-claude") ? false : null;
const useClaude = claudeFlag ?? existsSync(join(homedir(), ".claude"));

const CANONICAL_SKILLS = join(".agents", "skills");
const CLAUDE_SKILLS = join(".claude", "skills");

function run(cmd, cwd = targetRoot) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd });
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// Minimal frontmatter reader for our own SKILL.md files: flat `key: value`
// pairs between the two `---` fences, good enough for name/description.
function readFrontmatter(path) {
  const text = readFileSync(path, "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return fields;
}

// A directory link so a skill lives once (in .agents/skills) and Claude Code
// still finds it. Symlink first; on Windows fall back to a junction, which
// needs no special privileges; last resort is a plain copy.
function makeDirLink(target, link) {
  try {
    symlinkSync(relative(dirname(link), target), link, "dir");
    return "symlink";
  } catch {
    try {
      symlinkSync(target, link, "junction");
      return "junction";
    } catch {
      return null;
    }
  }
}

function linkSkillIntoClaude(name) {
  const rel = join(CLAUDE_SKILLS, name);
  const link = join(targetRoot, rel);
  const canonical = join(targetRoot, CANONICAL_SKILLS, name);

  let present = false;
  try {
    lstatSync(link);
    present = true;
  } catch {
    /* not there yet */
  }
  if (present) return report("skip", rel, "already there");
  if (dryRun) return report("link", rel);

  mkdirSync(dirname(link), { recursive: true });
  const kind = makeDirLink(canonical, link);
  if (kind) return report("link", rel, `→ ${CANONICAL_SKILLS}`);
  cpSync(canonical, link, { recursive: true });
  report("copy", rel, "symlinks unavailable");
}

// Skills staged as local folders — drop a new folder with a SKILL.md here
// and it shows up in the menu automatically, no code changes needed. Local
// skills are copied into the canonical .agents/skills store, then linked into
// Claude Code's directory when the shim is enabled.
function loadLocalSkills() {
  if (!existsSync(localSkillsDir)) return [];
  return readdirSync(localSkillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const skillFile = join(localSkillsDir, e.name, "SKILL.md");
      const fm = existsSync(skillFile) ? readFrontmatter(skillFile) : {};
      return {
        id: fm.name || e.name,
        description: fm.description || "(no description found)",
        requires: (fm.requires || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        install() {
          const rel = join(CANONICAL_SKILLS, e.name);
          const dest = join(targetRoot, rel);
          // Never clobber a skill the repo already has — someone may have
          // edited it.
          if (existsSync(dest)) {
            report("skip", rel, "already there");
          } else if (dryRun) {
            report("create", rel);
          } else {
            mkdirSync(dirname(dest), { recursive: true });
            cpSync(join(localSkillsDir, e.name), dest, { recursive: true });
            report("create", rel);
          }
          if (useClaude) linkSkillIntoClaude(e.name);
        },
      };
    })
    // Deterministic order, so prompts and the printed catalog are stable
    // regardless of filesystem readdir order.
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---- The swappable catalog ----------------------------------------------
// This is the one place to edit to change what setup.mjs offers.
// - Local skills (authored in this template, not published anywhere) are
//   picked up automatically from template-assets/skills/*/SKILL.md — just
//   add or remove a folder there.
// - Remote skills come from published packages — add/remove entries below.
//
// `--agent universal` installs into the canonical .agents/skills store and
// nothing else, so the template never assumes a harness. Harness directories
// (e.g. .claude/skills) are linked from that store by this script. Without
// `--agent`, the CLI prompts interactively for which agents to link — which is
// easy to fly past and leaves the skill fetched but unlinked.
const REMOTE_SKILLS = [
  {
    id: "find-skills",
    description: "Finds relevant skills from the skills.sh ecosystem for a project or task.",
    source: "https://github.com/vercel-labs/skills",
    skills: ["find-skills"],
  },
  {
    id: "grilling",
    description: "Stress-test a plan, decision or idea with a relentless round-by-round interview.",
    source: "mattpocock/skills",
    skills: ["grilling"],
  },
  {
    id: "domain-modeling",
    description: "Build and sharpen a project's domain model, glossary and ADRs.",
    source: "mattpocock/skills",
    skills: ["domain-modeling"],
  },
  {
    id: "improve-codebase-architecture",
    description: "Scans the codebase for architectural deepening opportunities and reports them as an interactive HTML review.",
    source: "mattpocock/skills",
    skills: ["improve-codebase-architecture"],
  },
  {
    id: "handoff",
    description: "Compacts the current conversation into a handoff document so another agent or session can pick up where you left off.",
    source: "mattpocock/skills",
    skills: ["handoff"],
  },
].map((entry) => ({
  ...entry,
  install() {
    run(`npx skills@latest add ${entry.source} --skill ${entry.skills.join(" ")} --agent universal -y`);
    if (useClaude) for (const name of entry.skills) linkSkillIntoClaude(name);
  },
}));

const SKILLS = [...loadLocalSkills(), ...REMOTE_SKILLS];
// ---------------------------------------------------------------------------

if (hasFlag("--list")) {
  console.log("Skills available in this template:\n");
  for (const s of SKILLS) console.log(`- **${s.id}** — ${s.description}`);
  process.exit(0);
}

// ---- Adopting into an existing repository --------------------------------

function report(action, rel, note) {
  const prefix = dryRun ? "would " : "";
  console.log(`  ${prefix}${action.padEnd(6)} ${rel}${note ? `  (${note})` : ""}`);
}

function writeIfChanged(rel, content) {
  const path = join(targetRoot, rel);
  const existed = existsSync(path);
  if (existed && readFileSync(path, "utf8") === content) return report("ok", rel, "unchanged");
  if (dryRun) return report(existed ? "merge" : "create", rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  report(existed ? "merge" : "create", rel);
}

// The canonical, harness-neutral files the template contributes, and how each
// one survives contact with a file that is already there.
const CONFIG_FILES = [
  { rel: "AGENTS.md", kind: "markdown" },
  { rel: ".vscode/extensions.json", kind: "json", merge: mergeExtensions },
  { rel: "docs/KNOWLEDGE.md", kind: "verbatim" },
];

function installConfigFiles() {
  for (const { rel, kind, merge } of CONFIG_FILES) {
    const sourcePath = join(sourceRoot, rel);
    if (!existsSync(sourcePath)) continue;
    const source = readFileSync(sourcePath, "utf8");
    const targetPath = join(targetRoot, rel);
    const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null;

    // Markdown goes through the merge either way: creating it marker-wrapped
    // is what lets a later run refresh the block instead of appending a second
    // copy of it.
    if (kind === "markdown") {
      writeIfChanged(rel, mergeAgentInstructions(existing ?? "", source));
      continue;
    }

    if (existing === null) {
      writeIfChanged(rel, source);
      continue;
    }

    if (kind === "json") {
      const mine = parseJson(source);
      const theirs = parseJson(existing);
      if (!theirs.ok) {
        // VS Code allows comments and trailing commas here. Rewriting such a
        // file would strip them, so leave it exactly as it is.
        report("skip", rel, "not plain JSON — merge it by hand");
        continue;
      }
      writeIfChanged(rel, `${JSON.stringify(merge(theirs.value, mine.value), null, 2)}\n`);
    } else if (existing === source) {
      report("ok", rel, "unchanged");
    } else {
      // Prose has no sane merge: leave theirs, drop ours alongside.
      writeIfChanged(rel.replace(/\.md$/, ".template.md"), source);
      report("skip", rel, "kept yours");
    }
  }
}

// Claude Code compatibility shim, layered on top of the canonical files:
//   CLAUDE.md            imports AGENTS.md instead of duplicating it
//   .claude/settings.json  the plan-mode reminder hook (Claude Code hooks only)
// Other harnesses need none of this — they read AGENTS.md directly.
function installClaudeShim() {
  if (!useClaude) return;
  const existing = existsSync(join(targetRoot, "CLAUDE.md"))
    ? readFileSync(join(targetRoot, "CLAUDE.md"), "utf8")
    : null;
  writeIfChanged("CLAUDE.md", mergeClaudeImport(existing ?? ""));

  const settingsSource = join(claudeShimDir, "settings.json");
  if (!existsSync(settingsSource)) return;
  const rel = join(".claude", "settings.json");
  const targetPath = join(targetRoot, rel);
  const existingSettings = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : null;
  const source = parseJson(readFileSync(settingsSource, "utf8"));
  if (existingSettings === null) {
    writeIfChanged(rel, readFileSync(settingsSource, "utf8"));
    return;
  }
  const theirs = parseJson(existingSettings);
  if (!theirs.ok) {
    report("skip", rel, "not plain JSON — merge it by hand");
    return;
  }
  writeIfChanged(rel, `${JSON.stringify(mergeSettings(theirs.value, source.value), null, 2)}\n`);
}

function assertAdoptable() {
  if (targetRoot === sourceRoot) {
    fail("Refusing to adopt the template into itself — pass --into <path-to-your-repo>.");
  }
  if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory()) {
    fail(`--into target does not exist as a directory: ${targetRoot}`);
  }
  const isRepo = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: targetRoot });
  if (isRepo.status !== 0) {
    fail(
      `--into target is not a git repository: ${targetRoot}\n` +
        "Adopting is only safe where you can review and undo it with git.",
    );
  }
  if (allowDirty || dryRun) return;
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: targetRoot, encoding: "utf8" });
  if (status.stdout.trim() !== "") {
    fail(
      `${targetRoot} has uncommitted changes.\n` +
        "Commit or stash them first so this run is easy to review and revert,\n" +
        "or pass --allow-dirty to go ahead anyway.",
    );
  }
}

// ---- Prompting -----------------------------------------------------------

const rl = createInterface({ input: process.stdin, output: process.stdout });

// A plain rl.question() per call drops answers that arrive before it's
// listening (e.g. piped/redirected input, where all lines land at once) —
// queue lines as they come in and hand them out to askers in order instead.
const lineQueue = [];
const waiters = [];
rl.on("line", (line) => {
  if (waiters.length) waiters.shift()(line);
  else lineQueue.push(line);
});
// Input can run out before the questions do; take the default rather than hang.
rl.on("close", () => {
  while (waiters.length) waiters.shift()("");
});
function nextLine() {
  if (lineQueue.length) return Promise.resolve(lineQueue.shift());
  return new Promise((resolve) => waiters.push(resolve));
}

async function askYesNo(question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  if (assumeYes) {
    process.stdout.write(`${question} [${hint}] (${defaultYes ? "y" : "n"})\n`);
    return defaultYes;
  }
  process.stdout.write(`${question} [${hint}] `);
  const answer = (await nextLine()).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

// ---- Run -----------------------------------------------------------------

const summary = [];

// In fresh mode git is decided early but committed at the very end, so the
// initial commit captures the finished project (skills installed, scaffolding
// removed) instead of the template exactly as it arrived.
let freshGitPending = false;

if (adopting) {
  if (fresh) {
    fail(
      "--fresh starts a new project's own history and cannot be combined with --into.\n" +
        "Adoption never touches git history.",
    );
  }
  assertAdoptable();
  console.log(`Adopting this template into ${targetRoot}${dryRun ? " (dry run)" : ""}.\n`);
  installConfigFiles();
  installClaudeShim();
  console.log("");
} else {
  console.log("Project setup — pick what you want, skip what you don't.\n");

  // git — fresh projects only. An existing repo keeps its history unless
  // --fresh asks for a new one; adopt mode never touches git at all. The
  // commit itself happens at the end of the run, once unpacking is done.
  if (await askYesNo("Initialize a git repository here?", true)) {
    const isRepo = existsSync(join(targetRoot, ".git"));
    if (!fresh && isRepo) {
      console.log("  Already a git repo — leaving its history alone.");
      console.log(
        "  Pass --fresh to give the project its own parentless main history and drop the template remote.",
      );
      summary.push("existing git history kept");
    } else if (dryRun) {
      report(
        "fresh",
        isRepo
          ? "git history → parentless Initial commit on main, drop origin"
          : "git repository + parentless Initial commit on main",
      );
      summary.push("fresh git history (dry run)");
    } else {
      freshGitPending = true;
    }
  } else {
    summary.push("git init skipped");
  }

  // The canonical files (AGENTS.md, docs/KNOWLEDGE.md, .vscode/extensions.json)
  // are already here from the copy; this lays down the optional Claude shim.
  installClaudeShim();
}

// Decide every skill first, so a skill that depends on another (declared with
// a `requires:` frontmatter field) can pull its dependency in before install.
const chosen = new Map();
for (const skill of SKILLS) {
  chosen.set(
    skill.id,
    await askYesNo(`Enable ${skill.id} — ${skill.description}`, true),
  );
}
for (const skill of SKILLS) {
  if (!chosen.get(skill.id)) continue;
  for (const dep of skill.requires ?? []) {
    if (chosen.get(dep)) continue;
    if (!SKILLS.some((s) => s.id === dep)) continue;
    chosen.set(dep, true);
    console.log(`  ${dep} enabled — required by ${skill.id}`);
  }
}

for (const skill of SKILLS) {
  if (!chosen.get(skill.id)) {
    summary.push(`${skill.id} skipped`);
    continue;
  }
  if (dryRun) report("install", skill.id);
  else skill.install();
  summary.push(`${skill.id} enabled`);
}

if (useClaude) {
  console.log(
    `\nClaude Code shim installed (CLAUDE.md → AGENTS.md` +
      (existsSync(join(targetRoot, join(".claude", "settings.json"))) ? ", .claude/settings.json" : "") +
      `). Run with --no-claude to skip it.`,
  );
}

// Clean up template scaffolding — fresh projects only. When adopting, the
// scaffolding lives in the template folder, which is not ours to delete.
// The script removes itself too, before the commit below, so neither lands in
// the project's history.
if (!adopting && (await askYesNo("Remove template scaffolding (this script + template-assets/) when done?", true))) {
  if (dryRun) {
    report("remove", "setup.mjs + template-assets/");
  } else {
    rmSync(join(targetRoot, "template-assets"), { recursive: true, force: true });
    rmSync(fileURLToPath(import.meta.url), { force: true });
    summary.push("template scaffolding removed");
  }
}

// The fresh history is committed last so the initial commit contains the
// finished project: skills in, scaffolding out.
if (freshGitPending && !dryRun) {
  const result = ensureFreshHistory({
    cwd: targetRoot,
    log: (cmd) => console.log(`  $ ${cmd}`),
  });
  if (result.changed) {
    console.log(
      result.droppedOrigin
        ? "\n  Started a fresh history on main; dropped the template's origin remote."
        : "\n  Started a fresh history on main.",
    );
    summary.push("fresh git history started (main)");
  } else {
    console.log("\n  History is already fresh — nothing to change.");
    summary.push("git history already fresh");
  }
}

console.log(`\n${adopting ? "Adoption" : "Setup"} complete:`);
summary.forEach((line) => console.log(`  - ${line}`));
if (adopting && !dryRun) console.log("\nReview it with `git diff`; undo it with `git checkout -- .`.");
rl.close();
process.exit(0);
