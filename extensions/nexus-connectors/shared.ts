import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

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
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const refreshToken = process.env.MICROSOFT_REFRESH_TOKEN;
  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const configuredScopes =
    process.env.MICROSOFT_SCOPES?.trim() ||
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
  const direct = process.env.DROPBOX_ACCESS_TOKEN;
  if (direct) return direct;

  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

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
  const token = process.env.NOTION_TOKEN || process.env.NOTION_ACCESS_TOKEN;
  if (!token) {
    throw new Error("NOTION_TOKEN or NOTION_ACCESS_TOKEN must be configured on the OpenClaw host.");
  }

  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": process.env.NOTION_VERSION?.trim() || "2026-03-11",
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  };
}
export async function linearGraphql(query: string, variables: Record<string, unknown> = {}) {
  const apiKey = process.env.LINEAR_API_KEY;
  const accessToken = process.env.LINEAR_ACCESS_TOKEN;
  if (!apiKey && !accessToken) {
    throw new Error("LINEAR_API_KEY or LINEAR_ACCESS_TOKEN must be configured on the OpenClaw host.");
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
  const direct = process.env.ZOOM_ACCESS_TOKEN;
  if (direct) return { token: direct, mode: "direct" };

  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Configure ZOOM_ACCESS_TOKEN or ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET on the OpenClaw host.",
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  const refreshToken = process.env.ZOOM_REFRESH_TOKEN;

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
      error?: string;
      reason?: string;
    };
    if (!response.ok || !data.access_token) {
      throw new Error(data.reason ?? data.error ?? `Zoom OAuth HTTP ${response.status}`);
    }
    return { token: data.access_token, mode: "refresh" };
  }

  const accountId = process.env.ZOOM_ACCOUNT_ID;
  if (!accountId) {
    throw new Error(
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
    throw new Error(data.reason ?? data.error ?? `Zoom server OAuth HTTP ${response.status}`);
  }
  return { token: data.access_token, mode: "server-to-server" };
}

export function zoomTargetUser(mode: "direct" | "refresh" | "server-to-server", explicit?: string): string {
  const requested = explicit?.trim();
  if (requested) return requested;
  if (mode === "server-to-server") {
    const configured = process.env.ZOOM_USER_ID?.trim();
    if (!configured) {
      throw new Error("ZOOM_USER_ID or an explicit userId is required for server-to-server Zoom access.");
    }
    return configured;
  }
  return "me";
}

