import { getConnectorSecret } from "./connector-secrets.js";
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
