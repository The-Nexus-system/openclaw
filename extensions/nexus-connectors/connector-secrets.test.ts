import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  connectorSecretSource,
  getConnectorSecret,
  getRotatingConnectorSecret,
  setConnectorSecret,
} from "./connector-secrets.js";

const originalFile = process.env.NEXUS_CONNECTOR_SECRETS_FILE;

function tempStore(): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-connector-secrets-"));
  const file = path.join(dir, "connector-secrets.json");
  process.env.NEXUS_CONNECTOR_SECRETS_FILE = file;
  return { dir, file };
}

afterEach(() => {
  if (originalFile === undefined) {
    delete process.env.NEXUS_CONNECTOR_SECRETS_FILE;
  } else {
    process.env.NEXUS_CONNECTOR_SECRETS_FILE = originalFile;
  }
  delete process.env.NEXUS_TEST_SECRET;
});

describe("connector secret store", () => {
  it("stores and resolves a protected file secret", () => {
    const { file } = tempStore();

    setConnectorSecret("NEXUS_TEST_SECRET", "file-value");

    expect(getConnectorSecret("NEXUS_TEST_SECRET")).toBe("file-value");
    expect(connectorSecretSource("NEXUS_TEST_SECRET")).toBe("file");

    if (process.platform !== "win32") {
      const mode = fs.statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("lets an environment value override the protected file for static secrets", () => {
    tempStore();
    setConnectorSecret("NEXUS_TEST_SECRET", "file-value");
    process.env.NEXUS_TEST_SECRET = "env-value";

    expect(getConnectorSecret("NEXUS_TEST_SECRET")).toBe("env-value");
    expect(connectorSecretSource("NEXUS_TEST_SECRET")).toBe("env");
  });

  it("lets a persisted rotated value override the bootstrap environment value", () => {
    tempStore();
    process.env.NEXUS_TEST_SECRET = "bootstrap-value";
    setConnectorSecret("NEXUS_TEST_SECRET", "rotated-value");

    expect(getRotatingConnectorSecret("NEXUS_TEST_SECRET")).toBe("rotated-value");
    expect(getConnectorSecret("NEXUS_TEST_SECRET")).toBe("bootstrap-value");
  });

  it("rejects group or world-readable secret files on POSIX", () => {
    if (process.platform === "win32") return;

    const { file } = tempStore();
    fs.writeFileSync(file, JSON.stringify({ NEXUS_TEST_SECRET: "unsafe" }), {
      encoding: "utf8",
      mode: 0o644,
    });
    fs.chmodSync(file, 0o644);

    expect(() => getConnectorSecret("NEXUS_TEST_SECRET")).toThrow(
      /must not grant group or world access/u,
    );
  });

  it("rejects a symlinked secret store", () => {
    const { dir, file } = tempStore();
    const target = path.join(dir, "target.json");
    fs.writeFileSync(target, JSON.stringify({ NEXUS_TEST_SECRET: "unsafe" }), {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.symlinkSync(target, file);

    expect(() => getConnectorSecret("NEXUS_TEST_SECRET")).toThrow(
      /must not be a symbolic link/u,
    );
  });
});
