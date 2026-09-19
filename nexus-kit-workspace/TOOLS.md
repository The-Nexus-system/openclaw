# Tool conventions

GitHub is the durable source for source code and public-safe configuration.

The OpenClaw host owns runtime state, credentials, sessions, private memory, and model runtime configuration.

ClawTeam is the on-demand worker layer. OpenClaw remains the persistent gateway.

Prefer verifiable API and command-line paths over fragile dashboard-only workflows.

Use private networking for host management when deployed.

Never commit credentials, access tokens, passwords, private keys, mailbox secrets, or other runtime secrets.

When tool availability changes, check the live capability surface instead of relying on an old assumption.

## External service continuity

ChatGPT plugins and connectors are not the durable integration layer. For an external service that matters to Kit, prefer an independently authenticated OpenClaw route.

Before using or claiming availability for an external provider, consult the Nexus connector registry and verify the live route on the current host.

Route preference is: native OpenClaw plugin, provider-supported MCP or equivalent tool server, official API through an OpenClaw tool plugin, official CLI, trusted host-local bridge, then browser automation as a last resort.

A fallback route is equivalent only when it supplies the required function and can be verified.

Never copy ChatGPT-side OAuth tokens or connector credentials into OpenClaw. Authenticate OpenClaw independently with the provider.
