#!/usr/bin/env node
// Applies config/models.json to pi-subagents' per-agent model overrides in
// ~/.pi/agent/settings.json. Zero dependencies by design: `pi install` runs
// `npm install` on fresh machines, and every dependency is a way for that to fail.
//
//   node scripts/apply-models.mjs [--dry-run] [--settings <path>]

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const settingsIdx = args.indexOf("--settings");
const SETTINGS =
  settingsIdx !== -1 && args[settingsIdx + 1]
    ? args[settingsIdx + 1]
    : join(homedir(), ".pi", "agent", "settings.json");

// Roles that map to a pi-subagents builtin rather than a pw- agent.
const BUILTIN_ROLES = { oracle: "oracle" };

const log = (...a) => console.log(...a);
const fail = (m) => {
  console.error(`apply-models: ${m}`);
  process.exit(1);
};

// ---------------------------------------------------------------- load config
const cfgPath = join(ROOT, "config", "models.json");
if (!existsSync(cfgPath)) fail(`missing ${cfgPath}`);

let cfg;
try {
  cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
} catch (e) {
  fail(`config/models.json is not valid JSON: ${e.message}`);
}

const roles = cfg.roles ?? {};
if (!Object.keys(roles).length) fail("config/models.json has no roles");

if (roles.reviewer?.model && roles.reviewer.model === roles.worker?.model) {
  fail(
    "roles.reviewer and roles.worker resolve to the same model.\n" +
      "  A reviewer sharing the implementer's model is not a second opinion.\n" +
      "  Edit config/models.json and re-run.",
  );
}

// ------------------------------------------------- validate against the catalog
let known = null;
try {
  const out = execFileSync("pi", ["--list-models"], { encoding: "utf8", timeout: 30_000 });
  known = new Set();
  for (const line of out.split("\n").slice(1)) {
    const [provider, model] = line.trim().split(/\s+/);
    if (provider && model) known.add(`${provider}/${model}`);
  }
  if (!known.size) known = null;
} catch {
  log("note: could not run `pi --list-models`; skipping model catalog validation");
}

// ----------------------------------------------------------- build the overrides
const overrides = {};
const skipped = [];

for (const [role, spec] of Object.entries(roles)) {
  const model = typeof spec === "string" ? spec : spec?.model;
  if (!model) continue;

  if (known && !known.has(model)) {
    skipped.push(`${role} -> ${model} (not in the provider catalog)`);
    continue;
  }

  const entry = { model };
  if (typeof spec === "object" && spec.thinking) entry.thinking = spec.thinking;
  if (typeof spec === "object" && Array.isArray(spec.fallbackModels)) {
    entry.fallbackModels = spec.fallbackModels;
  }

  if (BUILTIN_ROLES[role]) {
    overrides[BUILTIN_ROLES[role]] = entry;
  } else {
    // pi-subagents resolves package agents under both the bare name and the
    // `<package>.<name>` form. Write both so the override lands either way.
    overrides[`pw-${role}`] = entry;
    overrides[`pi-workflow.pw-${role}`] = entry;
  }
}

if (skipped.length) {
  log("skipped (model missing from the catalog - the role falls back to the session model):");
  for (const s of skipped) log(`  ${s}`);
}

// ------------------------------------------------------------- merge and write
let settings = {};
if (existsSync(SETTINGS)) {
  try {
    settings = JSON.parse(readFileSync(SETTINGS, "utf8"));
  } catch (e) {
    fail(`${SETTINGS} is not valid JSON (${e.message}); refusing to overwrite it`);
  }
} else {
  log(`note: ${SETTINGS} does not exist yet; it will be created`);
}

// Merge, never replace: preserve every unrelated key.
const next = {
  ...settings,
  subagents: {
    ...(settings.subagents ?? {}),
    agentOverrides: { ...(settings.subagents?.agentOverrides ?? {}), ...overrides },
  },
};

const rendered = `${JSON.stringify(next, null, 2)}\n`;

if (DRY) {
  log("\n--dry-run: would write these agent overrides:\n");
  log(JSON.stringify(overrides, null, 2));
  process.exit(0);
}

mkdirSync(dirname(SETTINGS), { recursive: true });

if (existsSync(SETTINGS)) {
  const backup = `${SETTINGS}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  writeFileSync(backup, readFileSync(SETTINGS));
  log(`backed up  ${backup}`);
}

// Atomic: a killed process must never leave a truncated settings file.
const tmp = `${SETTINGS}.tmp-${process.pid}`;
writeFileSync(tmp, rendered);
renameSync(tmp, SETTINGS);

log(`\nwrote ${Object.keys(overrides).length} agent overrides to ${SETTINGS}`);
for (const [name, entry] of Object.entries(overrides)) {
  if (!name.startsWith("pi-workflow.")) log(`  ${name.padEnd(16)} ${entry.model}`);
}
log("\nRestart pi for these to take effect, then verify with:  /subagents-models");
