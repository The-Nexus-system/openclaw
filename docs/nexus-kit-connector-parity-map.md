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

### Microsoft Graph

Independent OAuth refresh and read routing are implemented for Microsoft Graph.

Tools:

- `nexus_microsoft_graph_get`
- `nexus_connector_probe` with `microsoft-graph`

The health probe requires identity, Outlook inbox, and calendar reads to succeed before it reports read verification. Failures identify the stage as credentials, token refresh, identity, mail, or calendar.

Runtime state remains unverified until the OpenClaw host receives an independent Microsoft OAuth grant and the live probe succeeds.

Consequential Microsoft writes are also implemented as optional tools:

- `nexus_outlook_send_mail` sends and then checks Sent Items.
- `nexus_outlook_create_event` creates an event and then reads it back by id.

Neither write route is marked write-verified until a real authorized host run succeeds.

### Dropbox

Independent read routing supports account identity, folder listing, search, and metadata.

Tool: `nexus_dropbox_read`

The live probe calls `users/get_current_account`. It supports either a direct access token or app-key/app-secret/refresh-token OAuth.

### Notion

Independent read routing is implemented with the official Notion API.

Tool: `nexus_notion_read`

The live probe reaches `/v1/users/me`. Personal/internal integration tokens and OAuth access tokens are both represented in the registry.

### Linear

Independent read routing is implemented with Linear GraphQL.

Tool: `nexus_linear_read`

The live probe queries the authenticated `viewer`. Personal API keys and OAuth access tokens are both supported.

### Zoom

Independent meeting-read routing is implemented.

Tool: `nexus_zoom_read`

The live probe reaches the user meetings endpoint. Direct access tokens, refresh-token OAuth, and server-to-server OAuth are represented separately; server-to-server routes also require a target user.

### Figma

Independent read routing is implemented.

Tool: `nexus_figma_read`

The live probe reaches `/v1/me`. Personal access tokens and OAuth bearer tokens are supported.

### Canva

Independent OAuth refresh, rotating refresh-token persistence, live identity verification, and read routing are implemented.

Tool: `nexus_canva_read`

The read tool supports current-user identity/profile, design listing, and single-design metadata. The live probe reaches `/rest/v1/users/me`, which requires a valid user token but no additional scope.

Because Canva refresh tokens are one-use, refreshed tokens are rotated into private host state at `~/.openclaw/kit/secrets/canva.json` rather than committed to Git. Runtime state remains unverified until an independently authorized Canva grant is installed and the live probe succeeds.

### Adobe Photoshop / Firefly Services

Independent authentication and health verification are implemented for Photoshop / Firefly Services.

The live probe exchanges Adobe client credentials when needed and then reaches Adobe's documented Photoshop API hello endpoint with both bearer authorization and `x-api-key`.

This proves Photoshop-service access only. Creative write/image-job parity is not marked complete until a real Photoshop v2 operation is implemented and its output is verified.

## Next parity group

Core providers still needing independent adapters or deeper write parity include:

- Spotify
- Apple Music
- Adobe PDF Services
- Dropbox write operations
- Notion write operations
- Linear write operations
- Zoom write operations
- Figma comment/write operations

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
