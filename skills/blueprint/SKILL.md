---
name: blueprint
description: Turn a goal into a comprehensive, decision-free implementation plan. Maps the existing codebase, researches the domain on the web, then interviews you one multiple-choice question at a time until every open decision is resolved, and writes a sharded plan with a dependency graph that build can execute. Use after groundwork, before build.
---

# blueprint

Stage 2 of 4. Produces a plan containing **no decisions for the implementing
engineer**.

Read `shared/preflight.md` from this package root and follow it now. Then read
`shared/asking.md`, `shared/artifacts.md`, and `shared/plan-shard-schema.md`.

If `plan/` already exists, go to **Amend mode** at the end of this file first.

---

## Phase A — orient

### A1. Prior stage

Read `.pi-workflow/tools.md` if present. If absent, say so once and recommend
`/skill:groundwork` — then continue if the user does not object. A missing tools
doc is a handicap, not a blocker.

### A2. Codebase recon (automatic, brownfield only)

If the project root contains source code, delegate:

```
subagent({ agent: "pi-workflow.pw-scout", model: <roles.scout.model>, context: "fresh",
           output: ".pi-workflow/research/codebase.md",
           task: "Map this repository for a change to: <goal>. Cover stack, testing,
                  quality gates, layout, existing patterns in the target area with
                  file:line citations, build and deploy, and anything fragile." })
```

Reuse an existing `codebase.md` if it is newer than the last commit touching the
relevant area. Skip entirely on greenfield.

### A3. Restate

Restate the goal in 3-5 sentences plus the constraints inherited from `tools.md`
and `codebase.md`. This is the last thing the user reads before questions begin —
it must be accurate. If your restatement is wrong, everything after it is wrong.

---

## Phase B — the interview

### B1. Seed the ledger

Populate `state.json.openDecisions` from this checklist, keeping only what is
genuinely undetermined **for this task**:

scope boundaries and non-goals · data model and persistence · auth and
authorization · external integrations · hosting and deploy target · local dev
story · testing strategy · error handling and validation · observability and
logging · migrations and backwards compatibility · UX flows and states ·
performance and scale · cost and quota limits · secrets handling · rollout and
rollback.

Drop anything the codebase already settles. Do not ask what you can read.

### B2. Loop

Repeat until the exit condition in B3:

1. **Pick** the highest-leverage open decision — the one whose answer most
   constrains the others. Architecture before details, always.

2. **Research before asking**, whenever the decision touches a library, service,
   protocol, or third-party API. Quick checks: `web_search` and `fetch_content`
   directly. Anything needing more than about three sources, or real documentation
   reading:

   ```
   subagent({ agent: "pi-workflow.pw-researcher", model: <roles.researcher.model>,
              task: "<the specific question, and the criteria to compare against>" })
   ```

   Save findings with citations to `.pi-workflow/research/<topic>.md`.

   **Options must reflect what is true in 2026, not what you remember.** Version
   numbers, API shapes, limits and pricing are fetched, never recalled.

3. **Ask** via `ask_user_question`, following `shared/asking.md`: one question,
   2-4 options, real tradeoffs, exactly one `(Recommended)` first, `preview`
   whenever the choice is structural. `header` ≤ 16 chars, `label` ≤ 60 chars,
   never author an option labeled "Other".

4. **Record** the answer, `notes`, and any custom text into the ledger entry.
   Notes are authoritative and override the selected option.

5. **Re-derive the ledger. This step is mandatory and is the point of the
   design.** After every answer, re-examine the whole ledger:
   - **add** decisions the answer newly implies
   - **mark moot** decisions the answer eliminates
   - **rephrase** decisions the answer reframes

   Then print one line so scope changes are visible:

   ```
   ledger: 7 resolved · 4 open · +2 new from this answer (rate-limiting, cache-invalidation)
   ```

6. Write `state.json` and repeat.

### B3. Exit condition

**The loop ends only when a full re-derivation pass adds nothing new and no
decision is open.**

Not at a question count. Not when the plan "seems clear enough". Not when the user
seems tired — if that happens, say how many decisions remain and offer to pause;
`state.json` makes the interview resumable.

### B4. Confirm

Present the complete resolved ledger — every decision and its resolution — and ask
for confirmation before writing anything. Any correction reopens the loop.

---

## Phase C — write the plan

### C1. Decompose

```
subagent({ agent: "pi-workflow.pw-planner", model: <roles.planner.model>, context: "fresh",
           reads: [".pi-workflow/research/codebase.md", ".pi-workflow/tools.md"],
           task: "Decompose into work packages. Return ids, depends_on, owns globs,
                  and one-line summaries only - do not write shard bodies yet.
                  Goal: <goal>. Resolved decisions: <full ledger>." })
```

### C2. Validate the graph before writing bodies

- `depends_on` is acyclic and every id exists
- ids unique and match filenames
- **`owns` globs disjoint within each wave** — this is what makes parallelism safe
- every acceptance criterion is objectively checkable
- no package exceeds ~400 lines of expected diff

Fix violations by splitting or reordering. Do not proceed with a broken graph.

### C3. Mandatory packages

Every plan includes these unless the ledger explicitly rules them out:

- **local-dev** — one documented command to run the thing, seed data,
  `.env.example`, and a smoke check (curl for APIs, Playwright for UI)
- **testing setup** — if the repo has no test harness
- **CI** — if the repo has no CI
- **production path** — Dockerfile / render.yaml / IaC / deploy workflow, written
  and statically validated, **never executed**
- **manual steps** — anything the user must do personally (DNS, provisioning,
  secrets, app registrations, licensing), each as its own `manual: true` shard

**Split anything that talks to a third party.** Scraping, crawling, bulk API
imports, migrations over real data: writing the code is bounded, running it is not.
One package writes the code and unit-tests it against **recorded fixtures**,
offline and deterministic. A **separate** package does the live run, with
`network: true` and either a `timeout_min` sized to the real job or `manual: true`.

A 200-line scraper that inherits the default 25-minute budget will be killed
mid-crawl, and the retry starts from a fresh context — re-writing the scraper
before it can re-run it. See "Runtime" in `shared/plan-shard-schema.md`.

### C4. Write the bodies

Fan out, one task per shard, all at once:

```
subagent({ tasks: [ { agent: "pi-workflow.pw-planner", model: <roles.planner.model>,
                      task: "Write shard <id> per shared/plan-shard-schema.md. <spec>" },
                    ... ],
           concurrency: <number of shards> })
```

Set `concurrency` explicitly — pi-subagents defaults it to 4.

Then write `plan/00-overview.md` from `templates/plan-overview.md.tmpl`: goal,
architecture, the **full decisions ledger**, conventions quoted from
`codebase.md` with citations, the environment commands, the package table, and the
wave ordering.

### C5. Self-review

```
subagent({ agent: "pi-workflow.pw-reviewer", model: <roles.reviewer.model>, context: "fresh",
           task: "Review .pi-workflow/plan/ against the decisions ledger. Report:
                  decisions left open, contradictions, missing dependencies,
                  unverifiable acceptance criteria, overlapping owns globs within a
                  wave, packages too large to implement in one context window." })
```

Fix everything it finds. Re-run until clean.

### C6. Close

Update `state.json`. Print the package count and wave plan, then:

```
Next: clear context, then /skill:build
```

---

## Amend mode

If `plan/` already exists, ask which:

- **resume** — the ledger still has open items; continue the interview
- **amend** — a new goal on top of an existing plan. Add packages with **new ids**,
  `depends_on` referencing completed ones. **Never renumber existing shards** —
  build's `state.json` keys off those ids.
- **restart** — archive to `plan.archived-<timestamp>/` first. Never delete.

---

## Hard rules

- Never write a plan while a decision is open.
- Never put "the engineer should decide", "consider", "TBD", or an unresolved
  either/or into a shard.
- Never state a library version, API signature, or price without having fetched it.
- Never ask what is already in `codebase.md`, `tools.md`, or the ledger.
- Never skip the re-derivation pass in B2.5.
- Never let a package's acceptance criteria depend on a third party without
  `network: true` and a `timeout_min` that reflects the real job. A gate as flaky
  as someone else's uptime is a gate everyone learns to ignore.
