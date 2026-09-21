import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BEGIN,
  END,
  mergeAgentInstructions,
  mergeClaudeImport,
  mergeSettings,
  mergeExtensions,
  parseJson,
} from "../lib/merge.mjs";

const BODY = "# Guidelines\n\n- Write tests before building the implementation.\n";

test("mergeAgentInstructions: absent file gets the block, marked", () => {
  const out = mergeAgentInstructions(null, BODY);
  assert.ok(out.includes(BEGIN) && out.includes(END));
  assert.ok(out.includes("Write tests before building"));
});

test("mergeAgentInstructions: existing file keeps its own text and gains the block", () => {
  const existing = "# My project\n\nDo not delete me.\n";
  const out = mergeAgentInstructions(existing, BODY);
  assert.ok(out.startsWith("# My project"));
  assert.ok(out.includes("Do not delete me."));
  assert.ok(out.includes("Write tests before building"));
});

test("mergeAgentInstructions: re-running replaces the block instead of appending a second one", () => {
  const first = mergeAgentInstructions("# Mine\n\nKeep.\n", BODY);
  const second = mergeAgentInstructions(first, BODY);
  assert.equal(second, first, "second run should be a no-op");
  assert.equal(second.split(BEGIN).length - 1, 1, "exactly one begin marker");
});

test("mergeAgentInstructions: an updated template rewrites only the marked region", () => {
  const first = mergeAgentInstructions("# Mine\n\nKeep.\n", BODY);
  const second = mergeAgentInstructions(first, "# Guidelines\n\n- A new rule.\n");
  assert.ok(second.includes("Keep."), "surrounding text survives");
  assert.ok(second.includes("A new rule."));
  assert.ok(!second.includes("Write tests before building"), "old block content is gone");
  assert.equal(second.split(BEGIN).length - 1, 1);
});

test("mergeAgentInstructions: text after the block survives an update", () => {
  const withTail = mergeAgentInstructions("# Mine\n", BODY) + "\n## My own trailing section\n";
  const out = mergeAgentInstructions(withTail, "# Guidelines\n\n- A new rule.\n");
  assert.ok(out.includes("# Mine"));
  assert.ok(out.includes("## My own trailing section"));
  assert.ok(out.includes("A new rule."));
});

test("mergeClaudeImport: absent CLAUDE.md is just an import of AGENTS.md", () => {
  const out = mergeClaudeImport("");
  assert.ok(out.includes("@AGENTS.md"));
  assert.ok(out.includes(BEGIN) && out.includes(END));
});

test("mergeClaudeImport: a repo's own CLAUDE.md text survives and gains the import", () => {
  const out = mergeClaudeImport("# House rules\n\nNever delete this line.\n");
  assert.ok(out.includes("Never delete this line."));
  assert.ok(out.includes("@AGENTS.md"));
});

test("mergeClaudeImport: re-running does not stack a second import", () => {
  const once = mergeClaudeImport("# House rules\n");
  const twice = mergeClaudeImport(once);
  assert.equal(twice, once);
  assert.equal(twice.split("@AGENTS.md").length - 1, 1);
});

const HOOK = {
  hooks: {
    UserPromptSubmit: [
      { hooks: [{ type: "command", command: "echo plan-rule", statusMessage: "Checking" }] },
    ],
  },
};

test("mergeSettings: absent settings become the template settings", () => {
  assert.deepEqual(mergeSettings(null, HOOK), HOOK);
});

test("mergeSettings: unrelated keys survive untouched", () => {
  const existing = { permissions: { allow: ["Bash(npm test)"] }, env: { DEBUG: "1" } };
  const out = mergeSettings(existing, HOOK);
  assert.deepEqual(out.permissions, existing.permissions);
  assert.deepEqual(out.env, existing.env);
  assert.equal(out.hooks.UserPromptSubmit.length, 1);
});

test("mergeSettings: an existing value is never overwritten by the template", () => {
  const out = mergeSettings({ model: "sonnet" }, { ...HOOK, model: "opus" });
  assert.equal(out.model, "sonnet");
});

test("mergeSettings: the same hook is not installed twice", () => {
  const once = mergeSettings(null, HOOK);
  const twice = mergeSettings(once, HOOK);
  assert.deepEqual(twice, once);
  assert.equal(twice.hooks.UserPromptSubmit.length, 1);
});

test("mergeSettings: a different existing hook on the same event is kept alongside ours", () => {
  const existing = {
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo mine" }] }],
    },
  };
  const out = mergeSettings(existing, HOOK);
  const commands = out.hooks.UserPromptSubmit.flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepEqual(commands, ["echo mine", "echo plan-rule"]);
});

test("mergeSettings: hooks on other events are left alone", () => {
  const existing = {
    hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "echo fmt" }] }] },
  };
  const out = mergeSettings(existing, HOOK);
  assert.equal(out.hooks.PostToolUse.length, 1);
  assert.equal(out.hooks.UserPromptSubmit.length, 1);
});

const EXT = { recommendations: ["Hyperclaw79.vssticky"] };

test("mergeExtensions: recommendations union, existing order first, no duplicates", () => {
  const out = mergeExtensions({ recommendations: ["esbenp.prettier-vscode"] }, EXT);
  assert.deepEqual(out.recommendations, ["esbenp.prettier-vscode", "Hyperclaw79.vssticky"]);
});

test("mergeExtensions: an already-recommended extension is not duplicated", () => {
  const out = mergeExtensions(EXT, EXT);
  assert.deepEqual(out.recommendations, ["Hyperclaw79.vssticky"]);
});

test("mergeExtensions: unrelated keys such as unwantedRecommendations survive", () => {
  const out = mergeExtensions({ unwantedRecommendations: ["ms-python.python"] }, EXT);
  assert.deepEqual(out.unwantedRecommendations, ["ms-python.python"]);
  assert.deepEqual(out.recommendations, ["Hyperclaw79.vssticky"]);
});

test("parseJson: valid JSON parses", () => {
  assert.deepEqual(parseJson('{"a":1}'), { ok: true, value: { a: 1 } });
});

test("parseJson: JSONC with comments is reported, never silently rewritten", () => {
  const result = parseJson('{\n  // a comment VS Code allows\n  "recommendations": []\n}');
  assert.equal(result.ok, false);
  assert.ok(result.reason, "carries a human-readable reason");
  assert.equal(result.value, undefined, "no parsed value to write back from");
});

test("parseJson: a trailing comma is reported rather than reformatted", () => {
  assert.equal(parseJson('{"recommendations": ["a",],}').ok, false);
});
