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
