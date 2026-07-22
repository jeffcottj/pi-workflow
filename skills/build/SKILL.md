---
name: build
description: Implement a blueprint plan. Reads the sharded plan, orders work packages by their dependency graph, runs each wave as parallel subagents, gates every package on tests plus a reviewer subagent on a different model, commits each completed package locally, and verifies the app actually runs. Stops for decision points and manual steps. Use after blueprint, in a fresh context.
---

# build

Stage 3 of 4. Executes the plan. Keeps going unless genuinely blocked.

Read `shared/preflight.md` from this package root and follow it now. Then read
`shared/artifacts.md` and `shared/plan-shard-schema.md`.

---

## Phase A — load and verify

### A1. Read the plan, not the shards

Read `plan/00-overview.md` in full. Read only the **frontmatter and Goal line** of
each shard.

**Do not read shard bodies into your context.** Bodies go to workers. You hold the
overview, the graph, and the status — that is what lets a 20-package plan finish
without exhausting your context window.

### A2. Validate

Check: acyclic `depends_on`, all referenced ids exist, `owns` disjoint within each
wave, acceptance criteria non-empty.

A malformed plan is blueprint's defect. **Report it and STOP.** Do not repair the
plan and do not work around it.

### A3. Working tree

If dirty, show the diff summary and ask: commit first via `/skill:yeet`, stash, or
proceed anyway.

If you intend to use `worktree: true` for parallel isolation, the tree **must** be
clean — pi-subagents requires it.

### A4. Resume

Read `state.json.packages`. Announce what is already complete and start at the
first incomplete package. **Never redo a `complete` package.**

---

## Phase B — wave execution

### B1. Build the wave

A wave is every package whose dependencies are all `complete`.

### B2. Launch

One `pi-workflow.pw-worker` per package, all at once:

```
subagent({
  tasks: [ { agent: "pi-workflow.pw-worker", model: <roles.worker.model>,
             task: "Implement work package <id>. Read .pi-workflow/plan/00-overview.md
                    and .pi-workflow/plan/<id>.md in full first. You may only create or
                    modify files matching that package's `owns` globs. Verify every
                    acceptance criterion by running it before reporting done." },
           ... ],
  concurrency: <wave size>,
  context: "fresh",
  timeoutMs: <limits.packageTimeoutMin * 60000>,
  turnBudget: <limits.turnBudget>,
  toolBudget: <limits.toolBudget>,
  control: <limits.control>
})
```

**Set `concurrency` to the wave size.** pi-subagents defaults it to 4, which would
silently cap a workflow configured for no cap (`limits.maxParallel: 0`). If
`maxParallel` is a positive integer, use that instead.

`context: "fresh"` is deliberate — shard self-containment is the whole design.

### B3. Gate each package

The **orchestrator** verifies, never the worker's self-report:

1. **Scope** — files changed are inside `owns`. A violation fails the package.
2. **Typecheck** and **lint** repo-wide, using the commands from the overview.
3. **Tests** for this package, plus the full suite if it is fast.
4. **Review:**

   ```
   subagent({ agent: "pi-workflow.pw-reviewer", model: <roles.reviewer.model>, context: "fresh",
              task: "Review the diff for work package <id> against its acceptance
                     criteria in .pi-workflow/plan/<id>.md. Diff: <git diff>." })
   ```

   `reviewer` must not **resolve** to the same model as `worker` — checked after
   fallback, not in the config file. Preflight has already established this; if it
   reported a collapse, you stopped there and are not reading this line.

**On failure:** send the specific findings to a fresh `pi-workflow.pw-worker` (attempt 2). On a
second failure, escalate once:

```
subagent({ agent: "oracle", model: <roles.oracle.model>,
           task: "Worker and reviewer disagree twice on package <id>. Diagnose the
                  real problem. Findings: <...>. Do not edit anything." })
```

Then mark `blocked`, continue with packages that do not depend on it, and stop to
report at the end of the wave.

### B4. Commit on pass

`git add` **only** the package's files, then:

```
feat(auth): session cookie endpoints [03-auth-endpoints]
```

Record the SHA in `state.json`. **Never `git push`** — that is yeet's job, and the
user's decision.

### B5. Manual packages

For `manual: true`: stop, print exactly what the user must do and how you will
verify it, and wait. Re-verify before continuing.

### B6. Wave summary

To stdout and `.pi-workflow/log/build-<iso8601>.md`: packages, files changed, test
counts, reviewer verdicts, elapsed, reported cost, and every timeout.

Then **continue to the next wave**. There is no approval gate between waves.

---

## Phase C — runaway detection

Per `config/limits.json`. These catch stuck agents; they do not ration work.

- A subagent exceeding `timeoutMs` is killed, logged as a timeout, retried within
  `maxRetriesPerPackage`. **Always report timeouts** in the wave summary.
- `turnBudget`, `toolBudget` and `control.*` are pi-subagents' native loop guards.
  Pass them on every launch.
- When cumulative reported cost crosses `softBudgetUsd`, finish the in-flight wave,
  then ask: continue / raise the budget / stop. **Never abort mid-package.**
- If pi-subagents reports no usage data, say so once and treat the soft budget as
  disabled. Never estimate cost.

---

## Phase D — local verification

The point of this stage: the user can inspect and validate without deploying.

1. Start the app with the local-dev command from the overview. Seed data.
2. **Smoke test for real:**
   - APIs — `curl` the health endpoint and the primary endpoints; assert status and
     shape
   - UI — drive the primary flow named in the plan with headless Playwright or
     chrome-devtools
   Capture results and screenshots to `.pi-workflow/log/`.
3. **Validate the production path statically** — Dockerfile builds, `render.yaml` /
   Bicep / CDK / Terraform passes its own validate or plan command, CI workflow
   lints.
4. **Never run a deploy.** Print the exact command and mark it a manual step:

   ```
   MANUAL: deploy when you are ready
     render deploys create srv-xxxx --wait
   ```

5. Tear down everything you started — containers, dev servers, browsers. Leave no
   orphans.

---

## Phase E — close

Final report: packages complete / blocked / skipped, commits made, tests passing,
smoke results, outstanding manual steps, total cost. Update `state.json`.

```
Next: /skill:yeet
```

---

## Stop conditions

Stop and ask **only** when:

- a decision was left open, or reality contradicts a decision in the plan
- a `manual: true` package is reached
- a package is blocked after retries and oracle
- the working tree is unexpectedly dirty
- the soft budget is crossed
- a deploy, or any irreversible or outward-facing action, would be required

Otherwise keep going.

## Hard rules

- Never `git push`. Never deploy. Never create cloud resources.
- Never let a worker edit outside its package's `owns` globs.
- Never mark a package complete on a subagent's say-so — verify it yourself.
- Never let reviewer and worker share a *resolved* model. A config that passes
  `validate.mjs` still collapses onto one model when neither is in this machine's
  catalog and both fall back to the session model. Stop; do not review anyway.
- Never modify the plan to match the code. If the plan is wrong, stop and say so.
- Never weaken or skip a test to make a package pass.
