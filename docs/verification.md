# Verification record

What was actually run against pi 0.81.1 / pi-subagents 0.35.1 /
`@juicesharp/rpiv-ask-user-question` 2.0.0 on Ubuntu 24.04, 2026-07-21.

Nothing below is asserted from reading code. Each line was executed.

## Passed

| Check | Result |
|---|---|
| `node scripts/validate.mjs` | valid — 4 skills, 6 agents, 21 catalog entries, 8 cross-references |
| Package registers with pi | `pi install ./` → all four skills appear in the skill list |
| Agents register | all six appear as `pi-workflow.pw-*` |
| Real delegation | `subagent({ agent: "pi-workflow.pw-scout", ... })` ran, read a file, returned contents, wrote nothing |
| `apply-models.mjs --dry-run` | 13 overrides rendered, no write |
| `apply-models.mjs` | wrote 13 overrides; backup created; `theme`, `defaultModel`, `defaultProvider`, `packages` all preserved |
| README bootstrap one-liner | resolves to the package root and finds `scripts/bootstrap.sh` |
| `bash -n scripts/bootstrap.sh` | syntax clean |

## Seeded faults — all caught

Each mutation was applied to a throwaway copy; `validate.mjs` exited non-zero with
the message shown.

| Fault | Message |
|---|---|
| `roles.reviewer` = `roles.worker` | reviewer must differ from worker: same model is not a second opinion |
| `sudo: false` + sudo in install | declares sudo: false but its install command uses sudo |
| Hardcoded model id in a skill | skills and agents must read config/models.json |
| Reference to a nonexistent shared file | references a path that does not exist |
| Write tool added to `pw-reviewer` | read-only agent but declares edit/write in tools |
| `AKIA…` key committed | possible AWS access key id committed |
| Skill frontmatter name mismatch | name must match directory |
| `pi-subagents.agents` removed from manifest | must be `["./agents"]` or the pw- agents will not load |
| npm dependency added | no npm dependencies allowed |
| Bare `agent: "pw-worker"` | must be namespaced or it will not resolve |

## Bug found and fixed during verification

**Package agents resolve only under their namespaced name.** Every skill
originally called `agent: "pw-worker"`. That fails at runtime:

```
Unknown agent: pw-scout
```

pi-subagents registers a package agent as `<package>.<name>` and does **not** alias
the bare form, despite the frontmatter doc implying `name:` is preserved. All
skills now use `pi-workflow.pw-*`, verified working, and `validate.mjs` rejects the
bare form so it cannot regress.

`apply-models.mjs` writes overrides under **both** keys, so routing lands whichever
form a future pi-subagents accepts.

## Not yet verified — needs an interactive session

These cannot run through `pi -p`; they need the TUI.

- [ ] `ask_user_question` dialog rendering: previews, per-option notes,
      multi-select, the "Type something." row
- [ ] A full `/skill:groundwork` run: probe → consent → install → re-probe loop →
      `tools.md`
- [ ] A full `/skill:blueprint` interview, including that the ledger **grows** when
      an answer implies new decisions
- [ ] A `/skill:build` run with a real parallel wave, reviewer gate and per-package
      commits
- [ ] `/skill:yeet` refusing on a seeded `AKIA…` in a staged file
- [ ] `/subagents` listing the six `pw-*` agents with source `package`, and each
      one's model matching `config/models.json`, after a pi restart.
      `/subagents-models` is builtin-only — it will only ever show the `oracle`
      override, never the `pw-*` routing.

Suggested first real run, small enough to inspect end to end:

> a Node HTTP service with a `/healthz` endpoint, dockerized, deployable to Render,
> with tests and CI
