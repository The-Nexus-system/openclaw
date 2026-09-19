import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerGeneralTools } from "./general-tools.js";
import { registerGoogleTools } from "./google-tools.js";
import { registerMicrosoftTools } from "./microsoft-tools.js";
import { registerStatusTools } from "./status-tools.js";
async function getAdobePhotoshopAccessToken(): Promise<string> {
  const direct = process.env.ADOBE_PHOTOSHOP_ACCESS_TOKEN;
  if (direct) return direct;

  const clientId = process.env.ADOBE_PHOTOSHOP_CLIENT_ID;
  const clientSecret = process.env.ADOBE_PHOTOSHOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Configure ADOBE_PHOTOSHOP_ACCESS_TOKEN or ADOBE_PHOTOSHOP_CLIENT_ID and ADOBE_PHOTOSHOP_CLIENT_SECRET on the OpenClaw host.",
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope:
      process.env.ADOBE_PHOTOSHOP_SCOPES?.trim() ||
      "openid,AdobeID,read_organizations",
  });

  const response = await fetch("https://ims-na1.adobelogin.com/ims/token/v3", {
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
      data.error_description ?? data.error ?? `Adobe IMS HTTP ${response.status}`,
    );
  }

  return data.access_token;
}

function adobePhotoshopHeaders(token: string): Record<string, string> {
  const clientId = process.env.ADOBE_PHOTOSHOP_CLIENT_ID;
  if (!clientId) {
    throw new Error("ADOBE_PHOTOSHOP_CLIENT_ID is required as the Adobe x-api-key.");
  }

  return {
    Authorization: `Bearer ${token}`,
    "x-api-key": clientId,
    Accept: "application/json, text/plain;q=0.9",
    "User-Agent": "nexus-kit-openclaw",
  };
}

export default definePluginEntry({
  id: "nexus-connectors",
  name: "Nexus Connectors",
  description:
    "Portable connector readiness and independent provider access for the Nexus Kit gateway.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      registryPath: {
        type: "string",
      },
    },
  },
  register(api) {
    registerStatusTools(api);
    registerGeneralTools(api);
    registerMicrosoftTools(api);
    registerGoogleTools(api);
  },
});
