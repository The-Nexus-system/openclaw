import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { metaDeveloperAppRead, openAIGet } from "./developer-shared.js";

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
        const result =
          params.operation === "models"
            ? await openAIGet("/models")
            : await openAIGet(
                `/models/${encodeURIComponent(params.model?.trim() || "")}`,
              );

        if (params.operation === "model" && !params.model?.trim()) {
          throw new Error("model is required for model retrieval");
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
}
