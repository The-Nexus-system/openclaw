# Nexus Kit connector portability

The Nexus Kit runtime must not depend on ChatGPT-only connectors for durable access to external services.

ChatGPT plugins/connectors are treated as one access surface, not as the authoritative integration layer. When a capability matters to Kit, OpenClaw should have an independent route to the same provider where the provider permits it.

## Integration order

For each service, prefer the first route that satisfies the required postcondition:

1. Native OpenClaw plugin or channel.
2. Provider-supported MCP or equivalent tool server.
3. Official provider API through a Nexus OpenClaw tool plugin.
4. Official provider CLI, allowlisted and wrapped by a skill or tool.
5. Host-local bridge to a trusted app or device.
6. Browser automation only when no stable API or CLI route exists.

A replacement route is not considered equivalent merely because it can reach the same website. It must preserve the function that matters, including read/write behavior, authentication, auditability, and verification.

## Authentication boundary

Never copy ChatGPT connector credentials or OAuth tokens into Git.

OpenClaw must authenticate independently with each provider. Runtime credentials belong in protected host storage, a secret manager, or the provider's supported OAuth flow.

Public Git stores only:

- provider names;
- capability contracts;
- environment-variable names;
- setup instructions;
- adapter code;
- test fixtures with fake data.

## Capability parity

The initial parity targets are:

- GitHub
- Gmail
- Google Calendar
- Google Drive
- Google Contacts
- DigitalOcean
- Microsoft Outlook / Microsoft Graph
- Dropbox
- Notion
- Linear
- Zoom
- Spotify
- Apple Music
- Figma
- Canva
- Adobe

Additional services can be added as they become useful. A service appearing in this list does not mean it is currently authenticated on the OpenClaw host.

## Verification

Every connector needs a health test that proves the actual provider path.

Read-capable connectors should verify a harmless metadata or identity read.

Write-capable connectors should not be marked write-ready until a reversible or explicitly authorized write path has been tested.

The connector registry should distinguish:

- planned
- installed
- authenticated
- read-verified
- write-verified
- degraded
- unavailable

Do not report a ChatGPT-side connector as proof that the independent OpenClaw route works.

## Failure behavior

If a preferred connector fails:

1. identify whether the failure is authentication, provider outage, permission, rate limit, local runtime, or adapter failure;
2. do not silently switch to a less-safe route for consequential writes;
3. use an equivalent alternate route only when its postcondition is understood;
4. record durable changes to the connector state when they affect future work.

## ChatGPT loss scenario

If ChatGPT connectors become unavailable, the OpenClaw runtime should still be able to operate the independently configured provider integrations.

Loss of ChatGPT-specific services such as ChatGPT Library is handled by maintaining private exports/backups of continuity records outside that service rather than trying to emulate an unavailable proprietary connector.
