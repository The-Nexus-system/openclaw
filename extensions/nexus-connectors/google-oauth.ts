import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { getConnectorSecret, setConnectorSecret } from "./connector-secrets.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const PENDING_TTL_MS = 15 * 60 * 1000;

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/contacts.readonly",
];

type PendingGoogleAuth = {
  stateHash: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
};

function stateDir(): string {
  return (
    process.env.NEXUS_KIT_OAUTH_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw", "kit", "oauth")
  );
}

function pendingFile(): string {
  return path.join(stateDir(), "google-pending.json");
}

function sha256Base64Url(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value, "utf8")
    .digest("base64url");
}

function writePending(value: PendingGoogleAuth): void {
  const dir = stateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = pendingFile();
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
  if (process.platform !== "win32") fs.chmodSync(file, 0o600);
}

function readPending(): PendingGoogleAuth | null {
  const file = pendingFile();
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Google OAuth pending-state file is unsafe.");
  }
  if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
    throw new Error("Google OAuth pending-state file permissions are unsafe.");
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as PendingGoogleAuth;
}

function consumePending(): PendingGoogleAuth | null {
  const value = readPending();
  try {
    fs.unlinkSync(pendingFile());
  } catch {
    // A missing pending file is harmless after it has already been consumed.
  }
  return value;
}

function sendHtml(res: ServerResponse, status: number, title: string, body: string): void {
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>`;
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(html);
}

async function exchangeGoogleCode(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ refresh_token?: string; scope?: string; error?: string; error_description?: string }> {
  const clientId = getConnectorSecret("GOOGLE_CLIENT_ID");
  const clientSecret = getConnectorSecret("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials are not configured.");
  }

  const form = new URLSearchParams({
    code: params.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "error",
  });

  const text = await response.text();
  let parsed: {
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Google token exchange returned non-JSON HTTP ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(
      parsed.error_description ?? parsed.error ?? `Google token exchange failed with HTTP ${response.status}`,
    );
  }

  return parsed;
}

function timingSafeStateMatch(actualState: string, expectedHash: string): boolean {
  const actualHash = sha256Base64Url(actualState);
  const actual = Buffer.from(actualHash);
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function registerGoogleOAuth(api: OpenClawPluginApi): void {
  api.registerTool({
    name: "nexus_google_oauth_start",
    description:
      "Create a short-lived Google OAuth approval link for Kit's independent Gmail, Calendar, Drive, and Contacts access. The user approves in a browser; the callback stores the refresh token directly in the protected connector vault.",
    parameters: Type.Object({}),
    async execute() {
      const clientId = getConnectorSecret("GOOGLE_CLIENT_ID");
      const redirectUri = getConnectorSecret("GOOGLE_REDIRECT_URI");

      if (!clientId) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "GOOGLE_CLIENT_ID is not configured in Kit's protected connector store.",
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
              error:
                "GOOGLE_REDIRECT_URI is not configured. It must exactly match the HTTPS redirect URI registered for Kit in Google Cloud.",
            }),
          }],
        };
      }
      if (!redirectUri.startsWith("https://")) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "GOOGLE_REDIRECT_URI must use HTTPS for the VPS callback flow.",
            }),
          }],
        };
      }

      const state = crypto.randomBytes(32).toString("base64url");
      const codeVerifier = crypto.randomBytes(48).toString("base64url");
      const codeChallenge = sha256Base64Url(codeVerifier);

      writePending({
        stateHash: sha256Base64Url(state),
        codeVerifier,
        redirectUri,
        createdAt: Date.now(),
      });

      const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              expiresInMinutes: 15,
              authorizationUrl: `${GOOGLE_AUTH_URL}?${query.toString()}`,
              instructions:
                "Open the authorization URL in Safari, choose the Google account, review the permissions, and approve. Do not copy any authorization code or token back into chat; Kit's callback stores the refresh token directly.",
            },
            null,
            2,
          ),
        }],
      };
    },
  });

  api.registerHttpRoute({
    path: "/nexus-kit/oauth/google/callback",
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
      const error = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");

      if (error) {
        consumePending();
        sendHtml(
          res,
          400,
          "Google authorization was not completed",
          "Google did not grant the requested access. You can close this page and try again later.",
        );
        return true;
      }

      const pending = readPending();
      if (!pending || !state || !code) {
        sendHtml(
          res,
          400,
          "Google authorization link is no longer valid",
          "The authorization request is missing or expired. Start Google authorization again from Kit.",
        );
        return true;
      }

      if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
        consumePending();
        sendHtml(
          res,
          400,
          "Google authorization link expired",
          "This approval link is older than 15 minutes. Start Google authorization again from Kit.",
        );
        return true;
      }

      if (!timingSafeStateMatch(state, pending.stateHash)) {
        sendHtml(
          res,
          403,
          "Google authorization could not be verified",
          "The security state did not match. Nothing was stored. Start authorization again from Kit.",
        );
        return true;
      }

      consumePending();

      try {
        const token = await exchangeGoogleCode({
          code,
          redirectUri: pending.redirectUri,
          codeVerifier: pending.codeVerifier,
        });

        if (!token.refresh_token) {
          sendHtml(
            res,
            409,
            "Google authorized access but no refresh token was returned",
            "Nothing was overwritten. Start authorization again and approve the requested offline access.",
          );
          return true;
        }

        setConnectorSecret("GOOGLE_REFRESH_TOKEN", token.refresh_token);
        if (token.scope) {
          setConnectorSecret("GOOGLE_GRANTED_SCOPES", token.scope);
        }

        sendHtml(
          res,
          200,
          "Google authorization complete",
          "Kit received and stored the Google authorization securely. No token needs to be copied. You can close this page.",
        );
      } catch {
        sendHtml(
          res,
          502,
          "Google authorization could not be saved",
          "The callback was valid, but Google token exchange failed. No token was displayed. Start authorization again from Kit.",
        );
      }

      return true;
    },
  });
}
