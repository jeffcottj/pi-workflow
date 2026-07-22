# Verification record

What was actually run against pi 0.81.1 / pi-subagents 0.35.1 /
`@juicesharp/rpiv-ask-user-question` 2.0.0 on Ubuntu 24.04, 2026-07-21.

Nothing below is asserted from reading code. Each line was executed.

Two sources, kept separate on purpose: checks run directly against the repo, and
what a live session on Fedora 44 established. The live-run section is the author's
report of a session in another terminal — real evidence, but not re-executed here,
so it is labelled as such rather than folded into the tables above.

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
| `npm test` | 60 pass, 0 fail — `validate.mjs` (repo and `--shards`), `apply-models.mjs`, `suggest-models.mjs`, `doctor.mjs`, `apply-web-search.mjs` against faked machines |
| `doctor.mjs` on this machine | 0 failures, 0 warnings, 11 ok |

## Seeded faults — all caught

**These are now automated.** Every row below is a test in `test/validate.test.mjs`,
run by `npm test` against a throwaway copy of the repo. The table is kept as the
readable index of what is guarded; the tests are what proves it still fires.

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
| `install_fedora` removed from a debian-family entry | install targets the debian family but has no install_fedora |
| `install_suse:` key added | unknown platform key — supported families are debian, fedora, arch |
| `sudo: false` + sudo in `install_fedora` | declares sudo: false but install_fedora uses sudo |

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

## Bug found in use — Fedora, 2026-07-21

**The catalog was Ubuntu-only and nothing checked it.** A `/skill:groundwork` run
on Fedora 44 offered `sudo apt install …`; the machine has `dnf`/`dnf5` and no
`apt` or `snap` at all. Five entries were affected — `gh`, `az`, `pwsh`, `jq`,
`ripgrep` — plus `playwright-deps`, whose `playwright install-deps` supports only
Debian and Ubuntu. `skills/groundwork/SKILL.md` also hardcoded *"the exact install
command for Ubuntu 24.04"* into the researcher prompt, so the non-catalog path
returned Ubuntu commands too.

Fixed by detecting the platform before any command is selected, per-family
`install_<family>` keys, and a validator rule that fails a family-bound entry
missing its siblings. Per-family commands were taken from each vendor's own
install page — GitHub CLI `docs/install_linux.md`, Microsoft Learn for `az` and
PowerShell — not translated from the Debian ones.

## Live run — Fedora 44, 2026-07-21

First use of the workflow on a real sample project, in an interactive session.
Reported by the author rather than re-executed here.

**Package version under test: `5f66219`** — the initial commit, so *before* the
platform fix above and before the `/subagents-models` doc correction. A git-installed
package does not track the remote until `pi update`, so this run exercised the
Ubuntu-only catalog. That is how the bug was found.

| Stage | What it establishes |
|---|---|
| `/skill:groundwork` | Ran to the consent step and beyond; surfaced the `apt`-on-Fedora defect. `ask_user_question` therefore rendered against a real dialog. Completed far enough that blueprint could follow. |
| `/skill:blueprint` | Completed and produced a plan — build reads `plan/`, and build started, so the shards exist and are readable. |
| `/skill:build` | **In flight at time of writing. Outcome unrecorded.** |
| `/subagents` | Lists all six `pw-*` agents with source `package`, after a pi restart. Their models were *not* compared against `config/models.json`. |

Still open from this run, and not to be inferred from it:

- The groundwork re-probe loop and its `tools.md` output were not inspected.
- Whether the blueprint ledger **grows** when an answer implies new decisions —
  a plan existing does not show the interview looped rather than ran once.
- Everything about build: parallel waves, the reviewer gate on a different model,
  per-package commits, the soft-budget prompt.

## Bug found in use — build timeout, 2026-07-21

**A scraping package was killed at 25 minutes having written the scrapers but not
run them.** The timeout fired as configured; the design around it was wrong in
three ways.

1. `config/limits.json` calls the timeout "runaway detection… not to ration work",
   and build repeated it. Nothing distinguished a **stuck** agent from one whose
   job was simply larger than the budget. This agent had made real progress.
2. The timeout path retried blind — no findings handed over, and `context: "fresh"`
   means the retry re-does the writing before it can reach the running. With
   `maxRetriesPerPackage: 2` that is up to 75 minutes to reach the same wall. The
   *test-failure* path had always been smarter, passing findings to attempt 2.
3. The root cause was upstream: shard invariant 5 sizes a package by its **diff**,
   which measures writing, not running. A 200-line scraper is unbounded at runtime
   because rate limits, pagination and third-party uptime are not the plan's to
   control.

Fixed: build's Phase C now separates timeout from failure — establish what survived
in the working tree, report it concretely, judge stuck vs undersized, and for
undersized **ask** (split / raise `timeout_min` / manual / skip) rather than retry.
Shards gained `network` and `timeout_min`; blueprint must split write-from-run for
third-party work; `validate.mjs --shards` enforces it.

Also found while fixing: `shared/plan-shard-schema.md` claimed
`scripts/validate.mjs` checked shards. It never had — plans live in the gitignored
`.pi-workflow/`, outside the repo the validator walks. `--shards <dir>` makes the
claim true rather than deleting it.

## Not yet verified — needs an interactive session

These cannot run through `pi -p`; they need the TUI.

- [x] `ask_user_question` dialog rendering — exercised by the groundwork run above.
      Previews, per-option notes and multi-select were not individually confirmed.
- [ ] A full `/skill:groundwork` run: probe → consent → install → re-probe loop →
      `tools.md` — reached consent, back half unverified
- [ ] `/skill:groundwork` on a non-Debian machine offering only commands for that
      machine's package manager, and researching rather than guessing where the
      catalog has no entry for the family — **needs a run on `e322b92` or later**
- [ ] A full `/skill:blueprint` interview, including that the ledger **grows** when
      an answer implies new decisions — a plan was produced; the looping was not
      observed
- [ ] A `/skill:build` run with a real parallel wave, reviewer gate and per-package
      commits — one run in flight, result pending
- [ ] `/skill:yeet` refusing on a seeded `AKIA…` in a staged file
- [x] `/subagents` listing the six `pw-*` agents with source `package`, after a pi
      restart. Models not yet checked against `config/models.json`.
      `/subagents-models` is builtin-only — it will only ever show the `oracle`
      override, never the `pw-*` routing.

Suggested first real run, small enough to inspect end to end:

> a Node HTTP service with a `/healthz` endpoint, dockerized, deployable to Render,
> with tests and CI
