# Plan shard schema

The contract between `blueprint` (writes) and `build` (executes). A shard is one
work package: a unit of work a single subagent can complete in one context window,
starting from nothing but this file and `00-overview.md`.

## Frontmatter

```yaml
---
id: 03-auth-endpoints          # NN-slug. Matches the filename. Unique. Never renumbered.
depends_on: [01-db-schema]     # ids only. Must form a DAG. [] for roots.
owns:                          # glob paths this package may create or modify
  - src/api/auth/**
  - tests/api/auth/**
acceptance:                    # objectively checkable. A command or an observable fact.
  - "POST /login returns 200 and sets an httpOnly session cookie"
  - "pnpm test tests/api/auth passes"
manual: false                  # true => the user must do it; build stops and hands over
---
```

## Body

All five sections are required, in this order.

### Goal
One paragraph. What exists when this package is done, in the past tense.

### Context
Everything a fresh agent needs that is not in `00-overview.md`:
- the exact libraries and versions decided in the interview
- existing conventions this code must match, cited as `file.ts:42` from
  `research/codebase.md` — quoted, not summarised
- the shape of adjacent code it will call or be called by
- environment variables, config keys, secrets it needs (names, never values)

### Steps
Numbered and concrete. Name the files, functions, routes, types, and env vars.
An implementer should never have to choose between two reasonable options.

### Tests
What to write, where it goes, and the exact command that runs it.

### Out of scope
What this package must **not** touch, especially anything owned by a sibling
package in the same wave.

## Invariants

`blueprint` enforces these before writing; `build` re-checks before executing;
`scripts/validate.mjs` checks any shard it can find.

1. **`owns` globs are disjoint across packages in the same wave.** Two agents
   editing the same file concurrently is the failure mode sharding exists to
   prevent. Overlap between different waves is fine — they are ordered.
2. **`depends_on` is acyclic**, and every id it names exists.
3. **No open questions.** No "decide whether", no "TBD", no "consider", no
   either/or left to the implementer. If blueprint cannot resolve something, it is
   an open decision and the interview is not finished.
4. **Every acceptance criterion is checkable** by running a command or observing a
   specific, named behaviour. "Code is clean" is not a criterion.
5. **Size:** roughly 100-400 lines of resulting diff. A package that cannot be
   described in one shard is two packages.
6. **`manual: true` packages have no `owns`** and their acceptance criteria
   describe what the user will have done, plus how build verifies it afterwards.
