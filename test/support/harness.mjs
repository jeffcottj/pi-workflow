// Test harness. Zero dependencies, same rule as scripts/.
//
// The scripts under test are CLIs that read the real machine: `pi --list-models`,
// ~/.pi/agent/settings.json, the repo they sit in. Testing them means running them
// as subprocesses against a fake machine, not importing them - which is also
// exactly how they fail in the wild.

import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const temps = [];

/** A throwaway directory, removed when the process exits. */
export function tmp(prefix = "piwf-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

process.on("exit", () => {
  for (const dir of temps) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

/**
 * A copy of the repo that tests may mutate freely. Excludes .git and node_modules
 * so the copy is cheap and cannot corrupt the working tree.
 */
export function repoCopy() {
  const dir = tmp("piwf-repo-");
  cpSync(REPO, dir, {
    recursive: true,
    filter: (src) => !src.includes("/.git/") && !src.endsWith("/.git") && !src.includes("node_modules"),
  });
  return dir;
}

/**
 * A fake `pi` on PATH. `models` is a list of "provider/model" strings; an empty
 * list makes `pi --list-models` return only its header, which is how a machine
 * with no authenticated provider behaves.
 */
export function fakePi(models, { version = "0.81.1" } = {}) {
  const dir = tmp("piwf-bin-");
  const lines = models.map((m) => {
    const [provider, ...rest] = m.split("/");
    return `echo "${provider} ${rest.join("/")}"`;
  });
  writeFileSync(
    join(dir, "pi"),
    `#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "${version}"; exit 0; }
[ "$1" = "--list-models" ] && { echo "PROVIDER MODEL"; ${lines.join("; ")}; exit 0; }
exit 0
`,
    { mode: 0o755 },
  );
  return dir;
}

/**
 * A PATH with no `pi` on it. Must replace PATH wholesale - prepending an empty
 * directory leaves the real binary reachable further down, which silently turns
 * a "pi is missing" test into a "pi is present" one.
 */
export const PATH_WITHOUT_PI = "/nonexistent-for-tests";

/** Write a pi agent settings.json under a fake PI_CODING_AGENT_DIR. */
export function fakeAgentDir(settings = {}, webSearch = null) {
  const dir = tmp("piwf-agent-");
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "agent", "settings.json"), JSON.stringify(settings, null, 2));
  if (webSearch !== null) writeFileSync(join(dir, "web-search.json"), JSON.stringify(webSearch, null, 2));
  return dir;
}

/**
 * Run a script. Never throws on a non-zero exit - the exit code is usually the
 * thing under test - so every caller must assert on `code` explicitly.
 */
export function run(script, args = [], { cwd = REPO, env = {}, binDir = null } = {}) {
  const path = binDir ? `${binDir}:${process.env.PATH}` : process.env.PATH;
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, PATH: path, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

/** Combined output, for assertions that do not care which stream carried it. */
export const out = (r) => `${r.stdout}${r.stderr}`;

export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const exists = existsSync;

/** Replace the first occurrence of `find` (string or regex) in a file. Throws if absent. */
export function patch(file, find, replace) {
  const text = readFileSync(file, "utf8");
  const hit = typeof find === "string" ? text.includes(find) : find.test(text);
  if (!hit) throw new Error(`patch target not found in ${file}: ${find}`);
  writeFileSync(file, text.replace(find, replace));
}

/**
 * Secret-shaped fixtures, assembled at runtime.
 *
 * A literal AWS key or PEM header in a test file is a real hit: validate.mjs walks
 * the whole repo, test/ included, and it is right to. Splitting the literals keeps
 * the fixtures effective without putting a permanent finding in the tree - and
 * keeps test/ inside the scan rather than carving out a blind spot.
 */
export const fixtures = {
  awsKey: () => `AKIA${"IOSFODNN7EXAMPLE"}`,
  pemHeader: () => `-----BEGIN RSA PRIVATE${" KEY-----"}`,
};
