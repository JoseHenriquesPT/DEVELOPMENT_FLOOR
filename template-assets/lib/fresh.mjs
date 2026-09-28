// Fresh-history helper for new projects.
//
// A project started from this template gets its history from the project, not
// from the template: a single parentless `Initial commit` on `main`, with the
// template's `origin` remote removed. Works on a clone with history, a
// repository with no commits yet, or a directory that is not a repository at
// all.
//
// Kept out of setup.mjs so `node --test` can exercise it against real
// temporary repositories without driving the interactive installer.
import { spawnSync } from "node:child_process";

export const FRESH_BRANCH = "main";
export const FRESH_MESSAGE = "Initial commit";

// A name that will not collide with anything a project would plausibly use;
// the old history is re-rooted through it, then it is renamed onto `main`.
const TEMP_BRANCH = "__fresh-history__";

function gitAt(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout.trim();
}

const lines = (text) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

/**
 * Give the repository at `cwd` a fresh history of its own.
 *
 * @param {object} options
 * @param {string} options.cwd          repository (or directory to initialize)
 * @param {string} [options.branch]     branch to leave checked out, default "main"
 * @param {string} [options.message]    message for the initial commit
 * @param {(cmd: string) => void} [options.log]  called with each git command, for progress output
 * @returns {{ changed: boolean, branch: string, droppedOrigin: boolean }}
 */
export function ensureFreshHistory({
  cwd,
  branch = FRESH_BRANCH,
  message = FRESH_MESSAGE,
  log = () => {},
} = {}) {
  if (!cwd) throw new Error("ensureFreshHistory needs a cwd");
  const git = (...args) => {
    log(`git ${args.join(" ")}`);
    return gitAt(cwd, args);
  };
  const succeeds = (...args) => spawnSync("git", args, { cwd }).status === 0;

  if (!succeeds("rev-parse", "--git-dir")) git("init", "-b", branch);

  const hasCommits = succeeds("rev-parse", "--verify", "HEAD");
  const branches = hasCommits
    ? lines(git("for-each-ref", "--format=%(refname:short)", "refs/heads"))
    : [];
  const remotes = lines(git("remote"));

  const already =
    hasCommits &&
    Number(git("rev-list", "--count", "HEAD")) === 1 &&
    branches.length === 1 &&
    branches[0] === branch &&
    remotes.length === 0;
  if (already) return { changed: false, branch, droppedOrigin: false };

  // An unborn HEAD still points at whatever the machine's default branch is.
  if (!hasCommits && git("symbolic-ref", "--short", "HEAD") !== branch) {
    git("symbolic-ref", "HEAD", `refs/heads/${branch}`);
  }

  // A repository that already has history is re-rooted through a temporary
  // orphan branch, so this works even when `branch` already exists.
  let orphaned = false;
  if (hasCommits) {
    if (branches.includes(TEMP_BRANCH)) git("branch", "-D", TEMP_BRANCH);
    git("checkout", "--orphan", TEMP_BRANCH);
    orphaned = true;
  }

  git("add", "-A");
  git("commit", "-m", message);
  if (orphaned) git("branch", "-M", TEMP_BRANCH, branch);

  // The old branches all belong to the old history; none of them can be the
  // current branch at this point (the current one is `branch`).
  for (const name of branches) {
    if (name === branch || name === TEMP_BRANCH) continue;
    git("branch", "-D", name);
  }

  let droppedOrigin = false;
  if (remotes.includes("origin")) {
    git("remote", "remove", "origin");
    droppedOrigin = true;
  }

  return { changed: true, branch, droppedOrigin };
}
