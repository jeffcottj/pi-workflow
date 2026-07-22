---
name: groundwork
description: Prepare tooling before planning or building. Given a task description, works out which CLIs, MCP servers and dev tools the work will need, checks what is already installed, installs what it safely can, hands sudo and login steps to the user, and writes an available-tools document. Use at the start of any new project or feature request, before blueprint.
---

# groundwork

Stage 1 of 4. Ends when every recommended tool is installed, declined, or
explicitly blocked — and never before.

Read `shared/preflight.md` from this package root (the parent of `skills/`) and
follow it now. Then read `shared/asking.md` and `shared/artifacts.md`.

## 1. Understand the task

Take the task description from the invocation. If it is shorter than a sentence or
the domain is genuinely ambiguous, ask **one** `ask_user_question` to pin the
domain, drawing options from the `domains` values in `catalog/tools.yaml`.

Ask at most two questions here. This is not the interview — `/skill:blueprint`
does that. You need only enough to know what tooling the work implies.

## 2. Detect the platform

Before any install command is selected, shown or run, establish what this machine
actually is:

```sh
. /etc/os-release && echo "$ID ${ID_LIKE:-}" && uname -m
```

Map `ID`/`ID_LIKE` onto a family:

| Family | `ID` values |
|---|---|
| `debian` | debian, ubuntu, linuxmint, pop |
| `fedora` | fedora, rhel, centos, rocky, almalinux |
| `arch` | arch, manjaro, endeavouros |

Then **confirm by fact, not by name**: run `command -v` for that family's package
manager (`apt`, `dnf`, `pacman`). What is present on PATH wins over anything
`/etc/os-release` claims. If the family is none of the three, or the expected
manager is absent, say so plainly and treat every catalog install command as
unresolved below.

### Resolving an install command

For each tool, in this order:

1. `install_<family>` if the entry has one — use it.
2. Otherwise `install`, **but only if** the package manager it invokes is present
   on this machine. A command naming `apt` on a `dnf` box is not a fallback, it is
   a failure.
3. Otherwise it is **unresolved**: delegate to `pi-workflow.pw-researcher` for the
   command for *this* platform, then show the user the command and its source
   before offering it. Never adapt a command yourself by swapping `apt` for `dnf` —
   package names differ across distros and a plausible guess is worse than an
   honest gap.
4. `MANUAL` at any level means print `install_notes` as a manual step.

## 3. Select candidates

1. Match the task's domains against `catalog/tools.yaml`. Entries with
   `domains: [any]` are always candidates.
2. Read `~/.pi/workflow/machine.json` if it exists. Entries checked within the
   last 7 days are trusted without re-probing; older ones are re-probed.
3. For anything the task implies that the catalog does not cover — a vendor CLI, a
   niche SDK, an MCP server for a service in play — delegate:

   ```
   subagent({ agent: "pi-workflow.pw-researcher", model: <roles.researcher.model>,
              task: "Find the tooling needed for: <task>. The target machine is
                     <ID> <VERSION_ID> (<family> family, <arch>), package manager
                     <manager>. For each candidate give: what it does, why this task
                     needs it, the exact install command *for that platform*,
                     whether it requires root, and whether it is a general dev tool
                     or specific to this project. Cite sources. If a tool has no
                     packaged install on this platform, say so rather than giving
                     the command for a different distro." })
   ```

   Write findings to `.pi-workflow/research/tooling-<topic>.md`.

## 4. Probe

Run each candidate's `detect` command. **Run nothing else.** No installs, no auth,
nothing interactive.

For anything present with an `auth_check`, run that too — cheaply and
non-interactively.

Sort results into: **present** · **present but unauthenticated** · **missing**.

For a large candidate set, delegate the probing to `pi-workflow.pw-scout` with the exact
detect commands. Keep the interpretation yourself.

## 5. Classify what is missing

- **global** — common dev tooling, or part of the standing hosting/infra stack
  (az, aws, render, fly, pac, docker, gh, terraform, pwsh, gitleaks).
- **project** — niche or specific to this project (framework CLIs, one-off SDKs,
  linters for a language used only here).

Use the catalog's `scope`. For anything unclassified, ask, recommending **global**
when the tool is plausibly reusable across future projects.

## 6. Get consent once

Do not ask per tool. Present the whole set in a single `ask_user_question` with
`multiSelect: true`, putting the full table in the option previews:

- tool · why this task needs it · scope · install command · sudo or not

Everything not selected is **declined**; capture the reason from `notes` if given.

## 7. Install

Use the command resolved in §2 for this platform — never the raw `install` field
when a family override applies.

- **`sudo: false`** → run the resolved command directly. Report each result.
- **`sudo: true`** → **never run it.** Collect every sudo command into one
  copy-pasteable block and ask the user to run it in another terminal window.
- **`MANUAL`** → print `install_notes` as the manual step.
- **unresolved** → the researcher's cited command, shown with its source, and only
  after the user has seen where it came from.
- **`auth` commands** → never run. They are interactive by nature. Surface them.

```
Run these in another terminal, then tell me when you are done:

  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker $USER

Then log out and back in for the docker group to take effect.
```

Then ask whether they are done, and **re-probe** to confirm. Never take "done" as
proof — the detect command is the proof.

## 8. Loop until settled

Repeat 7-8 until every candidate is `installed`, `already-present`, `declined`, or
`failed`.

A tool that fails to install twice is `failed`: capture the actual error and ask
whether to retry, skip, or stop.

**Do not exit with anything in an unknown state.** That is this skill's one
guarantee — blueprint and build both assume `tools.md` is true.

## 9. Write tools.md

Delegate to `pi-workflow.pw-scribe` with `templates/tools.md.tmpl` and your collected facts,
or write it directly if short. Output to `.pi-workflow/tools.md`.

Every version string must come from an actual detect run. Never from memory.

## 10. Update the machine inventory

Write `~/.pi/workflow/machine.json` (machine-scoped, deliberately outside the
repo, create the directory if needed):

```json
{ "version": 1, "updatedAt": "<iso8601>",
  "platform": { "id": "fedora", "versionId": "44", "family": "fedora",
                "manager": "dnf", "arch": "x86_64" },
  "tools": {
    "az": { "present": true, "version": "2.68.0", "checkedAt": "<iso8601>",
            "scope": "global", "authed": true },
    "flyctl": { "present": false, "declined": true, "checkedAt": "<iso8601>" } } }
```

Merge with what is there; never drop entries for tools you did not probe. If the
recorded `platform` differs from what you detected this run, discard every cached
tool entry and re-probe — the inventory belongs to a machine, not a distro.

## 11. Close

Update `state.json`: `stages.groundwork.status = "complete"`. Print outstanding
manual steps, then:

```
Next: clear context, then /skill:blueprint <your goal>
```

## Hard rules

- **Never execute a command containing `sudo`.** Not even if asked to. Print it.
- **Never offer or run an install command for a package manager this machine does
  not have.** An `apt` command on a `dnf` box wastes the user's time and teaches
  them to distrust the whole document. Resolve it or report it unresolved.
- Never run an install that prompts interactively.
- Never run an `auth` / login command.
- Never claim a tool is installed without a successful detect run afterwards.
- Never install outside `~/.local`, `~/.dotnet`, npm global, or a tool's own
  documented user-scope location without asking first.
