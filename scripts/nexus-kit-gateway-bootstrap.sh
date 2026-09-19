#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAWTEAM_REPO="https://github.com/The-Nexus-system/ClawTeam-OpenClaw.git"
BASE_DIR="${NEXUS_KIT_HOME:-$HOME/.nexus-kit}"
CLAWTEAM_DIR="$BASE_DIR/ClawTeam-OpenClaw"
SKILL_DIR="$HOME/.openclaw/workspace/skills/clawteam"
BIN_DIR="$HOME/bin"

mkdir -p "$BASE_DIR" "$SKILL_DIR" "$BIN_DIR"

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
cp "$CLAWTEAM_DIR/skills/openclaw/SKILL.md" "$SKILL_DIR/SKILL.md"

if command -v openclaw >/dev/null 2>&1; then
  openclaw approvals allowlist add --agent "*" "*/clawteam" >/dev/null 2>&1 || true
fi

clawteam config set transport file >/dev/null 2>&1 || true
clawteam config health

"$REPO_ROOT/scripts/nexus-kit-seed-workspace.sh"

echo "Kit gateway integration ready."
echo "OpenClaw remains the persistent gateway."
echo "ClawTeam is installed and available for on-demand worker spawning."
