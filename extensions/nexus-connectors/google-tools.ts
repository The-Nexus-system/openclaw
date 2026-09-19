import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  normalizeApiPath,
  providerGet,
  getGoogleAccessToken,
  googleServiceBase,
  base64UrlEncode,
  safeHeaderValue,
} from "./shared.js";

export function registerGoogleTools(api: OpenClawPluginApi) {
    api.registerTool({
      name: "nexus_google_get",
      description:
        "Perform an independently authenticated read-only GET against Gmail, Google Calendar, Google Drive, or Google People using OAuth credentials on the OpenClaw host. This does not use a ChatGPT connector.",
      parameters: Type.Object({
        service: Type.Union([
          Type.Literal("gmail"),
          Type.Literal("calendar"),
          Type.Literal("drive"),
          Type.Literal("people"),
        ]),
        path: Type.String({
          description:
            "Provider-relative API path such as Gmail /users/me/profile, Calendar /users/me/calendarList, Drive /files?pageSize=10, or People /people/me?personFields=names,emailAddresses.",
        }),
      }),
      async execute(_id, params) {
        try {
          const token = await getGoogleAccessToken();
          const apiPath = normalizeApiPath(params.path);
          const result = await providerGet(`${googleServiceBase(params.service)}${apiPath}`, {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "User-Agent": "nexus-kit-openclaw",
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
          };
        }
      },
    });

    api.registerTool(
      {
        name: "nexus_gmail_send",
        description:
          "Send a plain-text email through the independently authenticated Gmail API on the OpenClaw host. This is a consequential write tool and does not use a ChatGPT connector.",
        parameters: Type.Object({
          to: Type.String(),
          subject: Type.String(),
          body: Type.String(),
        }),
        async execute(_id, params) {
          try {
            const to = safeHeaderValue(params.to, "to");
            const subject = safeHeaderValue(params.subject, "subject");

            if (!to) {
              throw new Error("to is required");
            }

            const token = await getGoogleAccessToken();
            const mime = [
              `To: ${to}`,
              `Subject: ${subject}`,
              "MIME-Version: 1.0",
              'Content-Type: text/plain; charset="UTF-8"',
              "",
              params.body,
            ].join("\r\n");

            const response = await fetch(
              "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  "User-Agent": "nexus-kit-openclaw",
                },
                body: JSON.stringify({ raw: base64UrlEncode(mime) }),
                redirect: "error",
              },
            );

            const text = await response.text();
            let body: unknown = text;
            try {
              body = text ? JSON.parse(text) : null;
            } catch {
              // Keep non-JSON text.
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: response.ok,
                      status: response.status,
                      body,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [{ type: "text", text: JSON.stringify({ ok: false, error: message }) }],
            };
          }
        },
      },
      { optional: true },
    );
}
