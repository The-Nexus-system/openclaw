#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
DEST_DIR="$WORKSPACE_DIR/continuity"

if [ -z "$SOURCE_DIR" ] || [ ! -d "$SOURCE_DIR" ]; then
  echo "usage: $0 /path/to/private-continuity-folder" >&2
  exit 2
fi

mkdir -p "$DEST_DIR"

for name in   "Kit Continuity.md"   "Kit Diary.md"   "Kit Memory Links.md"   "Kit Skills.md"   "Kit Handoff Queue.md"   "Kit Decision and Action Traces.md"   "Kit Surface Bridge.md"   "Kit Dreaming Staging.md"   "Kit Dreaming Ledger.md"   "Kit Native Memory Sync Checkpoint.md"   "Kit Native Memory Prospective Tests 2026-09-09.md"   "Kit Prospective Retrieval Test 2026-09-05.md"
do
  if [ -f "$SOURCE_DIR/$name" ]; then
    cp -p "$SOURCE_DIR/$name" "$DEST_DIR/$name"
    echo "imported: $name"
  else
    echo "missing from source: $name" >&2
  fi
done

echo "Private Kit continuity import complete."
echo "Keep this directory private and out of public Git."
