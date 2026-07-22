// doctor.mjs against fake machines, and apply-web-search.mjs against fake config
// dirs. These are the two scripts a first-time user meets before any skill runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import {
  repoCopy, fakePi, PATH_WITHOUT_PI, run, out, tmp, readJson, exists, fakeAgentDir,
} from "./support/harness.mjs";

const REAL = ["opencode-go/deepseek-v4-flash", "opencode-go/deepseek-v4-pro", "opencode-go/kimi-k3",
  "opencode-go/kimi-k2.7-code", "opencode-go/glm-5.2", "opencode-go/mimo-v2.5", "opencode-go/qwen3.7-max"];
const OTHER = ["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-5"];

const HEALTHY = {
  defaultProvider: "opencode-go",
  defaultModel: "glm-5.1",
  packages: [
    "git:github.com/jeffcottj/pi-workflow",
    "npm:pi-subagents",
    "npm:@juicesharp/rpiv-ask-user-question",
    "npm:pi-web-access",
  ],
  subagents: { agentOverrides: { "pw-worker": { model: "opencode-go/kimi-k2.7-code" } } },
};

const doctor = (dir, agentDir, binDir) =>
  run(join(dir, "scripts", "doctor.mjs"), [], {
    cwd: dir,
    binDir,
    env: { PI_CODING_AGENT_DIR: agentDir },
  });

test("a fully set up machine passes", () => {
  const dir = repoCopy();
  const agent = fakeAgentDir(HEALTHY, { workflow: "none" });
  const r = doctor(dir, agent, fakePi(REAL));
  assert.equal(r.code, 0, out(r));
  assert.match(r.stdout, /0 failure\(s\)/);
  assert.match(r.stdout, /reviewer is a second opinion/);
});

test("the reviewer collapse is a failure, not a warning", () => {
  const dir = repoCopy();
  // Provider the config does not target: every role falls back to the session
  // model, so worker and reviewer land on the same one.
  const agent = fakeAgentDir(HEALTHY, { workflow: "none" });
  const r = doctor(dir, agent, fakePi(OTHER));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL\s+reviewer is a second opinion/);
  assert.match(r.stdout, /worker and reviewer both resolve to opencode-go\/glm-5.1/);
  assert.match(r.stdout, /suggest-models/);
});

test("a missing hard-dependency package fails", () => {
  const dir = repoCopy();
  const settings = structuredClone(HEALTHY);
  settings.packages = settings.packages.filter((p) => !p.includes("pi-subagents"));
  const r = doctor(dir, fakeAgentDir(settings, { workflow: "none" }), fakePi(REAL));
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL\s+package pi-subagents/);
  assert.match(r.stdout, /bootstrap\.sh/);
});

test("a missing pi-web-access is a warning, not a failure", () => {
  const dir = repoCopy();
  const settings = structuredClone(HEALTHY);
  settings.packages = settings.packages.filter((p) => !p.includes("pi-web-access"));
  const r = doctor(dir, fakeAgentDir(settings, { workflow: "none" }), fakePi(REAL));
  assert.equal(r.code, 0, "web research is degradable; preflight says so");
  assert.match(r.stdout, /warn\s+package pi-web-access/);
});

test("missing routing is a warning", () => {
  const dir = repoCopy();
  const settings = structuredClone(HEALTHY);
  delete settings.subagents;
  const r = doctor(dir, fakeAgentDir(settings, { workflow: "none" }), fakePi(REAL));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /warn\s+model routing applied/);
  assert.match(r.stdout, /apply-models/);
});

test("an absent curator config is reported with its fix", () => {
  const dir = repoCopy();
  const r = doctor(dir, fakeAgentDir(HEALTHY), fakePi(REAL));
  assert.equal(r.code, 0);
  assert.match(r.stdout, /warn\s+search curator/);
});

test("model checks are skipped, not guessed, when pi is unavailable", () => {
  const dir = repoCopy();
  const r = run(join(dir, "scripts", "doctor.mjs"), [], {
    cwd: dir,
    env: { PATH: PATH_WITHOUT_PI, PI_CODING_AGENT_DIR: fakeAgentDir(HEALTHY, { workflow: "none" }) },
  });
  assert.match(r.stdout, /FAIL\s+pi on PATH/);
  assert.match(r.stdout, /warn\s+model catalog/);
  assert.equal(r.code, 1);
});

// ------------------------------------------------------------ apply-web-search

const webSearch = (dir, agentDir, args = []) =>
  run(join(dir, "scripts", "apply-web-search.mjs"), args, {
    cwd: dir,
    env: { PI_CODING_AGENT_DIR: agentDir },
  });

test("writes workflow: none on a fresh machine", () => {
  const dir = repoCopy();
  const agent = tmp();
  const r = webSearch(dir, agent);
  assert.equal(r.code, 0, out(r));
  assert.equal(readJson(join(agent, "web-search.json")).workflow, "none");
});

test("leaves a deliberate /curator on alone", () => {
  const dir = repoCopy();
  const agent = tmp();
  writeFileSync(join(agent, "web-search.json"), JSON.stringify({ workflow: "summary-review" }));
  const r = webSearch(dir, agent);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /already set\s+workflow: summary-review/);
  assert.equal(readJson(join(agent, "web-search.json")).workflow, "summary-review");
});

test("preserves sibling keys when filling workflow in", () => {
  const dir = repoCopy();
  const agent = tmp();
  writeFileSync(
    join(agent, "web-search.json"),
    JSON.stringify({ provider: "brave", curatorTimeoutSeconds: 45 }),
  );
  assert.equal(webSearch(dir, agent).code, 0);
  const after = readJson(join(agent, "web-search.json"));
  assert.equal(after.workflow, "none");
  assert.equal(after.provider, "brave");
  assert.equal(after.curatorTimeoutSeconds, 45);
});

test("leaves an unparseable config untouched and does not abort bootstrap", () => {
  const dir = repoCopy();
  const agent = tmp();
  writeFileSync(join(agent, "web-search.json"), "{ oops");
  const r = webSearch(dir, agent);
  assert.equal(r.code, 0, "bootstrap runs under set -e; a bad config must not strand it");
  assert.match(r.stdout, /is not valid JSON/);
  assert.equal(readFileSync(join(agent, "web-search.json"), "utf8"), "{ oops");
});

test("--dry-run writes nothing", () => {
  const dir = repoCopy();
  const agent = tmp();
  const r = webSearch(dir, agent, ["--dry-run"]);
  assert.equal(r.code, 0);
  assert.equal(exists(join(agent, "web-search.json")), false);
});

test("honours XDG_CONFIG_HOME the way pi-web-access does", () => {
  const dir = repoCopy();
  const xdg = tmp();
  const r = run(join(dir, "scripts", "apply-web-search.mjs"), [], {
    cwd: dir,
    env: { PI_CODING_AGENT_DIR: "", XDG_CONFIG_HOME: xdg },
  });
  assert.equal(r.code, 0, out(r));
  assert.equal(readJson(join(xdg, "pi", "web-search.json")).workflow, "none");
});
