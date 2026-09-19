# Nexus Kit secrets

The Nexus Kit runtime uses two complementary secret systems.

## 1. Native OpenClaw SecretRefs

Use OpenClaw SecretRefs for credential classes OpenClaw natively supports, including model API keys, supported channel tokens, web-search keys, gateway authentication, and other documented SecretRef surfaces.

OpenClaw SecretRefs support environment, protected file, and exec/vault providers. They resolve into an in-memory runtime snapshot and fail closed when an active reference cannot be resolved.

Do not duplicate a credential into the Nexus connector vault when the native OpenClaw surface already owns it.

## 2. Nexus connector vault

OAuth refresh material and connector-specific credentials used by the Nexus connectors plugin live in:

`~/.openclaw/kit/connector-secrets.json`

unless `NEXUS_CONNECTOR_SECRETS_FILE` points to another protected path.

This exists because OpenClaw intentionally excludes rotating OAuth refresh/session material from the native SecretRef credential surface.

The connector vault:

- is outside Git;
- must be a regular file, not a symlink;
- must be owned by the OpenClaw user on POSIX hosts;
- must not grant group/world access on POSIX hosts;
- is written atomically;
- never needs to be pasted into ChatGPT;
- can be updated when an OAuth provider rotates a refresh token.

Environment values of the same credential name override the file. This is useful when a host-level secret manager injects a credential at process startup.

## Safe setup command

Initialize:

`python3 scripts/nexus-kit-secret init`

Store one credential without echoing it:

`python3 scripts/nexus-kit-secret set GOOGLE_CLIENT_ID`

The command asks for the value twice and prints only the credential name.

List stored credential names only:

`python3 scripts/nexus-kit-secret list`

Check whether one credential is available without printing it:

`python3 scripts/nexus-kit-secret check GOOGLE_CLIENT_ID`

## Password policy

Do not store ordinary account passwords when OAuth or provider tokens are available.

For OAuth services, authenticate with the provider in its supported authorization flow and store only the app credentials / refresh material required by the connector.

Examples:

- Google Workspace: one independently authorized Google OAuth application can provide the Gmail, Calendar, Drive, and Contacts scopes required by Kit.
- Microsoft: one independently authorized Microsoft Graph application can provide Outlook mail/calendar access.
- Dropbox, Canva, and similar services: use OAuth refresh tokens.
- GitHub and DigitalOcean: use scoped provider tokens rather than account passwords.
- Notion, Linear, Figma, and other token-capable services: use scoped integration/API tokens where appropriate.

## ChatGPT connector boundary

ChatGPT-managed connector OAuth material is not exportable through the assistant. The existence of a ChatGPT connection can tell us which integrations need parity, but it does not provide reusable hidden credentials.

Never copy old credentials from logs, committed environment files, screenshots, chat transcripts, or historical setup artifacts merely because a token-looking string is present. Treat exposed or historical credentials as compromised/stale and replace them through the provider.

## Backup

The connector vault must be included in the private Kit disaster-recovery plan, but never in the public OpenClaw repository.

Backups should be encrypted and access-controlled separately from source code. A recovered vault is not proof of connector health; run the live connector probes after restore.
