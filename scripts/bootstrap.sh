#!/usr/bin/env bash
# pi-workflow bootstrap: installs the companion pi packages the skills depend on
# and applies model routing. Safe to re-run.
#
# pi does not install pi packages transitively, so `pi install git:...` gets the
# skills but not the packages they call. This closes that gap.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

REQUIRED=(
  "npm:pi-subagents"
  "npm:@juicesharp/rpiv-ask-user-question"
  "npm:pi-web-access"
)

info() { printf '  %s\n' "$*"; }
head() { printf '\n%s\n' "$*"; }

head "pi-workflow bootstrap"
info "package root: $ROOT"

# ------------------------------------------------------------------ check pi
if ! command -v pi >/dev/null 2>&1; then
  echo "error: pi is not on PATH. Install it first: https://pi.dev" >&2
  exit 1
fi

PI_VERSION="$(pi --version 2>/dev/null || echo unknown)"
info "pi version:   $PI_VERSION"

case "$PI_VERSION" in
  0.[0-7][0-9].*|0.[0-9].*)
    info "warning: pi-workflow is developed against pi 0.81+; some features may be missing"
    ;;
esac

# ------------------------------------------------------- install companions
head "companion packages"

INSTALLED="$(pi list 2>/dev/null || true)"
CHANGED=0

for pkg in "${REQUIRED[@]}"; do
  name="${pkg#npm:}"
  if printf '%s' "$INSTALLED" | grep -qF -- "$name"; then
    info "already present   $name"
  else
    info "installing        $name"
    if pi install "$pkg"; then
      CHANGED=1
    else
      echo "error: failed to install $pkg" >&2
      exit 1
    fi
  fi
done

# ------------------------------------------------------------ model routing
head "model routing"
node "$ROOT/scripts/apply-models.mjs"

# ------------------------------------------------------------ search curator
# pi-web-access opens a browser curator on every top-level web_search. The
# workflow's research runs in subagents, which resolve to "none" regardless, so
# the curator only ever differs from the research path - default it off.
# Only fills the key in when absent: a later `/curator on` is a deliberate
# choice and re-running bootstrap must not silently undo it.
head "search curator"
node --input-type=module - <<'NODE'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir =
  process.env.PI_CODING_AGENT_DIR ??
  (process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "pi") : join(homedir(), ".pi"));
const file = join(dir, "web-search.json");

let config = {};
if (existsSync(file)) {
  try {
    config = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`  skipped           ${file} is not valid JSON (${e.message}); leaving it alone`);
    process.exit(0);
  }
}

if ("workflow" in config) {
  console.log(`  already set       workflow: ${config.workflow}`);
} else {
  config.workflow = "none";
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`  wrote             workflow: none -> ${file}`);
  console.log("  raw search results, no browser curator. Re-enable with /curator on");
}
NODE

# ------------------------------------------------------------------- summary
head "done"
if [ "$CHANGED" -eq 1 ]; then
  info "Restart pi so the newly installed packages register."
else
  info "No packages changed."
fi
info ""
info "Then check the skills are visible:"
info "  /skill:groundwork   /skill:blueprint   /skill:build   /skill:yeet"
info ""
info "And that model routing took effect:"
info "  /subagents        - the six pw-* agents, source 'package', with their models"
info "  /subagents-models - builtins only; shows the oracle override"
