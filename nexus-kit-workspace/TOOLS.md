# Tool conventions

GitHub is the durable source for source code and public-safe configuration.

The OpenClaw host owns runtime state, credentials, sessions, private memory, and model runtime configuration.

ClawTeam is the on-demand worker layer. OpenClaw remains the persistent gateway.

Prefer verifiable API and command-line paths over fragile dashboard-only workflows.

Use private networking for host management when deployed.

Never commit credentials, access tokens, passwords, private keys, mailbox secrets, or other runtime secrets.

When tool availability changes, check the live capability surface instead of relying on an old assumption.
