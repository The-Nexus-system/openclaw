# Nexus Kit connector parity map

This map tracks independent OpenClaw routes for service capabilities that may also be available through ChatGPT connectors.

It tracks capability parity, not ChatGPT credential migration. ChatGPT-managed OAuth state is not copied.

## Implemented in the Nexus connectors plugin

### GitHub

Independent read route implemented with `GITHUB_TOKEN` and the official GitHub REST API.

Tool: `nexus_github_get`

Write parity remains separate and should be implemented with explicit write tools or an allowlisted official CLI path, with postcondition verification.

### DigitalOcean

Independent read route implemented with `DIGITALOCEAN_ACCESS_TOKEN` and the official DigitalOcean v2 API.

Tool: `nexus_digitalocean_get`

Infrastructure mutations remain separate from read access.

### Google Workspace

Independent OAuth token refresh is implemented using host-stored Google OAuth client credentials plus a refresh token.

Read route covers:

- Gmail
- Google Calendar
- Google Drive
- Google People / Contacts

Tool: `nexus_google_get`

Gmail plain-text send is implemented as an optional consequential tool:

`nexus_gmail_send`

The runtime still needs an independently authorized Google OAuth grant with the required scopes.

## Next parity group

The next adapters to build are:

- Microsoft Graph for Outlook mail/calendar
- Dropbox
- Notion
- Linear
- Zoom

## Creative and media group

After core work/data connectors are stable:

- Figma
- Canva
- Adobe
- Spotify
- Apple Music

These should use official provider APIs, OAuth, provider-supported tool servers, or dedicated OpenClaw plugins.

## Product-specific services

ChatGPT Library/files are not treated as a portable external provider. Important continuity records must also exist in private host storage and private/encrypted backup.

ChatGPT Automations should map to OpenClaw cron, heartbeat, or another durable scheduler rather than being the only copy of a future task.

## Verification rule

Code existing in Git is not enough to mark parity complete.

For each provider:

1. install/enable adapter;
2. configure independent authentication;
3. perform a harmless live read;
4. mark read-verified only after success;
5. test write behavior only when explicitly needed and authorized;
6. verify the write postcondition before marking write-verified.
