---
name: nexus-connectors
description: "Use independently authenticated OpenClaw routes to external services instead of depending on ChatGPT-only connectors. Inspect connector readiness, select the safest equivalent route, verify provider access, and preserve clear read/write boundaries."
---

# Nexus connectors

Use this skill whenever Kit needs an external provider that may also exist as a ChatGPT plugin or connector.

## Principle

ChatGPT connector availability is not proof of OpenClaw connector availability.

OpenClaw authenticates independently. Never copy ChatGPT-side tokens or hidden connector state.

## Registry

The public-safe target registry lives at:

`config/nexus-kit-connectors.example.json`

A deployed host may copy and update its own private runtime registry. Do not put secrets in the registry.

Run:

`scripts/nexus-kit-connector-audit.sh`

before assuming a connector is usable on a newly deployed or restored host.

## Route selection

Prefer, in order:

1. native OpenClaw plugin or channel;
2. provider-supported MCP or equivalent tool server;
3. official provider API through a typed OpenClaw tool plugin;
4. official provider CLI;
5. trusted host-local bridge;
6. browser automation only as a last resort.

When switching routes, compare the required postcondition. Similar access is not necessarily equivalent access.

## Verification states

Use these states precisely:

- planned: desired but not installed;
- installed: adapter or CLI exists;
- authenticated: credentials appear valid;
- read-verified: a harmless live provider read succeeded;
- write-verified: an explicitly authorized live write succeeded and was read back or otherwise verified;
- degraded: route exists but currently cannot satisfy its normal contract;
- unavailable: no working route is currently present.

Do not jump directly from installed to write-verified.

## GitHub

Preferred independent routes: OpenClaw tool plugin or `gh` CLI.

Harmless probe:

`gh auth status`

Then a repository metadata read appropriate to the active task.

Do not use a write merely to test authentication.

## DigitalOcean

Preferred independent routes: official API/tool plugin or `doctl`.

Harmless probes:

`doctl account get`

`doctl compute droplet list`

Treat contradictory account-state results as a provider/account problem, not as permission to create resources blindly.

## Google services

Gmail, Calendar, Drive, and Contacts should share an independently configured Google OAuth application where practical, with only the scopes needed for the enabled capabilities.

Start with a user identity or harmless metadata read. Verify each service separately; a working Gmail token does not by itself prove Drive or Calendar scopes.

## Microsoft

Use Microsoft Graph OAuth for Outlook/mail/calendar capabilities. Speech-provider configuration is a separate capability and does not prove Graph access.

## Other providers

Dropbox, Notion, Linear, Zoom, Spotify, Apple Music, Figma, Canva, and Adobe should each use the provider-supported OAuth/API route or a dedicated OpenClaw plugin.

Keep provider-specific setup notes with the adapter. Keep credentials only in protected runtime storage.

## Writes

For sends, deletes, infrastructure changes, calendar edits, repository writes, or other consequential actions:

- confirm the active account/target;
- use the narrowest required permission;
- execute the real action;
- verify the postcondition;
- record a durable connector-state change only if it matters to future work.
