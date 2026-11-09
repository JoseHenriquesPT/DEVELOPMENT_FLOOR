// End-to-end tests for `node setup.mjs --into <repo>`: adopting the template
// into a repository that already exists and already has its own files.
//
// The canonical artifacts are harness-neutral (AGENTS.md, .agents/skills);
// the Claude Code shim is opt-in. Tests pass --claude or --no-claude explicitly
// so they don't depend on whether the machine running them has ~/.claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETUP = join(TEMPLATE_ROOT, "setup.mjs");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function isClean(cwd) {
  return git(cwd, "status", "--porcelain").trim() === "";
}

// A repo that already has content of its own, so every test can check that
// adopting the template did not disturb it. Pass `null` for a seeded file to
// leave it out, for the cases where the repo is missing one of ours.
function makeRepo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "adopt-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  const seeded = {
    "README.md": "# Existing project\n",
    "CLAUDE.md": "# House rules\n\nNever delete this line.\n",
    ".claude/settings.json": JSON.stringify({ permissions: { allow: ["Bash(npm test)"] } }, null, 2),
    ...files,
  };
  for (const [rel, content] of Object.entries(seeded)) {
    if (content === null) continue;
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  return dir;
}

// Decline every skill prompt so the suite never reaches the network, and pick a
// Claude mode explicitly so results don't depend on the host machine.
function adopt(target, ...flags) {
  const explicit = flags.some((f) => f === "--claude" || f === "--no-claude");
  const all = explicit ? flags : ["--claude", ...flags];
  return spawnSync(process.execPath, [SETUP, "--into", target, ...all], {
    input: "n\n".repeat(20),
    encoding: "utf8",
  });
}

const read = (dir, rel) => readFileSync(join(dir, rel), "utf8");

test("--dry-run changes nothing on disk", () => {
  const repo = makeRepo();
  const r = adopt(repo, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(isClean(repo), "working tree stays clean");
  assert.ok(/AGENTS\.md/.test(r.stdout), "still reports what it would do");
});

test("guidance lands in AGENTS.md; CLAUDE.md is a thin import", () => {
  const repo = makeRepo({ "AGENTS.md": null });
  assert.equal(adopt(repo).status, 0);
  const agents = read(repo, "AGENTS.md");
  assert.ok(agents.includes("Write tests before building"), "template guidance in AGENTS.md");
  assert.ok(
    agents.includes("thermo-nuclear-code-quality-review"),
    "review-before-handoff workflow in AGENTS.md",
  );
  const claude = read(repo, "CLAUDE.md");
  assert.ok(claude.includes("Never delete this line."), "existing CLAUDE.md text survives");
  assert.ok(claude.includes("@AGENTS.md"), "CLAUDE.md imports the canonical file");
  assert.ok(!claude.includes("Write tests before building"), "guidance is not duplicated into CLAUDE.md");
});

test("adopting preserves an existing AGENTS.md and adds the template block", () => {
  const repo = makeRepo({ "AGENTS.md": "# House rules\n\nNever delete this line.\n" });
  assert.equal(adopt(repo).status, 0);
  const agents = read(repo, "AGENTS.md");
  assert.ok(agents.includes("Never delete this line."), "existing guidance survives");
  assert.ok(agents.includes("Write tests before building"), "template guidance added");
});

test("--claude merges settings.json without dropping existing permissions", () => {
  const repo = makeRepo();
  assert.equal(adopt(repo, "--claude").status, 0);
  const settings = JSON.parse(read(repo, ".claude/settings.json"));
  assert.deepEqual(settings.permissions.allow, ["Bash(npm test)"], "permissions untouched");
  assert.equal(settings.hooks.UserPromptSubmit.length, 1, "plan-mode hook installed");
});

test("--no-claude installs the canonical setup with no Claude-specific files", () => {
  const repo = makeRepo({ "CLAUDE.md": null, ".claude/settings.json": null });
  assert.equal(adopt(repo, "--no-claude").status, 0);
  assert.ok(existsSync(join(repo, "AGENTS.md")), "AGENTS.md is canonical");
  assert.ok(!existsSync(join(repo, "CLAUDE.md")), "no CLAUDE.md shim");
  assert.ok(!existsSync(join(repo, ".claude")), "no .claude directory");
});

test("adopting creates the files the repo did not already have", () => {
  const repo = makeRepo();
  assert.equal(adopt(repo).status, 0);
  assert.ok(existsSync(join(repo, "docs", "KNOWLEDGE.md")));
  const ext = JSON.parse(read(repo, ".vscode/extensions.json"));
  assert.ok(ext.recommendations.includes("Hyperclaw79.vssticky"));
});

test("adopting never overwrites an existing docs/KNOWLEDGE.md", () => {
  const repo = makeRepo({ "docs/KNOWLEDGE.md": "# Our own knowledge\n" });
  assert.equal(adopt(repo).status, 0);
  assert.equal(read(repo, "docs/KNOWLEDGE.md"), "# Our own knowledge\n");
  assert.ok(existsSync(join(repo, "docs", "KNOWLEDGE.template.md")), "template written beside it");
});

test("a JSON file with comments is left byte-identical and reported", () => {
  const jsonc = '{\n  // keep my comment\n  "recommendations": ["esbenp.prettier-vscode"]\n}\n';
  const repo = makeRepo({ ".vscode/extensions.json": jsonc });
  const r = adopt(repo);
  assert.equal(r.status, 0);
  assert.equal(read(repo, ".vscode/extensions.json"), jsonc, "not reformatted, not merged");
  assert.ok(/extensions\.json/.test(r.stdout), "the skipped file is reported");
});

test("re-adopting is a no-op", () => {
  const repo = makeRepo();
  assert.equal(adopt(repo).status, 0);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "adopt");
  assert.equal(adopt(repo).status, 0);
  assert.ok(isClean(repo), "second run leaves the tree clean");
});

test("refuses a repo with uncommitted changes", () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "README.md"), "# Edited but not committed\n");
  const r = adopt(repo);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /clean|uncommitted/i);
  assert.equal(read(repo, "README.md"), "# Edited but not committed\n", "left alone");
});

test("--allow-dirty overrides the clean-tree check", () => {
  const repo = makeRepo();
  writeFileSync(join(repo, "README.md"), "# Edited but not committed\n");
  assert.equal(adopt(repo, "--allow-dirty").status, 0);
  assert.ok(existsSync(join(repo, "docs", "KNOWLEDGE.md")));
});

test("refuses a target that is not a git repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "adopt-nogit-"));
  const r = adopt(dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /git repositor/i);
});

test("refuses a target that does not exist", () => {
  const r = adopt(join(tmpdir(), "adopt-does-not-exist-12345"));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /not (a directory|exist)/i);
});

test("refuses to adopt the template into itself", () => {
  const r = adopt(TEMPLATE_ROOT);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /itself|template/i);
});

test("adopt mode never commits and never deletes the template scaffolding", () => {
  const repo = makeRepo();
  const before = git(repo, "rev-parse", "HEAD").trim();
  assert.equal(adopt(repo).status, 0);
  assert.equal(git(repo, "rev-parse", "HEAD").trim(), before, "no commit made");
  assert.ok(existsSync(SETUP), "setup.mjs did not delete itself");
  assert.ok(existsSync(join(TEMPLATE_ROOT, "template-assets")), "scaffolding intact");
});

// Enable only the local thermo-nuclear skill and decline everything else, so we
// exercise the canonical-store + Claude-link path without touching the network.
test("a local skill installs into .agents/skills and links into .claude/skills", () => {
  const repo = makeRepo();
  const r = spawnSync(process.execPath, [SETUP, "--into", repo, "--claude"], {
    input: "n\ny\n" + "n\n".repeat(20),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const canonical = join(repo, ".agents", "skills", "thermo-nuclear-code-quality-review");
  assert.ok(existsSync(join(canonical, "SKILL.md")), "canonical copy exists");
  const link = join(repo, ".claude", "skills", "thermo-nuclear-code-quality-review");
  assert.ok(lstatSync(link), "Claude Code link exists");
});

test("--no-claude leaves the canonical store harness-neutral", () => {
  const repo = makeRepo();
  const r = spawnSync(process.execPath, [SETUP, "--into", repo, "--no-claude"], {
    input: "n\ny\n" + "n\n".repeat(20),
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(
    existsSync(join(repo, ".agents", "skills", "thermo-nuclear-code-quality-review", "SKILL.md")),
    "canonical copy exists",
  );
  assert.ok(!existsSync(join(repo, ".claude", "skills")), "no Claude link created");
});

test("re-adopting with a local skill enabled is a no-op", () => {
  const repo = makeRepo();
  const run = () =>
    spawnSync(process.execPath, [SETUP, "--into", repo, "--claude"], {
      input: "n\ny\n" + "n\n".repeat(20),
      encoding: "utf8",
    });
  assert.equal(run().status, 0);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "adopt with skill");
  assert.equal(run().status, 0);
  assert.ok(isClean(repo), "second run leaves the tree clean");
});

// The no-op test above seeds a CLAUDE.md, so its first run takes the merge
// path and writes the markers. A repo with no CLAUDE.md of its own takes the
// create path instead — and that is where re-running used to append the whole
// template body a second time.
test("re-adopting is a no-op for a repo that had no CLAUDE.md", () => {
  const repo = makeRepo({ "CLAUDE.md": null });
  assert.equal(adopt(repo).status, 0);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "adopt");
  assert.equal(adopt(repo).status, 0);
  assert.ok(isClean(repo), "second run leaves the tree clean");
  const agents = read(repo, "AGENTS.md");
  const occurrences = agents.split("Write tests before building").length - 1;
  assert.equal(occurrences, 1, "template guidance appears exactly once");
});
