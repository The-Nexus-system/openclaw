import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getConnectorSecret, setConnectorSecret } from "./connector-secrets.js";

const execFileAsync = promisify(execFile);

export type ConnectorRecord = {
  id: string;
  provider?: string;
  priority?: number;
  routes?: string[];
  credentialEnv?: string[];
  credentialAlternatives?: string[][];
  optionalCredentialEnv?: string[];
  requiredReadScopes?: string[];
  requiredWriteScopes?: string[];
  targetCapabilities?: string[];
  state?: string;
};

export type ConnectorRegistry = {
  schemaVersion?: number;
  connectors?: ConnectorRecord[];
};

export function resolveRegistryPath(pluginConfig: unknown): string {
  const configured =
    pluginConfig &&
    typeof pluginConfig === "object" &&
    "registryPath" in pluginConfig &&
    typeof (pluginConfig as { registryPath?: unknown }).registryPath === "string"
      ? (pluginConfig as { registryPath: string }).registryPath
      : undefined;

  return configured ?? path.join(os.homedir(), ".openclaw", "kit", "connectors.json");
}

export function loadRegistry(registryPath: string): ConnectorRegistry {
  const raw = fs.readFileSync(registryPath, "utf8");
  return JSON.parse(raw) as ConnectorRegistry;
}

export function normalizeApiPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("://") || trimmed.startsWith("//")) {
    throw new Error("path must be a provider-relative API path");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export async function providerGet(url: string, headers: Record<string, string>) {
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "error",
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON text.
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

export async function providerJsonRequest(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  headers: Record<string, string>,
  payload?: unknown,
) {
  const response = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect: "error",
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON text.
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getGoogleAccessToken(): Promise<string> {
  const clientId = getConnectorSecret("GOOGLE_CLIENT_ID");
  const clientSecret = getConnectorSecret("GOOGLE_CLIENT_SECRET");
  const refreshToken = getConnectorSecret("GOOGLE_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN must be configured on the OpenClaw host.",
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

  const body = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ??
        body.error ??
        `Google token refresh failed with HTTP ${response.status}`,
    );
  }

  return body.access_token;
}

export function googleServiceBase(service: string): string {
  switch (service) {
    case "gmail":
      return "https://gmail.googleapis.com/gmail/v1";
    case "calendar":
      return "https://www.googleapis.com/calendar/v3";
    case "drive":
      return "https://www.googleapis.com/drive/v3";
    case "people":
      return "https://people.googleapis.com/v1";
    default:
      throw new Error("unsupported Google service");
  }
}

export function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function safeHeaderValue(value: string, field: string): string {
  if (value.includes("\r") || value.includes("\n")) {
    throw new Error(`${field} must not contain line breaks`);
  }
  return value.trim();
}

export class ConnectorProbeError extends Error {
  constructor(
    public readonly phase: string,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorProbeError";
  }
}

export async function getMicrosoftAccessToken(requiredScopes: string[] = []): Promise<string> {
  const clientId = getConnectorSecret("MICROSOFT_CLIENT_ID");
  const refreshToken = getConnectorSecret("MICROSOFT_REFRESH_TOKEN");
  const tenant = getConnectorSecret("MICROSOFT_TENANT_ID")?.trim() || "common";
  const clientSecret = getConnectorSecret("MICROSOFT_CLIENT_SECRET");
  const configuredScopes =
    getConnectorSecret("MICROSOFT_SCOPES")?.trim() ||
    "openid offline_access User.Read Mail.Read Calendars.Read";
  const scope = Array.from(
    new Set([...configuredScopes.split(/\s+/u).filter(Boolean), ...requiredScopes]),
  ).join(" ");

  if (!clientId || !refreshToken) {
    throw new ConnectorProbeError(
      "credentials",
      "MICROSOFT_CLIENT_ID and MICROSOFT_REFRESH_TOKEN must be configured on the OpenClaw host.",
    );
  }

  const form = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope,
  });
  if (clientSecret) {
    form.set("client_secret", clientSecret);
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "error",
    },
  );

  const text = await response.text();
  let body: {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ConnectorProbeError(
      "token-refresh",
      `Microsoft token refresh returned non-JSON HTTP ${response.status}`,
    );
  }

  if (!response.ok || !body.access_token) {
    throw new ConnectorProbeError(
      "token-refresh",
      body.error_description ??
        body.error ??
        `Microsoft token refresh failed with HTTP ${response.status}`,
    );
  }

  return body.access_token;
}
export async function getDropboxAccessToken(): Promise<string> {
  const direct = getConnectorSecret("DROPBOX_ACCESS_TOKEN");
  if (direct) return direct;

  const appKey = getConnectorSecret("DROPBOX_APP_KEY");
  const appSecret = getConnectorSecret("DROPBOX_APP_SECRET");
  const refreshToken = getConnectorSecret("DROPBOX_REFRESH_TOKEN");

  if (!appKey || !appSecret || !refreshToken) {
    throw new ConnectorProbeError(
      "credentials",
      "Configure DROPBOX_ACCESS_TOKEN or DROPBOX_APP_KEY, DROPBOX_APP_SECRET, and DROPBOX_REFRESH_TOKEN on the OpenClaw host.",
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: appKey,
    client_secret: appSecret,
  });

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "error",
  });

  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    throw new ConnectorProbeError(
      "token-refresh",
      data.error_description ??
        data.error ??
        `Dropbox OAuth HTTP ${response.status}`,
    );
  }

  return data.access_token;
}

export async function dropboxApi(path: string, payload: unknown) {
  const token = await getDropboxAccessToken();
  return providerJsonRequest(
    `https://api.dropboxapi.com/2/${path}`,
    "POST",
    {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "nexus-kit-openclaw",
    },
    payload,
  );
}
export function notionHeaders(): Record<string, string> {
  const token = getConnectorSecret("NOTION_TOKEN") || getConnectorSecret("NOTION_ACCESS_TOKEN");
  if (!token) {
    throw new ConnectorProbeError(
      "credentials",
      "NOTION_TOKEN or NOTION_ACCESS_TOKEN must be configured on the OpenClaw host.",
    );
  }

  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": getConnectorSecret("NOTION_VERSION")?.trim() || "2026-03-11",
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  };
}
export async function linearGraphql(query: string, variables: Record<string, unknown> = {}) {
  const apiKey = getConnectorSecret("LINEAR_API_KEY");
  const accessToken = getConnectorSecret("LINEAR_ACCESS_TOKEN");
  if (!apiKey && !accessToken) {
    throw new ConnectorProbeError(
      "credentials",
      "LINEAR_API_KEY or LINEAR_ACCESS_TOKEN must be configured on the OpenClaw host.",
    );
  }

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: accessToken ? `Bearer ${accessToken}` : apiKey!,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "nexus-kit-openclaw",
    },
    body: JSON.stringify({ query, variables }),
    redirect: "error",
  });

  const text = await response.text();
  let body: { data?: unknown; errors?: unknown[] } | unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Keep text for diagnostics.
  }

  const graphqlErrors =
    body && typeof body === "object" && "errors" in body && Array.isArray((body as { errors?: unknown }).errors)
      ? (body as { errors: unknown[] }).errors
      : [];

  return {
    ok: response.ok && graphqlErrors.length === 0,
    status: response.status,
    body,
    graphqlErrors,
  };
}
export async function getZoomAccessToken(): Promise<{ token: string; mode: "direct" | "refresh" | "server-to-server" }> {
  const direct = getConnectorSecret("ZOOM_ACCESS_TOKEN");
  if (direct) return { token: direct, mode: "direct" };

  const clientId = getConnectorSecret("ZOOM_CLIENT_ID");
  const clientSecret = getConnectorSecret("ZOOM_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new ConnectorProbeError(
      "credentials",
      "Configure ZOOM_ACCESS_TOKEN or ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET on the OpenClaw host.",
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const refreshToken = getConnectorSecret("ZOOM_REFRESH_TOKEN");

  if (refreshToken) {
    const response = await fetch(
      `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        redirect: "error",
      },
    );
    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      reason?: string;
    };
    if (!response.ok || !data.access_token) {
      throw new ConnectorProbeError(
        "token-refresh",
        data.reason ?? data.error ?? `Zoom OAuth HTTP ${response.status}`,
      );
    }
    if (data.refresh_token) {
      setConnectorSecret("ZOOM_REFRESH_TOKEN", data.refresh_token);
    }
    return { token: data.access_token, mode: "refresh" };
  }

  const accountId = getConnectorSecret("ZOOM_ACCOUNT_ID");
  if (!accountId) {
    throw new ConnectorProbeError(
      "credentials",
      "ZOOM_ACCOUNT_ID is required for Zoom server-to-server OAuth when no direct or refresh token is configured.",
    );
  }

  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      redirect: "error",
    },
  );
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    reason?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new ConnectorProbeError(
      "token-refresh",
      data.reason ?? data.error ?? `Zoom server OAuth HTTP ${response.status}`,
    );
  }
  return { token: data.access_token, mode: "server-to-server" };
}

export function zoomTargetUser(mode: "direct" | "refresh" | "server-to-server", explicit?: string): string {
  const requested = explicit?.trim();
  if (requested) return requested;
  if (mode === "server-to-server") {
    const configured = getConnectorSecret("ZOOM_USER_ID")?.trim();
    if (!configured) {
      throw new ConnectorProbeError(
        "target-user",
        "ZOOM_USER_ID or an explicit userId is required for server-to-server Zoom access.",
      );
    }
    return configured;
  }
  return "me";
}



export async function runExpoProjectRead(
  operation: "info" | "status",
  limit = 3,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const token = getConnectorSecret("EXPO_TOKEN");
  if (!token) {
    throw new ConnectorProbeError(
      "credentials",
      "EXPO_TOKEN must be configured in the protected OpenClaw connector store.",
    );
  }

  const projectDir = getConnectorSecret("EXPO_PROJECT_DIR")?.trim();
  if (!projectDir) {
    throw new ConnectorProbeError(
      "project",
      "EXPO_PROJECT_DIR must point to a linked Expo/EAS project on the OpenClaw host.",
    );
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(projectDir);
  } catch {
    throw new ConnectorProbeError(
      "project",
      "EXPO_PROJECT_DIR does not exist on the OpenClaw host.",
    );
  }
  if (!stat.isDirectory()) {
    throw new ConnectorProbeError("project", "EXPO_PROJECT_DIR must be a directory.");
  }

  const args =
    operation === "status"
      ? ["project:status", "--limit", String(Math.max(1, Math.min(limit, 25))), "--json", "--non-interactive"]
      : ["project:info", "--json", "--non-interactive"];

  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
    CI: "1",
    EXPO_TOKEN: token,
  };

  try {
    const { stdout } = await execFileAsync("eas", args, {
      cwd: projectDir,
      env: childEnv,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });

    const text = stdout.trim();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new ConnectorProbeError(
        "response",
        "EAS CLI returned non-JSON output for a JSON read command.",
      );
    }

    return { ok: true, status: 200, body };
  } catch (error) {
    if (error instanceof ConnectorProbeError) throw error;

    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";

    if (code === "ENOENT") {
      throw new ConnectorProbeError(
        "runtime",
        "EAS CLI is not installed or is not available in PATH on the OpenClaw host.",
      );
    }

    throw new ConnectorProbeError(
      "service",
      "EAS CLI could not complete the authenticated Expo project read.",
    );
  }
}


export async function getSpotifyAccessToken(): Promise<string> {
  const clientId = getConnectorSecret("SPOTIFY_CLIENT_ID");
  const clientSecret = getConnectorSecret("SPOTIFY_CLIENT_SECRET");
  const refreshToken = getConnectorSecret("SPOTIFY_REFRESH_TOKEN");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new ConnectorProbeError(
      "credentials",
      "SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN must be configured.",
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
    redirect: "error",
  });

  const text = await response.text();
  let body: {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ConnectorProbeError(
      "token-refresh",
      `Spotify token refresh returned non-JSON HTTP ${response.status}`,
    );
  }

  if (!response.ok || !body.access_token) {
    throw new ConnectorProbeError(
      "token-refresh",
      body.error_description ??
        body.error ??
        `Spotify token refresh failed with HTTP ${response.status}`,
    );
  }

  if (body.refresh_token) {
    setConnectorSecret("SPOTIFY_REFRESH_TOKEN", body.refresh_token);
  }
  if (body.scope) {
    setConnectorSecret("SPOTIFY_GRANTED_SCOPES", body.scope);
  }

  return body.access_token;
}

export async function spotifyGet(relativePath: string) {
  const token = await getSpotifyAccessToken();
  const apiPath = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return providerGet(`https://api.spotify.com/v1${apiPath}`, {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  });
}
