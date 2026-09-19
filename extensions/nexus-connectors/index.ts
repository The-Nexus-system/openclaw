import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

type ConnectorRecord = {
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

type ConnectorRegistry = {
  schemaVersion?: number;
  connectors?: ConnectorRecord[];
};

function resolveRegistryPath(pluginConfig: unknown): string {
  const configured =
    pluginConfig &&
    typeof pluginConfig === "object" &&
    "registryPath" in pluginConfig &&
    typeof (pluginConfig as { registryPath?: unknown }).registryPath === "string"
      ? (pluginConfig as { registryPath: string }).registryPath
      : undefined;

  return configured ?? path.join(os.homedir(), ".openclaw", "kit", "connectors.json");
}

function loadRegistry(registryPath: string): ConnectorRegistry {
  const raw = fs.readFileSync(registryPath, "utf8");
  return JSON.parse(raw) as ConnectorRegistry;
}

function normalizeApiPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("://") || trimmed.startsWith("//")) {
    throw new Error("path must be a provider-relative API path");
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function providerGet(url: string, headers: Record<string, string>) {
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

async function providerJsonRequest(
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getGoogleAccessToken(): Promise<string> {
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

function googleServiceBase(service: string): string {
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

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function safeHeaderValue(value: string, field: string): string {
  if (value.includes("\r") || value.includes("\n")) {
    throw new Error(`${field} must not contain line breaks`);
  }
  return value.trim();
}

class ConnectorProbeError extends Error {
  constructor(
    public readonly phase: string,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorProbeError";
  }
}

async function getMicrosoftAccessToken(requiredScopes: string[] = []): Promise<string> {
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
async function getDropboxAccessToken(): Promise<string> {
  const direct = process.env.DROPBOX_ACCESS_TOKEN;
  if (direct) return direct;

  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

  if (!appKey || !appSecret || !refreshToken) {
    throw new Error(
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
    throw new Error(
      data.error_description ??
        data.error ??
        `Dropbox OAuth HTTP ${response.status}`,
    );
  }

  return data.access_token;
}

async function dropboxApi(path: string, payload: unknown) {
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
function notionHeaders(): Record<string, string> {
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

export default definePluginEntry({
  id: "nexus-connectors",
  name: "Nexus Connectors",
  description:
    "Portable connector readiness and independent provider access for the Nexus Kit gateway.",
  register(api) {
    api.registerTool({
      name: "nexus_connector_status",
      description:
        "Inspect the independent Nexus connector registry. Reports routes, capabilities, declared state, and whether credential environment variables are present. It never returns credential values and does not prove live provider access.",
      parameters: Type.Object({
        connector: Type.Optional(
          Type.String({
            description: "Optional connector id such as github, gmail, or digitalocean.",
          }),
        ),
      }),
      async execute(_id, params) {
        const registryPath = resolveRegistryPath(api.pluginConfig);

        let registry: ConnectorRegistry;
        try {
          registry = loadRegistry(registryPath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    ok: false,
                    registryPath,
                    error: message,
                    note: "Run the Nexus Kit gateway bootstrap to seed the connector registry.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const requested =
          typeof params.connector === "string" ? params.connector.trim().toLowerCase() : "";

        const records = (registry.connectors ?? [])
          .filter((item) => !requested || item.id.toLowerCase() === requested)
          .map((item) => {
            const markers = item.credentialEnv ?? [];
            const alternatives = item.credentialAlternatives ?? [];
            const optionalMarkers = item.optionalCredentialEnv ?? [];
            const credentialMarkers = Object.fromEntries(
              markers.map((name) => [name, Boolean(process.env[name])]),
            );
            const alternativeStatus = alternatives.map((group) => ({
              markers: Object.fromEntries(group.map((name) => [name, Boolean(process.env[name])])),
              satisfied: group.every((name) => Boolean(process.env[name])),
            }));
            const optionalCredentialMarkers = Object.fromEntries(
              optionalMarkers.map((name) => [name, Boolean(process.env[name])]),
            );

            return {
              id: item.id,
              provider: item.provider ?? item.id,
              priority: item.priority ?? null,
              state: item.state ?? "unknown",
              routes: item.routes ?? [],
              targetCapabilities: item.targetCapabilities ?? [],
              credentialMarkers,
              credentialAlternatives: alternativeStatus,
              optionalCredentialMarkers,
              requiredReadScopes: item.requiredReadScopes ?? [],
              requiredWriteScopes: item.requiredWriteScopes ?? [],
              liveProviderVerified: false,
            };
          });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  registryPath,
                  connector: requested || null,
                  records,
                  warning:
                    "Credential-marker presence is not authentication. A harmless live provider probe is required before marking a connector read-verified.",
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    });


    api.registerTool({
      name: "nexus_connector_probe",
      description:
        "Run a harmless live read against an independently configured external service and report whether OpenClaw actually reached the intended provider. This is the verification step used before calling a connector read-verified.",
      parameters: Type.Object({
        connector: Type.Union([
          Type.Literal("github"),
          Type.Literal("digitalocean"),
          Type.Literal("gmail"),
          Type.Literal("google-calendar"),
          Type.Literal("google-drive"),
          Type.Literal("google-contacts"),
          Type.Literal("microsoft-graph"),
          Type.Literal("dropbox"),
          Type.Literal("notion"),
        ]),
      }),
      async execute(_id, params) {
        const checks: Array<{ name: string; ok: boolean; status: number }> = [];
        try {

          if (params.connector === "github") {
            const token = process.env.GITHUB_TOKEN;
            if (!token) {
              throw new Error("GITHUB_TOKEN is not configured on the OpenClaw host.");
            }
            const result = await providerGet("https://api.github.com/user", {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "nexus-kit-openclaw",
            });
            checks.push({ name: "authenticated-user", ok: result.ok, status: result.status });
          }

          if (params.connector === "digitalocean") {
            const token = process.env.DIGITALOCEAN_ACCESS_TOKEN;
            if (!token) {
              throw new Error(
                "DIGITALOCEAN_ACCESS_TOKEN is not configured on the OpenClaw host.",
              );
            }
            const result = await providerGet("https://api.digitalocean.com/v2/account", {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "User-Agent": "nexus-kit-openclaw",
            });
            checks.push({ name: "account", ok: result.ok, status: result.status });
          }

          if (
            params.connector === "gmail" ||
            params.connector === "google-calendar" ||
            params.connector === "google-drive" ||
            params.connector === "google-contacts"
          ) {
            const token = await getGoogleAccessToken();
            const headers = {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "User-Agent": "nexus-kit-openclaw",
            };

            if (params.connector === "gmail") {
              const result = await providerGet(
                "https://gmail.googleapis.com/gmail/v1/users/me/profile",
                headers,
              );
              checks.push({ name: "gmail-profile", ok: result.ok, status: result.status });
            }

            if (params.connector === "google-calendar") {
              const result = await providerGet(
                "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
                headers,
              );
              checks.push({ name: "calendar-list", ok: result.ok, status: result.status });
            }

            if (params.connector === "google-drive") {
              const result = await providerGet(
                "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)",
                headers,
              );
              checks.push({ name: "drive-files", ok: result.ok, status: result.status });
            }

            if (params.connector === "google-contacts") {
              const result = await providerGet(
                "https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses",
                headers,
              );
              checks.push({ name: "people-me", ok: result.ok, status: result.status });
            }
          }

          if (params.connector === "notion") {
            const result = await providerGet(
              "https://api.notion.com/v1/users/me",
              notionHeaders(),
            );
            checks.push({ name: "notion-user", ok: result.ok, status: result.status });
          }

          if (params.connector === "dropbox") {
            const result = await dropboxApi("users/get_current_account", {});
            checks.push({ name: "dropbox-account", ok: result.ok, status: result.status });
          }

          if (params.connector === "microsoft-graph") {
            const token = await getMicrosoftAccessToken();
            const headers = {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "User-Agent": "nexus-kit-openclaw",
            };

            const identity = await providerGet(
              "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail",
              headers,
            );
            checks.push({ name: "graph-identity", ok: identity.ok, status: identity.status });
            if (!identity.ok) {
              throw new ConnectorProbeError(
                "identity",
                `Microsoft Graph identity probe failed with HTTP ${identity.status}`,
              );
            }

            const mail = await providerGet(
              "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id,displayName,totalItemCount,unreadItemCount",
              headers,
            );
            checks.push({ name: "outlook-mail", ok: mail.ok, status: mail.status });
            if (!mail.ok) {
              throw new ConnectorProbeError(
                "mail",
                `Microsoft Graph mail probe failed with HTTP ${mail.status}`,
              );
            }

            const calendar = await providerGet(
              "https://graph.microsoft.com/v1.0/me/calendars?$top=1&$select=id,name",
              headers,
            );
            checks.push({ name: "outlook-calendar", ok: calendar.ok, status: calendar.status });
            if (!calendar.ok) {
              throw new ConnectorProbeError(
                "calendar",
                `Microsoft Graph calendar probe failed with HTTP ${calendar.status}`,
              );
            }
          }

          const readVerified = checks.length > 0 && checks.every((check) => check.ok);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    connector: params.connector,
                    readVerified,
                    checks,
                    note: readVerified
                      ? "Independent OpenClaw provider access reached every required probe endpoint."
                      : "At least one required live provider probe failed. Do not mark this connector read-verified.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const phase = error instanceof ConnectorProbeError ? error.phase : "unknown";
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    connector: params.connector,
                    readVerified: false,
                    phase,
                    checks,
                    error: message,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      },
    });

    api.registerTool({
      name: "nexus_github_get",
      description:
        "Perform an independently authenticated read-only GET against the GitHub REST API using GITHUB_TOKEN on the OpenClaw host. This does not use a ChatGPT connector.",
      parameters: Type.Object({
        path: Type.String({
          description:
            "GitHub REST API path such as /repos/OWNER/REPO or /user/repos?per_page=20.",
        }),
      }),
      async execute(_id, params) {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  error: "GITHUB_TOKEN is not configured on the OpenClaw host.",
                }),
              },
            ],
          };
        }

        try {
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(`https://api.github.com${apiPath}`, {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "nexus-kit-openclaw",
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool({
      name: "nexus_digitalocean_get",
      description:
        "Perform an independently authenticated read-only GET against the DigitalOcean v2 API using DIGITALOCEAN_ACCESS_TOKEN on the OpenClaw host. This does not use a ChatGPT connector.",
      parameters: Type.Object({
        path: Type.String({
          description: "DigitalOcean v2 path such as /account, /droplets, or /regions.",
        }),
      }),
      async execute(_id, params) {
        const token = process.env.DIGITALOCEAN_ACCESS_TOKEN;
        if (!token) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: false,
                  error: "DIGITALOCEAN_ACCESS_TOKEN is not configured on the OpenClaw host.",
                }),
              },
            ],
          };
        }

        try {
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(`https://api.digitalocean.com/v2${apiPath}`, {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "nexus-kit-openclaw",
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });


    api.registerTool({
      name: "nexus_notion_read",
      description:
        "Read Notion through an independently authenticated OpenClaw route. Supports token identity, workspace search, and page retrieval without using a ChatGPT connector.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("me"),
          Type.Literal("search"),
          Type.Literal("page"),
        ]),
        query: Type.Optional(Type.String()),
        pageId: Type.Optional(Type.String()),
        pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      async execute(_id, params) {
        try {
          const headers = notionHeaders();

          if (params.operation === "me") {
            const result = await providerGet("https://api.notion.com/v1/users/me", headers);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          if (params.operation === "search") {
            const result = await providerJsonRequest(
              "https://api.notion.com/v1/search",
              "POST",
              headers,
              {
                ...(params.query?.trim() ? { query: params.query.trim() } : {}),
                page_size: params.pageSize ?? 20,
                sort: {
                  direction: "descending",
                  timestamp: "last_edited_time",
                },
              },
            );
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          const pageId = params.pageId?.trim();
          if (!pageId) throw new Error("pageId is required for Notion page retrieval");
          const result = await providerGet(
            `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`,
            headers,
          );
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool({
      name: "nexus_dropbox_read",
      description:
        "Read Dropbox through an independently authenticated OpenClaw route. Operations are limited to account identity, folder listing, search, and metadata; this tool does not mutate Dropbox.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("account"),
          Type.Literal("list_folder"),
          Type.Literal("search"),
          Type.Literal("metadata"),
        ]),
        path: Type.Optional(Type.String()),
        query: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      }),
      async execute(_id, params) {
        try {
          let result;

          if (params.operation === "account") {
            result = await dropboxApi("users/get_current_account", {});
          } else if (params.operation === "list_folder") {
            result = await dropboxApi("files/list_folder", {
              path: params.path ?? "",
              recursive: false,
              include_deleted: false,
              include_non_downloadable_files: true,
              limit: params.limit ?? 20,
            });
          } else if (params.operation === "search") {
            const query = params.query?.trim();
            if (!query) throw new Error("query is required for Dropbox search");
            result = await dropboxApi("files/search_v2", {
              query,
              options: {
                path: params.path ?? "",
                max_results: params.limit ?? 20,
                file_status: "active",
              },
            });
          } else {
            const targetPath = params.path?.trim();
            if (!targetPath) throw new Error("path is required for Dropbox metadata");
            result = await dropboxApi("files/get_metadata", {
              path: targetPath,
              include_media_info: false,
              include_deleted: false,
              include_has_explicit_shared_members: true,
            });
          }

          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool({
      name: "nexus_microsoft_graph_get",
      description:
        "Perform an independently authenticated read-only GET against Microsoft Graph using OAuth credentials stored on the OpenClaw host. This is for Outlook mail/calendar and related Microsoft Graph reads and does not use a ChatGPT connector.",
      parameters: Type.Object({
        path: Type.String({
          description:
            "Microsoft Graph v1.0 provider-relative path such as /me, /me/messages?$top=10, or /me/calendars.",
        }),
      }),
      async execute(_id, params) {
        try {
          const token = await getMicrosoftAccessToken();
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(`https://graph.microsoft.com/v1.0${apiPath}`, {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "nexus-kit-openclaw",
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool(
      {
        name: "nexus_outlook_send_mail",
        description:
          "Send a plain-text email through Microsoft Graph using independent OpenClaw OAuth credentials, then verify that the message appears in Sent Items. This is a consequential write tool and does not use a ChatGPT connector.",
        parameters: Type.Object({
          to: Type.String(),
          subject: Type.String(),
          body: Type.String(),
        }),
        async execute(_id, params) {
          try {
            const to = safeHeaderValue(params.to, "to");
            const subject = safeHeaderValue(params.subject, "subject");
            if (!to) throw new Error("to is required");

            const token = await getMicrosoftAccessToken([
              "Mail.Read",
              "Mail.Send",
            ]);
            const headers = {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "User-Agent": "nexus-kit-openclaw",
            };

            const send = await providerJsonRequest(
              "https://graph.microsoft.com/v1.0/me/sendMail",
              "POST",
              headers,
              {
                message: {
                  subject,
                  body: {
                    contentType: "Text",
                    content: params.body,
                  },
                  toRecipients: [
                    {
                      emailAddress: {
                        address: to,
                      },
                    },
                  ],
                },
                saveToSentItems: true,
              },
            );

            if (!send.ok) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        ok: false,
                        stage: "send",
                        status: send.status,
                        body: send.body,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }

            let verified = false;
            let verificationStatus: number | null = null;
            for (let attempt = 0; attempt < 5; attempt += 1) {
              await sleep(700);
              const sent = await providerGet(
                "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=10&$select=id,subject,toRecipients,sentDateTime&$orderby=sentDateTime%20desc",
                headers,
              );
              verificationStatus = sent.status;
              if (sent.ok && sent.body && typeof sent.body === "object" && "value" in sent.body) {
                const value = (sent.body as { value?: Array<{ subject?: string; toRecipients?: Array<{ emailAddress?: { address?: string } }> }> }).value ?? [];
                verified = value.some(
                  (message) =>
                    message.subject === subject &&
                    (message.toRecipients ?? []).some(
                      (recipient) =>
                        recipient.emailAddress?.address?.toLowerCase() === to.toLowerCase(),
                    ),
                );
                if (verified) break;
              }
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: verified,
                      sentAccepted: true,
                      postconditionVerified: verified,
                      verificationStatus,
                      warning: verified
                        ? undefined
                        : "Graph accepted the send, but the Sent Items readback did not confirm it yet.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
            };
          }
        },
      },
      { optional: true },
    );

    api.registerTool(
      {
        name: "nexus_outlook_create_event",
        description:
          "Create an Outlook calendar event through Microsoft Graph using independent OpenClaw OAuth credentials, then read the event back by id to verify persistence. This is a consequential write tool and does not use a ChatGPT connector.",
        parameters: Type.Object({
          subject: Type.String(),
          start: Type.String({
            description: "Local date-time string accepted by Microsoft Graph, for example 2026-09-20T14:00:00.",
          }),
          end: Type.String({
            description: "Local date-time string accepted by Microsoft Graph.",
          }),
          timeZone: Type.String({
            description: "Microsoft Graph time-zone label, for example Eastern Standard Time.",
          }),
          body: Type.Optional(Type.String()),
        }),
        async execute(_id, params) {
          try {
            const subject = safeHeaderValue(params.subject, "subject");
            if (!subject) throw new Error("subject is required");

            const token = await getMicrosoftAccessToken([
              "Calendars.ReadWrite",
            ]);
            const headers = {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              "User-Agent": "nexus-kit-openclaw",
            };

            const created = await providerJsonRequest(
              "https://graph.microsoft.com/v1.0/me/events",
              "POST",
              headers,
              {
                subject,
                body: {
                  contentType: "Text",
                  content: params.body ?? "",
                },
                start: {
                  dateTime: params.start,
                  timeZone: params.timeZone,
                },
                end: {
                  dateTime: params.end,
                  timeZone: params.timeZone,
                },
              },
            );

            const eventId =
              created.ok &&
              created.body &&
              typeof created.body === "object" &&
              "id" in created.body &&
              typeof (created.body as { id?: unknown }).id === "string"
                ? (created.body as { id: string }).id
                : null;

            if (!created.ok || !eventId) {
              return {
                content: [
                  {
                    type: "text",
                    text: JSON.stringify(
                      {
                        ok: false,
                        stage: "create",
                        status: created.status,
                        body: created.body,
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }

            const verify = await providerGet(
              `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(eventId)}?$select=id,subject,start,end`,
              headers,
            );

            const persisted =
              verify.ok &&
              verify.body &&
              typeof verify.body === "object" &&
              "id" in verify.body &&
              (verify.body as { id?: unknown }).id === eventId;

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: Boolean(persisted),
                      eventId,
                      postconditionVerified: Boolean(persisted),
                      verificationStatus: verify.status,
                      body: verify.body,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
            };
          }
        },
      },
      { optional: true },
    );

    api.registerTool({
      name: "nexus_google_get",
      description:
        "Perform an independently authenticated read-only GET against Gmail, Google Calendar, Google Drive, or Google People using OAuth credentials on the OpenClaw host. This does not use a ChatGPT connector.",
      parameters: Type.Object({
        service: Type.Union([
          Type.Literal("gmail"),
          Type.Literal("calendar"),
          Type.Literal("drive"),
          Type.Literal("people"),
        ]),
        path: Type.String({
          description:
            "Provider-relative API path such as Gmail /users/me/profile, Calendar /users/me/calendarList, Drive /files?pageSize=10, or People /people/me?personFields=names,emailAddresses.",
        }),
      }),
      async execute(_id, params) {
        try {
          const token = await getGoogleAccessToken();
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(`${googleServiceBase(params.service)}${apiPath}`, {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "nexus-kit-openclaw",
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool(
      {
        name: "nexus_gmail_send",
        description:
          "Send a plain-text email through the independently authenticated Gmail API on the OpenClaw host. This is a consequential write tool and does not use a ChatGPT connector.",
        parameters: Type.Object({
          to: Type.String(),
          subject: Type.String(),
          body: Type.String(),
        }),
        async execute(_id, params) {
          try {
            const to = safeHeaderValue(params.to, "to");
            const subject = safeHeaderValue(params.subject, "subject");

            if (!to) {
              throw new Error("to is required");
            }

            const token = await getGoogleAccessToken();
            const mime = [
              `To: ${to}`,
              `Subject: ${subject}`,
              "MIME-Version: 1.0",
              'Content-Type: text/plain; charset="UTF-8"',
              "",
              params.body,
            ].join("\r\n");

            const response = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  "User-Agent": "nexus-kit-openclaw",
                },
                body: JSON.stringify({ raw: base64UrlEncode(mime) }),
                redirect: "error",
              },
            );

            const text = await response.text();
            let body: unknown = text;
            try {
              body = text ? JSON.parse(text) : null;
            } catch {
              // Keep non-JSON text.
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: response.ok,
                      status: response.status,
                      body,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
            };
          }
        },
      },
      { optional: true },
    );
  },
});
