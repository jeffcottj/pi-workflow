# pi-workflow

A four-stage development workflow for the [pi coding agent](https://pi.dev),
packaged so it can be recreated on any device with one command.

| Stage | Skill | Produces |
|---|---|---|
| 1 | `/skill:groundwork` | `tools.md` — every CLI and MCP server the task needs, installed or consciously declined |
| 2 | `/skill:blueprint` | `plan/` — a sharded, decision-free implementation plan |
| 3 | `/skill:build` | working, tested, locally-verified code and local commits |
| 4 | `/skill:yeet` | a safe commit pushed to `main` |

The premise: an LLM will happily produce code that compiles and is nonetheless not
what you wanted. The fix is to spend the decisions up front, with a human, and to
hand the implementer a plan that leaves nothing open.

## Install

```sh
pi install git:github.com/jeffcottj/pi-workflow
```

pi does not install pi packages transitively, so run the bootstrap once to add the
companion packages the skills call:

```sh
bash "$(pi list | grep -A1 pi-workflow | tail -1 | xargs)"/scripts/bootstrap.sh
```

`pi list` prints each installed package's resolved path — use it if the one-liner
does not match your layout. For a git install that is normally
`~/.pi/agent/git/github.com/jeffcottj/pi-workflow`.

Restart pi. The four skills appear as `/skill:groundwork`, `/skill:blueprint`,
`/skill:build`, `/skill:yeet`.

Private repo instead: `pi install git:git@github.com:jeffcottj/pi-workflow`.
To update: `pi update git:github.com/jeffcottj/pi-workflow`.

### Requirements

- pi ≥ 0.81, Node ≥ 20
- an authenticated provider (`pi --list-models` shows something)
- companions, installed by bootstrap: `pi-subagents`,
  `@juicesharp/rpiv-ask-user-question`, `pi-web-access`

## Usage

```sh
pi
> /skill:groundwork add SSO to the admin portal using Entra ID
```

groundwork works out what tooling the job needs, probes the machine, installs what
it safely can, and hands you anything requiring `sudo` or an interactive login. It
keeps looping until nothing is in an unknown state, then writes
`.pi-workflow/tools.md`.

Clear context, then:

```sh
> /skill:blueprint add SSO to the admin portal using Entra ID
```

blueprint maps your codebase, researches the domain on the web, and interviews you
**one question at a time** with selectable options, explanations, and a
recommendation. Every answer re-derives the open-decisions ledger, so answering one
question can raise two more — the interview ends when a full pass adds nothing new,
not at a fixed question count. Then it writes a sharded plan.

Clear context, then:

```sh
> /skill:build
```

build runs each dependency wave as parallel subagents, gates every package on
tests, typecheck, lint and a reviewer running on a **different model**, and commits
each package locally. It brings the app up and smoke-tests it. It never deploys —
it hands you the command.

```sh
> /skill:yeet
```

## Configuration

### `config/models.json`

Roles map to the `pw-*` agents. `scripts/apply-models.mjs` writes these into
`subagents.agentOverrides` in `~/.pi/agent/settings.json`.

| Role | Default | Why |
|---|---|---|
| `scout` | `deepseek-v4-flash` | Codebase mapping and tool probing are recall tasks |
| `researcher` | `deepseek-v4-pro` | Synthesis across many fetched pages |
| `planner` | `kimi-k3` | 1M context holds interview, research and plan at once |
| `worker` | `kimi-k2.7-code` | Code-specialised, 262K max output |
| `reviewer` | `glm-5.2` | A different family from `worker`, so review is a real second opinion |
| `scribe` | `mimo-v2.5` | Docs do not need a frontier model |
| `oracle` | `qwen3.7-max` | Escalation when worker and reviewer disagree twice |

Defaults target the `opencode-go` catalog. Edit for your provider and re-run
`node scripts/apply-models.mjs`; unknown model ids are skipped with a warning
rather than written. `reviewer` sharing a model with `worker` is a validation
error, not a preference.

### `~/.pi/web-search.json`

Not part of this repo — it belongs to `pi-web-access` — but bootstrap sets
`workflow: "none"` there on a fresh machine, so `web_search` returns raw results
instead of opening the browser curator.

The reasoning: research that feeds a plan runs in `pw-researcher` subagents, and
those resolve to `none` regardless of this setting because they have no UI. Curating
only top-level searches would give your interactive searches different treatment
from the ones actually shaping plans. `auto-summary` is worse for this workflow
still — it puts a second model between the search and a researcher whose whole
contract is to cite only what it fetched.

Bootstrap only fills the key in when it is absent, so a later `/curator on` sticks.

### `config/limits.json`

Runaway detection only — **no parallelism cap and no hard budget kill.** Every
package whose dependencies are satisfied launches immediately. What is enforced:

- `packageTimeoutMin` — a subagent past this is stuck, not thorough. Killed, logged,
  retried once.
- `turnBudget` / `toolBudget` / `control` — pi-subagents' native loop guards.
- `softBudgetUsd` — on crossing, build finishes the in-flight wave and **asks**:
  continue, raise, or stop. It never aborts mid-package.

### `catalog/tools.yaml`

The curated inventory groundwork probes, so it does not re-research `az` and
`docker` on every project. Adding a tool: see `catalog/README.md`. Anything not in
the catalog still gets handled — groundwork researches it on the web.

Entries carry per-distro install commands (`install_debian`, `install_fedora`,
`install_arch`). groundwork detects the machine's family first and resolves
against it, and **never offers a command for a package manager the machine does
not have** — it researches the right one instead. `validate.mjs` fails any entry
whose install is bound to one family without commands for the others.

## Artifacts

Everything lands in one gitignored directory at the project root:

```
.pi-workflow/
├── state.json      # stage and package status; makes every skill resumable
├── tools.md
├── plan/           # 00-overview.md + one shard per work package
├── research/       # codebase map, cited web findings
└── log/            # wave summaries, subagent transcripts
```

This is deliberate: plans are visible next to the code, easy to copy to another
machine, and covered by one `.gitignore` line. **They are never committed** —
`yeet` enforces it. Move them between devices yourself.

## Design notes

**Skills, not TypeScript.** The repo ships markdown. Delegation, structured
questions and web access come from published packages that already do those jobs
well. Nothing here breaks when pi's extension API changes.

**pi-only, on purpose.** The skills call `ask_user_question` and `subagent`
directly. A harness-neutral version would degrade to printing questions as text,
which is the experience this exists to replace. The artifacts are plain markdown,
so a plan written here is readable anywhere.

**Purpose-built agents.** `agents/pw-*.md` are real agent definitions with their
own tool sets and system prompts, not prose instructions to a generic worker.
`pw-scout`, `pw-researcher` and `pw-reviewer` have **no write tools at all** — a
reviewer that cannot edit cannot quietly fix what it was supposed to report.

**Nothing reaches infrastructure by accident.** `build` never deploys and never
creates cloud resources. `pw-worker` cannot push. `yeet` is the only thing that
talks to a remote, and it refuses on any secret-scan hit with no override.

## Development

```sh
node scripts/validate.mjs        # frontmatter, routing, catalog, references, secrets
node scripts/apply-models.mjs --dry-run
```

Conventions for editing this repo are in `AGENTS.md`.

## License

MIT
