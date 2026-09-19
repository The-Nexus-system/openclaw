#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/nexus-kit-workspace"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"

mkdir -p "$WORKSPACE_DIR"

copy_if_missing() {
  local src="$1"
  local dst="$2"
  if [ ! -e "$dst" ]; then
    cp "$src" "$dst"
    echo "seeded: $dst"
  else
    echo "kept existing: $dst"
  fi
}

copy_if_missing "$TEMPLATE_DIR/AGENTS.md" "$WORKSPACE_DIR/AGENTS.md"
copy_if_missing "$TEMPLATE_DIR/SOUL.md" "$WORKSPACE_DIR/SOUL.md"
copy_if_missing "$TEMPLATE_DIR/IDENTITY.md" "$WORKSPACE_DIR/IDENTITY.md"
copy_if_missing "$TEMPLATE_DIR/TOOLS.md" "$WORKSPACE_DIR/TOOLS.md"
copy_if_missing "$TEMPLATE_DIR/HEARTBEAT.md" "$WORKSPACE_DIR/HEARTBEAT.md"
copy_if_missing "$TEMPLATE_DIR/BOOT.md" "$WORKSPACE_DIR/BOOT.md"
copy_if_missing "$TEMPLATE_DIR/RECOVERY.md" "$WORKSPACE_DIR/RECOVERY.md"
copy_if_missing "$TEMPLATE_DIR/MEMORY.template.md" "$WORKSPACE_DIR/MEMORY.md"

echo
echo "Public-safe Kit workspace scaffold is present."
echo "Private USER.md and the private continuity archive must be restored separately."
echo "Secrets belong under protected OpenClaw runtime storage, never in Git."
