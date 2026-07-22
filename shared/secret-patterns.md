# Secret patterns

The one list. `/skill:yeet` runs these against the staged diff; `scripts/validate.mjs`
parses this same file and runs them over the repo. Two copies would drift, and the
copy that drifts is the one guarding a push to a public remote.

Format inside the block: `<label> :: <JavaScript regex source>`, one per line.
No delimiters, no flags — `validate.mjs` compiles each with `new RegExp(source)`.
Keep `|` unescaped; it is inside a fenced block, not a table, precisely so
alternation is safe to write.

```patterns
private key header :: -----BEGIN [A-Z ]*PRIVATE KEY-----
AWS access key id :: \b(AKIA|ASIA)[0-9A-Z]{16}\b
GitHub token :: \bgh[pousr]_[A-Za-z0-9]{20,}\b
Slack token :: \bxox[abpr]-[A-Za-z0-9-]{10,}\b
Google API key :: \bAIza[0-9A-Za-z_-]{35}\b
JWT :: \beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b
Azure storage connection string :: DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;]+
Azure client secret :: \bclient_secret["'\s:=]+[A-Za-z0-9._~-]{20,}
Azure SAS token :: [?&]sig=[A-Za-z0-9%2F%2B=]{20,}
generic assigned secret :: \b(api[_-]?key|secret|password|passwd|token)["'\s:=]+["'][^"']{16,}["']
```

## Filenames

Staged paths matching any of these are fatal regardless of content. `yeet` checks
them; `validate.mjs` does not, because the repo legitimately contains none.

```filenames
\.pem$
\.pfx$
\.p12$
\.keystore$
(^|/)id_rsa$
(^|/)\.env($|\.)
```

## Rules

- **Any hit is fatal.** Report file and line with the value redacted, unstage
  everything, and STOP.
- **There is no override.** Not a flag, not a "commit just the safe files", not on
  request. The user fixes it and re-runs.
- A pattern that fires on this repo's own text is a broken pattern, not a finding —
  `validate.mjs` runs the list against the whole repo on every commit, so a
  pattern with a runaway match makes the build fail loudly rather than silently
  desensitising anyone.
