import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

const {
  providerGet,
  getMicrosoftAccessToken,
  runExpoProjectRead,
  facebookManagedPages,
  instagramProfessionalIdentity,
  threadsIdentity,
  twilioAccountSid,
  twilioGet,
  openAIGet,
  metaDeveloperAppRead,
} = vi.hoisted(() => ({
  providerGet: vi.fn(),
  getMicrosoftAccessToken: vi.fn(),
  runExpoProjectRead: vi.fn(),
  facebookManagedPages: vi.fn(),
  instagramProfessionalIdentity: vi.fn(),
  threadsIdentity: vi.fn(),
  twilioAccountSid: vi.fn(),
  twilioGet: vi.fn(),
  openAIGet: vi.fn(),
  metaDeveloperAppRead: vi.fn(),
}));

vi.mock("./shared.js", () => ({
  resolveRegistryPath: vi.fn(() => "/tmp/connectors.json"),
  loadRegistry: vi.fn(() => ({ connectors: [] })),
  providerGet,
  getGoogleAccessToken: vi.fn(),
  ConnectorProbeError: class ConnectorProbeError extends Error {
    phase: string;
    constructor(phase: string, message: string) {
      super(message);
      this.phase = phase;
    }
  },
  getMicrosoftAccessToken,
  dropboxApi: vi.fn(),
  notionHeaders: vi.fn(),
  linearGraphql: vi.fn(),
  getZoomAccessToken: vi.fn(),
  zoomTargetUser: vi.fn(),
  runExpoProjectRead,
}));

vi.mock("./developer-shared.js", () => ({
  openAIGet,
  metaDeveloperAppRead,
}));

vi.mock("./social-shared.js", () => ({
  facebookManagedPages,
  instagramProfessionalIdentity,
  threadsIdentity,
  twilioAccountSid,
  twilioGet,
}));

vi.mock("./creative-shared.js", () => ({
  adobePhotoshopHeaders: vi.fn(),
  canvaHeaders: vi.fn(),
  figmaHeaders: vi.fn(),
  getAdobePhotoshopAccessToken: vi.fn(),
  getCanvaAccessToken: vi.fn(),
}));

import { registerStatusTools } from "./status-tools.js";

type RegisteredTool = {
  name: string;
  execute: (id: string, params: { connector: string }) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
};

function registerAndGetProbe(): RegisteredTool {
  const tools: RegisteredTool[] = [];
  const api = {
    pluginConfig: {},
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  } as unknown as OpenClawPluginApi;

  registerStatusTools(api);
  const probe = tools.find((tool) => tool.name === "nexus_connector_probe");
  if (!probe) {
    throw new Error("nexus_connector_probe was not registered");
  }
  return probe;
}

function response(ok = true, status = 200) {
  return { ok, status, body: {} };
}

describe("nexus_connector_probe Microsoft Graph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMicrosoftAccessToken.mockResolvedValue("test-token");
  });

  it("marks Microsoft Graph read-verified only after identity, mail, and calendar succeed", async () => {
    providerGet
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response());

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "microsoft-graph" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(true);
    expect(payload.checks).toEqual([
      { name: "graph-identity", ok: true, status: 200 },
      { name: "outlook-mail", ok: true, status: 200 },
      { name: "outlook-calendar", ok: true, status: 200 },
    ]);

    expect(providerGet).toHaveBeenNthCalledWith(
      1,
      "https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail",
      expect.objectContaining({ Authorization: "Bearer test-token" }),
    );
    expect(providerGet).toHaveBeenNthCalledWith(
      2,
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id,displayName,totalItemCount,unreadItemCount",
      expect.objectContaining({ Authorization: "Bearer test-token" }),
    );
    expect(providerGet).toHaveBeenNthCalledWith(
      3,
      "https://graph.microsoft.com/v1.0/me/calendars?$top=1&$select=id,name",
      expect.objectContaining({ Authorization: "Bearer test-token" }),
    );
  });

  it("does not mark Microsoft Graph verified when mail access fails", async () => {
    providerGet
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(false, 403));

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "microsoft-graph" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(false);
    expect(payload.phase).toBe("mail");
    expect(payload.checks).toEqual([
      { name: "graph-identity", ok: true, status: 200 },
      { name: "outlook-mail", ok: false, status: 403 },
    ]);
    expect(providerGet).toHaveBeenCalledTimes(2);
  });

  it("does not call Graph when Microsoft authentication fails", async () => {
    getMicrosoftAccessToken.mockRejectedValueOnce(new Error("token refresh failed"));

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "microsoft-graph" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(false);
    expect(payload.checks).toEqual([]);
    expect(payload.error).toBe("token refresh failed");
    expect(providerGet).not.toHaveBeenCalled();
  });
});


describe("nexus_connector_probe social providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    twilioAccountSid.mockReturnValue("ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("marks Twilio read-verified only after the account endpoint succeeds", async () => {
    twilioGet.mockResolvedValue(response());

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "twilio" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(true);
    expect(payload.checks).toEqual([
      { name: "twilio-account", ok: true, status: 200 },
    ]);
    expect(twilioGet).toHaveBeenCalledWith(
      "/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
    );
  });

  it("does not mark Facebook Pages verified when the Pages API denies access", async () => {
    facebookManagedPages.mockResolvedValue(response(false, 403));

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "facebook-pages" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(false);
    expect(payload.checks).toEqual([
      { name: "facebook-pages", ok: false, status: 403 },
    ]);
  });

  it("marks Instagram verified after the professional-account route succeeds", async () => {
    instagramProfessionalIdentity.mockResolvedValue(response());

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "instagram" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(true);
    expect(payload.checks).toEqual([
      { name: "instagram-professional", ok: true, status: 200 },
    ]);
  });

  it("marks Threads verified after the profile endpoint succeeds", async () => {
    threadsIdentity.mockResolvedValue(response());

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "threads" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(true);
    expect(payload.checks).toEqual([
      { name: "threads-profile", ok: true, status: 200 },
    ]);
  });
});


describe("nexus_connector_probe developer platforms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks OpenAI read-verified only after the live models endpoint succeeds", async () => {
    openAIGet.mockResolvedValue(response());

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "openai-api" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(true);
    expect(payload.checks).toEqual([
      { name: "openai-models", ok: true, status: 200 },
    ]);
    expect(openAIGet).toHaveBeenCalledWith("/models");
  });

  it("does not mark OpenAI verified when the API key is denied", async () => {
    openAIGet.mockResolvedValue(response(false, 401));

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "openai-api" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(false);
    expect(payload.checks).toEqual([
      { name: "openai-models", ok: false, status: 401 },
    ]);
  });

  it("marks Meta Developer verified after the configured app object is readable", async () => {
    metaDeveloperAppRead.mockResolvedValue(response());

    const probe = registerAndGetProbe();
    const result = await probe.execute("test", { connector: "meta-developer" });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");

    expect(payload.readVerified).toBe(true);
    expect(payload.checks).toEqual([
      { name: "meta-developer-app", ok: true, status: 200 },
    ]);
  });
});
