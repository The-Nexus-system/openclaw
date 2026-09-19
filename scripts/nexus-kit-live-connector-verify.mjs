#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const target = (process.argv[2] || "all").toLowerCase();
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const PROBES = [
  "github",
  "digitalocean",
  "gmail",
  "google-calendar",
  "google-drive",
  "google-contacts",
  "microsoft-graph",
  "dropbox",
  "notion",
  "linear",
  "zoom",
  "figma",
  "canva",
  "adobe-photoshop",
  "expo-eas",
  "twilio",
  "facebook-pages",
  "instagram",
  "threads",
  "spotify",
  "openai-api",
  "meta-developer",
  "app-store-connect",
  "google-play",
  "metricool",
];

function out(record) {
  process.stdout.write(JSON.stringify(record) + "\n");
}

function parseNestedJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function findField(value, field) {
  value = parseNestedJson(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findField(item, field);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      return value[field];
    }
    for (const child of Object.values(value)) {
      const found = findField(child, field);
      if (found !== undefined) return found;
    }
  }

  return undefined;
}

function collectText(value, output = []) {
  value = parseNestedJson(value);

  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return output;
  }

  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectText(child, output);
  }

  return output;
}

function looksUnconfigured(value) {
  const text = collectText(value).join(" ").toLowerCase();
  return [
    "not configured",
    "must be configured",
    "is required",
    "missing",
    "does not exist",
    "not installed",
    "not available in path",
    "must point to",
  ].some((marker) => text.includes(marker));
}

function invokeProbe(connector) {
  const params = JSON.stringify({
    name: "nexus_connector_probe",
    args: { connector },
  });

  const proc = spawnSync(
    "openclaw",
    [
      "gateway",
      "call",
      "tools.invoke",
      "--params",
      params,
      "--json",
      "--timeout",
      "60000",
    ],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    },
  );

  if (proc.error) {
    return {
      connector,
      state: "failed",
      error: proc.error.message,
    };
  }

  const stdout = proc.stdout?.trim() || "";
  let payload;
  try {
    payload = stdout ? JSON.parse(stdout) : {};
  } catch {
    return {
      connector,
      state: "failed",
      error: "OpenClaw gateway call returned non-JSON output.",
      exitCode: proc.status,
    };
  }

  if (proc.status !== 0) {
    return {
      connector,
      state: looksUnconfigured(payload) ? "unconfigured" : "failed",
      exitCode: proc.status,
      error: findField(payload, "message") ?? "Gateway tool invocation failed.",
    };
  }

  const readVerified = findField(payload, "readVerified");
  const checks = findField(payload, "checks");
  const phase = findField(payload, "phase");
  const error = findField(payload, "error");

  if (readVerified === true) {
    return {
      connector,
      state: "read-verified",
      ...(checks !== undefined ? { checks } : {}),
    };
  }

  if (readVerified === false) {
    return {
      connector,
      state: looksUnconfigured(payload) ? "unconfigured" : "failed",
      ...(phase !== undefined ? { phase } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(checks !== undefined ? { checks } : {}),
    };
  }

  return {
    connector,
    state: "failed",
    error: "Connector probe returned no readVerified result.",
  };
}


function invokeMetricoolProbe() {
  const script = path.join(REPO_ROOT, "scripts", "nexus-kit-metricool-probe");
  const proc = spawnSync("python3", [script], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
  });

  if (proc.error) {
    return {
      connector: "metricool",
      state: "failed",
      error: proc.error.message,
    };
  }

  const lines = (proc.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  let payload;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      payload = JSON.parse(lines[index]);
      break;
    } catch {
      // Ignore non-JSON diagnostic lines and keep looking for the probe record.
    }
  }

  if (!payload || typeof payload !== "object") {
    return {
      connector: "metricool",
      state: "failed",
      exitCode: proc.status,
      error: "Metricool MCP probe returned no JSON result.",
    };
  }

  const state = payload.state;
  if (state === "read-verified" || state === "unconfigured") {
    return payload;
  }

  return {
    ...payload,
    connector: "metricool",
    state: "failed",
    ...(proc.status !== 0 ? { exitCode: proc.status } : {}),
  };
}

const selected = target === "all" ? PROBES : [target];

let failures = 0;
for (const connector of selected) {
  if (!PROBES.includes(connector)) {
    out({ connector, state: "unknown-connector" });
    failures += 1;
    continue;
  }

  const result = connector === "metricool" ? invokeMetricoolProbe() : invokeProbe(connector);
  out(result);
  if (result.state === "failed" || result.state === "unknown-connector") {
    failures += 1;
  }
}

process.exitCode = failures ? 1 : 0;
