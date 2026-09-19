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
    secretPath = path.join(tempDir, "canva.json");

    delete process.env.CANVA_ACCESS_TOKEN;
    process.env.CANVA_CLIENT_ID = "canva-client";
    process.env.CANVA_CLIENT_SECRET = "canva-secret";
    process.env.CANVA_REFRESH_TOKEN = "bootstrap-refresh";
    process.env.CANVA_SECRET_STATE = secretPath;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists Canva's rotated refresh token and does not immediately reuse the one-use token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.canva.com/rest/v1/oauth/token");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      expect(String(init?.body)).toContain("refresh_token=bootstrap-refresh");

      return new Response(
        JSON.stringify({
          access_token: "fresh-access",
          refresh_token: "rotated-refresh",
          expires_in: 14400,
          token_type: "Bearer",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    vi.stubGlobal("fetch", fetchMock);

    const first = await getCanvaAccessToken();
    const second = await getCanvaAccessToken();

    expect(first).toBe("fresh-access");
    expect(second).toBe("fresh-access");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(fs.readFileSync(secretPath, "utf8")) as {
      refreshToken?: string;
    };
    expect(saved.refreshToken).toBe("rotated-refresh");
  });
});
