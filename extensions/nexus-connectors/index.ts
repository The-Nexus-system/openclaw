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

async function getMicrosoftAccessToken(): Promise<string> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const refreshToken = process.env.MICROSOFT_REFRESH_TOKEN;
  const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || "common";
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const scope =
    process.env.MICROSOFT_SCOPES?.trim() ||
    "openid offline_access User.Read Mail.Read Calendars.Read";

  if (!clientId || !refreshToken) {
    throw new Error(
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
    throw new Error(`Microsoft token refresh returned non-JSON HTTP ${response.status}`);
  }

  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ??
        body.error ??
        `Microsoft token refresh failed with HTTP ${response.status}`,
    );
  }

  return body.access_token;
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
            const credentialMarkers = Object.fromEntries(
              markers.map((name) => [name, Boolean(process.env[name])]),
            );

            return {
              id: item.id,
              provider: item.provider ?? item.id,
              priority: item.priority ?? null,
              state: item.state ?? "unknown",
              routes: item.routes ?? [],
              targetCapabilities: item.targetCapabilities ?? [],
              credentialMarkers,
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
