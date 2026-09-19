import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { providerGet } from "./shared.js";
import {
  canvaHeaders,
  figmaHeaders,
  getCanvaAccessToken,
} from "./creative-shared.js";

export function registerCreativeTools(api: OpenClawPluginApi) {
api.registerTool({
      name: "nexus_figma_read",
      description:
        "Read Figma through an independently authenticated OpenClaw route. Supports user identity, file content, file metadata, and comments without using a ChatGPT connector.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("me"),
          Type.Literal("file"),
          Type.Literal("file_metadata"),
          Type.Literal("comments"),
        ]),
        fileKey: Type.Optional(Type.String()),
        depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
      async execute(_id, params) {
        try {
          const headers = figmaHeaders();

          if (params.operation === "me") {
            const result = await providerGet("https://api.figma.com/v1/me", headers);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          const fileKey = params.fileKey?.trim();
          if (!fileKey) throw new Error("fileKey is required for this Figma operation");

          let url: string;
          if (params.operation === "file") {
            const query = new URLSearchParams();
            if (params.depth) query.set("depth", String(params.depth));
            url =
              `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}` +
              (query.size ? `?${query.toString()}` : "");
          } else if (params.operation === "file_metadata") {
            url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/meta`;
          } else {
            url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`;
          }

          const result = await providerGet(url, headers);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });


    api.registerTool({
      name: "nexus_canva_read",
      description:
        "Read Canva account identity/profile through an independently authenticated OpenClaw route without using a ChatGPT connector.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("me"),
          Type.Literal("profile"),
        ]),
      }),
      async execute(_id, params) {
        try {
          const token = await getCanvaAccessToken();
          const url =
            params.operation === "profile"
              ? "https://api.canva.com/rest/v1/users/me/profile"
              : "https://api.canva.com/rest/v1/users/me";
          const result = await providerGet(url, canvaHeaders(token));
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });
}
