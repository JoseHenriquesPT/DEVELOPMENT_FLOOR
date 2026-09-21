// Merge rules used when adopting this template into a repository that already
// has files of its own. The guiding rule throughout: whatever the repo already
// says wins. We only ever add.
//
// Pure functions, no filesystem access, so they can be unit-tested directly.

export const BEGIN = "<!-- BEGIN development-floor -->";
export const END = "<!-- END development-floor -->";

/**
 * Replace the template's marked block in a file, or append it if there isn't
 * one yet. Text the repo's owner wrote around the block is never touched, so a
 * later run can refresh the guidance instead of stacking a second copy.
 */
function upsertBlock(existing, block) {
  if (!existing || !existing.trim()) return block;

  const start = existing.indexOf(BEGIN);
  const end = existing.indexOf(END);
  if (start !== -1 && end > start) {
    // Replace only what's between the markers; keep the text on both sides.
    return existing.slice(0, start) + block.trimEnd() + existing.slice(end + END.length);
  }
  return `${existing.trimEnd()}\n\n${block}`;
}

const marked = (body) => `${BEGIN}\n${body.trim()}\n${END}\n`;

/**
 * Fold the template's guidance into a repo's AGENTS.md as a marked block.
 * AGENTS.md is the cross-harness convention: Claude Code, Codex, Cursor, pi,
 * Copilot and others read it (Claude Code via the CLAUDE.md import below).
 */
export function mergeAgentInstructions(existing, body) {
  return upsertBlock(existing, marked(body));
}

/**
 * Make a CLAUDE.md point at AGENTS.md instead of duplicating its content.
 * Claude Code expands `@AGENTS.md` imports, so the canonical guidelines live
 * in exactly one file for every harness. Any existing CLAUDE.md text survives.
 */
export function mergeClaudeImport(existing) {
  return upsertBlock(existing, marked("@AGENTS.md"));
}

/**
 * JSON.parse that reports failure instead of throwing. A config we cannot parse
 * (VS Code permits comments and trailing commas in extensions.json) is one we
 * refuse to rewrite — reformatting someone's commented config is exactly the
 * kind of damage this whole module exists to avoid.
 */
export function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Hook groups are keyed by the command they run: a group whose commands are all
// already configured is one we have nothing to add to.
function mergeHookGroups(existing, incoming) {
  const configured = new Set();
  for (const group of existing) {
    for (const hook of group?.hooks ?? []) configured.add(hook?.command);
  }
  const merged = existing.slice();
  for (const group of incoming) {
    const missing = (group?.hooks ?? []).filter((hook) => !configured.has(hook?.command));
    if (missing.length) merged.push({ ...group, hooks: missing });
  }
  return merged;
}

function deepMerge(existing, incoming, path) {
  if (existing === undefined || existing === null) return structuredClone(incoming);
  if (isPlainObject(existing) && isPlainObject(incoming)) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = deepMerge(existing[key], value, [...path, key]);
    }
    return merged;
  }
  if (Array.isArray(existing) && Array.isArray(incoming)) {
    if (path[0] === "hooks" && path.length === 2) return mergeHookGroups(existing, incoming);
    // Union by value, existing entries keeping their order.
    const seen = new Set(existing.map((item) => JSON.stringify(item)));
    return [...existing, ...incoming.filter((item) => !seen.has(JSON.stringify(item)))];
  }
  // Conflicting scalars: the repo's own value stands.
  return existing;
}

/** Add our Claude Code hook to .claude/settings.json without disturbing anything else in it. */
export function mergeSettings(existing, template) {
  return deepMerge(existing, template, []);
}

/** Add our recommendation to .vscode/extensions.json, keeping the repo's own. */
export function mergeExtensions(existing, template) {
  return deepMerge(existing, template, []);
}
