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

async function zoomAccess() {
  if (process.env.ZOOM_ACCESS_TOKEN) {
    return { token: process.env.ZOOM_ACCESS_TOKEN, mode: "direct" };
  }

  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");

  if (process.env.ZOOM_REFRESH_TOKEN) {
    const response = await fetch(
      `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.ZOOM_REFRESH_TOKEN)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        redirect: "error",
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      throw new Error(data.reason || data.error || `Zoom OAuth HTTP ${response.status}`);
    }
    return { token: data.access_token, mode: "refresh" };
  }

  if (!process.env.ZOOM_ACCOUNT_ID) return null;

  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(process.env.ZOOM_ACCOUNT_ID)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      redirect: "error",
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.reason || data.error || `Zoom server OAuth HTTP ${response.status}`);
  }
  return { token: data.access_token, mode: "server-to-server" };
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

async function probeFigma() {
  const personalToken = process.env.FIGMA_TOKEN;
  const oauthToken = process.env.FIGMA_ACCESS_TOKEN;
  if (!personalToken && !oauthToken) {
    return { connector: "figma", state: "unconfigured" };
  }

  const result = await getJson("https://api.figma.com/v1/me", {
    ...(oauthToken
      ? { Authorization: `Bearer ${oauthToken}` }
      : { "X-Figma-Token": personalToken }),
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  });

  return {
    connector: "figma",
    state: result.ok ? "read-verified" : "failed",
    checks: [{ endpoint: "/v1/me", ok: result.ok, status: result.status }],
  };
}

async function probeZoom() {
  const auth = await zoomAccess();
  if (!auth) return { connector: "zoom", state: "unconfigured" };

  const userId =
    auth.mode === "server-to-server"
      ? process.env.ZOOM_USER_ID?.trim()
      : "me";

  if (!userId) {
    return {
      connector: "zoom",
      state: "unconfigured",
      error: "ZOOM_USER_ID is required for server-to-server verification.",
    };
  }

  const result = await getJson(
    `https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/meetings?type=previous_meetings&page_size=1`,
    {
      Authorization: `Bearer ${auth.token}`,
      Accept: "application/json",
      "User-Agent": "nexus-kit-openclaw",
    },
  );

  return {
    connector: "zoom",
    state: result.ok ? "read-verified" : "failed",
    checks: [
      {
        endpoint: "previous meetings",
        ok: result.ok,
        status: result.status,
      },
    ],
  };
}

async function probeLinear() {
  const apiKey = process.env.LINEAR_API_KEY;
  const accessToken = process.env.LINEAR_ACCESS_TOKEN;
  if (!apiKey && !accessToken) {
    return { connector: "linear", state: "unconfigured" };
  }

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: accessToken ? `Bearer ${accessToken}` : apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "nexus-kit-openclaw",
    },
    body: JSON.stringify({
      query: "query NexusKitViewer { viewer { id name email } }",
    }),
    redirect: "error",
  });

  const body = await response.json().catch(() => ({}));
  const graphqlErrors = Array.isArray(body?.errors) ? body.errors : [];
  const ok = response.ok && graphqlErrors.length === 0 && Boolean(body?.data?.viewer?.id);

  return {
    connector: "linear",
    state: ok ? "read-verified" : "failed",
    checks: [
      {
        endpoint: "GraphQL viewer",
        ok,
        status: response.status,
        graphqlErrorCount: graphqlErrors.length,
      },
    ],
  };
}

async function probeNotion() {
  const token = process.env.NOTION_TOKEN || process.env.NOTION_ACCESS_TOKEN;
  if (!token) return { connector: "notion", state: "unconfigured" };

  const result = await getJson("https://api.notion.com/v1/users/me", {
    Authorization: `Bearer ${token}`,
    "Notion-Version": process.env.NOTION_VERSION?.trim() || "2026-03-11",
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  });

  return {
    connector: "notion",
    state: result.ok ? "read-verified" : "failed",
    checks: [{ endpoint: "/v1/users/me", ok: result.ok, status: result.status }],
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
  notion: probeNotion,
  linear: probeLinear,
  zoom: probeZoom,
  figma: probeFigma,
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
