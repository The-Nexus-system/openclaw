# Nexus Kit developer-platform authorization

The persistent Kit runtime should use machine credentials and provider APIs wherever possible. Ordinary account passwords should not be stored in OpenClaw.

The setup goal is to reduce provider-console work to a one-time authorization/key-creation step. After that, Kit stores the machine credential privately, generates short-lived tokens locally, and verifies the real provider path.

## OpenAI API

Preferred credential: a dedicated OpenAI project service-account API key for Kit.

Store:

- `OPENAI_API_KEY`
- optional `OPENAI_PROJECT_ID`
- optional `OPENAI_ORG_ID`

Kit verifies the credential with a live `GET /v1/models` request.

Do not confuse a normal project/service-account key with an organization Admin API key. Administrative project/key/rate-limit management should use a separate credential and adapter if it is needed later.

## Microsoft Graph

Use:

`nexus-kit-auth microsoft`

After the one-time Microsoft app registration/client ID exists, this uses device-code authorization. The user opens one Microsoft link on the phone, enters a short code, approves the requested permissions, and the refresh token is stored directly in the protected connector vault.

No Microsoft password or OAuth token is copied through chat.

## Google Workspace

Google does not permit the limited-input/device flow for the full Gmail/Calendar/Contacts scope set Kit needs.

Kit therefore provides:

`nexus-kit-auth google`

This generates a short-lived PKCE authorization URL. The user opens it in Safari and approves access. Google redirects to Kit's registered HTTPS callback, and the callback stores the refresh token directly.

One-time provider work:

- create/configure the Google OAuth client;
- register the exact Kit HTTPS callback URI;
- store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`;
- store `GOOGLE_REDIRECT_URI`.

After that, reauthorization does not require copying authorization codes or refresh tokens.

## App Store Connect

Preferred credential: an App Store Connect API key.

One-time provider work:

- ensure App Store Connect API access is enabled for the account;
- generate a role-appropriate API key;
- record the Issuer ID and Key ID;
- download the private `.p8` key. Apple only allows private-key download at key creation time, so preserve it securely.

Store the short identifiers with the hidden secret command:

`python3 scripts/nexus-kit-secret set APPSTORE_ISSUER_ID`

`python3 scripts/nexus-kit-secret set APPSTORE_KEY_ID`

Import the downloaded private key without opening or pasting its contents:

`python3 scripts/nexus-kit-secret import-file APPSTORE_PRIVATE_KEY /path/to/AuthKey.p8`

Kit generates the short-lived ES256 App Store Connect JWT locally. The private key is never sent to Git and the JWT is not stored permanently.

Live verification:

`nexus_connector_probe connector=app-store-connect`

The connector is read-verified only when the generated JWT successfully reaches the real App Store Connect `/v1/apps` endpoint.

## Google Play

Preferred credential: a dedicated Google service account authorized for the app in Google Play Console.

One-time provider work:

- create/download the service-account JSON credential;
- grant that service account the required Google Play app permissions;
- identify the Android package name.

Import the downloaded service-account JSON directly:

`python3 scripts/nexus-kit-secret import-file GOOGLE_PLAY_SERVICE_ACCOUNT_JSON /path/to/service-account.json`

Store the package name:

`python3 scripts/nexus-kit-secret set GOOGLE_PLAY_PACKAGE_NAME`

The connector signs a Google OAuth JWT locally and exchanges it for a short-lived Android Publisher access token. Neither the service-account private key nor access token is committed to Git.

A user OAuth refresh-token route remains available as a fallback through `GOOGLE_PLAY_REFRESH_TOKEN`, but service-account authentication is preferred for the persistent Kit host.

Live verification uses the real Android Publisher reviews endpoint for the configured package.

## Expo / EAS

Preferred credential: an Expo Robot user with a scoped access token for the persistent runtime.

Store:

- `EXPO_TOKEN`
- `EXPO_PROJECT_DIR`

Kit verifies the credential by running an authenticated non-interactive EAS project-status read against the linked project. Token presence alone does not count as verification.

## Meta Developer

Keep developer-app access separate from Page/Instagram/Threads access.

For the Meta app itself store `META_APP_ID` plus one supported credential route:

- `META_APP_ACCESS_TOKEN`;
- `META_APP_SECRET`;
- a suitable Meta user token.

Kit verifies developer access by reading the configured app object through the Graph API.

Page, Instagram, Threads, personal-profile, and Groups behavior is tracked as separate connector surfaces.

## Twilio

Prefer a dedicated restricted Twilio API key over the main Auth Token.

Store:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`

The main `TWILIO_AUTH_TOKEN` remains a fallback.

Kit verifies access by reading the actual Twilio account resource.

## Metricool

Primary route: Metricool's official remote MCP endpoint through the OpenClaw stdio bridge.

Use:

`nexus-kit-auth metricool`

The auth helper tries headless OAuth device authorization through the pinned `mcp-remote` client. Device authorization is accepted only when Metricool's authorization metadata actually advertises RFC 8628 support. If the provider does not advertise it, setup fails closed rather than falling back to an invisible browser on the VPS.

Optional fallback:

`nexus-kit-auth metricool --api-key`

This stores a Metricool API key in the protected connector vault and supplies it to the remote MCP as `X-Mc-Auth`. Treat this as a fallback because Metricool API-key availability may depend on plan, while Metricool's OAuth MCP route is the normal any-plan path.

OAuth client/token state from `mcp-remote` lives under:

`~/.openclaw/kit/mcp-auth/metricool`

That directory is private runtime state. It must never be committed to Git and must be included in encrypted recovery backups.

Production OpenClaw uses:

`nexus-kit-mcp-metricool`

The production wrapper refuses to begin a first-time authorization flow in the background. If neither a usable private OAuth cache nor API key exists, it tells the operator to run `nexus-kit-auth metricool`.

Live verification uses:

`nexus-kit-metricool-probe`

The probe launches the same production MCP wrapper, initializes MCP, lists the real Metricool tools, locates a read-only brand-list tool, and calls it. It never prints returned brand/account data. Metricool is read-verified only when that real account read succeeds.

## Secret-file accessibility rule

Do not make the user manually copy multiline private keys or JSON credentials.

Use:

`python3 scripts/nexus-kit-secret import-file NAME PATH`

The importer reads a local UTF-8 regular file, refuses symlinks and oversized inputs, writes into the protected connector vault, and never prints the secret value.

## Verification rule

Creating a key, importing a file, or successfully exchanging a token does not by itself prove that the provider permissions are correct.

After every authorization or restore, run the provider's live read probe. Writes are enabled/tested separately and require their own postcondition verification.
