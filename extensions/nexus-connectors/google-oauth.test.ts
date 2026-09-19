import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

const { getConnectorSecret, setConnectorSecret } = vi.hoisted(() => ({
  getConnectorSecret: vi.fn(),
  setConnectorSecret: vi.fn(),
}));

vi.mock("./connector-secrets.js", () => ({
  getConnectorSecret,
  setConnectorSecret,
}));

import { registerGoogleOAuth } from "./google-oauth.js";

type Tool = {
  name: string;
  execute: () => Promise<{ content: Array<{ type: string; text: string }> }>;
};

type Route = {
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
};

function fakeApi() {
  const tools: Tool[] = [];
  const routes: Route[] = [];
  const api = {
    registerTool(tool: Tool) {
      tools.push(tool);
    },
    registerHttpRoute(route: Route) {
      routes.push(route);
    },
  } as unknown as OpenClawPluginApi;

  registerGoogleOAuth(api);

  const tool = tools.find((item) => item.name === "nexus_google_oauth_start");
  const route = routes.find((item) => item.path === "/nexus-kit/oauth/google/callback");
  if (!tool || !route) throw new Error("Google OAuth registrations missing");

  return { tool, route };
}

function responseCollector() {
  const headers = new Map<string, string>();
  const state = {
    statusCode: 200,
    body: "",
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) this.body += String(chunk);
    },
  };
  return { response: state as unknown as ServerResponse, state, headers };
}

describe("Google OAuth callback", () => {
  let tempDir: string;
  const originalStateDir = process.env.NEXUS_KIT_OAUTH_STATE_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-google-oauth-"));
    process.env.NEXUS_KIT_OAUTH_STATE_DIR = tempDir;

    getConnectorSecret.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_REDIRECT_URI: "https://kit.example/nexus-kit/oauth/google/callback",
      };
      return values[name];
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalStateDir === undefined) {
      delete process.env.NEXUS_KIT_OAUTH_STATE_DIR;
    } else {
      process.env.NEXUS_KIT_OAUTH_STATE_DIR = originalStateDir;
    }
  });

  it("creates a short-lived approval URL without exposing tokens", async () => {
    const { tool } = fakeApi();
    const result = await tool.execute();
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.ok).toBe(true);
    expect(payload.expiresInMinutes).toBe(15);

    const authUrl = new URL(payload.authorizationUrl);
    expect(authUrl.origin + authUrl.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(authUrl.searchParams.get("redirect_uri")).toBe(
      "https://kit.example/nexus-kit/oauth/google/callback",
    );
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("prompt")).toBe("consent");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("state")).toBeTruthy();
    expect(authUrl.searchParams.get("scope")).toContain("gmail.modify");

    expect(result.content[0]?.text).not.toContain("client-secret");
  });

  it("rejects a callback with the wrong security state", async () => {
    const { tool, route } = fakeApi();
    await tool.execute();

    const { response, state } = responseCollector();
    await route.handler(
      {
        method: "GET",
        headers: { host: "kit.example" },
        url: "/nexus-kit/oauth/google/callback?code=test-code&state=wrong-state",
      } as IncomingMessage,
      response,
    );

    expect(state.statusCode).toBe(403);
    expect(state.body).toContain("could not be verified");
    expect(setConnectorSecret).not.toHaveBeenCalled();
  });

  it("exchanges a valid one-time callback and stores the refresh token", async () => {
    const { tool, route } = fakeApi();
    const start = await tool.execute();
    const payload = JSON.parse(start.content[0]?.text ?? "{}");
    const authUrl = new URL(payload.authorizationUrl);
    const stateValue = authUrl.searchParams.get("state");
    if (!stateValue) throw new Error("missing state");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "temporary-access-token",
          refresh_token: "durable-refresh-token",
          scope: "scope-a scope-b",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { response, state } = responseCollector();
    await route.handler(
      {
        method: "GET",
        headers: { host: "kit.example" },
        url:
          "/nexus-kit/oauth/google/callback?code=test-code&state=" +
          encodeURIComponent(stateValue),
      } as IncomingMessage,
      response,
    );

    expect(state.statusCode).toBe(200);
    expect(state.body).toContain("authorization complete");
    expect(state.body).not.toContain("durable-refresh-token");

    expect(setConnectorSecret).toHaveBeenCalledWith(
      "GOOGLE_REFRESH_TOKEN",
      "durable-refresh-token",
    );
    expect(setConnectorSecret).toHaveBeenCalledWith(
      "GOOGLE_GRANTED_SCOPES",
      "scope-a scope-b",
    );

    const fetchBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(fetchBody).toContain("code=test-code");
    expect(fetchBody).toContain("code_verifier=");
    expect(fetchBody).toContain(
      "redirect_uri=https%3A%2F%2Fkit.example%2Fnexus-kit%2Foauth%2Fgoogle%2Fcallback",
    );
  });

  it("cannot reuse the same valid callback twice", async () => {
    const { tool, route } = fakeApi();
    const start = await tool.execute();
    const payload = JSON.parse(start.content[0]?.text ?? "{}");
    const stateValue = new URL(payload.authorizationUrl).searchParams.get("state");
    if (!stateValue) throw new Error("missing state");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            access_token: "temporary",
            refresh_token: "refresh",
          }),
      }),
    );

    const first = responseCollector();
    await route.handler(
      {
        method: "GET",
        headers: { host: "kit.example" },
        url:
          "/nexus-kit/oauth/google/callback?code=one&state=" +
          encodeURIComponent(stateValue),
      } as IncomingMessage,
      first.response,
    );
    expect(first.state.statusCode).toBe(200);

    const second = responseCollector();
    await route.handler(
      {
        method: "GET",
        headers: { host: "kit.example" },
        url:
          "/nexus-kit/oauth/google/callback?code=two&state=" +
          encodeURIComponent(stateValue),
      } as IncomingMessage,
      second.response,
    );
    expect(second.state.statusCode).toBe(400);
  });
});
