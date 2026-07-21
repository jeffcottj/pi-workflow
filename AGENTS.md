# Conventions for agents editing this repo

This repo is a pi package. Its product is **markdown that instructs models**, not
documentation for humans. Optimise for an agent following it literally.

## Writing skills and agents

- Imperative, numbered procedure. No hedging, no "consider", no "you might".
- State STOP conditions explicitly: what must halt, and what to say when it does.
- Prefer a hard rule over a soft preference. If something must never happen, write
  "Never X" as its own line, not as a clause.
- Keep skill bodies short enough to sit in context comfortably. Shared procedure
  belongs in `shared/*.md`, referenced by relative path — never copy-pasted.
- Every `SKILL.md` `description` must say **what it does and when to use it**.
  That string is all the model sees at startup when deciding whether to invoke.

## Hard rules

- **No npm dependencies.** `scripts/*.mjs` must run on stock Node with zero
  installs. `pi install` runs `npm install` on fresh machines; every dependency is
  a new way for that to fail.
- **Never hardcode a model ID in a skill or agent file.** Routing lives in
  `config/models.json` and is applied via `scripts/apply-models.mjs`. The only
  files that may name a model are `config/models.json`, `README.md`, and comments.
- Model IDs must exist in the authenticated provider's catalog (`pi --list-models`).
- `roles.reviewer` must never resolve to the same model as `roles.worker`. A
  reviewer that shares a model with the implementer is not a second opinion.
- Never commit `.pi-workflow/`.
- Run `node scripts/validate.mjs` before committing.

## Structure

| Path | Purpose |
|---|---|
| `skills/` | The four user-facing skills. Declared in `package.json` `pi.skills`. |
| `agents/` | Purpose-built subagents. Declared in `package.json` `pi-subagents.agents`. |
| `shared/` | Procedure common to several skills. Referenced, not duplicated. |
| `config/` | `models.json` (role routing) and `limits.json` (runaway detection). |
| `catalog/` | `tools.yaml` — the curated tool/MCP inventory groundwork probes. |
| `templates/` | Skeletons for generated artifacts. |
| `scripts/` | `bootstrap.sh`, `apply-models.mjs`, `validate.mjs`. |

## Companion packages

The skills depend on `pi-subagents`, `@juicesharp/rpiv-ask-user-question`, and
`pi-web-access`. pi does **not** install pi packages transitively, so these are
installed by `scripts/bootstrap.sh` and verified by each skill's preflight.
Their confirmed APIs are documented in the repo README; do not guess at schemas —
read `~/.pi/agent/npm/node_modules/<pkg>/README.md`.
