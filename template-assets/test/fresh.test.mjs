// Tests for the fresh-start flow: a new project's history is its own — one
// parentless commit on `main`, with the template's `origin` remote gone.
//
// These run against real temporary git repositories. There is no network or
// interactive input, and the end-to-end checks use --dry-run so they leave
// the template scaffolding and the fixture repository untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureFreshHistory } from "../lib/fresh.mjs";

const TEMPLATE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETUP = join(TEMPLATE_ROOT, "setup.mjs");

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

const lines = (text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const branches = (cwd) => lines(git(cwd, "for-each-ref", "--format=%(refname:short)", "refs/heads"));
const remotes = (cwd) => lines(git(cwd, "remote"));
const commits = (cwd) => Number(git(cwd, "rev-list", "--count", "HEAD"));
const roots = (cwd) => Number(git(cwd, "rev-list", "--count", "--max-parents=0", "HEAD"));

// A repository with the template's shape: history on `master` plus the
// template remote the fresh start is supposed to drop.
function makeClone() {
  const dir = mkdtempSync(join(tmpdir(), "fresh-clone-"));
  git(dir, "init", "-q", "-b", "master");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "AGENTS.md"), "# Guidelines\n");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "KNOWLEDGE.md"), "# Tooling\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "template history");
  git(dir, "remote", "add", "origin", "https://github.com/Tykelar/DEVELOPMENT_FLOOR.git");
  return dir;
}

test("an unborn repository becomes one parentless commit on main", () => {
  const dir = mkdtempSync(join(tmpdir(), "fresh-unborn-"));
  git(dir, "init", "-q", "-b", "master");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "AGENTS.md"), "# Guidelines\n");

  const result = ensureFreshHistory({ cwd: dir });
  assert.equal(result.changed, true);
  assert.deepEqual(branches(dir), ["main"]);
  assert.equal(commits(dir), 1);
  assert.equal(roots(dir), 1, "the commit is parentless");
  assert.equal(git(dir, "log", "-1", "--format=%s"), "Initial commit");
});

test("a template clone gets its own main history and loses origin", () => {
  const dir = makeClone();
  const result = ensureFreshHistory({ cwd: dir });

  assert.equal(result.changed, true);
  assert.equal(result.droppedOrigin, true);
  assert.deepEqual(branches(dir), ["main"]);
  assert.deepEqual(remotes(dir), []);
  assert.equal(commits(dir), 1);
  assert.equal(roots(dir), 1, "history is parentless");
  assert.equal(git(dir, "log", "-1", "--format=%s"), "Initial commit");
  assert.ok(existsSync(join(dir, "AGENTS.md")), "working tree preserved");
  assert.equal(readFileSync(join(dir, "docs", "KNOWLEDGE.md"), "utf8"), "# Tooling\n");
});

test("uncommitted work is carried into the fresh commit", () => {
  const dir = makeClone();
  writeFileSync(join(dir, "new-file.txt"), "work in progress\n");

  const result = ensureFreshHistory({ cwd: dir });
  assert.equal(result.changed, true);
  assert.equal(git(dir, "status", "--porcelain"), "", "no leftover changes");
  assert.equal(readFileSync(join(dir, "new-file.txt"), "utf8"), "work in progress\n");
});

test("extra branches do not survive the fresh start", () => {
  const dir = makeClone();
  git(dir, "branch", "feature");

  ensureFreshHistory({ cwd: dir });
  assert.deepEqual(branches(dir), ["main"]);
});

test("re-running on an already fresh repository is a no-op", () => {
  const dir = makeClone();
  ensureFreshHistory({ cwd: dir });
  const head = git(dir, "rev-parse", "HEAD");

  const result = ensureFreshHistory({ cwd: dir });
  assert.equal(result.changed, false);
  assert.equal(git(dir, "rev-parse", "HEAD"), head, "no new commit");
});

// The installer path: --fresh --yes --no-claude --dry-run must report the
// fresh-start step without touching git, the scaffolding, or the network.
test("setup.mjs --fresh --yes --no-claude --dry-run changes nothing", () => {
  const dir = makeClone();
  const head = git(dir, "rev-parse", "HEAD");

  const r = spawnSync(process.execPath, [SETUP, "--fresh", "--yes", "--no-claude", "--dry-run"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(dir, "rev-parse", "HEAD"), head, "no commit made");
  assert.deepEqual(remotes(dir), ["origin"], "remote left alone");
  assert.ok(!existsSync(join(dir, ".agents")), "skills not installed");
  assert.ok(existsSync(SETUP), "setup.mjs not deleted");
  assert.ok(existsSync(join(TEMPLATE_ROOT, "template-assets")), "scaffolding intact");
  assert.match(r.stdout, /fresh/i, "reports the fresh-start step");
});

test("setup.mjs refuses --fresh alongside --into", () => {
  const dir = makeClone();
  const r = spawnSync(process.execPath, [SETUP, "--into", dir, "--fresh", "--no-claude"], {
    input: "n\n".repeat(20),
    encoding: "utf8",
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /fresh/i);
});
