#!/usr/bin/env bash
set -euo pipefail

if ! command -v openclaw >/dev/null 2>&1; then
  echo "OpenClaw is not installed or not available in PATH." >&2
  exit 2
fi

echo "Nexus Kit contact-channel health"
echo

echo "1. Channel runtime status"
openclaw channels status || true
echo

echo "2. Telegram provider capability probe"
openclaw channels capabilities --channel telegram || true
echo

echo "3. Gateway deep status"
openclaw status --deep || true
echo

echo "Important:"
echo "- Telegram is fully verified only after an allowlisted inbound DM and a confirmed Kit reply."
echo "- WhatsApp is fully verified only after the linked listener is live and a real allowlisted message round-trip succeeds."
echo "- This command does not send test messages automatically."
