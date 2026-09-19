#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY="${NEXUS_CONNECTOR_REGISTRY:-$REPO_ROOT/config/nexus-kit-connectors.example.json}"

if [ ! -f "$REGISTRY" ]; then
  echo "connector registry not found: $REGISTRY" >&2
  exit 2
fi

python3 - "$REGISTRY" <<'PY'
import json
import os
import shutil
import subprocess
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    registry = json.load(f)

cli_by_id = {
    "github": ["gh"],
    "digitalocean": ["doctl"],
}

print("Nexus Kit connector readiness")
print("This audit checks local prerequisites only. It does not prove provider access.")
print()

for item in sorted(registry.get("connectors", []), key=lambda x: (x.get("priority", 99), x.get("id", ""))):
    cid = item["id"]
    required_env = item.get("credentialEnv", [])
    env_present = [name for name in required_env if os.environ.get(name)]
    env_missing = [name for name in required_env if not os.environ.get(name)]

    cli_names = cli_by_id.get(cid, [])
    cli_present = [name for name in cli_names if shutil.which(name)]
    cli_missing = [name for name in cli_names if not shutil.which(name)]

    print(f"[{cid}] {item.get('provider', cid)}")
    print(f"  target state: {item.get('state', 'unknown')}")
    print(f"  routes: {', '.join(item.get('routes', [])) or 'none'}")
    if required_env:
        print(f"  credential markers present: {len(env_present)}/{len(required_env)}")
        if env_missing:
            print(f"  missing markers: {', '.join(env_missing)}")
    else:
        print("  credential markers: none declared")
    if cli_names:
        print(f"  cli present: {', '.join(cli_present) if cli_present else 'none'}")
        if cli_missing:
            print(f"  cli missing: {', '.join(cli_missing)}")
    print()

print("OpenClaw plugin inspection")
if shutil.which("openclaw"):
    try:
        proc = subprocess.run(
            ["openclaw", "plugins", "list"],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=30,
        )
        print(proc.stdout.rstrip())
    except Exception as exc:
        print(f"  unable to inspect plugins: {exc}")
else:
    print("  openclaw executable not found")

print()
print("Important: authentication-marker presence is not a health check.")
print("Each connector must still pass a harmless live provider probe before it is marked read-verified.")
PY
