import crypto from "node:crypto";
import { getConnectorSecret, getRotatingConnectorSecret } from "./connector-secrets.js";
import { ConnectorProbeError, providerGet } from "./shared.js";
import { metaGraphVersion } from "./social-shared.js";

export function openAIHeaders(): Record<string, string> {
  const apiKey = getConnectorSecret("OPENAI_API_KEY");
  if (!apiKey) {
    throw new ConnectorProbeError(
      "credentials",
      "OPENAI_API_KEY is not configured in the protected OpenClaw connector store.",
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  };

  const project = getConnectorSecret("OPENAI_PROJECT_ID")?.trim();
  const organization = getConnectorSecret("OPENAI_ORG_ID")?.trim();
  if (project) headers["OpenAI-Project"] = project;
  if (organization) headers["OpenAI-Organization"] = organization;

  return headers;
}

export async function openAIGet(relativePath: string) {
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return providerGet(`https://api.openai.com/v1${path}`, openAIHeaders());
}

export function metaDeveloperAppId(): string {
  const appId = getConnectorSecret("META_APP_ID")?.trim();
  if (!appId) {
    throw new ConnectorProbeError(
      "credentials",
      "META_APP_ID is not configured in the protected OpenClaw connector store.",
    );
  }
  return appId;
}

export function metaDeveloperAccessToken(): string {
  const explicit = getConnectorSecret("META_APP_ACCESS_TOKEN");
  if (explicit) return explicit;

  const userToken =
    getConnectorSecret("META_USER_ACCESS_TOKEN") ??
    getConnectorSecret("META_ACCESS_TOKEN");
  if (userToken) return userToken;

  const appId = getConnectorSecret("META_APP_ID");
  const appSecret = getConnectorSecret("META_APP_SECRET");
  if (appId && appSecret) {
    return `${appId}|${appSecret}`;
  }

  throw new ConnectorProbeError(
    "credentials",
    "Configure META_APP_ACCESS_TOKEN, a Meta user access token, or META_APP_ID plus META_APP_SECRET.",
  );
}

export async function metaDeveloperAppRead() {
  const version = metaGraphVersion();
  const appId = metaDeveloperAppId();
  const token = metaDeveloperAccessToken();
  const query = new URLSearchParams({
    fields: "id,name,namespace",
  });

  return providerGet(
    `https://graph.facebook.com/${version}/${encodeURIComponent(appId)}?${query.toString()}`,
    {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "nexus-kit-openclaw",
    },
  );
}


function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signJwtEs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: string,
): string {
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

function signJwtRs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: string,
): string {
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput, "utf8"), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

export function getAppStoreConnectToken(): string {
  const issuerId = getConnectorSecret("APPSTORE_ISSUER_ID")?.trim();
  const keyId = getConnectorSecret("APPSTORE_KEY_ID")?.trim();
  const privateKey = getConnectorSecret("APPSTORE_PRIVATE_KEY");

  if (!issuerId || !keyId || !privateKey) {
    throw new ConnectorProbeError(
      "credentials",
      "APPSTORE_ISSUER_ID, APPSTORE_KEY_ID, and APPSTORE_PRIVATE_KEY must be configured.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  return signJwtEs256(
    {
      alg: "ES256",
      kid: keyId,
      typ: "JWT",
    },
    {
      iss: issuerId,
      iat: now,
      exp: now + 20 * 60,
      aud: "appstoreconnect-v1",
    },
    privateKey,
  );
}

export async function appStoreConnectGet(relativePath: string) {
  const token = getAppStoreConnectToken();
  const apiPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return providerGet(`https://api.appstoreconnect.apple.com/v1${apiPath}`, {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  });
}

type GoogleServiceAccount = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

function parseGooglePlayServiceAccount(): GoogleServiceAccount | null {
  const raw = getConnectorSecret("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON");
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConnectorProbeError(
      "credentials",
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON.",
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConnectorProbeError(
      "credentials",
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON must contain a service-account JSON object.",
    );
  }

  return parsed as GoogleServiceAccount;
}

async function getGooglePlayServiceAccountToken(account: GoogleServiceAccount): Promise<string> {
  const email = account.client_email?.trim();
  const privateKey = account.private_key;
  const tokenUri = account.token_uri?.trim() || "https://oauth2.googleapis.com/token";

  if (!email || !privateKey) {
    throw new ConnectorProbeError(
      "credentials",
      "Google Play service-account JSON is missing client_email or private_key.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwtRs256(
    { alg: "RS256", typ: "JWT" },
    {
      iss: email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: tokenUri,
      iat: now,
      exp: now + 60 * 60,
    },
    privateKey,
  );

  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "error",
  });

  const text = await response.text();
  let body: { access_token?: string; error?: string; error_description?: string } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ConnectorProbeError(
      "token-exchange",
      `Google Play service-account token exchange returned non-JSON HTTP ${response.status}`,
    );
  }

  if (!response.ok || !body.access_token) {
    throw new ConnectorProbeError(
      "token-exchange",
      body.error_description ??
        body.error ??
        `Google Play service-account token exchange failed with HTTP ${response.status}`,
    );
  }

  return body.access_token;
}

async function getGooglePlayRefreshTokenAccessToken(): Promise<string> {
  const clientId = getConnectorSecret("GOOGLE_CLIENT_ID");
  const clientSecret = getConnectorSecret("GOOGLE_CLIENT_SECRET");
  const refreshToken = getRotatingConnectorSecret("GOOGLE_PLAY_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new ConnectorProbeError(
      "credentials",
      "Configure GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_PLAY_REFRESH_TOKEN.",
    );
  }

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "error",
  });

  const text = await response.text();
  let body: { access_token?: string; error?: string; error_description?: string } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ConnectorProbeError(
      "token-refresh",
      `Google Play OAuth refresh returned non-JSON HTTP ${response.status}`,
    );
  }

  if (!response.ok || !body.access_token) {
    throw new ConnectorProbeError(
      "token-refresh",
      body.error_description ??
        body.error ??
        `Google Play OAuth refresh failed with HTTP ${response.status}`,
    );
  }

  return body.access_token;
}

export async function getGooglePlayAccessToken(): Promise<string> {
  const account = parseGooglePlayServiceAccount();
  if (account) return getGooglePlayServiceAccountToken(account);
  return getGooglePlayRefreshTokenAccessToken();
}

export async function googlePlayGet(relativePath: string) {
  const token = await getGooglePlayAccessToken();
  const apiPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return providerGet(`https://androidpublisher.googleapis.com/androidpublisher/v3${apiPath}`, {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  });
}

export function googlePlayPackageName(): string {
  const packageName = getConnectorSecret("GOOGLE_PLAY_PACKAGE_NAME")?.trim();
  if (!packageName) {
    throw new ConnectorProbeError(
      "package",
      "GOOGLE_PLAY_PACKAGE_NAME must be configured to verify the Android Publisher API against a real app.",
    );
  }
  return packageName;
}
