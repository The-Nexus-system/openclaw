import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCanvaAccessToken } from "./creative-shared.js";

describe("Canva OAuth refresh durability", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";
  let secretPath = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-canva-"));
    secretPath = path.join(tempDir, "connector-secrets.json");

    process.env.NEXUS_CONNECTOR_SECRETS_FILE = secretPath;
    delete process.env.CANVA_ACCESS_TOKEN;
    process.env.CANVA_CLIENT_ID = "canva-client";
    process.env.CANVA_CLIENT_SECRET = "canva-secret";
    process.env.CANVA_REFRESH_TOKEN = "bootstrap-refresh";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses the persisted rotated token instead of reusing the bootstrap environment token", async () => {
    const refreshBodies: string[] = [];
    let call = 0;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.canva.com/rest/v1/oauth/token");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);

      refreshBodies.push(String(init?.body));
      call += 1;

      return new Response(
        JSON.stringify({
          access_token: `fresh-access-${call}`,
          refresh_token: `rotated-refresh-${call}`,
          expires_in: 14400,
          token_type: "Bearer",
          scope: "design:meta:read",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    expect(await getCanvaAccessToken()).toBe("fresh-access-1");
    expect(await getCanvaAccessToken()).toBe("fresh-access-2");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshBodies[0]).toContain("refresh_token=bootstrap-refresh");
    expect(refreshBodies[1]).toContain("refresh_token=rotated-refresh-1");

    const saved = JSON.parse(fs.readFileSync(secretPath, "utf8")) as {
      CANVA_REFRESH_TOKEN?: string;
    };
    expect(saved.CANVA_REFRESH_TOKEN).toBe("rotated-refresh-2");
  });
});
