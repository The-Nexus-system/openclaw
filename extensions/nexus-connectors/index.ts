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
    // Preserve non-JSON response text.
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

export default definePluginEntry({
  id: "nexus-connectors",
  name: "Nexus Connectors",
  description: "Portable connector readiness and independent provider access for the Nexus Kit gateway.",
  register(api) {
    api.registerTool({
      name: "nexus_connector_status",
      description:
        "Inspect the Nexus Kit independent connector registry. Reports routes, target capabilities, declared state, and whether required credential environment variables are present. It never returns credential values and does not prove live provider access.",
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
        "Perform an independently authenticated read-only GET against the GitHub REST API using GITHUB_TOKEN on the OpenClaw host. Use provider-relative API paths only. This does not use a ChatGPT connector.",
      parameters: Type.Object({
        path: Type.String({
          description: "GitHub REST API path such as /repos/OWNER/REPO or /user/repos?per_page=20.",
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
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }] };
        }
      },
    });

    api.registerTool({
      name: "nexus_digitalocean_get",
      description:
        "Perform an independently authenticated read-only GET against the DigitalOcean v2 API using DIGITALOCEAN_ACCESS_TOKEN on the OpenClaw host. Use provider-relative v2 paths only. This does not use a ChatGPT connector.",
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
          return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }] };
        }
      },
    });
  },
});
