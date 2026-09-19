import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  facebookManagedPages,
  instagramProfessionalIdentity,
  threadsIdentity,
  twilioAccountSid,
  twilioGet,
} from "./social-shared.js";

export function registerSocialTools(api: OpenClawPluginApi) {
  api.registerTool({
    name: "nexus_twilio_read",
    description:
      "Read Twilio account resources through independently stored OpenClaw credentials. Supports account identity, phone numbers, and recent messages. This tool does not send messages or place calls.",
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal("account"),
        Type.Literal("phone_numbers"),
        Type.Literal("messages"),
      ]),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      try {
        const accountSid = twilioAccountSid();
        let result;

        if (params.operation === "account") {
          result = await twilioGet(`/Accounts/${encodeURIComponent(accountSid)}.json`);
        } else if (params.operation === "phone_numbers") {
          const query = new URLSearchParams({
            PageSize: String(params.limit ?? 20),
          });
          result = await twilioGet(
            `/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?${query.toString()}`,
          );
        } else {
          const query = new URLSearchParams({
            PageSize: String(params.limit ?? 20),
          });
          result = await twilioGet(
            `/Accounts/${encodeURIComponent(accountSid)}/Messages.json?${query.toString()}`,
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
    name: "nexus_facebook_pages_read",
    description:
      "Read Facebook Pages managed by the independently authorized Meta account. Returns Page identities/tasks without returning Page access tokens.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      try {
        const result = await facebookManagedPages(params.limit ?? 25);
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
    name: "nexus_instagram_read",
    description:
      "Verify/read the independently authorized Instagram professional-account identity. Uses direct Instagram Login when configured, otherwise the Facebook-linked professional account route.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      try {
        const result = await instagramProfessionalIdentity(params.limit ?? 25);
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
    name: "nexus_threads_read",
    description:
      "Read the independently authorized Threads profile identity through the official Threads API.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const result = await threadsIdentity();
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
