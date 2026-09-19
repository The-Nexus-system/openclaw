import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

type RegisteredTool = {
  name: string;
  execute: (id: string, params: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
};

function registerTools() {
  const tools: RegisteredTool[] = [];

  plugin.register({
    pluginConfig: {},
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  } as never);

  return tools;
}

function getTool(name: string) {
  const tool = registerTools().find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`tool not registered: ${name}`);
  }
  return tool;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("nexus-connectors registration contract", () => {
  it("registers the complete portable connector tool surface", () => {
    const names = registerTools().map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "nexus_connector_status",
        "nexus_connector_probe",
        "nexus_github_get",
        "nexus_digitalocean_get",
        "nexus_google_get",
        "nexus_gmail_send",
        "nexus_microsoft_graph_get",
        "nexus_outlook_send_mail",
        "nexus_outlook_create_event",
        "nexus_dropbox_read",
        "nexus_notion_read",
        "nexus_linear_read",
        "nexus_zoom_read",
        "nexus_figma_read",
        "nexus_canva_read",
        "nexus_adobe_photoshop_get",
      ]),
    );

    expect(new Set(names).size).toBe(names.length);
  });
});

describe("nexus-connectors Microsoft health probe", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.MICROSOFT_CLIENT_ID = "test-client";
    process.env.MICROSOFT_REFRESH_TOKEN = "test-refresh";
    process.env.MICROSOFT_TENANT_ID = "common";
    delete process.env.MICROSOFT_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks Microsoft Graph read-verified only after identity, mail, and calendar all succeed", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/oauth2/v2.0/token")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ access_token: "test-access" });
      }

      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer test-access",
      );

      if (url.includes("/v1.0/me?$select=")) {
        return jsonResponse({
          id: "user-id",
          displayName: "Nexus System",
          userPrincipalName: "nexus@example.com",
        });
      }

      if (url.includes("/v1.0/me/mailFolders/inbox")) {
        return jsonResponse({
          id: "inbox-id",
          displayName: "Inbox",
          totalItemCount: 10,
          unreadItemCount: 2,
        });
      }

      if (url.includes("/v1.0/me/calendars")) {
        return jsonResponse({ value: [{ id: "calendar-id", name: "Calendar" }] });
      }

      return jsonResponse({ error: "unexpected URL", url }, 404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "microsoft-graph" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(true);
    expect(payload.checks).toEqual([
      { name: "graph-identity", ok: true, status: 200 },
      { name: "outlook-mail", ok: true, status: 200 },
      { name: "outlook-calendar", ok: true, status: 200 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("refuses to mark Microsoft Graph read-verified when calendar access fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/oauth2/v2.0/token")) {
        return jsonResponse({ access_token: "test-access" });
      }
      if (url.includes("/v1.0/me?$select=")) {
        return jsonResponse({ id: "user-id" });
      }
      if (url.includes("/v1.0/me/mailFolders/inbox")) {
        return jsonResponse({ id: "inbox-id" });
      }
      if (url.includes("/v1.0/me/calendars")) {
        return jsonResponse({ error: { code: "ErrorAccessDenied" } }, 403);
      }

      return jsonResponse({ error: "unexpected URL", url }, 404);
    });

    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "microsoft-graph" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(false);
    expect(payload.phase).toBe("calendar");
    expect(payload.checks).toEqual([
      { name: "graph-identity", ok: true, status: 200 },
      { name: "outlook-mail", ok: true, status: 200 },
      { name: "outlook-calendar", ok: false, status: 403 },
    ]);
  });

  it("reports missing independent Microsoft credentials instead of claiming access", async () => {
    delete process.env.MICROSOFT_REFRESH_TOKEN;

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "microsoft-graph" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(false);
    expect(payload.phase).toBe("credentials");
    expect(payload.checks).toEqual([]);
    expect(payload.error).toContain("MICROSOFT_CLIENT_ID and MICROSOFT_REFRESH_TOKEN");
  });
});


describe("nexus-connectors Dropbox health probe", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DROPBOX_ACCESS_TOKEN;
    delete process.env.DROPBOX_APP_KEY;
    delete process.env.DROPBOX_APP_SECRET;
    delete process.env.DROPBOX_REFRESH_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks Dropbox read-verified when a direct access token reaches the account endpoint", async () => {
    process.env.DROPBOX_ACCESS_TOKEN = "dropbox-direct";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://api.dropboxapi.com/2/users/get_current_account");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer dropbox-direct",
      );
      return jsonResponse({
        account_id: "dbid:test",
        name: { display_name: "Nexus System" },
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "dropbox" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(true);
    expect(payload.checks).toEqual([
      { name: "dropbox-account", ok: true, status: 200 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes Dropbox OAuth before probing the account endpoint", async () => {
    process.env.DROPBOX_APP_KEY = "app-key";
    process.env.DROPBOX_APP_SECRET = "app-secret";
    process.env.DROPBOX_REFRESH_TOKEN = "refresh-token";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "https://api.dropboxapi.com/oauth2/token") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ access_token: "dropbox-refreshed" });
      }

      expect(url).toBe("https://api.dropboxapi.com/2/users/get_current_account");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer dropbox-refreshed",
      );
      return jsonResponse({ account_id: "dbid:test" });
    });

    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "dropbox" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the Dropbox account stage when authentication succeeds but the provider rejects the probe", async () => {
    process.env.DROPBOX_ACCESS_TOKEN = "dropbox-direct";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error_summary: "invalid_access_token/" }, 401)),
    );

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "dropbox" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(false);
    expect(payload.phase).toBe("account");
    expect(payload.checks).toEqual([
      { name: "dropbox-account", ok: false, status: 401 },
    ]);
  });

  it("reports missing Dropbox credentials without attempting a provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "dropbox" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(false);
    expect(payload.phase).toBe("credentials");
    expect(payload.checks).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe("nexus-connectors provider health probes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of [
      "FIGMA_TOKEN",
      "FIGMA_ACCESS_TOKEN",
      "ADOBE_PHOTOSHOP_ACCESS_TOKEN",
      "ADOBE_PHOTOSHOP_CLIENT_ID",
      "ADOBE_PHOTOSHOP_CLIENT_SECRET",
      "NOTION_TOKEN",
      "NOTION_ACCESS_TOKEN",
      "LINEAR_API_KEY",
      "LINEAR_ACCESS_TOKEN",
      "ZOOM_ACCESS_TOKEN",
      "ZOOM_CLIENT_ID",
      "ZOOM_CLIENT_SECRET",
      "ZOOM_REFRESH_TOKEN",
      "ZOOM_ACCOUNT_ID",
      "ZOOM_USER_ID",
      "CANVA_ACCESS_TOKEN",
      "CANVA_CLIENT_ID",
      "CANVA_CLIENT_SECRET",
      "CANVA_REFRESH_TOKEN",
      "CANVA_SECRET_STATE",
      "NEXUS_KIT_SECRET_STATE_DIR",
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const cases = [
    {
      connector: "figma",
      expectedUrl: "https://api.figma.com/v1/me",
      check: "figma-me",
      setup: () => {
        process.env.FIGMA_TOKEN = "figma-test";
      },
    },
    {
      connector: "canva",
      expectedUrl: "https://api.canva.com/rest/v1/users/me",
      check: "canva-user",
      setup: () => {
        process.env.CANVA_ACCESS_TOKEN = "canva-test";
      },
    },
    {
      connector: "adobe-photoshop",
      expectedUrl: "https://image.adobe.io/pie/psdService/hello",
      check: "adobe-photoshop-hello",
      setup: () => {
        process.env.ADOBE_PHOTOSHOP_ACCESS_TOKEN = "adobe-test";
        process.env.ADOBE_PHOTOSHOP_CLIENT_ID = "adobe-client";
      },
    },
    {
      connector: "notion",
      expectedUrl: "https://api.notion.com/v1/users/me",
      check: "notion-user",
      setup: () => {
        process.env.NOTION_TOKEN = "notion-test";
      },
    },
    {
      connector: "linear",
      expectedUrl: "https://api.linear.app/graphql",
      check: "linear-viewer",
      setup: () => {
        process.env.LINEAR_API_KEY = "linear-test";
      },
    },
    {
      connector: "zoom",
      expectedUrl:
        "https://api.zoom.us/v2/users/me/meetings?type=previous_meetings&page_size=1",
      check: "zoom-meetings",
      setup: () => {
        process.env.ZOOM_ACCESS_TOKEN = "zoom-test";
      },
    },
  ] as const;

  it.each(cases)(
    "marks $connector read-verified only after reaching its provider endpoint",
    async ({ connector, expectedUrl, check, setup }) => {
      setup();
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(expectedUrl);
        return jsonResponse({ data: { viewer: { id: "test" } } });
      });
      vi.stubGlobal("fetch", fetchMock);

      const tool = getTool("nexus_connector_probe");
      const result = await tool.execute("test", { connector });
      const payload = JSON.parse(result.content[0].text);

      expect(payload.readVerified).toBe(true);
      expect(payload.checks).toEqual([{ name: check, ok: true, status: 200 }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("rotates Canva refresh tokens into protected private host state", async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "nexus-canva-test-"));
    process.env.NEXUS_KIT_SECRET_STATE_DIR = stateDir;
    process.env.CANVA_CLIENT_ID = "canva-client";
    process.env.CANVA_CLIENT_SECRET = "canva-secret";
    process.env.CANVA_REFRESH_TOKEN = "canva-refresh-original";

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "https://api.canva.com/rest/v1/oauth/token") {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          access_token: "canva-access",
          refresh_token: "canva-refresh-rotated",
          scope: "design:meta:read",
        });
      }

      expect(url).toBe("https://api.canva.com/rest/v1/users/me");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer canva-access",
      );
      return jsonResponse({ user: { id: "canva-user" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const tool = getTool("nexus_connector_probe");
      const result = await tool.execute("test", { connector: "canva" });
      const payload = JSON.parse(result.content[0].text);

      expect(payload.readVerified).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const stored = JSON.parse(
        readFileSync(path.join(stateDir, "canva.json"), "utf8"),
      );
      expect(stored.refresh_token).toBe("canva-refresh-rotated");
      expect(stored.scope).toBe("design:meta:read");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("keeps Figma unverified when the provider rejects the token", async () => {
    process.env.FIGMA_TOKEN = "figma-test";
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ message: "unauthorized" }, 401)));

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "figma" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(false);
    expect(payload.phase).toBe("account");
    expect(payload.checks).toEqual([{ name: "figma-me", ok: false, status: 401 }]);
  });

  it("reports Adobe credential failure before making a provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tool = getTool("nexus_connector_probe");
    const result = await tool.execute("test", { connector: "adobe-photoshop" });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.readVerified).toBe(false);
    expect(payload.phase).toBe("credentials");
    expect(payload.checks).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
