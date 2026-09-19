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

export default definePluginEntry({
  id: "nexus-connectors",
  name: "Nexus Connectors",
  description: "Portable connector readiness and route discovery for the Nexus Kit gateway.",
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
  },
});
