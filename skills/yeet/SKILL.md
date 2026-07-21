---
name: yeet
description: Commit and push to main, safely. Audits gitignore, scans the staged diff for secrets, shows exactly what will and will not be committed, writes a conventional commit message, and pushes. Refuses to continue if anything looks like a credential. Use when work is done and verified.
---

# yeet

Stage 4 of 4. Assumes the repo is or will become public, and that planning docs
must never leave the machine through git.

Read `shared/preflight.md` from this package root and follow it now. Then read
`shared/asking.md`.

---

## 1. Repo checks

- In a git repo? If not, stop.
- On `main`? If not, ask: switch, merge into main, or push this branch instead.
- Remote configured? If not, stop and say what to add.
- Behind the remote? `git pull --rebase` first. **Stop on conflict** — resolving
  someone else's conflict unattended is not this skill's job.

## 2. Audit .gitignore

Ensure it covers the following, adding what is missing and reporting each addition:

- **`.pi-workflow/`** — non-negotiable
- `.pi-subagents/`
- `.env`, `.env.*` with `!.env.example`
- `node_modules/`, `dist/`, `build/`, `.next/`, `out/`, `coverage/`,
  `__pycache__/`, `*.pyc`, `bin/`, `obj/`
- `.DS_Store`, editor directories
- stack-specific artifacts actually present in the tree: `.terraform/`,
  `*.tfstate*`, `.azure/`, `.aws-sam/`, `cdk.out/`, `playwright-report/`,
  `test-results/`

Then verify: `git check-ignore -q .pi-workflow`.

## 3. Already-tracked violations

If anything matching those patterns is **already tracked** — a previously
committed `.env`, a stray `dist/` — **STOP**. Report it and explain plainly:

> `git rm --cached` stops tracking it going forward but does **not** remove it from
> history. If this file ever contained a live credential, rotate the credential —
> removing the file is not enough.

Do not rewrite history unless the user explicitly asks for it.

## 4. Stage

`git add -A`, then review `git diff --cached --stat`.

## 5. Secret scan

Both passes run. Both are required.

**a. gitleaks**, if available:

```sh
gitleaks protect --staged --redact
```

If it is absent, offer to install it (`catalog/tools.yaml`) but do not require it —
pass (b) always runs.

**b. Built-in regex pass** over the staged diff, regardless of (a):

- private key headers (`-----BEGIN * PRIVATE KEY-----`)
- AWS `AKIA…` / `ASIA…` and secret access keys
- Azure connection strings, `client_secret`, SAS tokens
- GitHub `gh[pousr]_…`
- Slack `xox[abpr]-…`
- Google `AIza…`
- JWTs (`eyJ…` with two dots)
- generic `api[_-]?key`, `secret`, `password`, `token` assigned a long literal
- staged files named `*.pem`, `*.pfx`, `*.p12`, `id_rsa`, `*.keystore`, `.env*`

**Any hit is fatal.** Report file and line with the value **redacted**, unstage
everything (`git reset`), and STOP.

**There is no override flag.** Do not offer one. Do not commit "just the safe
files". The user fixes it and re-runs.

## 6. Show the manifest

Before committing, print both lists. The second is the one the user actually
checks:

```
COMMITTING  12 files  +814 -62
  src/api/auth.ts                    +180
  tests/api/auth.test.ts             +210
  ...

EXCLUDED (gitignored)
  .pi-workflow/          planning artifacts - hand-carried, never committed
  .env.local             secrets
  dist/                  build artifacts
```

## 7. Commit message

Conventional commit. Derive the subject from the **actual diff**, plus package
names from `state.json` when present. Body: what changed and why, one bullet per
area. No emoji. No AI co-author trailer unless asked.

Delegate to `pi-workflow.pw-scribe` for the wording if the diff is large; you still own the
final text.

Show the message and allow an edit via `ask_user_question` before committing.

## 8. Commit and push

Commit, then `git push origin main`. Report the SHA and the remote URL.

If the push is rejected, **report the real error**. Do not retry with `--force`.

## 9. Close

Update `state.json`: `stages.yeet.status = "complete"`, record the SHA.

---

## Hard rules

- Never force-push. Never rewrite history unprompted.
- Never commit `.pi-workflow/`. If it ever appears staged, that is a bug — stop and
  report rather than working around it.
- Never bypass the secret scan, for any reason, on any request.
- Never write a commit message that overstates what changed.
- Never commit work you were not asked to commit — if the tree contains unrelated
  changes, surface them and ask.
