#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAWTEAM_REPO="https://github.com/The-Nexus-system/ClawTeam-OpenClaw.git"
BASE_DIR="${NEXUS_KIT_HOME:-$HOME/.nexus-kit}"
CLAWTEAM_DIR="$BASE_DIR/ClawTeam-OpenClaw"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
CLAWTEAM_SKILL_DIR="$WORKSPACE_DIR/skills/clawteam"
CONNECTOR_SKILL_DIR="$WORKSPACE_DIR/skills/nexus-connectors"
CONNECTOR_STATE_DIR="$HOME/.openclaw/kit"
BIN_DIR="$HOME/bin"

mkdir -p "$BASE_DIR" "$CLAWTEAM_SKILL_DIR" "$CONNECTOR_SKILL_DIR" "$CONNECTOR_STATE_DIR" "$BIN_DIR"

if [ -d "$CLAWTEAM_DIR/.git" ]; then
  git -C "$CLAWTEAM_DIR" fetch --prune origin
  git -C "$CLAWTEAM_DIR" checkout main
  git -C "$CLAWTEAM_DIR" pull --ff-only origin main
else
  git clone "$CLAWTEAM_REPO" "$CLAWTEAM_DIR"
fi

python3 -m pip install --user -e "$CLAWTEAM_DIR"

CLAWTEAM_BIN="$(command -v clawteam || true)"
if [ -z "$CLAWTEAM_BIN" ]; then
  for candidate in "$HOME/.local/bin/clawteam" "$HOME/Library/Python"/*/bin/clawteam; do
    if [ -x "$candidate" ]; then
      CLAWTEAM_BIN="$candidate"
      break
    fi
  done
fi

if [ -z "$CLAWTEAM_BIN" ]; then
  echo "ClawTeam installed but the clawteam executable was not found in PATH." >&2
  exit 1
fi

ln -sf "$CLAWTEAM_BIN" "$BIN_DIR/clawteam"
cp "$CLAWTEAM_DIR/skills/openclaw/SKILL.md" "$CLAWTEAM_SKILL_DIR/SKILL.md"
cp "$REPO_ROOT/skills/nexus-connectors/SKILL.md" "$CONNECTOR_SKILL_DIR/SKILL.md"

if [ ! -f "$CONNECTOR_STATE_DIR/connectors.json" ]; then
  cp "$REPO_ROOT/config/nexus-kit-connectors.example.json" "$CONNECTOR_STATE_DIR/connectors.json"
  chmod 600 "$CONNECTOR_STATE_DIR/connectors.json" 2>/dev/null || true
fi

if ! command -v openclaw >/dev/null 2>&1; then
  echo "OpenClaw executable not found; cannot verify the Kit gateway." >&2
  exit 1
fi

openclaw approvals allowlist add --agent "*" "*/clawteam" >/dev/null 2>&1 || true

if ! openclaw plugins inspect nexus-connectors --json >/dev/null 2>&1; then
  openclaw plugins install --link "$REPO_ROOT/extensions/nexus-connectors"
fi

openclaw plugins enable nexus-connectors
openclaw plugins inspect nexus-connectors --json > "$CONNECTOR_STATE_DIR/nexus-connectors.inspect.json"

clawteam config set transport file >/dev/null 2>&1 || true
clawteam config health

"$REPO_ROOT/scripts/nexus-kit-seed-workspace.sh"

NEXUS_CONNECTOR_REGISTRY="$CONNECTOR_STATE_DIR/connectors.json" \
  "$REPO_ROOT/scripts/nexus-kit-connector-audit.sh" || true

node "$REPO_ROOT/scripts/nexus-kit-live-connector-verify.mjs" all || true

openclaw plugins inspect nexus-connectors --json > "$CONNECTOR_STATE_DIR/nexus-connectors.inspect.json"

echo "Kit gateway integration ready."
echo "OpenClaw remains the persistent gateway."
echo "ClawTeam is installed and available for on-demand worker spawning."
echo "Nexus connector routing is installed and the connector registry is present at $CONNECTOR_STATE_DIR/connectors.json."
echo "Connector credentials are not stored in Git and must be configured independently."
