// apply-models.mjs and suggest-models.mjs, run against fake machines.
//
// The failure these exist to prevent is silent: a config that validates cleanly
// still puts worker and reviewer on the same model when the machine's provider is
// not the one config/models.json targets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { repoCopy, fakePi, PATH_WITHOUT_PI, run, out, tmp, readJson, exists } from "./support/harness.mjs";

const REAL = ["opencode-go/deepseek-v4-flash", "opencode-go/deepseek-v4-pro", "opencode-go/kimi-k3",
  "opencode-go/kimi-k2.7-code", "opencode-go/glm-5.2", "opencode-go/mimo-v2.5", "opencode-go/qwen3.7-max"];
const OTHER = ["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-5", "anthropic/claude-haiku-4-5"];

const apply = (dir, args, binDir) =>
  run(join(dir, "scripts", "apply-models.mjs"), args, { cwd: dir, binDir });
const suggest = (dir, args, binDir) =>
  run(join(dir, "scripts", "suggest-models.mjs"), args, { cwd: dir, binDir });

// ---------------------------------------------------------------- apply-models

test("writes an override per role when every model resolves", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  const r = apply(dir, ["--settings", settings], fakePi(REAL));
  assert.equal(r.code, 0, out(r));
  const written = readJson(settings).subagents.agentOverrides;
  assert.equal(written["pw-worker"].model, "opencode-go/kimi-k2.7-code");
  assert.equal(written["pw-reviewer"].model, "opencode-go/glm-5.2");
  // Both name forms, so routing lands whichever pi-subagents accepts.
  assert.ok(written["pi-workflow.pw-worker"], "namespaced form missing");
  // oracle maps to a builtin, not a pw- agent.
  assert.ok(written.oracle, "oracle override missing");
  assert.ok(!written["pw-oracle"], "oracle must not be written as a pw- agent");
});

test("exits non-zero and writes nothing when no role resolves", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  const r = apply(dir, ["--settings", settings], fakePi(OTHER));
  assert.equal(r.code, 2, "zero overrides must not read as success");
  assert.match(out(r), /not one role resolved/);
  assert.match(out(r), /suggest-models/);
  assert.equal(exists(settings), false, "settings must not be written on failure");
});

test("preserves unrelated settings keys", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  writeFileSync(settings, JSON.stringify({ theme: "dark", packages: ["npm:pi-subagents"] }));
  const r = apply(dir, ["--settings", settings], fakePi(REAL));
  assert.equal(r.code, 0, out(r));
  const after = readJson(settings);
  assert.equal(after.theme, "dark");
  assert.deepEqual(after.packages, ["npm:pi-subagents"]);
});

test("refuses to overwrite a settings file it cannot parse", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  writeFileSync(settings, "{ not json");
  const r = apply(dir, ["--settings", settings], fakePi(REAL));
  assert.equal(r.code, 1);
  assert.match(out(r), /refusing to overwrite/);
  assert.equal(readFileSync(settings, "utf8"), "{ not json");
});

test("--dry-run writes nothing", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  const r = apply(dir, ["--dry-run", "--settings", settings], fakePi(REAL));
  assert.equal(r.code, 0, out(r));
  assert.equal(exists(settings), false);
});

test("warns when only one of worker/reviewer resolves", () => {
  const dir = repoCopy();
  const settings = join(tmp(), "settings.json");
  // Everything present except the worker's model.
  const partial = REAL.filter((m) => !m.includes("kimi-k2.7-code"));
  const r = apply(dir, ["--settings", settings], fakePi(partial));
  assert.equal(r.code, 0, out(r));
  assert.match(out(r), /worker did not resolve/);
});

// -------------------------------------------------------------- suggest-models

test("keeps every role when the configured models all exist", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakePi(REAL));
  assert.equal(r.code, 0, out(r));
  assert.doesNotMatch(r.stdout, /change/);
  assert.match(r.stdout, /keep\s+worker/);
});

test("proposes a mapping when the configured provider is absent", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakePi(OTHER));
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /change worker/);
  assert.match(r.stdout, /provider:\s+anthropic/);
});

test("the proposal never puts worker and reviewer on one model", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakePi(OTHER));
  const worker = r.stdout.match(/worker\s+(\S+)/)[1];
  const reviewer = r.stdout.match(/reviewer\s+(\S+)/)[1];
  assert.notEqual(worker, reviewer);
});

test("refuses outright when the catalog has one model", () => {
  const dir = repoCopy();
  const r = suggest(dir, [], fakePi(["ollama/llama4"]));
  assert.equal(r.code, 1);
  assert.match(out(r), /worker and reviewer cannot differ/);
});

test("--write applies the proposal and backs the old config up", () => {
  const dir = repoCopy();
  const cfgPath = join(dir, "config", "models.json");
  const before = readJson(cfgPath);
  const r = suggest(dir, ["--write"], fakePi(OTHER));
  assert.equal(r.code, 0, out(r));
  const after = readJson(cfgPath);
  assert.equal(after.provider, "anthropic");
  assert.notEqual(after.roles.worker.model, before.roles.worker.model);
  assert.notEqual(after.roles.worker.model, after.roles.reviewer.model);
  assert.match(out(r), /backed up/);
  // The old `why` described a model that is no longer routed there.
  assert.match(after.roles.worker.why, /Auto-selected/);
});

test("the written config passes validate", () => {
  const dir = repoCopy();
  const bin = fakePi(OTHER);
  assert.equal(suggest(dir, ["--write"], bin).code, 0);
  const v = run(join(dir, "scripts", "validate.mjs"), [], { cwd: dir, binDir: bin });
  assert.equal(v.code, 0, out(v));
});

test("an unknown --provider is refused with the list of real ones", () => {
  const dir = repoCopy();
  const r = suggest(dir, ["--provider", "openai"], fakePi(OTHER));
  assert.equal(r.code, 1);
  assert.match(out(r), /no models for provider "openai".*anthropic/s);
});

test("says what is wrong when pi is not on PATH", () => {
  const dir = repoCopy();
  const r = run(join(dir, "scripts", "suggest-models.mjs"), [], {
    cwd: dir,
    env: { PATH: PATH_WITHOUT_PI },
  });
  assert.equal(r.code, 1);
  assert.match(out(r), /could not run `pi --list-models`/);
});
