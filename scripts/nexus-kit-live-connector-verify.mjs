#!/usr/bin/env node

const target = (process.argv[2] || "all").toLowerCase();

function out(record) {
  process.stdout.write(JSON.stringify(record) + "\n");
}

async function getJson(url, headers) {
  const response = await fetch(url, { method: "GET", headers, redirect: "error" });
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep non-JSON text.
  }
  return { ok: response.ok, status: response.status, body };
}

async function googleToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "error",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google OAuth HTTP ${response.status}`);
  }

  return data.access_token;
}

async function dropboxToken() {
  if (process.env.DROPBOX_ACCESS_TOKEN) return process.env.DROPBOX_ACCESS_TOKEN;

  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  if (!appKey || !appSecret || !refreshToken) return null;

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

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `Dropbox OAuth HTTP ${response.status}`,
    );
  }
  return data.access_token;
}

async function microsoftToken() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const refreshToken = process.env.MICROSOFT_REFRESH_TOKEN;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || "common";

  if (!clientId || !refreshToken) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope:
      process.env.MICROSOFT_SCOPES?.trim() ||
      "openid offline_access User.Read Mail.Read Calendars.Read",
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "error",
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `Microsoft OAuth HTTP ${response.status}`,
    );
  }

  return data.access_token;
}

async function probeGithub() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { connector: "github", state: "unconfigured" };

  const result = await getJson("https://api.github.com/user", {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nexus-kit-openclaw",
  });

  return {
    connector: "github",
    state: result.ok ? "read-verified" : "failed",
    checks: [{ endpoint: "/user", ok: result.ok, status: result.status }],
  };
}

async function probeDigitalOcean() {
  const token = process.env.DIGITALOCEAN_ACCESS_TOKEN;
  if (!token) return { connector: "digitalocean", state: "unconfigured" };

  const result = await getJson("https://api.digitalocean.com/v2/account", {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  });

  return {
    connector: "digitalocean",
    state: result.ok ? "read-verified" : "failed",
    checks: [{ endpoint: "/v2/account", ok: result.ok, status: result.status }],
  };
}

async function probeGoogle(kind) {
  const token = await googleToken();
  if (!token) return { connector: kind, state: "unconfigured" };

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  };

  const endpoints = {
    gmail: [
      ["gmail-profile", "https://gmail.googleapis.com/gmail/v1/users/me/profile"],
    ],
    "google-calendar": [
      [
        "calendar-list",
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
      ],
    ],
    "google-drive": [
      [
        "drive-files",
        "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)",
      ],
    ],
    "google-contacts": [
      [
        "people-me",
        "https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses",
      ],
    ],
  };

  const checks = [];
  for (const [name, url] of endpoints[kind]) {
    const result = await getJson(url, headers);
    checks.push({ endpoint: name, ok: result.ok, status: result.status });
  }

  return {
    connector: kind,
    state: checks.every((check) => check.ok) ? "read-verified" : "failed",
    checks,
  };
}

async function probeDropbox() {
  const token = await dropboxToken();
  if (!token) return { connector: "dropbox", state: "unconfigured" };

  const response = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "nexus-kit-openclaw",
    },
    body: "{}",
    redirect: "error",
  });

  return {
    connector: "dropbox",
    state: response.ok ? "read-verified" : "failed",
    checks: [
      {
        endpoint: "/2/users/get_current_account",
        ok: response.ok,
        status: response.status,
      },
    ],
  };
}

async function probeMicrosoft() {
  const token = await microsoftToken();
  if (!token) return { connector: "microsoft-graph", state: "unconfigured" };

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  };

  const endpoints = [
    [
      "graph-identity",
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail",
    ],
    [
      "outlook-mail",
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id,displayName,totalItemCount,unreadItemCount",
    ],
    [
      "outlook-calendar",
      "https://graph.microsoft.com/v1.0/me/calendars?$top=1&$select=id,name",
    ],
  ];

  const checks = [];
  for (const [name, url] of endpoints) {
    const result = await getJson(url, headers);
    checks.push({ endpoint: name, ok: result.ok, status: result.status });
  }

  return {
    connector: "microsoft-graph",
    state: checks.every((check) => check.ok) ? "read-verified" : "failed",
    checks,
  };
}

const probes = {
  github: probeGithub,
  digitalocean: probeDigitalOcean,
  gmail: () => probeGoogle("gmail"),
  "google-calendar": () => probeGoogle("google-calendar"),
  "google-drive": () => probeGoogle("google-drive"),
  "google-contacts": () => probeGoogle("google-contacts"),
  "microsoft-graph": probeMicrosoft,
  dropbox: probeDropbox,
};

const selected = target === "all" ? Object.keys(probes) : [target];

let failures = 0;
for (const name of selected) {
  const probe = probes[name];
  if (!probe) {
    out({ connector: name, state: "unknown-connector" });
    failures += 1;
    continue;
  }

  try {
    const result = await probe();
    out(result);
    if (result.state === "failed") failures += 1;
  } catch (error) {
    out({
      connector: name,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    failures += 1;
  }
}

process.exitCode = failures ? 1 : 0;
