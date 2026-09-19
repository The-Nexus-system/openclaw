import { ConnectorProbeError, providerGet } from "./shared.js";
import { getConnectorSecret } from "./connector-secrets.js";

export function twilioHeaders(): Record<string, string> {
  const accountSid = getConnectorSecret("TWILIO_ACCOUNT_SID");
  const apiKeySid =
    getConnectorSecret("TWILIO_API_KEY_SID") ??
    getConnectorSecret("TWILIO_API_KEY");
  const apiKeySecret =
    getConnectorSecret("TWILIO_API_KEY_SECRET") ??
    getConnectorSecret("TWILIO_API_SECRET");
  const authToken = getConnectorSecret("TWILIO_AUTH_TOKEN");

  if (!accountSid) {
    throw new ConnectorProbeError(
      "credentials",
      "TWILIO_ACCOUNT_SID is not configured.",
    );
  }

  let username: string;
  let password: string;

  if (apiKeySid && apiKeySecret) {
    username = apiKeySid;
    password = apiKeySecret;
  } else if (authToken) {
    username = accountSid;
    password = authToken;
  } else {
    throw new ConnectorProbeError(
      "credentials",
      "Configure a Twilio API key SID/secret, or TWILIO_AUTH_TOKEN.",
    );
  }

  const basic = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return {
    Authorization: `Basic ${basic}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  };
}

export function twilioAccountSid(): string {
  const value = getConnectorSecret("TWILIO_ACCOUNT_SID")?.trim();
  if (!value) {
    throw new ConnectorProbeError(
      "credentials",
      "TWILIO_ACCOUNT_SID is not configured.",
    );
  }
  return value;
}

export async function twilioGet(relativePath: string) {
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return providerGet(`https://api.twilio.com/2010-04-01${path}`, twilioHeaders());
}

export function metaGraphVersion(): string {
  const configured = getConnectorSecret("META_GRAPH_VERSION")?.trim();
  if (!configured) return "v26.0";
  return configured.startsWith("v") ? configured : `v${configured}`;
}

export function metaUserAccessToken(): string {
  const token =
    getConnectorSecret("META_USER_ACCESS_TOKEN") ??
    getConnectorSecret("META_ACCESS_TOKEN");
  if (!token) {
    throw new ConnectorProbeError(
      "credentials",
      "META_USER_ACCESS_TOKEN or META_ACCESS_TOKEN is not configured.",
    );
  }
  return token;
}

export function metaBearerHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "nexus-kit-openclaw",
  };
}

export async function facebookManagedPages(limit = 25) {
  const version = metaGraphVersion();
  const token = metaUserAccessToken();
  const query = new URLSearchParams({
    fields: "id,name,tasks",
    limit: String(Math.max(1, Math.min(limit, 100))),
  });
  return providerGet(
    `https://graph.facebook.com/${version}/me/accounts?${query.toString()}`,
    metaBearerHeaders(token),
  );
}

export async function instagramProfessionalIdentity(limit = 25) {
  const direct = getConnectorSecret("INSTAGRAM_ACCESS_TOKEN");
  const version = metaGraphVersion();

  if (direct) {
    const query = new URLSearchParams({
      fields: "id,username",
    });
    return providerGet(
      `https://graph.instagram.com/${version}/me?${query.toString()}`,
      metaBearerHeaders(direct),
    );
  }

  const token = metaUserAccessToken();
  const query = new URLSearchParams({
    fields: "id,name,instagram_business_account{id,username}",
    limit: String(Math.max(1, Math.min(limit, 100))),
  });
  return providerGet(
    `https://graph.facebook.com/${version}/me/accounts?${query.toString()}`,
    metaBearerHeaders(token),
  );
}

export async function threadsIdentity() {
  const token = getConnectorSecret("THREADS_ACCESS_TOKEN");
  if (!token) {
    throw new ConnectorProbeError(
      "credentials",
      "THREADS_ACCESS_TOKEN is not configured.",
    );
  }
  const query = new URLSearchParams({
    fields: "id,username,name",
  });
  return providerGet(
    `https://graph.threads.net/me?${query.toString()}`,
    metaBearerHeaders(token),
  );
}
