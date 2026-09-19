#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="${NEXUS_KIT_STATE_DIR:-$HOME/.openclaw/kit}"
mkdir -p "$STATE_DIR"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "FAIL: OpenClaw executable is not available." >&2
  exit 1
fi

echo "1/3 — OpenClaw plugin load"
openclaw plugins inspect nexus-connectors --json > "$STATE_DIR/nexus-connectors.inspect.json"

python3 - "$STATE_DIR/nexus-connectors.inspect.json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

text = json.dumps(data).lower()
if "nexus-connectors" not in text:
    raise SystemExit("FAIL: plugin inspection did not identify nexus-connectors")

bad = ("hard error", "failed to load", '"loaded": false')
if any(marker in text for marker in bad):
    raise SystemExit("FAIL: plugin inspection reports an unloadable/disabled connector plugin")

print("PASS: nexus-connectors is visible to OpenClaw")
PY

echo
echo "2/3 — Targeted connector tests"
if command -v pnpm >/dev/null 2>&1 && [ -d "$REPO_ROOT/node_modules" ]; then
  (
    cd "$REPO_ROOT"
    pnpm exec vitest run \
      extensions/nexus-connectors/index.test.ts \
      extensions/nexus-connectors/connector-secrets.test.ts \
      extensions/nexus-connectors/google-oauth.test.ts \
      extensions/nexus-connectors/browser-oauth.test.ts \
      extensions/nexus-connectors/status-tools.test.ts \
      extensions/nexus-connectors/creative-shared.test.ts
  )
  echo "PASS: targeted connector tests"
else
  echo "SKIP: source test dependencies are not installed on this host."
  echo "      Plugin-load verification still ran; install repo dev dependencies to run unit tests."
fi

echo
echo "3/3 — Independent provider probes"
node "$REPO_ROOT/scripts/nexus-kit-live-connector-verify.mjs" all || {
  code=$?
  echo "NOTE: one or more configured providers failed live verification." >&2
  echo "      Unconfigured providers are reported separately and are not proof of failure." >&2
  exit "$code"
}

echo
echo "PASS: connector self-test completed."
