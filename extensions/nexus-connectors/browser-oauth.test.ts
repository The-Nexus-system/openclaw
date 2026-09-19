import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

const { getConnectorSecret, setConnectorSecret } = vi.hoisted(() => ({
  getConnectorSecret: vi.fn(),
  setConnectorSecret: vi.fn(),
}));

vi.mock("./connector-secrets.js", () => ({
  getConnectorSecret,
  setConnectorSecret,
}));

import { registerBrowserOAuth } from "./browser-oauth.js";

type Tool = {
  name: string;
  execute: (
    id: string,
    params: { provider: "dropbox" | "canva" | "spotify" | "zoom" },
  ) => Promise<{ content: Array<{ type: string; text: string }> }>;
};

type Route = {
  path: string;
  handler: (
    req: IncomingMessage,
    res: ServerResponse,
  ) => Promise<boolean | void> | boolean | void;
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

  registerBrowserOAuth(api);

  const tool = tools.find((item) => item.name === "nexus_browser_oauth_start");
  if (!tool) throw new Error("browser OAuth start tool missing");

  return { tool, routes };
}

function responseCollector() {
  const state = {
    statusCode: 200,
    body: "",
    setHeader() {},
    end(chunk?: unknown) {
      if (chunk !== undefined) this.body += String(chunk);
    },
  };
  return { response: state as unknown as ServerResponse, state };
}

describe("shared browser OAuth", () => {
  let tempDir: string;
  const originalStateDir = process.env.NEXUS_KIT_OAUTH_STATE_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-browser-oauth-"));
    process.env.NEXUS_KIT_OAUTH_STATE_DIR = tempDir;

    getConnectorSecret.mockImplementation((name: string) => {
      const values: Record<string, string> = {
        DROPBOX_APP_KEY: "dropbox-client",
        DROPBOX_APP_SECRET: "dropbox-secret",
        DROPBOX_REDIRECT_URI: "https://kit.example/nexus-kit/oauth/dropbox/callback",

        CANVA_CLIENT_ID: "canva-client",
        CANVA_CLIENT_SECRET: "canva-secret",
        CANVA_REDIRECT_URI: "https://kit.example/nexus-kit/oauth/canva/callback",

        SPOTIFY_CLIENT_ID: "spotify-client",
        SPOTIFY_CLIENT_SECRET: "spotify-secret",
        SPOTIFY_REDIRECT_URI: "https://kit.example/nexus-kit/oauth/spotify/callback",

        ZOOM_CLIENT_ID: "zoom-client",
        ZOOM_CLIENT_SECRET: "zoom-secret",
        ZOOM_REDIRECT_URI: "https://kit.example/nexus-kit/oauth/zoom/callback",
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

  it("uses offline access for Dropbox and PKCE for Canva", async () => {
    const { tool } = fakeApi();

    const dropboxStart = await tool.execute("test", { provider: "dropbox" });
    const dropboxPayload = JSON.parse(dropboxStart.content[0]?.text ?? "{}");
    const dropboxUrl = new URL(dropboxPayload.authorizationUrl);

    expect(dropboxUrl.searchParams.get("token_access_type")).toBe("offline");
    expect(dropboxUrl.searchParams.get("state")).toBeTruthy();

    const canvaStart = await tool.execute("test", { provider: "canva" });
    const canvaPayload = JSON.parse(canvaStart.content[0]?.text ?? "{}");
    const canvaUrl = new URL(canvaPayload.authorizationUrl);

    expect(canvaUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(canvaUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(canvaUrl.searchParams.get("scope")).toContain("profile:read");
  });

  it("rejects a wrong state without exchanging a code", async () => {
    const { tool, routes } = fakeApi();
    await tool.execute("test", { provider: "canva" });

    const route = routes.find(
      (item) => item.path === "/nexus-kit/oauth/canva/callback",
    );
    if (!route) throw new Error("Canva callback route missing");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { response, state } = responseCollector();
    await route.handler(
      {
        method: "GET",
        headers: { host: "kit.example" },
        url: "/nexus-kit/oauth/canva/callback?code=test-code&state=wrong",
      } as IncomingMessage,
      response,
    );

    expect(state.statusCode).toBe(403);
    expect(setConnectorSecret).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores a Canva refresh token after a valid PKCE callback without displaying it", async () => {
    const { tool, routes } = fakeApi();
    const start = await tool.execute("test", { provider: "canva" });
    const payload = JSON.parse(start.content[0]?.text ?? "{}");
    const stateValue = new URL(payload.authorizationUrl).searchParams.get("state");
    if (!stateValue) throw new Error("state missing");

    const route = routes.find(
      (item) => item.path === "/nexus-kit/oauth/canva/callback",
    );
    if (!route) throw new Error("Canva callback route missing");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          access_token: "temporary-access",
          refresh_token: "rotated-refresh",
          scope: "profile:read design:meta:read",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { response, state } = responseCollector();
    await route.handler(
      {
        method: "GET",
        headers: { host: "kit.example" },
        url:
          "/nexus-kit/oauth/canva/callback?code=test-code&state=" +
          encodeURIComponent(stateValue),
      } as IncomingMessage,
      response,
    );

    expect(state.statusCode).toBe(200);
    expect(state.body).toContain("authorization complete");
    expect(state.body).not.toContain("rotated-refresh");
    expect(setConnectorSecret).toHaveBeenCalledWith(
      "CANVA_REFRESH_TOKEN",
      "rotated-refresh",
    );

    const requestBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? "");
    expect(requestBody).toContain("grant_type=authorization_code");
    expect(requestBody).toContain("code=test-code");
    expect(requestBody).toContain("code_verifier=");
  });

  it("cannot replay a successful callback", async () => {
    const { tool, routes } = fakeApi();
    const start = await tool.execute("test", { provider: "spotify" });
    const payload = JSON.parse(start.content[0]?.text ?? "{}");
    const stateValue = new URL(payload.authorizationUrl).searchParams.get("state");
    if (!stateValue) throw new Error("state missing");

    const route = routes.find(
      (item) => item.path === "/nexus-kit/oauth/spotify/callback",
    );
    if (!route) throw new Error("Spotify callback route missing");

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
          "/nexus-kit/oauth/spotify/callback?code=one&state=" +
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
          "/nexus-kit/oauth/spotify/callback?code=two&state=" +
          encodeURIComponent(stateValue),
      } as IncomingMessage,
      second.response,
    );
    expect(second.state.statusCode).toBe(400);
  });
});
