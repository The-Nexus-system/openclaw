import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type SecretMap = Record<string, string>;

function secretsPath(): string {
  return (
    process.env.NEXUS_CONNECTOR_SECRETS_FILE?.trim() ||
    path.join(os.homedir(), ".openclaw", "kit", "connector-secrets.json")
  );
}

function assertSafeSecretsFile(file: string): void {
  const stat = fs.lstatSync(file);

  if (stat.isSymbolicLink()) {
    throw new Error("connector secret store must not be a symbolic link");
  }
  if (!stat.isFile()) {
    throw new Error("connector secret store must be a regular file");
  }

  if (process.platform !== "win32") {
    if (typeof process.geteuid === "function" && stat.uid !== process.geteuid()) {
      throw new Error("connector secret store must be owned by the OpenClaw user");
    }
    if ((stat.mode & 0o077) !== 0) {
      throw new Error("connector secret store permissions must not grant group or world access");
    }
  }
}

function readFileSecrets(): SecretMap {
  const file = secretsPath();
  if (!fs.existsSync(file)) {
    return {};
  }

  assertSafeSecretsFile(file);

  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("connector secret store must contain a JSON object");
  }

  const result: SecretMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 0) {
      result[key] = value;
    }
  }
  return result;
}

export function getConnectorSecret(name: string): string | undefined {
  const envValue = process.env[name];
  if (envValue && envValue.length > 0) {
    return envValue;
  }
  return readFileSecrets()[name];
}

export function getRotatingConnectorSecret(name: string): string | undefined {
  const fileValue = readFileSecrets()[name];
  if (fileValue && fileValue.length > 0) {
    return fileValue;
  }
  const envValue = process.env[name];
  return envValue && envValue.length > 0 ? envValue : undefined;
}

export function hasConnectorSecret(name: string): boolean {
  return Boolean(getConnectorSecret(name));
}

export function connectorSecretSource(name: string): "env" | "file" | null {
  const envValue = process.env[name];
  if (envValue && envValue.length > 0) {
    return "env";
  }
  const fileValue = readFileSecrets()[name];
  return fileValue ? "file" : null;
}

export function setConnectorSecret(name: string, value: string): void {
  if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(name)) {
    throw new Error("connector secret name must be an uppercase environment-style identifier");
  }
  if (!value) {
    throw new Error("connector secret value must not be empty");
  }

  const file = secretsPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  let current: SecretMap = {};
  if (fs.existsSync(file)) {
    current = readFileSecrets();
  }

  current[name] = value;

  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(current, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "w",
  });

  if (process.platform !== "win32") {
    fs.chmodSync(temp, 0o600);
  }

  fs.renameSync(temp, file);

  if (process.platform !== "win32") {
    fs.chmodSync(file, 0o600);
  }

  assertSafeSecretsFile(file);
}

export function connectorSecretsFile(): string {
  return secretsPath();
}
