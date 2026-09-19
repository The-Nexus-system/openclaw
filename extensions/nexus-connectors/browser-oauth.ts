import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { getConnectorSecret, setConnectorSecret } from "./connector-secrets.js";

type BrowserOAuthProvider = "dropbox" | "canva" | "spotify" | "zoom";

type PendingOAuth = {
  stateHash: string;
  redirectUri: string;
  createdAt: number;
  codeVerifier?: string;
};

type OAuthProviderConfig = {
  label: string;
  clientIdSecret: string;
  clientSecretSecret: string;
  redirectSecret: string;
  refreshTokenSecret: string;
  grantedScopesSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  defaultScopes?: string[];
  usePkce?: boolean;
};

const TTL_MS = 15 * 60 * 1000;

const PROVIDERS: Record<BrowserOAuthProvider, OAuthProviderConfig> = {
  dropbox: {
    label: "Dropbox",
    clientIdSecret: "DROPBOX_APP_KEY",
    clientSecretSecret: "DROPBOX_APP_SECRET",
    redirectSecret: "DROPBOX_REDIRECT_URI",
    refreshTokenSecret: "DROPBOX_REFRESH_TOKEN",
    grantedScopesSecret: "DROPBOX_GRANTED_SCOPES",
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
  },
  canva: {
    label: "Canva",
    clientIdSecret: "CANVA_CLIENT_ID",
    clientSecretSecret: "CANVA_CLIENT_SECRET",
    redirectSecret: "CANVA_REDIRECT_URI",
    refreshTokenSecret: "CANVA_REFRESH_TOKEN",
    grantedScopesSecret: "CANVA_GRANTED_SCOPES",
    authorizeUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
    defaultScopes: ["profile:read", "design:meta:read"],
    usePkce: true,
  },
  spotify: {
    label: "Spotify",
    clientIdSecret: "SPOTIFY_CLIENT_ID",
    clientSecretSecret: "SPOTIFY_CLIENT_SECRET",
    redirectSecret: "SPOTIFY_REDIRECT_URI",
    refreshTokenSecret: "SPOTIFY_REFRESH_TOKEN",
    grantedScopesSecret: "SPOTIFY_GRANTED_SCOPES",
    authorizeUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    defaultScopes: [
      "user-read-private",
      "playlist-read-private",
      "playlist-modify-private",
      "playlist-modify-public",
      "user-library-read",
    ],
  },
  zoom: {
    label: "Zoom",
    clientIdSecret: "ZOOM_CLIENT_ID",
    clientSecretSecret: "ZOOM_CLIENT_SECRET",
    redirectSecret: "ZOOM_REDIRECT_URI",
    refreshTokenSecret: "ZOOM_REFRESH_TOKEN",
    grantedScopesSecret: "ZOOM_GRANTED_SCOPES",
    authorizeUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
  },
};

function stateDir(): string {
  return (
    process.env.NEXUS_KIT_OAUTH_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw", "kit", "oauth")
  );
}

function pendingFile(provider: BrowserOAuthProvider): string {
  return path.join(stateDir(), `${provider}-pending.json`);
}

function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("base64url");
}

function writePending(provider: BrowserOAuthProvider, value: PendingOAuth): void {
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = pendingFile(provider);
  const temp = `${file}.tmp-${process.pid}`;

  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
}

function readPending(provider: BrowserOAuthProvider): PendingOAuth | null {
  const file = pendingFile(provider);
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("OAuth pending-state file is unsafe.");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("OAuth pending-state file permissions are unsafe.");
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as PendingOAuth;
}

function consumePending(provider: BrowserOAuthProvider): PendingOAuth | null {
  const value = readPending(provider);
  try {
    fs.unlinkSync(pendingFile(provider));
  } catch {
    // Missing is harmless after successful one-time consumption.
  }
  return value;
}

function stateMatches(actualState: string, expectedHash: string): boolean {
  const a = Buffer.from(sha256Base64Url(actualState));
  const b = Buffer.from(expectedHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function html(res: ServerResponse, status: number, title: string, message: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`,
  );
}

function configuredScopes(provider: BrowserOAuthProvider): string[] {
  const override = getConnectorSecret(`${provider.toUpperCase()}_SCOPES`);
  if (override?.trim()) {
    return override.split(/[\s,]+/u).filter(Boolean);
  }
  return PROVIDERS[provider].defaultScopes ?? [];
}

function buildAuthorizationUrl(
  provider: BrowserOAuthProvider,
  state: string,
  codeChallenge?: string,
): string {
  const config = PROVIDERS[provider];
  const clientId = getConnectorSecret(config.clientIdSecret);
  const redirectUri = getConnectorSecret(config.redirectSecret);

  if (!clientId || !redirectUri) {
    throw new Error(
      `${config.clientIdSecret} and ${config.redirectSecret} must be configured.`,
    );
  }
  if (!redirectUri.startsWith("https://")) {
    throw new Error(`${config.redirectSecret} must use HTTPS on the persistent Kit host.`);
  }

  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  if (provider === "dropbox") {
    query.set("token_access_type", "offline");
  }

  const scopes = configuredScopes(provider);
  if (scopes.length) {
    query.set("scope", scopes.join(" "));
  }

  if (config.usePkce) {
    if (!codeChallenge) throw new Error("PKCE challenge was not generated.");
    query.set("code_challenge", codeChallenge);
    query.set("code_challenge_method", "S256");
  }

  return `${config.authorizeUrl}?${query.toString()}`;
}

async function exchangeCode(
  provider: BrowserOAuthProvider,
  code: string,
  pending: PendingOAuth,
): Promise<{ refresh_token?: string; scope?: string; access_token?: string; error?: string; error_description?: string }> {
  const config = PROVIDERS[provider];
  const clientId = getConnectorSecret(config.clientIdSecret);
  const clientSecret = getConnectorSecret(config.clientSecretSecret);
  if (!clientId || !clientSecret) {
    throw new Error(
      `${config.clientIdSecret} and ${config.clientSecretSecret} must be configured.`,
    );
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirectUri,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  if (provider === "dropbox") {
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
  } else {
    headers.Authorization =
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
  }

  if (pending.codeVerifier) {
    form.set("code_verifier", pending.codeVerifier);
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
    body: form.toString(),
    redirect: "error",
  });

  const text = await response.text();
  let body: {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${config.label} token exchange returned non-JSON HTTP ${response.status}`);
  }

  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ??
        body.error ??
        `${config.label} token exchange failed with HTTP ${response.status}`,
    );
  }

  return body;
}

function registerCallback(api: OpenClawPluginApi, provider: BrowserOAuthProvider): void {
  const config = PROVIDERS[provider];

  api.registerHttpRoute({
    path: `/nexus-kit/oauth/${provider}/callback`,
    auth: "plugin",
    match: "exact",
    async handler(req: IncomingMessage, res: ServerResponse) {
      if (req.method !== "GET") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET");
        res.end("Method not allowed");
        return true;
      }

      const host = req.headers.host ?? "localhost";
      const requestUrl = new URL(req.url ?? "/", `https://${host}`);
      const oauthError = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");

      if (oauthError) {
        consumePending(provider);
        html(
          res,
          400,
          `${config.label} authorization was not completed`,
          "The provider did not grant the requested access. You can close this page and try again later.",
        );
        return true;
      }

      const pending = readPending(provider);
      if (!pending || !code || !state) {
        html(
          res,
          400,
          `${config.label} authorization link is no longer valid`,
          "The authorization request is missing or expired. Start authorization again from Kit.",
        );
        return true;
      }

      if (Date.now() - pending.createdAt > TTL_MS) {
        consumePending(provider);
        html(
          res,
          400,
          `${config.label} authorization link expired`,
          "Start authorization again from Kit to get a new approval link.",
        );
        return true;
      }

      if (!stateMatches(state, pending.stateHash)) {
        html(
          res,
          403,
          `${config.label} authorization could not be verified`,
          "The security state did not match. Nothing was stored.",
        );
        return true;
      }

      consumePending(provider);

      try {
        const token = await exchangeCode(provider, code, pending);

        if (!token.refresh_token) {
          html(
            res,
            409,
            `${config.label} authorized but did not return a refresh token`,
            "Nothing was overwritten. Start authorization again and approve persistent/offline access.",
          );
          return true;
        }

        setConnectorSecret(config.refreshTokenSecret, token.refresh_token);
        if (token.scope) {
          setConnectorSecret(config.grantedScopesSecret, token.scope);
        }

        html(
          res,
          200,
          `${config.label} authorization complete`,
          "Kit received and stored the authorization securely. No token needs to be copied. You can close this page.",
        );
      } catch {
        html(
          res,
          502,
          `${config.label} authorization could not be saved`,
          "The callback was valid, but token exchange failed. No token was displayed.",
        );
      }

      return true;
    },
  });
}

export function registerBrowserOAuth(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "nexus_browser_oauth_start",
    description:
      "Generate a short-lived browser approval link for Dropbox, Canva, Spotify, or Zoom. The provider callback stores the refresh token directly in Kit's protected connector vault.",
    parameters: Type.Object({
      provider: Type.Union([
        Type.Literal("dropbox"),
        Type.Literal("canva"),
        Type.Literal("spotify"),
        Type.Literal("zoom"),
      ]),
    }),
    async execute(_id, params) {
      const provider = params.provider as BrowserOAuthProvider;
      const config = PROVIDERS[provider];
      const redirectUri = getConnectorSecret(config.redirectSecret);

      if (!getConnectorSecret(config.clientIdSecret) || !getConnectorSecret(config.clientSecretSecret)) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false,
              error:
                `${config.clientIdSecret} and ${config.clientSecretSecret} must be configured first.`,
            }),
          }],
        };
      }
      if (!redirectUri) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: `${config.redirectSecret} is not configured.`,
            }),
          }],
        };
      }

      const state = crypto.randomBytes(32).toString("base64url");
      const codeVerifier = config.usePkce
        ? crypto.randomBytes(64).toString("base64url")
        : undefined;
      const codeChallenge = codeVerifier
        ? sha256Base64Url(codeVerifier)
        : undefined;

      writePending(provider, {
        stateHash: sha256Base64Url(state),
        redirectUri,
        createdAt: Date.now(),
        ...(codeVerifier ? { codeVerifier } : {}),
      });

      try {
        const authorizationUrl = buildAuthorizationUrl(provider, state, codeChallenge);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                provider,
                expiresInMinutes: 15,
                authorizationUrl,
                instructions:
                  "Open the authorization URL in Safari and approve the requested access. Do not copy the authorization code or tokens back into chat; Kit's callback stores the refresh token directly.",
              },
              null,
              2,
            ),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        consumePending(provider);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
        };
      }
    },
  });

  registerCallback(api, "dropbox");
  registerCallback(api, "canva");
  registerCallback(api, "spotify");
  registerCallback(api, "zoom");
}
