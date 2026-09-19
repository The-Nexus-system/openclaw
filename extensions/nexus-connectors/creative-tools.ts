import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { normalizeApiPath, providerGet } from "./shared.js";
import {
  adobePhotoshopHeaders,
  canvaHeaders,
  figmaHeaders,
  getAdobePhotoshopAccessToken,
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
        "Read Canva through an independently authenticated OpenClaw route. Supports account identity/profile, design listing, and single-design metadata without using a ChatGPT connector.",
      parameters: Type.Object({
        operation: Type.Union([
          Type.Literal("me"),
          Type.Literal("profile"),
          Type.Literal("designs"),
          Type.Literal("design"),
        ]),
        designId: Type.Optional(Type.String()),
      }),
      async execute(_id, params) {
        try {
          const token = await getCanvaAccessToken();
          let url: string;
          if (params.operation === "profile") {
            url = "https://api.canva.com/rest/v1/users/me/profile";
          } else if (params.operation === "designs") {
            url = "https://api.canva.com/rest/v1/designs";
          } else if (params.operation === "design") {
            const designId = params.designId?.trim();
            if (!designId) {
              throw new Error("designId is required for Canva design retrieval");
            }
            url = `https://api.canva.com/rest/v1/designs/${encodeURIComponent(designId)}`;
          } else {
            url = "https://api.canva.com/rest/v1/users/me";
          }
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

    api.registerTool({
      name: "nexus_adobe_photoshop_get",
      description:
        "Perform an independently authenticated read-only GET against the Adobe Photoshop/Firefly Services image API. Use provider-relative paths only. This does not use the ChatGPT Adobe connector.",
      parameters: Type.Object({
        path: Type.String({
          description:
            "Adobe image API provider-relative path such as /pie/psdService/hello or another documented read/status endpoint.",
        }),
      }),
      async execute(_id, params) {
        try {
          const token = await getAdobePhotoshopAccessToken();
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(
            `https://image.adobe.io${apiPath}`,
            adobePhotoshopHeaders(token),
          );
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
