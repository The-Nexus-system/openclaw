import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { hasConnectorSecret, connectorSecretSource, getConnectorSecret } from "./connector-secrets.js";
import type { ConnectorRegistry } from "./shared.js";
import {
  resolveRegistryPath,
  loadRegistry,
  providerGet,
  getGoogleAccessToken,
  ConnectorProbeError,
  getMicrosoftAccessToken,
  dropboxApi,
  notionHeaders,
  linearGraphql,
  getZoomAccessToken,
  zoomTargetUser,
  runExpoProjectRead,
  spotifyGet,
} from "./shared.js";
import {
  appStoreConnectGet,
  googlePlayGet,
  googlePlayPackageName,
  metaDeveloperAppRead,
  openAIGet,
} from "./developer-shared.js";
import {
  facebookManagedPages,
  instagramProfessionalIdentity,
  threadsIdentity,
  twilioAccountSid,
  twilioGet,
} from "./social-shared.js";
import {
  adobePhotoshopHeaders,
  canvaHeaders,
  figmaHeaders,
  getAdobePhotoshopAccessToken,
  getCanvaAccessToken,
} from "./creative-shared.js";

export function registerStatusTools(api: OpenClawPluginApi) {
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
              markers.map((name) => [name, hasConnectorSecret(name)]),
            );
            const alternativeStatus = alternatives.map((group) => ({
              markers: Object.fromEntries(group.map((name) => [name, hasConnectorSecret(name)])),
              satisfied: group.every((name) => hasConnectorSecret(name)),
            }));
            const optionalCredentialMarkers = Object.fromEntries(
              optionalMarkers.map((name) => [name, hasConnectorSecret(name)]),
            );

            return {
              id: item.id,
              provider: item.provider ?? item.id,
              priority: item.priority ?? null,
              state: item.state ?? "unknown",
              routes: item.routes ?? [],
              targetCapabilities: item.targetCapabilities ?? [],
              credentialMarkers,
              credentialSources: Object.fromEntries(
                markers.map((name) => [name, connectorSecretSource(name)]),
              ),
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
          Type.Literal("linear"),
          Type.Literal("zoom"),
          Type.Literal("figma"),
          Type.Literal("canva"),
          Type.Literal("adobe-photoshop"),
          Type.Literal("expo-eas"),
          Type.Literal("twilio"),
          Type.Literal("facebook-pages"),
          Type.Literal("instagram"),
          Type.Literal("threads"),
          Type.Literal("openai-api"),
          Type.Literal("meta-developer"),
          Type.Literal("app-store-connect"),
          Type.Literal("google-play"),
          Type.Literal("spotify"),
        ]),
      }),
      async execute(_id, params) {
        const checks: Array<{ name: string; ok: boolean; status: number }> = [];
        try {

          if (params.connector === "github") {
            const token = getConnectorSecret("GITHUB_TOKEN");
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
            const token = getConnectorSecret("DIGITALOCEAN_ACCESS_TOKEN");
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

          if (params.connector === "figma") {
            const result = await providerGet(
              "https://api.figma.com/v1/me",
              figmaHeaders(),
            );
            checks.push({ name: "figma-me", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "account",
                `Figma account probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "canva") {
            const token = await getCanvaAccessToken();
            const result = await providerGet(
              "https://api.canva.com/rest/v1/users/me",
              canvaHeaders(token),
            );
            checks.push({ name: "canva-user", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "account",
                `Canva user probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "adobe-photoshop") {
            const token = await getAdobePhotoshopAccessToken();
            const result = await providerGet(
              "https://image.adobe.io/pie/psdService/hello",
              adobePhotoshopHeaders(token),
            );
            checks.push({ name: "adobe-photoshop-hello", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "hello",
                `Adobe Photoshop hello probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "zoom") {
            const auth = await getZoomAccessToken();
            const userId = zoomTargetUser(auth.mode);
            const result = await providerGet(
              `https://api.zoom.us/v2/users/${encodeURIComponent(userId)}/meetings?type=previous_meetings&page_size=1`,
              {
                Authorization: `Bearer ${auth.token}`,
                Accept: "application/json",
                "User-Agent": "nexus-kit-openclaw",
              },
            );
            checks.push({ name: "zoom-meetings", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "meetings",
                `Zoom meetings probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "linear") {
            const result = await linearGraphql(
              "query NexusKitViewer { viewer { id name email } }",
            );
            checks.push({ name: "linear-viewer", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "viewer",
                `Linear viewer probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "notion") {
            const result = await providerGet(
              "https://api.notion.com/v1/users/me",
              notionHeaders(),
            );
            checks.push({ name: "notion-user", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "user",
                `Notion user probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "dropbox") {
            const result = await dropboxApi("users/get_current_account", {});
            checks.push({ name: "dropbox-account", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "account",
                `Dropbox account probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "expo-eas") {
            const result = await runExpoProjectRead("status", 1);
            checks.push({ name: "expo-project-status", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "project",
                `Expo EAS project probe failed with status ${result.status}`,
              );
            }
          }

          if (params.connector === "twilio") {
            const accountSid = twilioAccountSid();
            const result = await twilioGet(
              `/Accounts/${encodeURIComponent(accountSid)}.json`,
            );
            checks.push({ name: "twilio-account", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "account",
                `Twilio account probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "facebook-pages") {
            const result = await facebookManagedPages(1);
            checks.push({ name: "facebook-pages", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "pages",
                `Facebook Pages probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "instagram") {
            const result = await instagramProfessionalIdentity(1);
            checks.push({ name: "instagram-professional", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "instagram",
                `Instagram professional account probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "threads") {
            const result = await threadsIdentity();
            checks.push({ name: "threads-profile", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "threads",
                `Threads profile probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "openai-api") {
            const result = await openAIGet("/models");
            checks.push({ name: "openai-models", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "models",
                `OpenAI models probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "meta-developer") {
            const result = await metaDeveloperAppRead();
            checks.push({ name: "meta-developer-app", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "app",
                `Meta developer app probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "app-store-connect") {
            const result = await appStoreConnectGet("/apps?limit=1");
            checks.push({ name: "app-store-connect-apps", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "apps",
                `App Store Connect apps probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "google-play") {
            const packageName = googlePlayPackageName();
            const result = await googlePlayGet(
              `/applications/${encodeURIComponent(packageName)}/reviews?maxResults=1`,
            );
            checks.push({ name: "google-play-reviews", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "reviews",
                `Google Play reviews probe failed with HTTP ${result.status}`,
              );
            }
          }

          if (params.connector === "spotify") {
            const result = await spotifyGet("/me");
            checks.push({ name: "spotify-profile", ok: result.ok, status: result.status });
            if (!result.ok) {
              throw new ConnectorProbeError(
                "profile",
                `Spotify profile probe failed with HTTP ${result.status}`,
              );
            }
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

}
