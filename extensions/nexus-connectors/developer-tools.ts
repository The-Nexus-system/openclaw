import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { appStoreConnectGet, googlePlayGet, googlePlayPackageName, metaDeveloperAppRead, openAIGet } from "./developer-shared.js";

export function registerDeveloperTools(api: OpenClawPluginApi) {
  api.registerTool({
    name: "nexus_openai_read",
    description:
      "Read the independently configured OpenAI API project. Supports model listing/retrieval without using the ChatGPT connector surface.",
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal("models"),
        Type.Literal("model"),
      ]),
      model: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      try {
        if (params.operation === "model" && !params.model?.trim()) {
          throw new Error("model is required for model retrieval");
        }

        const result =
          params.operation === "models"
            ? await openAIGet("/models")
            : await openAIGet(
                `/models/${encodeURIComponent(params.model!.trim())}`,
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

  api.registerTool({
    name: "nexus_meta_developer_read",
    description:
      "Read the independently configured Meta developer app object through Graph API. This verifies app-level developer access rather than Page/social access.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const result = await metaDeveloperAppRead();
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
    name: "nexus_app_store_connect_read",
    description:
      "Read App Store Connect through Kit's independently stored API key. Supports listing apps and builds without using the App Store Connect web UI.",
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal("apps"),
        Type.Literal("builds"),
      ]),
      appId: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    }),
    async execute(_id, params) {
      try {
        const limit = params.limit ?? 20;
        let result;

        if (params.operation === "apps") {
          result = await appStoreConnectGet(
            `/apps?limit=${limit}&fields%5Bapps%5D=name,bundleId,sku,primaryLocale`,
          );
        } else {
          const appId = params.appId?.trim();
          if (!appId) throw new Error("appId is required for App Store Connect build retrieval");
          result = await appStoreConnectGet(
            `/builds?limit=${limit}&filter%5Bapp%5D=${encodeURIComponent(appId)}`,
          );
        }

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
    name: "nexus_google_play_read",
    description:
      "Read the configured Google Play app through the Android Publisher API using Kit's independent machine credentials. Supports recent reviews without using the Play Console web UI.",
    parameters: Type.Object({
      operation: Type.Literal("reviews"),
      maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      try {
        const packageName = googlePlayPackageName();
        const query = new URLSearchParams({
          maxResults: String(params.maxResults ?? 20),
        });
        const result = await googlePlayGet(
          `/applications/${encodeURIComponent(packageName)}/reviews?${query.toString()}`,
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
