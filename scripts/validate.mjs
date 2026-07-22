#!/usr/bin/env node
// Structural validation for the pi-workflow package. Zero dependencies.
//
//   node scripts/validate.mjs [--verbose]
//
// Exits non-zero with a precise message on the first class of failure found.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VERBOSE = process.argv.includes("--verbose");

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${relative(ROOT, file) || file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${relative(ROOT, file) || file}: ${msg}`);
const ok = (msg) => VERBOSE && console.log(`  ok  ${msg}`);

const read = (p) => readFileSync(p, "utf8");
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// ---------------------------------------------------------------- frontmatter
// Minimal front-matter reader: `key: value`, plus `key:` followed by `- item`
// lines. Sufficient for skill and agent headers, which are deliberately flat.
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (item && listKey) {
      out[listKey].push(stripQuotes(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === "") {
      listKey = key;
      out[key] = [];
    } else {
      listKey = null;
      out[key] = stripQuotes(value);
    }
  }
  return out;
}

const stripQuotes = (s) => s.replace(/^["'](.*)["']$/, "$1").trim();

// ------------------------------------------------------------- 1. package.json
const pkgPath = join(ROOT, "package.json");
let pkg = {};
try {
  pkg = JSON.parse(read(pkgPath));
  ok("package.json parses");
} catch (e) {
  err(pkgPath, `not valid JSON: ${e.message}`);
}

if (!(pkg.keywords ?? []).includes("pi-package")) {
  err(pkgPath, 'keywords must include "pi-package" for pi to discover this package');
}
if (JSON.stringify(pkg.pi?.skills) !== JSON.stringify(["./skills"])) {
  err(pkgPath, 'pi.skills must be ["./skills"]');
}
if (JSON.stringify(pkg["pi-subagents"]?.agents) !== JSON.stringify(["./agents"])) {
  err(pkgPath, '"pi-subagents".agents must be ["./agents"] for the pw- agents to load');
}
if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
  err(pkgPath, "no npm dependencies allowed: scripts must run on stock Node");
}
for (const p of [...(pkg.pi?.skills ?? []), ...(pkg["pi-subagents"]?.agents ?? [])]) {
  if (!existsSync(join(ROOT, p))) err(pkgPath, `declared path does not exist: ${p}`);
}

// ------------------------------------------------------------------ 2. skills
const SKILLS = ["groundwork", "blueprint", "build", "yeet"];
const skillsDir = join(ROOT, "skills");

for (const name of SKILLS) {
  const file = join(skillsDir, name, "SKILL.md");
  if (!existsSync(file)) {
    err(file, "missing");
    continue;
  }
  const fm = frontmatter(read(file));
  if (!fm) {
    err(file, "missing YAML frontmatter");
    continue;
  }
  if (fm.name !== name) err(file, `frontmatter name "${fm.name}" must match directory "${name}"`);
  if (!/^[a-z0-9-]{1,64}$/.test(fm.name ?? "")) err(file, "name must be lowercase, <=64 chars");
  if (!fm.description) err(file, "description is required");
  else if (fm.description.length < 60) {
    err(file, "description must say what the skill does AND when to use it");
  }
  ok(`skill ${name}`);
}

if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
    if (d.isDirectory() && !SKILLS.includes(d.name)) warn(skillsDir, `unexpected skill: ${d.name}`);
  }
}

// ------------------------------------------------------------------ 3. agents
const agentsDir = join(ROOT, "agents");
const agentFiles = walk(agentsDir).filter((f) => f.endsWith(".md"));
const agentNames = new Set();

if (!agentFiles.length) err(agentsDir, "no agent definitions found");

for (const file of agentFiles) {
  const fm = frontmatter(read(file));
  if (!fm) {
    err(file, "missing YAML frontmatter");
    continue;
  }
  if (!fm.name) err(file, "name is required");
  if (fm.package !== "pi-workflow") err(file, 'package must be "pi-workflow" to namespace the agent');
  if (!fm.description) err(file, "description is required");
  if (!fm.tools) err(file, "tools is required: agents must declare an explicit tool set");
  if (agentNames.has(fm.name)) err(file, `duplicate agent name: ${fm.name}`);
  agentNames.add(fm.name);

  // Read-only agents must not carry write tools.
  const READ_ONLY = ["pw-scout", "pw-reviewer", "pw-researcher"];
  if (READ_ONLY.includes(fm.name) && /\b(edit|write)\b/.test(fm.tools)) {
    err(file, `${fm.name} is a read-only agent but declares edit/write in tools`);
  }
  ok(`agent ${fm.name}`);
}

// ------------------------------------------------------------------ 4. models
const modelsPath = join(ROOT, "config", "models.json");
let models = {};
try {
  models = JSON.parse(read(modelsPath));
  ok("config/models.json parses");
} catch (e) {
  err(modelsPath, `not valid JSON: ${e.message}`);
}

const roles = models.roles ?? {};
const REQUIRED_ROLES = ["scout", "researcher", "planner", "worker", "reviewer", "scribe", "oracle"];
for (const role of REQUIRED_ROLES) {
  if (!roles[role]) err(modelsPath, `missing role: ${role}`);
}

for (const [role, spec] of Object.entries(roles)) {
  const model = typeof spec === "string" ? spec : spec?.model;
  if (!model) {
    err(modelsPath, `role ${role} has no model`);
    continue;
  }
  if (!/^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/.test(model)) {
    err(modelsPath, `role ${role}: "${model}" is not a provider/model id`);
  }
}

if (roles.reviewer && roles.worker) {
  const r = typeof roles.reviewer === "string" ? roles.reviewer : roles.reviewer.model;
  const w = typeof roles.worker === "string" ? roles.worker : roles.worker.model;
  if (r === w) {
    err(modelsPath, "roles.reviewer must differ from roles.worker: same model is not a second opinion");
  }
}

// Every pw- agent needs a matching role, and vice versa.
for (const name of agentNames) {
  const role = name.replace(/^pw-/, "");
  if (!roles[role]) err(modelsPath, `agent ${name} has no matching role in config/models.json`);
}

// Optional: check against the live catalog when pi is available.
try {
  const out = execFileSync("pi", ["--list-models"], { encoding: "utf8", timeout: 30_000 });
  const known = new Set();
  for (const line of out.split("\n").slice(1)) {
    const [provider, model] = line.trim().split(/\s+/);
    if (provider && model) known.add(`${provider}/${model}`);
  }
  if (known.size) {
    for (const [role, spec] of Object.entries(roles)) {
      const model = typeof spec === "string" ? spec : spec?.model;
      if (model && !known.has(model)) warn(modelsPath, `role ${role}: "${model}" is not in the local catalog`);
    }
    ok("model ids checked against the local catalog");
  }
} catch {
  ok("pi not available; skipped live model catalog check");
}

// ------------------------------------------------------------------ 5. limits
const limitsPath = join(ROOT, "config", "limits.json");
try {
  const limits = JSON.parse(read(limitsPath));
  const shape = {
    maxParallel: "number",
    packageTimeoutMin: "number",
    maxRetriesPerPackage: "number",
    softBudgetUsd: "number",
    softBudgetAction: "string",
  };
  for (const [key, type] of Object.entries(shape)) {
    if (typeof limits[key] !== type) err(limitsPath, `${key} must be a ${type}`);
  }
  if (typeof limits.turnBudget?.maxTurns !== "number") err(limitsPath, "turnBudget.maxTurns must be a number");
  if (typeof limits.toolBudget?.hard !== "number") err(limitsPath, "toolBudget.hard must be a number");
  ok("config/limits.json");
} catch (e) {
  if (e instanceof SyntaxError) err(limitsPath, `not valid JSON: ${e.message}`);
  else if (!existsSync(limitsPath)) err(limitsPath, "missing");
}

// ----------------------------------------------------------------- 6. catalog
// Distro families groundwork can resolve an install command for. Adding one here
// makes every family-bound catalog entry fail until it carries a command for it -
// which is the point: the failure is the reminder.
const FAMILIES = ["debian", "fedora", "arch"];

// Package managers, mapped to the family whose machines actually have them.
// `snap` is here because it ships on Ubuntu and essentially nowhere else by
// default, so a snap install is a debian-family install in practice.
const PKG_MANAGERS = [
  [/\b(apt|apt-get|dpkg|snap)\b/, "debian"],
  [/\b(dnf|dnf5|yum|rpm)\b/, "fedora"],
  [/\b(pacman|yay|paru)\b/, "arch"],
];

const inferFamily = (cmd) => PKG_MANAGERS.find(([re]) => re.test(cmd))?.[1] ?? null;

const catalogPath = join(ROOT, "catalog", "tools.yaml");
if (!existsSync(catalogPath)) {
  err(catalogPath, "missing");
} else {
  const entries = parseToolCatalog(read(catalogPath), catalogPath);
  const seen = new Set();
  for (const { fields, line } of entries) {
    const at = `${catalogPath}:${line}`;
    const id = fields.id;
    for (const req of ["id", "name", "kind", "detect", "install", "sudo", "scope", "domains"]) {
      if (!(req in fields)) errors.push(`${relative(ROOT, catalogPath)}:${line}: entry "${id ?? "?"}" missing ${req}`);
    }
    if (id && seen.has(id)) errors.push(`${relative(ROOT, catalogPath)}:${line}: duplicate id "${id}"`);
    if (id) seen.add(id);

    if (fields.scope && !["global", "project"].includes(fields.scope)) {
      errors.push(`${relative(ROOT, catalogPath)}:${line}: scope must be global or project`);
    }
    if (fields.sudo && !["true", "false"].includes(fields.sudo)) {
      errors.push(`${relative(ROOT, catalogPath)}:${line}: sudo must be true or false`);
    }

    // Every install variant, base and per-family alike.
    const installs = Object.entries(fields).filter(([k]) => k === "install" || k.startsWith("install_"));
    for (const [key, cmd] of installs) {
      if (key === "install_notes" || key === "install_family") continue;
      const family = key === "install" ? null : key.slice("install_".length);
      if (family && !FAMILIES.includes(family)) {
        errors.push(
          `${relative(ROOT, catalogPath)}:${line}: "${id}" has unknown platform key "${key}"` +
            ` - supported families are ${FAMILIES.join(", ")}`,
        );
      }
      // The rule that matters: groundwork runs non-sudo installs directly.
      if (fields.sudo === "false" && /\bsudo\b/.test(cmd ?? "")) {
        errors.push(
          `${relative(ROOT, catalogPath)}:${line}: "${id}" declares sudo: false but ${key} uses sudo` +
            " - groundwork would run it directly",
        );
      }
    }

    // A base install bound to one distro family needs a command for the others,
    // or groundwork has nothing correct to offer there. Declared via
    // install_family, otherwise inferred from the package manager it invokes.
    const declaredFamily = fields.install_family;
    if (declaredFamily && !FAMILIES.includes(declaredFamily)) {
      errors.push(
        `${relative(ROOT, catalogPath)}:${line}: "${id}" install_family "${declaredFamily}" is not one of ${FAMILIES.join(", ")}`,
      );
    }
    const baseFamily = declaredFamily ?? inferFamily(fields.install ?? "");
    if (baseFamily && FAMILIES.includes(baseFamily)) {
      for (const other of FAMILIES.filter((f) => f !== baseFamily)) {
        if (!(`install_${other}` in fields)) {
          errors.push(
            `${relative(ROOT, catalogPath)}:${line}: "${id}" install targets the ${baseFamily} family` +
              ` but has no install_${other} - use MANUAL if there is no scriptable path`,
          );
        }
      }
    }
    if (at) ok(`catalog ${id}`);
  }
  if (entries.length < 5) err(catalogPath, "catalog looks empty; expected the seeded tool set");
}

// A deliberately small YAML reader for this file's shape: a `tools:` sequence of
// flat maps. Anything more expressive would need a real parser, and a real parser
// would need a dependency.
function parseToolCatalog(text, file) {
  const out = [];
  let current = null;
  let lineNo = 0;
  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (/^tools:\s*$/.test(line)) continue;

    const start = line.match(/^\s*-\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (start) {
      if (current) out.push(current);
      current = { fields: { [start[1]]: stripQuotes(start[2]) }, line: lineNo };
      continue;
    }
    const kv = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv && current) {
      current.fields[kv[1]] = stripQuotes(kv[2]);
      continue;
    }
    if (line.trim() && !kv && !start && current === null) {
      err(file, `line ${lineNo}: unexpected content outside a tools entry`);
    }
  }
  if (current) out.push(current);
  return out;
}

// ------------------------------------------------------- 7. cross-references
const referenced = new Set();
const mdFiles = [...walk(skillsDir), ...walk(agentsDir)].filter((f) => f.endsWith(".md"));
for (const file of mdFiles) {
  const text = read(file);
  for (const m of text.matchAll(/\b((?:shared|templates|config|catalog|scripts)\/[A-Za-z0-9._/-]+)/g)) {
    const target = m[1].replace(/[.,)]+$/, "");
    referenced.add(target);
    if (!existsSync(join(ROOT, target))) err(file, `references a path that does not exist: ${target}`);
  }
}
ok(`${referenced.size} cross-references resolved`);

// ------------------------------------------------- 8. no hardcoded model ids
for (const file of mdFiles) {
  const text = read(file);
  const hit = text.match(/\b(opencode-go|anthropic|openai|google)\/[a-zA-Z0-9._-]+/);
  if (hit) {
    err(file, `hardcoded model id "${hit[0]}": skills and agents must read config/models.json`);
  }
}
ok("no hardcoded model ids in skills or agents");

// ------------------------------------------ 8b. agents referenced by full name
// pi-subagents registers package agents ONLY as `<package>.<name>`. A bare
// `pw-worker` fails at runtime with "Unknown agent" - verified against
// pi-subagents 0.35.1.
for (const file of walk(skillsDir).filter((f) => f.endsWith(".md"))) {
  const text = read(file);
  for (const m of text.matchAll(/agent:\s*"(pw-[a-z-]+)"/g)) {
    err(file, `agent "${m[1]}" must be namespaced as "pi-workflow.${m[1]}" or it will not resolve`);
  }
  for (const m of text.matchAll(/(?<!pi-workflow\.)`(pw-[a-z-]+)`/g)) {
    err(file, `prose references bare agent "${m[1]}"; use pi-workflow.${m[1]}`);
  }
}
ok("agent references are namespaced");

// --------------------------------------------------------------- 9. secrets
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, "GitHub token"],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, "JWT"],
];

for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (rel.startsWith(".git/") || rel.startsWith("node_modules/") || rel.startsWith(".pi-workflow/")) continue;
  if (statSync(file).size > 512 * 1024) continue;
  let text;
  try {
    text = read(file);
  } catch {
    continue;
  }
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) err(file, `possible ${label} committed`);
  }
}
ok("no secrets detected");

// ----------------------------------------------------------------- report
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  x ${e}`);
  process.exit(1);
}

console.log(`\npi-workflow: valid (${SKILLS.length} skills, ${agentNames.size} agents)`);
