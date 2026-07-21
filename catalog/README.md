# Tool catalog

`tools.yaml` is the curated inventory `/skill:groundwork` probes before a task.
It exists so groundwork does not re-research `az` and `docker` on every project.
Anything not in the catalog is still handled — groundwork delegates to a
researcher subagent for niche or unfamiliar tooling — but catalog hits are fast,
deterministic, and reflect decisions you have already made.

## Entry schema

```yaml
- id: <stable-slug>          # required, unique
  name: <human name>         # required
  kind: cli | mcp | runtime | service
  detect: <shell command>    # required; exit 0 means present. Cheap, non-interactive.
  install: <shell command>   # required; MANUAL if there is no scriptable install
  install_notes: <string>    # optional; PATH additions, post-install steps, caveats
  sudo: true | false         # required; true => groundwork prints it, never runs it
  scope: global | project    # required
  auth: <command>            # optional; the interactive login. Never run by an agent.
  auth_check: <command>      # optional; cheap non-interactive credential check
  domains: [<slug>, ...]     # required; matched against the task's domain
```

## Rules

- **`detect` must be cheap and non-interactive.** No prompts, no browser, no
  network round-trip that can hang. Prefer `--version`. Where a CLI can exist
  without working (Docker), detect the working state (`docker info`).
- **If `install` contains `sudo`, `sudo: true`.** This is enforced by
  `scripts/validate.mjs`. groundwork never executes a sudo command; it prints it
  for you to run in another terminal and then re-probes.
- **`auth` is never run by an agent.** Logins are interactive by nature. They are
  surfaced as outstanding manual steps in `tools.md`.
- **`scope: global`** for anything reusable across projects — common dev tooling
  and your standing hosting/infra stack. **`scope: project`** for niche or
  project-specific tooling. groundwork asks when the catalog does not classify.
- Use `install: MANUAL` rather than guessing a command. A wrong install command is
  worse than no entry: groundwork will run a non-sudo one.

## Adding a tool

Add the entry, then verify honestly:

```sh
# detect must exit non-zero when absent and zero when present
sh -c '<detect>' ; echo "exit=$?"
node scripts/validate.mjs
```

Pick `domains` values that match how you would describe a task ("azure",
"power-apps", "e2e"), not how the vendor markets the tool. `any` means the tool is
a candidate for every task.
